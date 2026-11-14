import { selectProbabilisticRecipe, type RecipeRandomSource } from "../recipe-selection";
import type {
  CompiledSimulationDevice,
  CompiledSimulationNode,
  CompiledSimulationRecipeChannel,
  CompiledSimulationRecipeItem,
  CompiledSimulationRecipePlan,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  RegionalWarehouseWriteContext,
  SimulationAcceptRule,
  SimulationItemDomain,
  SimulationItemDomainFilter,
} from "../contracts";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { convertSimulationSecondsToTicksExact } from "../contracts";
import {
  ENTITY_INPUT_ROUTING_STRATEGY,
  ENTITY_SIMULATION_BEHAVIOR_TYPE,
} from "@/domain/registry/types/entity-simulation-behavior";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
import type {
  RuntimeDeviceRecipeState,
  RuntimeRecipeItem,
  RuntimeReservedItem,
  RuntimeSlotState,
  SimulationMutableRuntimeState,
} from "./runtime-state";
import { readAdmissionOutputRemainingAllowance } from "./runtime-state";
import { canRecipeFinishAtCurrentPhase, resolveTransportRecipeTiming } from "./phase-gating";
import { isDeviceInRequiredGasDiffusion } from "./gas-diffusion";
import {
  WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
  WATER_PURIFIER_BYPRODUCT_RECIPE_ID,
  WATER_PURIFIER_COLLECT_RECIPE_ID,
  WATER_PURIFIER_INTAKE_CHANNEL_IDS,
  WATER_PURIFIER_NODE_ENTITY_ID,
} from "@/shared/water-purifier-node";
import {
  CONSUMPTION_RECIPE_CHANNEL_TYPE,
  CONSUMPTION_RECIPE_TAG,
} from "@/shared/consumption-channel";
import {
  ItemDomainFlag,
  resolveRecipeItemDomainFlags,
} from "@/domain/shared/item-domain-flags";
import {
  isItemAvailableByActivity,
  isRecipeAvailableByActivity,
} from "@/shared/registry/activity-availability";

const WAREHOUSE_SINK_TAG = "WarehouseSink";

/**
 * 配方计划只依赖已编译拓扑中的设备、channel 与配方定义；运行时库存只决定该计划当前能否启动。
 * 用 WeakMap 将计划生命周期绑定到 topology，避免每次启动配方以及每个历史检查点重复创建同一静态对象。
 */
const recipePlanCacheByTopology = new WeakMap<
  CompiledSimulationTopology,
  Map<string, Map<string, Map<string, CompiledSimulationRecipePlan>>>
>();

/** 文档级 link 涉及的设备存储组；内部 input/output-view link 不计为设备已外连。 */
const documentLinkedStorageGroupsByTopology = new WeakMap<
  CompiledSimulationTopology,
  ReadonlySet<string>
>();



export interface IngredientSlotContent {
  readonly slotId: string;
  readonly itemType: string;
  readonly availableAmount: number;
}

export function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  const visited = new Set<string>();
  let current = slotId;

  while (true) {
    if (visited.has(current)) {
      return slotId;
    }
    visited.add(current);

    const next = state.persistent.shareAllTargetSlotIdBySourceSlotId[current];
    if (next === undefined || next === current) {
      return current;
    }

    current = next;
  }
}

/**
 * 沿 share-all 链向上查找 ignoreStock。
 * 若链上任意槽位 ignoreStock=true，则整个链条视为无限输出。
 * 对应《仿真运行原理》§7.2 share-all 写入代理模型 ——
 *   source 端读写全部代理到 target 端存储，ignoreStock 作为 slot 属性应沿链继承。
 * 订正（2026-05-15）：ignoreStock 不再仅是编译槽位局部属性，支持跨链 OR 语义。
 */
export function resolveEffectiveIgnoreStock(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  slotId: string,
): boolean {
  const visited = new Set<string>();
  let current = slotId;

  while (true) {
    if (visited.has(current)) {
      // 防御性：避免因数据错误导致死循环
      return false;
    }
    visited.add(current);

    const slot = topology.slots[current];
    if (slot?.ignoreStock) {
      return true;
    }

    const next = state.persistent.shareAllTargetSlotIdBySourceSlotId[current];
    if (next === undefined || next === current) {
      return false;
    }

    current = next;
  }
}

export function getReservedAmount(
  state: SimulationMutableRuntimeState,
  storageSlotId: string,
): number {
  const perf = state.transient._perf;
  const lookupStartedAt = perf === undefined ? 0 : performance.now();
  if (perf !== undefined) {
    perf.getReservedCalls += 1;
    perf.reservedLookupCalls += 1;
  }

  if (state.transient.reservedAmountByStorageSlotId === null) {
    const buildStartedAt = perf === undefined ? 0 : performance.now();
    const index: Record<string, number> = {};
    for (const deviceState of Object.values(state.persistent.devices)) {
      for (const recipe of Object.values(deviceState.channelRecipes)) {
        if (recipe === null) continue;
        for (const reservation of recipe.reservations) {
          if (reservation.ignoreStock) continue;
          index[reservation.slotId] = (index[reservation.slotId] ?? 0) + reservation.amount;
        }
      }
    }
    state.transient.reservedAmountByStorageSlotId = index;
    if (perf !== undefined) {
      perf.reservedIndexBuilds += 1;
      perf.reservedIndexBuildMs += performance.now() - buildStartedAt;
    }
  }

  const result = state.transient.reservedAmountByStorageSlotId[storageSlotId] ?? 0;
  if (perf !== undefined) {
    perf.reservedLookupMs += performance.now() - lookupStartedAt;
  }
  return result;
}

export function adjustReservedAmounts(
  state: SimulationMutableRuntimeState,
  reservations: readonly RuntimeReservedItem[],
  direction: 1 | -1,
): void {
  const index = state.transient.reservedAmountByStorageSlotId;
  if (index === null || reservations.length === 0) return;
  const perf = state.transient._perf;
  if (perf !== undefined) perf.reservationAdjustCalls += 1;
  for (const reservation of reservations) {
    if (reservation.ignoreStock) continue;
    const next = (index[reservation.slotId] ?? 0) + reservation.amount * direction;
    if (next > 0) index[reservation.slotId] = next;
    else delete index[reservation.slotId];
  }
}

export function acceptsItem(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  rule: SimulationAcceptRule,
  itemType: string,
): boolean {
  if (rule.exclude.includes(itemType)) {
    return false;
  }

  switch (rule.base.kind) {
    case "domain":
      return (requireActiveItemDomain(registry, topology, itemType) & rule.base.flags) !== 0;
    case "item":
      return rule.base.itemId === itemType;
    case "none":
      return false;
  }
}

export function findInputSlotForItem(options: {
  registry: RegistryContract;
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  const perf = options.state.transient._perf;
  if (perf !== undefined) { perf.findInputSlotCalls += 1; }

  // 运输组件域锁检查：若该节点所属组件已锁定为其他物品类型，拒绝接受。
  const device = options.topology.devices[options.node.deviceId];
  const componentId = device?.transportComponentId ?? null;
  if (componentId !== null) {
    const domain = options.state.persistent.transportComponentDomain[componentId];
    if (domain !== null && domain !== options.itemType) {
      return null;
    }
  }

  const warehouseSinkSlotId = findWarehouseSinkTargetSlotForItem({
    registry: options.registry,
    topology: options.topology,
    state: options.state,
    node: options.node,
    itemType: options.itemType,
  });
  if (warehouseSinkSlotId !== null) {
    return warehouseSinkSlotId;
  }

  const nodeState = options.state.transient.nodes[options.node.id];
  const excluded = new Set(nodeState?.excludedItemTypes ?? []);

  for (const slotId of options.node.slotIds) {
    const slot = options.topology.slots[slotId];
    if (slot === undefined || !slotCanHold(options.registry, options.topology, slot, options.itemType)) {
      continue;
    }

    const storageSlotId = resolveStorageSlotId(options.state, slotId);
    const slotState = options.state.persistent.slots[storageSlotId];
    if (slotState === undefined) {
      continue;
    }

    // 组内互斥规则（§3.4）：同一槽位组内不同槽不可容纳相同物品。
    // 若该槽位已持有目标物品 → 有容量就追加，满容则直接失败。
    if (slotState.itemType === options.itemType) {
      if (getRemainingCapacity(options.topology, options.state, slotId) > 0) {
        return slotId;
      }
      return null;
    }

    // 空槽位：容量必须大于 0 才能写入。
    if (slotState.count === 0 && slotState.itemType === null && !excluded.has(options.itemType)) {
      if (getRemainingCapacity(options.topology, options.state, slotId) > 0) {
        return slotId;
      }
    }
  }

  return null;
}

function findWarehouseSinkTargetSlotForItem(options: {
  registry: RegistryContract;
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  if (!isWarehouseSinkInputNode(options.registry, options.topology, options.node)) {
    return null;
  }

  const warehouseSlotId = findWarehouseSlotId(options.topology, options.itemType);
  if (warehouseSlotId === null) {
    return null;
  }

  const slot = options.topology.slots[warehouseSlotId];
  if (slot === undefined || !slotCanHold(options.registry, options.topology, slot, options.itemType)) {
    return null;
  }

  return getRemainingCapacity(options.topology, options.state, warehouseSlotId) > 0
    ? warehouseSlotId
    : null;
}

function isWarehouseSinkInputNode(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  node: CompiledSimulationNode,
): boolean {
  if (node.viewRole !== "input-view") {
    return false;
  }

  const device = topology.devices[node.deviceId];
  if (device === undefined) {
    return false;
  }
  if (registry.queries.findEntityDefinition(device.definitionId)?.tags.includes(WAREHOUSE_SINK_TAG) === true) {
    return true;
  }

  const storageSlotGroupId = node.sourceStorageSlotGroupId;
  if (storageSlotGroupId === null) {
    return false;
  }
  const hasRegionalUnlinkedWarehouseBehavior = device.simulationBehaviors.some((behavior) =>
    behavior.type === ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting
    && behavior.strategy === ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked
    && behavior.storageSlotGroupIds.includes(storageSlotGroupId),
  );
  return hasRegionalUnlinkedWarehouseBehavior
    && !resolveDocumentLinkedStorageGroups(topology).has(
      createDeviceStorageGroupKey(device.id, storageSlotGroupId),
    );
}

function resolveDocumentLinkedStorageGroups(
  topology: CompiledSimulationTopology,
): ReadonlySet<string> {
  const cached = documentLinkedStorageGroupsByTopology.get(topology);
  if (cached !== undefined) {
    return cached;
  }

  const linkedStorageGroups = new Set<string>();
  for (const link of Object.values(topology.links)) {
    if (!link.id.startsWith("document-link:")) {
      continue;
    }
    for (const slotId of [...link.sourceSlotIds, ...link.targetSlotIds]) {
      const slot = topology.slots[slotId];
      const node = slot === undefined ? undefined : topology.nodes[slot.nodeId];
      if (node?.sourceStorageSlotGroupId === null || node === undefined) {
        continue;
      }
      linkedStorageGroups.add(createDeviceStorageGroupKey(
        node.deviceId,
        node.sourceStorageSlotGroupId,
      ));
    }
  }
  documentLinkedStorageGroupsByTopology.set(topology, linkedStorageGroups);
  return linkedStorageGroups;
}

function createDeviceStorageGroupKey(deviceId: string, storageSlotGroupId: string): string {
  return `${deviceId}\u0000${storageSlotGroupId}`;
}

function findWarehouseSlotId(
  topology: CompiledSimulationTopology,
  itemType: string,
): string | null {
  const warehouseDevice = Object.values(topology.devices).find((device) => device.definitionId === "warehouse");
  if (warehouseDevice === undefined) {
    return null;
  }

  const warehouseSlotId = `${warehouseDevice.id}/node:warehouse/slot:${itemType}`;
  return topology.slots[warehouseSlotId] === undefined ? null : warehouseSlotId;
}

export function findOutputSlotForItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  for (const slotId of options.node.slotIds) {
    const slot = options.topology.slots[slotId];
    const storageSlotId = resolveStorageSlotId(options.state, slotId);
    const slotState = options.state.persistent.slots[storageSlotId];
    const itemType = slotState?.itemType ?? slot?.lock ?? null;
    if (slot === undefined || slotState === undefined || itemType !== options.itemType) {
      continue;
    }

    if (resolveEffectiveIgnoreStock(options.topology, options.state, slotId) || slotState.count - getReservedAmount(options.state, storageSlotId) > 0) {
      return slotId;
    }
  }

  return null;
}

export function canOutputSlotProvideItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  sourceSlotId: string;
  itemType: string;
}): boolean {
  const perf = options.state.transient._perf;
  if (perf !== undefined) { perf.canOutputProvideCalls += 1; }

  const slot = options.topology.slots[options.sourceSlotId];
  const storageSlotId = resolveStorageSlotId(options.state, options.sourceSlotId);
  const slotState = options.state.persistent.slots[storageSlotId];
  const itemType = slotState?.itemType ?? slot?.lock ?? null;
  if (slot === undefined || slotState === undefined || itemType !== options.itemType) {
    return false;
  }

  return resolveEffectiveIgnoreStock(options.topology, options.state, options.sourceSlotId) || slotState.count - getReservedAmount(options.state, storageSlotId) > 0;
}

export function moveOneItem(options: {
  registry: RegistryContract;
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  sourceSlotId: string;
  targetSlotId: string;
  itemType: string;
  regionalWarehouse?: RegionalWarehouseWriteContext;
}): boolean {
  const sourceSlot = options.topology.slots[options.sourceSlotId];
  const targetSlot = options.topology.slots[options.targetSlotId];
  const sourceStorageSlotId = resolveStorageSlotId(options.state, options.sourceSlotId);
  const targetStorageSlotId = resolveStorageSlotId(options.state, options.targetSlotId);
  const sourceState = options.state.persistent.slots[sourceStorageSlotId];
  const targetState = options.state.persistent.slots[targetStorageSlotId];
  if (
    sourceSlot === undefined
    || targetSlot === undefined
    || sourceState === undefined
    || targetState === undefined
  ) {
    return false;
  }

  if (!canOutputSlotProvideItem({
    topology: options.topology,
    state: options.state,
    sourceSlotId: options.sourceSlotId,
    itemType: options.itemType,
  })) {
    return false;
  }

  if (!slotCanHold(options.registry, options.topology, targetSlot, options.itemType)) {
    return false;
  }

  if (targetState.itemType !== null && targetState.itemType !== options.itemType) {
    return false;
  }

  if (getRemainingCapacity(options.topology, options.state, options.targetSlotId) <= 0) {
    return false;
  }

  const targetIsWarehouseStorage = isWarehouseStorageSlotId(
    options.topology,
    targetStorageSlotId,
  );
  if (
    options.topology.simulationMode === SIMULATION_MODE.regionalMultiBase
    && targetIsWarehouseStorage
    && options.regionalWarehouse?.isWarehouseStorageSlotId(targetStorageSlotId) !== true
  ) {
    throw new Error(
      `Regional warehouse write context is required for target slot "${targetStorageSlotId}".`,
    );
  }

  if (!resolveEffectiveIgnoreStock(options.topology, options.state, options.sourceSlotId)) {
    sourceState.count = Math.max(0, sourceState.count - 1);
    if (sourceState.count === 0) {
      sourceState.itemType = null;
    }
  }

  if (
    targetIsWarehouseStorage
    && options.regionalWarehouse?.isWarehouseStorageSlotId(targetStorageSlotId) === true
  ) {
    // 区域模式入仓只写当前 Epoch 的 deposit journal；本 Epoch 内不可被取货读取。
    options.regionalWarehouse.deposit(options.itemType, 1);
    return true;
  }


  targetState.itemType = targetState.itemType ?? options.itemType;
  targetState.count += 1;
  return true;
}

function isWarehouseStorageSlotId(
  topology: CompiledSimulationTopology,
  storageSlotId: string,
): boolean {
  const slot = topology.slots[storageSlotId];
  const node = slot === undefined ? undefined : topology.nodes[slot.nodeId];
  return node !== undefined
    && topology.devices[node.deviceId]?.definitionId === "warehouse";
}


export function createStartableRecipeForChannel(options: {
  registry: RegistryContract;
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  device: CompiledSimulationDevice;
  channel: CompiledSimulationRecipeChannel;
  recipeRandom: RecipeRandomSource;
  shouldStartPlan?: (plan: CompiledSimulationRecipePlan) => boolean;
}): RuntimeDeviceRecipeState | null {
  const plans = resolveDeviceRecipePlans(options);
  const executable = plans.some(plan => plan.probability !== undefined)
    ? [] as Array<{ plan: CompiledSimulationRecipePlan; reservations: RuntimeReservedItem[] }>
    : null;
  let hasExecutableOrdinary = false;
  let selected: { plan: CompiledSimulationRecipePlan; reservations: RuntimeReservedItem[] } | null = null;
  for (const plan of plans) {
    if (executable !== null && hasExecutableOrdinary && plan.probability === undefined) continue;
    if (options.shouldStartPlan?.(plan) === false) continue;
    const reservations = selectRecipeInputs({ registry: options.registry, topology: options.topology, state: options.state, plan });
    if (reservations === null) continue;
    const candidate = { plan, reservations };
    if (executable !== null) {
      executable.push(candidate);
      if (plan.probability === undefined) hasExecutableOrdinary = true;
    } else {
      selected = candidate;
      break;
    }
  }
  if (executable !== null && executable.length > 0) {
    selected = selectProbabilisticRecipe(executable, candidate => candidate.plan.probability, options.recipeRandom);
  }
  if (selected === null) return null;
  const { plan, reservations } = selected;
  const runId = `recipe-run:${options.state.persistent.nextRecipeRunIndex}`;
  options.state.persistent.nextRecipeRunIndex += 1;
  return {
    runId, recipeId: plan.recipeId, recipeType: plan.recipeType,
    progressTicks: 0, durationTicks: plan.durationTicks, state: "running",
    plan, reservations, inputItems: aggregateInputItems(reservations),
  };
}

// ingredientNodeIds / productNodeIds 从 channel 获取而非从 device 全局获取。
export function resolveDeviceRecipePlans(options: {
  registry: RegistryContract;
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  device: CompiledSimulationDevice;
  channel: CompiledSimulationRecipeChannel;
}): readonly CompiledSimulationRecipePlan[] {
  const ingredientSlotContents = readIngredientSlotContents({
    topology: options.topology,
    state: options.state,
    ingredientNodeIds: options.channel.ingredientNodeIds,
  });

  const plans = sortRecipePlansByEfficiency(resolveRecipes({
    registry: options.registry,
    topology: options.topology,
    state: options.state,
    device: options.device,
    channel: options.channel,
    ingredientSlotContents,
  })).filter((plan) => planFitsAdmissionOutputAllowance(options, plan));
  if (
    options.channel.type === CONSUMPTION_RECIPE_CHANNEL_TYPE
    || options.device.allowDuplicateRecipesAcrossChannels === true
  ) {
    return plans;
  }

  const deviceState = options.state.persistent.devices[options.device.id];
  if (deviceState === undefined) {
    return plans;
  }

  const siblingRecipeIds = new Set(
    Object.entries(deviceState.channelRecipes)
      .filter(([channelId, recipe]) => channelId !== options.channel.id && recipe !== null)
      .map(([, recipe]) => recipe!.recipeId),
  );
  return plans.filter((plan) => !siblingRecipeIds.has(plan.recipeId));
}

function planFitsAdmissionOutputAllowance(
  options: {
    readonly topology: CompiledSimulationTopology;
    readonly state: SimulationMutableRuntimeState;
    readonly device: CompiledSimulationDevice;
  },
  plan: CompiledSimulationRecipePlan,
): boolean {
  const admissionPortId = options.device.portIds.find((portId) =>
    options.topology.ports[portId]?.admissionRule !== null
    && options.topology.ports[portId]?.admissionRule !== undefined
  );
  if (admissionPortId === undefined) {
    return true;
  }

  return sumRecipeItemAmounts(plan.inputs)
    <= readAdmissionOutputRemainingAllowance(
      options.topology,
      options.state,
      admissionPortId,
    );
}

export function placeRecipeOutputs(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): boolean {
  const overlayState = createSlotOverlayState(topology, state);
  if (!placeRecipeOutputsIntoOverlay(registry, topology, overlayState, plan, inputItems)) {
    return false;
  }
  commitSlotOverlay(state.persistent.slots, overlayState.persistent.slots);
  return true;
}

function placeRecipeOutputsIntoOverlay(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): boolean {
  for (const output of resolveRecipeOutputItems(plan.outputs, inputItems)) {
    for (let amount = 0; amount < output.amount; amount += 1) {
      const targetSlotId = findRecipeOutputSlot(registry, topology, state, plan, output.itemType);
      if (targetSlotId === null) return false;
      const storageSlotId = resolveStorageSlotId(state, targetSlotId);
      const slotState = cloneSlotIntoOverlay(state.persistent.slots, storageSlotId);
      if (slotState === null) return false;
      slotState.itemType = slotState.itemType ?? output.itemType;
      slotState.count += 1;
    }
  }
  return true;
}

/**
 * 每 tick 执行一次：基于当前 persistent.slots 重建所有 node 的 excludedItemTypes。
 *
 * Stage 1 (advanceDevices) 在 buildSolveGraph 之前运行，无法使用 transient.nodes 中
 * 的 excludedItemTypes（那是上一 tick 残留）。本函数在 tick 开头提供一份基于当前库存的
 * 快照写入 transient.nodes，供 createSlotOverlayState 浅拷贝使用，消除每次配方完成时
 * 的全拓扑重复扫描。
 */
export function rebuildExcludedItemTypesForTick(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  const nodes: Record<string, { excludedItemTypes: readonly string[] }> = {};
  for (const nodeId of topology.ordering.nodeOrder) {
    const node = topology.nodes[nodeId];
    if (node === undefined) continue;
    const items = new Set<string>();
    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const itemType = state.persistent.slots[storageSlotId]?.itemType ?? null;
      if (itemType !== null) items.add(itemType);
    }
    if (items.size > 0) {
      nodes[nodeId] = { excludedItemTypes: [...items].sort() };
    }
  }
  state.transient.nodes = nodes as Record<string, SimulationMutableRuntimeState['transient']['nodes'][string]>;
}

function createSlotOverlayState(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): SimulationMutableRuntimeState {
  // transient.nodes[nodeId].excludedItemTypes 包含上一 tick 的 buildSolveGraph 残留，
  // 当 advanceDevices 在粗步长模式下通过本 overlay 调用 findInputSlotForItem 时，
  // 会读到 stale 的排除列表，错误地将空槽视为"已被同组其他槽占用"而跳过，
  // 导致 strict-pipe 等设备的 dynamic-pipe-transfer 配方输出放置失败。
  //
  // 在每 tick 开头统一重建并写入 transient.nodes。overlay 恢复浅拷贝即可安全读取。
  // 其他 transient 字段（edges、transfers、blockedInputNodeIds 等）属于 Stage 3 求解数据，
  // 在 overlay 配方完成路径中不会被读取，无需重建。
  // _perf 和 recipeStatsDelta 继续共享引用 —— finishRecipeIfPossible 向其中写入统计。
  return {
    ...state,
    persistent: {
      ...state.persistent,
      slots: Object.create(state.persistent.slots) as Record<string, RuntimeSlotState>,
    },
    transient: {
      ...state.transient,
    },
  };
}

function cloneSlotIntoOverlay(
  slots: Record<string, RuntimeSlotState>,
  slotId: string,
): RuntimeSlotState | null {
  if (Object.prototype.hasOwnProperty.call(slots, slotId)) {
    return slots[slotId] ?? null;
  }
  const source = slots[slotId];
  if (source === undefined) return null;
  const clone = { ...source };
  slots[slotId] = clone;
  return clone;
}

function commitSlotOverlay(
  targetSlots: Record<string, RuntimeSlotState>,
  overlaySlots: Record<string, RuntimeSlotState>,
): void {
  for (const [slotId, slotState] of Object.entries(overlaySlots)) {
    targetSlots[slotId] = slotState;
  }
}

export function selectRecipeInputs(options: {
  registry: RegistryContract;
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  plan: CompiledSimulationRecipePlan;
}): RuntimeReservedItem[] | null {
  const selections: RuntimeReservedItem[] = [];
  const localTakenBySlot: Record<string, number> = {};

  for (const input of options.plan.inputs) {
    let remainingAmount = input.amount;
    while (remainingAmount > 0) {
      const selection = findRecipeInputSelection(
        options.registry,
        options.topology,
        options.state,
        options.plan,
        input,
        localTakenBySlot,
      );
      if (selection === null) {
        return null;
      }
      const amount = Math.min(selection.availableAmount, remainingAmount);
      selections.push({
        slotId: selection.slotId,
        itemType: selection.itemType,
        amount,
        ignoreStock: selection.ignoreStock,
      });
      localTakenBySlot[selection.slotId] = (localTakenBySlot[selection.slotId] ?? 0) + amount;
      remainingAmount -= amount;
    }
  }

  return selections;
}

export function consumeSelections(
  slots: Record<string, RuntimeSlotState>,
  selections: readonly RuntimeReservedItem[],
): void {
  for (const selection of selections) {
    if (selection.ignoreStock) {
      continue;
    }
    const slotState = slots[selection.slotId];
    if (slotState === undefined) {
      continue;
    }
    slotState.count = Math.max(0, slotState.count - selection.amount);
    if (slotState.count === 0) {
      slotState.itemType = null;
    }
  }
}

export function aggregateInputItems(selections: readonly RuntimeReservedItem[]): RuntimeRecipeItem[] {
  const amountByItemType = new Map<string, number>();
  for (const selection of selections) {
    amountByItemType.set(selection.itemType, (amountByItemType.get(selection.itemType) ?? 0) + selection.amount);
  }
  return [...amountByItemType.entries()].map(([itemType, amount]) => ({ itemType, amount }));
}


export function requireActiveItemDomain(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  itemType: string,
): SimulationItemDomain {
  const item = registry.queries.findItemDefinition(itemType);
  if (
    item === null
    || !isItemAvailableByActivity(item, topology.activeActivityIds)
  ) {
    throw new Error(`Simulation item "${itemType}" is not registered or active.`);
  }
  const domain = registry.queries.resolveItemDomain(itemType);
  if (domain === null) {
    throw new Error(`Simulation item "${itemType}" has no registered domain.`);
  }
  return domain;
}

export function finishRecipeIfPossible(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  const perf = state.transient._perf;
  const preflightStartedAt = perf === undefined ? 0 : performance.now();
  if (perf !== undefined) perf.recipeFinishCalls += 1;
  if (!canRecipeFinishAtCurrentPhase(registry, topology, state, recipe)) {
    if (perf !== undefined) {
      perf.recipeFinishFailures += 1;
      perf.recipeFinishPreflightMs += performance.now() - preflightStartedAt;
    }
    return false;
  }

  const overlayState = createSlotOverlayState(topology, state);
  const hadReservations = recipe.reservations.length > 0;
  if (hadReservations) {
    for (const reservation of recipe.reservations) {
      if (cloneSlotIntoOverlay(overlayState.persistent.slots, reservation.slotId) === null) {
        if (perf !== undefined) {
          perf.recipeFinishFailures += 1;
          perf.recipeFinishPreflightMs += performance.now() - preflightStartedAt;
        }
        return false;
      }
    }
    consumeSelections(overlayState.persistent.slots, recipe.reservations);
  }

  if (!placeRecipeOutputsIntoOverlay(registry, topology, overlayState, recipe.plan, recipe.inputItems)) {
    if (perf !== undefined) {
      perf.recipeFinishFailures += 1;
      perf.recipeFinishPreflightMs += performance.now() - preflightStartedAt;
    }
    return false;
  }
  if (perf !== undefined) {
    perf.recipeFinishPreflightMs += performance.now() - preflightStartedAt;
  }

  const commitStartedAt = perf === undefined ? 0 : performance.now();
  const changedSlotCount = Object.keys(overlayState.persistent.slots).length;
  commitSlotOverlay(state.persistent.slots, overlayState.persistent.slots);
  if (hadReservations) adjustReservedAmounts(state, recipe.reservations, -1);
  if (perf !== undefined) {
    perf.recipeFinishSuccesses += 1;
    perf.recipeFinishChangedSlots += changedSlotCount;
    perf.recipeFinishCommitMs += performance.now() - commitStartedAt;
  }

  // 只统计生产设备的配方（编译期 isProducer 缓存，零开销判断）
  const producerDevice = resolveRecipeProducerDevice(topology, recipe.plan);
  if (
    producerDevice !== undefined
    && registry.queries.findEntityDefinition(producerDevice.definitionId)?.tags.includes("Producer") === true
  ) {
    const delta = state.transient.recipeStatsDelta;
    if (hadReservations) {
      for (const input of recipe.inputItems) {
        delta.consumed[input.itemType] = (delta.consumed[input.itemType] ?? 0) + input.amount;
      }
    }
    for (const output of resolveRecipeOutputItems(recipe.plan.outputs, recipe.inputItems)) {
      delta.produced[output.itemType] = (delta.produced[output.itemType] ?? 0) + output.amount;
    }
  }

  return true;
}

/**
 * 从配方计划中反查所属设备。
 * 通过 productNodeIds 或 ingredientNodeIds 找到 node，再找到 device。
 */
function resolveRecipeProducerDevice(
  topology: CompiledSimulationTopology,
  plan: CompiledSimulationRecipePlan,
): CompiledSimulationDevice | undefined {
  const nodeId = plan.productNodeIds[0] ?? plan.ingredientNodeIds[0];
  if (nodeId === undefined) return undefined;
  const node = topology.nodes[nodeId];
  if (node === undefined) return undefined;
  return topology.devices[node.deviceId];
}

// 函数体内本身就从 options.device 读取 definitionId 和 tags，签名中的冗余参数从未被使用。
function resolveRecipes(options: {
  registry: RegistryContract;
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  device: CompiledSimulationDevice;
  channel: CompiledSimulationRecipeChannel;
  ingredientSlotContents: readonly IngredientSlotContent[];
}): readonly CompiledSimulationRecipePlan[] {

  if (options.device.definitionId === WATER_PURIFIER_NODE_ENTITY_ID) {
    const allowedRecipeId = resolveWaterPurifierAllowedRecipeId(options.channel.id);
    if (allowedRecipeId === null) {
      return [];
    }
    if (
      options.device.waterPurifierNode?.outputMode === "manual-rate"
      && allowedRecipeId === WATER_PURIFIER_BYPRODUCT_RECIPE_ID
    ) {
      return [];
    }
    const recipe = options.registry.queries.findRecipeDefinition(allowedRecipeId);
    if (
      recipe === null
      || !isRecipeAvailableByActivity(recipe, options.topology.activeActivityIds)
      || !recipeCanMatchContents(options.registry, options.topology, recipe, options.ingredientSlotContents)
      || !isDeviceInRequiredGasDiffusion({
        topology: options.topology,
        state: options.state,
        device: options.device,
        requiredEnvironmentAnyOf: recipe.requiredEnvironmentAnyOf ?? null,
      })
    ) {
      return [];
    }

    return [getOrCreateRegistryRecipePlan(options, recipe)];
  }

  // 手选配方设备：不自动根据原料匹配配方，必须由用户手动指定配方后设备才运行
  if (options.channel.manualRecipeOnly) {
    if (options.channel.defaultRecipeId === null) {
      return [];
    }
    const selectedRecipe = options.registry.queries.findRecipeDefinition(options.channel.defaultRecipeId);
    if (
      selectedRecipe === null
      || !isRecipeAvailableByActivity(selectedRecipe, options.topology.activeActivityIds)
      || !doesRecipeMatchChannelType(selectedRecipe, options.channel)
    ) {
      return [];
    }
    if (!isDeviceInRequiredGasDiffusion({
      topology: options.topology,
      state: options.state,
      device: options.device,
      requiredEnvironmentAnyOf: selectedRecipe.requiredEnvironmentAnyOf ?? null,
    })) {
      return [];
    }
    return [getOrCreateRegistryRecipePlan(options, selectedRecipe)];
  }

  const timing = options.channel.type !== CONSUMPTION_RECIPE_CHANNEL_TYPE
    ? resolveTransportRecipeTiming(options.registry, options.topology, options.device)
    : null;
  const transportPlans = timing !== null && options.ingredientSlotContents.length > 0
    ? resolveTransportRecipePlans(options, timing) : [];

  const registryPlans = resolveRecipesForDeviceChannel(
    options.registry,
    options.topology,
    options.device.definitionId,
    options.channel,
  )
    .filter((recipe) => recipeCanMatchContents(
      options.registry,
      options.topology,
      recipe,
      options.ingredientSlotContents,
    ))
    .filter((recipe) => isDeviceInRequiredGasDiffusion({
      topology: options.topology,
      state: options.state,
      device: options.device,
      requiredEnvironmentAnyOf: recipe.requiredEnvironmentAnyOf ?? null,
    }))
    .map((recipe) => getOrCreateRegistryRecipePlan(options, recipe));
  return [...transportPlans, ...registryPlans];
}

function resolveRecipesForDeviceChannel(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  definitionId: string,
  channel: CompiledSimulationRecipeChannel,
): readonly RecipeDefinition[] {
  return registry.queries.findRecipeDefinitionsByMachine(definitionId)
    .filter((recipe) => isRecipeAvailableByActivity(recipe, topology.activeActivityIds))
    .filter((recipe) => doesRecipeMatchChannelType(recipe, channel));
}

function doesRecipeMatchChannelType(
  recipe: RecipeDefinition,
  channel: CompiledSimulationRecipeChannel,
): boolean {
  return recipe.tags.includes(CONSUMPTION_RECIPE_TAG)
    === (channel.type === CONSUMPTION_RECIPE_CHANNEL_TYPE);
}

function sortRecipePlansByEfficiency(
  plans: readonly CompiledSimulationRecipePlan[],
): readonly CompiledSimulationRecipePlan[] {
  return [...plans].sort((left, right) => {
    const outputAmountDifference =
      sumRecipeItemAmounts(right.outputs) - sumRecipeItemAmounts(left.outputs);
    if (outputAmountDifference !== 0) {
      return outputAmountDifference;
    }

    const inputAmountDifference =
      sumRecipeItemAmounts(left.inputs) - sumRecipeItemAmounts(right.inputs);
    if (inputAmountDifference !== 0) {
      return inputAmountDifference;
    }

    return left.recipeId.localeCompare(right.recipeId);
  });
}

function sumRecipeItemAmounts(items: readonly CompiledSimulationRecipeItem[]): number {
  return items.reduce((total, item) => total + item.amount, 0);
}

function resolveTransportRecipePlans(
  options: {
    topology: CompiledSimulationTopology;
    state: SimulationMutableRuntimeState;
    device: CompiledSimulationDevice;
    channel: CompiledSimulationRecipeChannel;
  },
  timing: {
    readonly durationTicks: number;
    readonly recipeIdSuffix: string;
  },
): readonly CompiledSimulationRecipePlan[] {
  // 不再生成 amount=2 的双件变体。
  const transferAmounts: readonly number[] = [1];

  return transferAmounts.map((amount) => {
    const recipeId = `${options.device.definitionId}:${timing.recipeIdSuffix}`;
    return getOrCreateRecipePlan(options, recipeId, () => ({
      recipeId,
      recipeType: "reserved-item",
      durationTicks: timing.durationTicks,
      inputs: [{ itemId: "any", amount }],
      outputs: [{ itemId: "same-as-input", amount }],
      ingredientNodeIds: options.channel.ingredientNodeIds,
      productNodeIds: options.channel.productNodeIds,
      requiredEnvironmentAnyOf: null,
      environmentOutput: null,
    }));
  });
}


function getOrCreateRecipePlan(
  options: {
    topology: CompiledSimulationTopology;
    device: CompiledSimulationDevice;
    channel: CompiledSimulationRecipeChannel;
  },
  recipeId: string,
  createPlan: () => CompiledSimulationRecipePlan,
): CompiledSimulationRecipePlan {
  let devicePlans = recipePlanCacheByTopology.get(options.topology);
  if (devicePlans === undefined) {
    devicePlans = new Map();
    recipePlanCacheByTopology.set(options.topology, devicePlans);
  }

  let channelPlans = devicePlans.get(options.device.id);
  if (channelPlans === undefined) {
    channelPlans = new Map();
    devicePlans.set(options.device.id, channelPlans);
  }

  let recipePlans = channelPlans.get(options.channel.id);
  if (recipePlans === undefined) {
    recipePlans = new Map();
    channelPlans.set(options.channel.id, recipePlans);
  }

  const cachedPlan = recipePlans.get(recipeId);
  if (cachedPlan !== undefined) {
    return cachedPlan;
  }

  const plan = createPlan();
  recipePlans.set(recipeId, plan);
  return plan;
}

function getOrCreateRegistryRecipePlan(
  options: {
    topology: CompiledSimulationTopology;
    device: CompiledSimulationDevice;
    channel: CompiledSimulationRecipeChannel;
  },
  recipe: RecipeDefinition,
): CompiledSimulationRecipePlan {
  return getOrCreateRecipePlan(options, recipe.id, () => ({
    recipeId: recipe.id,
    probability: recipe.probability,
    recipeType: recipe.recipeType,
    durationTicks: requireExactRecipeDurationTicks(
      recipe,
      options.topology.standardTickRate,
    ),
    inputs: recipe.inputs.map((input) => ({ ...input })),
    outputs: recipe.outputs.map((output) => ({ ...output })),
    ingredientNodeIds: options.channel.ingredientNodeIds,
    productNodeIds: recipe.outputTarget === "warehouse"
      ? options.topology.ordering.deviceOrder.flatMap(id => options.topology.devices[id]!.definitionId === "warehouse" ? options.topology.devices[id]!.nodeIds : [])
      : options.channel.productNodeIds,
    requiredEnvironmentAnyOf: normalizeRecipeGasItemId(recipe.requiredEnvironmentAnyOf),
    environmentOutput: normalizeRecipeGasDiffusionOutput(recipe.environmentOutput),
  }));
}

function requireExactRecipeDurationTicks(
  recipe: RecipeDefinition,
  standardTickRate: number,
): number {
  const durationTicks = convertSimulationSecondsToTicksExact(
    recipe.durationSeconds,
    standardTickRate,
  );
  if (durationTicks === null) {
    throw new Error(
      `Recipe "${recipe.id}" duration ${recipe.durationSeconds}s is not exactly representable at ${standardTickRate} TPS.`,
    );
  }
  return durationTicks;
}

function normalizeRecipeGasItemId(itemIds: readonly string[] | undefined): readonly string[] | null {
  return itemIds?.length ? itemIds : null;
}

function normalizeRecipeGasDiffusionOutput(
  output: RecipeDefinition["environmentOutput"],
): CompiledSimulationRecipePlan["environmentOutput"] {
  return output ? { itemId: output.itemId, rangeId: output.rangeId } : null;
}

function resolveWaterPurifierAllowedRecipeId(channelId: string): string | null {
  if ((WATER_PURIFIER_INTAKE_CHANNEL_IDS as readonly string[]).includes(channelId)) {
    return WATER_PURIFIER_COLLECT_RECIPE_ID;
  }
  if (channelId === WATER_PURIFIER_BYPRODUCT_CHANNEL_ID) {
    return WATER_PURIFIER_BYPRODUCT_RECIPE_ID;
  }
  return null;
}

function readIngredientSlotContents(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  ingredientNodeIds: readonly string[];
}): readonly IngredientSlotContent[] {
  const contents: IngredientSlotContent[] = [];
  for (const nodeId of options.ingredientNodeIds) {
    const node = options.topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }

    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(options.state, slotId);
      const slotState = options.state.persistent.slots[storageSlotId];
      const itemType = slotState?.itemType ?? options.topology.slots[slotId]?.lock ?? null;
      if (slotState === undefined || itemType === null) {
        continue;
      }

      const availableAmount = resolveEffectiveIgnoreStock(options.topology, options.state, slotId)
        ? Number.POSITIVE_INFINITY
        : Math.max(0, slotState.count - getReservedAmount(options.state, storageSlotId));
      if (availableAmount > 0) {
        contents.push({ slotId: storageSlotId, itemType, availableAmount });
      }
    }
  }
  return contents;
}

function recipeCanMatchContents(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  recipe: RecipeDefinition,
  contents: readonly IngredientSlotContent[],
): boolean {
  if (recipe.inputs.length === 0) {
    return true;
  }

  const availableByItemType = new Map<string, number>();
  const availableByDomain = new Map<SimulationItemDomain, number>();
  let totalAvailable = 0;
  for (const content of contents) {
    availableByItemType.set(content.itemType, (availableByItemType.get(content.itemType) ?? 0) + content.availableAmount);
    totalAvailable += content.availableAmount;
    const domain = requireActiveItemDomain(registry, topology, content.itemType);
    availableByDomain.set(domain, (availableByDomain.get(domain) ?? 0) + content.availableAmount);
  }

  for (const input of recipe.inputs) {
    if (input.itemId === "any") {
      if (totalAvailable < input.amount) {
        return false;
      }
      totalAvailable -= input.amount;
      continue;
    }

    // 原逻辑仅处理 "any" 和精确物品 ID，无法匹配使用域占位符的隐藏销毁配方（如暗管 fluid void）。
    const inputDomainFlags = resolveRecipeItemDomainFlags(input.itemId);
    if (inputDomainFlags !== null) {
      const matchingDomains = [
        ItemDomainFlag.Solid,
        ItemDomainFlag.Liquid,
        ItemDomainFlag.Gas,
      ].filter((domain) => (inputDomainFlags & domain) !== 0);
      const domainAvailable = matchingDomains.reduce(
        (total, domain) => total + (availableByDomain.get(domain) ?? 0),
        0,
      );
      if (domainAvailable < input.amount) return false;

      let remainingAmount = input.amount;
      for (const domain of matchingDomains) {
        const available = availableByDomain.get(domain) ?? 0;
        const deducted = Math.min(available, remainingAmount);
        availableByDomain.set(domain, available - deducted);
        remainingAmount -= deducted;
        if (remainingAmount === 0) break;
      }
      totalAvailable -= input.amount;
      continue;
    }

    const available = availableByItemType.get(input.itemId) ?? 0;
    if (available < input.amount) {
      return false;
    }
    availableByItemType.set(input.itemId, available - input.amount);
    totalAvailable -= input.amount;
  }

  return true;
}

function getRemainingCapacity(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  slotId: string,
): number {
  const perf = state.transient._perf;
  if (perf !== undefined) { perf.getRemainingCapacityCalls += 1; }

  const slot = topology.slots[slotId];
  if (slot === undefined) {
    return 0;
  }
  const sharedSlotIds = state.persistent.sharedCapacitySlotIdsBySlotId[slotId];
  if (sharedSlotIds === undefined) {
    const storageSlotId = resolveStorageSlotId(state, slotId);
    return Math.max(0, slot.capacity - (state.persistent.slots[storageSlotId]?.count ?? 0));
  }

  const visitedStorageSlotIds = new Set<string>();
  let occupiedCount = 0;
  for (const sharedSlotId of sharedSlotIds) {
    const storageSlotId = resolveStorageSlotId(state, sharedSlotId);
    if (visitedStorageSlotIds.has(storageSlotId)) {
      continue;
    }
    visitedStorageSlotIds.add(storageSlotId);
    occupiedCount += state.persistent.slots[storageSlotId]?.count ?? 0;
  }

  return Math.max(0, (state.persistent.sharedCapacityLimitBySlotId[slotId] ?? slot.capacity) - occupiedCount);
}

function slotCanHold(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  slot: CompiledSimulationSlot,
  itemType: string,
): boolean {
  if (slot.lock !== null && slot.lock !== itemType) {
    return false;
  }
  return doesDomainFilterAcceptItemDomain(
    slot.domain,
    requireActiveItemDomain(registry, topology, itemType),
  );
}

function doesDomainFilterAcceptItemDomain(
  filter: SimulationItemDomainFilter,
  domain: SimulationItemDomain,
): boolean {
  return (filter & domain) !== 0;
}

function findRecipeOutputSlot(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  itemType: string,
): string | null {
  for (const nodeId of plan.productNodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    const targetSlotId = findInputSlotForItem({ registry, topology, state, node, itemType });
    if (targetSlotId !== null) {
      return targetSlotId;
    }
  }
  return null;
}

function resolveRecipeOutputItems(
  outputs: readonly CompiledSimulationRecipeItem[],
  inputItems: readonly RuntimeRecipeItem[],
): Array<{ readonly itemType: string; readonly amount: number }> {
  const firstInputItemType = inputItems[0]?.itemType ?? null;
  return outputs.flatMap((output) => {
    if (output.itemId === "same-as-input" || output.itemId === "any") {
      return firstInputItemType === null ? [] : [{ itemType: firstInputItemType, amount: output.amount }];
    }
    return [{ itemType: output.itemId, amount: output.amount }];
  });
}

function findRecipeInputSelection(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  input: CompiledSimulationRecipeItem,
  localTakenBySlot: Record<string, number>,
): {
  readonly slotId: string;
  readonly itemType: string;
  readonly availableAmount: number;
  readonly ignoreStock: boolean;
} | null {
  for (const nodeId of plan.ingredientNodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const slotState = state.persistent.slots[storageSlotId];
      if (
        slotState === undefined
        || slotState.itemType === null
        || !recipeInputMatches(registry, topology, input, slotState.itemType)
      ) {
        continue;
      }
      const itemType = slotState.itemType;
      const ignoreStock = resolveEffectiveIgnoreStock(topology, state, slotId);
      const availableAmount = ignoreStock
        ? Number.POSITIVE_INFINITY
        : slotState.count
          - getReservedAmount(state, storageSlotId)
          - (localTakenBySlot[storageSlotId] ?? 0);
      if (availableAmount > 0) {
        return { slotId: storageSlotId, itemType, availableAmount, ignoreStock };
      }
    }
  }
  return null;
}

// 原逻辑仅处理 "any" 和精确物品 ID，无法匹配暗管等使用域占位符的隐藏配方。
function recipeInputMatches(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  input: CompiledSimulationRecipeItem,
  itemType: string,
): boolean {
  if (input.itemId === "any" || input.itemId === itemType) {
    return true;
  }
  const inputDomainFlags = resolveRecipeItemDomainFlags(input.itemId);
  return inputDomainFlags !== null
    && (inputDomainFlags & requireActiveItemDomain(registry, topology, itemType)) !== 0;
}


/**
 * 在每个 tick 结束后维护运输组件的域锁：
 * - 若组件内任一槽位有物品，将域锁设置为该物品类型；
 * - 若组件内所有槽位均已排空，清除域锁（设为 null），允许新类型物品进入。
 *
 * 订正（2026-05-07）：引入运输组件域锁机制，替代合并设备的方案。
 */
export function maintainTransportComponentDomains(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const [componentId, component] of Object.entries(topology.transportComponents)) {
    const domain = state.persistent.transportComponentDomain[componentId];
    // 若组件已锁定，确认锁定的物品类型是否仍在组件内。
    if (domain !== null) {
      const domainStillPresent = component.slotIds.some((slotId) => {
        const storageSlotId = resolveStorageSlotId(state, slotId);
        return state.persistent.slots[storageSlotId]?.itemType === domain;
      });
      if (!domainStillPresent) {
        state.persistent.transportComponentDomain[componentId] = null;
      }
      continue;
    }

    // 组件未锁定：扫描槽位，将域锁设为第一个非空槽位的物品类型。
    for (const slotId of component.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const slotState = state.persistent.slots[storageSlotId];
      if (slotState !== undefined && slotState.count > 0 && slotState.itemType !== null) {
        state.persistent.transportComponentDomain[componentId] = slotState.itemType;
        break;
      }
    }
  }
}
