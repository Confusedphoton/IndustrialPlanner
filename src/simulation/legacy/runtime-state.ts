import type { SimulationDeviceStateReadModel, SimulationCropCultivationReadModel } from "@/domain/simulation/types/simulation-types";
import {
  ADMISSION_RATE_WINDOWS_PER_MINUTE,
} from "@/domain/registry";
import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipePlan,
  RuntimeEnvironmentSnapshot,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  SimulationRecipeType,
} from "../contracts";
import { collectTopologyRoutingCursorGroups } from "./routing-cursor-groups";

/** 基地电池满容量（焦耳）= 100MJ。940kW 负载约 106 秒耗尽。 */
export const BASE_BATTERY_CAPACITY_J = 100_000_000;

export type RuntimeShadowState = "uncertain" | "accept" | "moved";

export interface SimulationMutableRuntimeState {
  tickNumber: number;
  lastAdvancedTickNumber: number;
  persistent: SimulationPersistentRuntimeState;
  transient: SimulationTickTransientState;
}

export interface SimulationPersistentRuntimeState {
  cultivationSeconds?: number;
  slots: Record<string, RuntimeSlotState>;
  devices: Record<string, RuntimeDeviceState>;
  /** 准入口跨 tick 计数。key 为 compiled port id。 */
  admissionCounters: Record<string, number>;
  /** 准入口每个对齐十秒窗口计数。key 为 compiled port id。 */
  fixedWindowCounters: Record<string, RuntimeFixedWindowCounterState>;
  routingCursors: Record<string, number>;
  shareAllTargetSlotIdBySourceSlotId: Record<string, string>;
  sharedCapacitySlotIdsBySlotId: Record<string, readonly string[]>;
  sharedCapacityLimitBySlotId: Record<string, number>;
  nextRecipeRunIndex: number;
  /** 运输组件的当前域锁：组件内所有槽位只能存在该物品类型。null 表示组件为空，无限制。 */
  transportComponentDomain: Record<string, string | null>;
  /** 基地电池当前电量（焦耳），进入仿真时满电。 */
  baseBatteryJoules: number;
  /** 净水节点手动产出的跨 tick 小数余量。key 为 compiled device id。 */
  waterPurifierManualRemainders: Record<string, number>;
  /** 地区有限资源每 10 秒提交后的六分之一物品余量。key 为 item id。 */
  regionalResourceRemainderSixths: Record<string, number>;
  /** 配方产出/消耗统计状态（1 分钟滑动窗口） */
  recipeStats: RecipeStatsState;
}

/** 单 tick 配方统计增量 */
export interface RecipeStatsDelta {
  /** 该 tick 内各物品产出数量 */
  produced: Record<string, number>;
  /** 该 tick 内各物品消耗数量 */
  consumed: Record<string, number>;
}

export interface RecipeStatsBucket extends RecipeStatsDelta {
  /** 该 bucket 覆盖的标准 tick 数。 */
  standardTicks: number;
}

/** 配方统计滑动窗口状态 */
export interface RecipeStatsState {
  /** 环形缓冲：最近 N 个 tick 的 delta */
  windowDeltas: RecipeStatsDelta[];
  /** 当前写入游标 */
  windowCursor: number;
  /** 窗口中有效条目数 */
  windowCount: number;
  /** 窗口容量（= standardTickRate × 60） */
  windowCapacity: number;
  /** 当前聚合值：key 为 itemType */
  aggregated: Record<string, { producedPerMinute: number; consumedPerMinute: number }>;
  /** 各物品最后一次发生变化的 tick */
  lastChangedTick: Record<string, number>;
  /** 已封桶的 phase-safe 统计窗口。 */
  windowBuckets: RecipeStatsBucket[];
  /** 正在累积、尚未到 phase-safe 边界的 bucket。 */
  activeBucket: RecipeStatsBucket;
  /** 已封桶窗口当前覆盖的标准 tick 数。 */
  coveredStandardTicks: number;
  /** 已封桶窗口内各物品产出总量。 */
  windowProducedTotals: Record<string, number>;
  /** 已封桶窗口内各物品消耗总量。 */
  windowConsumedTotals: Record<string, number>;
}

export interface RuntimeSlotState {
  itemType: string | null;
  count: number;
}

export interface RuntimeDeviceState {
  deviceState?: SimulationDeviceStateReadModel;
  cultivation?: SimulationCropCultivationReadModel;
  block: boolean;
  // 每个 channel 独立运行一个配方。key 为 channel id。
  channelRecipes: Record<string, RuntimeDeviceRecipeState | null>;
}


export interface RuntimeDeviceRecipeState {
  runId: string;
  recipeId: string;
  recipeType: SimulationRecipeType;
  progressTicks: number;
  durationTicks: number;
  state: "running" | "waiting-output";
  plan: CompiledSimulationRecipePlan;
  reservations: RuntimeReservedItem[];
  inputItems: RuntimeRecipeItem[];
}

export interface RuntimeRecipeItem {
  itemType: string;
  amount: number;
}

export interface RuntimeReservedItem {
  slotId: string;
  itemType: string;
  amount: number;
  ignoreStock: boolean;
}

export interface RuntimeFixedWindowCounterState {
  windowStartTick: number;
  count: number;
  /** 已完成窗口的计数环形缓冲（最多 6 个 = ADMISSION_RATE_WINDOWS_PER_MINUTE）。最旧窗口可能仅部分落入过去 60 秒，oneMinuteCount 需配合 moveTicks 精确计算该窗口覆盖部分。 */
  pastWindowCounts: readonly number[];
  /** 准入口每次输出的 tick 号（用于精确计算过去一分钟真实通过数量）。窗口滚动时 trim 60 秒以外的旧条目。 */
  moveTicks: number[];
}

export interface SimulationTickTransientState {
  /** Stage 2 构建的求解节点状态。excludedItemTypes 在 overlay 配方完成路径中不可直接读取 —— 该字段包含上一 tick 的 buildSolveGraph 残留，createSlotOverlayState 会重建它。 */
  nodes: Record<string, RuntimeTickNodeState>;
  edges: Record<string, RuntimeTickEdgeState>;
  transfers: RuntimeTransferRecord[];
  diagnostics: RuntimeTickDiagnosticRecord[];
  /** Stage 3 增量优化：被阻塞的 input-view node ID 集合，避免 refreshBlockedInputNodesAfterMove 每次全量扫描 nodeOrder。 */
  blockedInputNodeIds: Set<string>;
  /** 当前 tick 的槽位预留量聚合索引（lazy build）；首次查询时从所有设备配方遍历构建。在 overlay 配方完成路径中不可直接读取 —— 预留量在 commitSlotOverlay 之后由 adjustReservedAmounts 在原 state 上修正。 */
  reservedAmountByStorageSlotId: Record<string, number> | null;
  /** 帧开始时冻结、Stage 5 消耗启动后重算的设备运行许可。跨 tick 的 overlay 配方完成路径不可依赖此字段 —— 它是上一 tick 的快照。 */
  activeConsumptionDeviceIds: ReadonlySet<string>;
  /** 当前 tick 判定用气体扩散范围。跨 tick 的 overlay 配方完成路径不可依赖此字段 —— 它是上一 tick 的快照。 */
  activeEnvironments: readonly RuntimeEnvironmentSnapshot[];
  /** 当前 tick 是否处于真实电力不足状态。 */
  isPowerOutage: boolean;
  /** Perf 埋点：当前 tick 的热点函数调用计数累积器。仅在 perfEnabled 时非空。 */
  _perf?: SimulationRuntimePerf;
  /** 当前 tick 的配方统计增量（产出/消耗），由各阶段累积，tick 结束时滚入滑动窗口后清空。 */
  recipeStatsDelta: RecipeStatsDelta;
}

export interface SimulationRuntimePerf {
  getReservedCalls: number;
  canOutputProvideCalls: number;
  findInputSlotCalls: number;
  getRemainingCapacityCalls: number;
  selectSourceCalls: number;
  solveOutputEdgeChecks: number;
  inputEdgeLookupCalls: number;
  inputEdgeLookupMs: number;
  outputEdgeLookupCalls: number;
  outputEdgeLookupMs: number;
  edgeIndexFallbackScans: number;
  reservedLookupCalls: number;
  reservedLookupMs: number;
  reservedIndexBuilds: number;
  reservedIndexBuildMs: number;
  reservationAdjustCalls: number;
  recipeFinishCalls: number;
  recipeFinishSuccesses: number;
  recipeFinishFailures: number;
  recipeFinishPreflightMs: number;
  recipeFinishCommitMs: number;
  recipeFinishChangedSlots: number;
}

export type RuntimeNodeResolveState = "unresolved" | "visited" | "blocked-resolved";

export interface RuntimeTickNodeState {
  nodeId: string;
  result: "uncertain" | "solved-run" | "solved-block";
  resolveState: RuntimeNodeResolveState;
  excludedItemTypes: readonly string[];
  acceptedInputEdgeIds: string[];
  acceptedOutputEdgeIds: string[];
  blockReason?: string;
}

export interface RuntimeTickEdgeState {
  edgeId: string;
  shadowPull: RuntimeShadowState;
  shadowPush: RuntimeShadowState;
  sourceSlotId: string | null;
  targetSlotId: string | null;
  itemType: string | null;
  amount: number;
}

export interface RuntimeTransferRecord {
  edgeId: string;
  sourceSlotId: string;
  targetSlotId: string;
  itemType: string;
  amount: number;
}

export interface RuntimeTickDiagnosticRecord {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
}

export function createSimulationMutableRuntimeState(
  topology: CompiledSimulationTopology,
): SimulationMutableRuntimeState {
  const slots: Record<string, RuntimeSlotState> = {};
  for (const slotId of topology.ordering.slotOrder) {
    const slot = topology.slots[slotId];
    if (slot === undefined) {
      continue;
    }

    slots[slotId] = createInitialSlotState(slot);
  }

  const linkState = buildRuntimeLinkState(topology);
  normalizeShareAllSources(slots, linkState.shareAllTargetSlotIdBySourceSlotId);

  const devices: Record<string, RuntimeDeviceState> = {};
  const admissionCounters = createInitialAdmissionCounters(topology);
  const fixedWindowCounters = createInitialFixedWindowCounters(topology);
  const routingCursors: Record<string, number> = {};
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    devices[deviceId] = { block: false, channelRecipes: {} };
    for (const [portRef, entry] of Object.entries(device.routing)) {
      routingCursors[`${deviceId}:${portRef}`] = entry.roundRobinSeed;
    }
  }
  for (const routingGroup of collectTopologyRoutingCursorGroups(topology)) {
    routingCursors[routingGroup.key] = 0;
  }


  return {
    tickNumber: 0,
    lastAdvancedTickNumber: 0,
    persistent: {
      slots,
      devices,
      admissionCounters,
      fixedWindowCounters,
      routingCursors,
      ...linkState,
      nextRecipeRunIndex: 1,
      transportComponentDomain: Object.fromEntries(
        Object.keys(topology.transportComponents).map((id) => [id, null]),
      ),
      baseBatteryJoules: BASE_BATTERY_CAPACITY_J,
      waterPurifierManualRemainders: createWaterPurifierManualRemainders(topology),
      regionalResourceRemainderSixths: {},
      recipeStats: createRecipeStatsState(topology.standardTickRate),
    },
    transient: createEmptyTransientState(),
  };
}

export interface SimulationRuntimeStateMigrationOptions {
  readonly previousTopology: CompiledSimulationTopology;
  readonly previousState: SimulationMutableRuntimeState;
  readonly topology: CompiledSimulationTopology;
  readonly resetDeviceIds: readonly string[];
}

export function createMigratedSimulationMutableRuntimeState(
  options: SimulationRuntimeStateMigrationOptions,
): SimulationMutableRuntimeState {
  const state = createSimulationMutableRuntimeState(options.topology);
  const resetDeviceIds = new Set(options.resetDeviceIds);

  state.tickNumber = options.previousState.tickNumber;
  state.lastAdvancedTickNumber = options.previousState.tickNumber;
  state.persistent.nextRecipeRunIndex = options.previousState.persistent.nextRecipeRunIndex;
  state.persistent.cultivationSeconds = options.previousState.persistent.cultivationSeconds;
  state.persistent.baseBatteryJoules = options.previousState.persistent.baseBatteryJoules;
  for (const [itemId, perMinute] of Object.entries(
    options.topology.regionalResourceSupply?.finitePerMinuteByItemId ?? {},
  )) {
    if (
      options.previousTopology.regionalResourceSupply?.finitePerMinuteByItemId[itemId]
      === perMinute
    ) {
      state.persistent.regionalResourceRemainderSixths[itemId] =
        (options.previousState.persistent.regionalResourceRemainderSixths ?? {})[itemId] ?? 0;
    }
  }

  for (const deviceId of options.topology.ordering.deviceOrder) {
    if (resetDeviceIds.has(deviceId)) {
      continue;
    }

    const previousDevice = options.previousTopology.devices[deviceId];
    const nextDevice = options.topology.devices[deviceId];
    const previousDeviceState = options.previousState.persistent.devices[deviceId];
    if (previousDevice === undefined || nextDevice === undefined || previousDeviceState === undefined) {
      continue;
    }

    for (const slotId of listDeviceSlotIds(options.topology, nextDevice)) {
      const previousSlotState = options.previousState.persistent.slots[slotId];
      if (previousSlotState !== undefined) {
        state.persistent.slots[slotId] = cloneRuntimeSlotState(previousSlotState);
      }
    }

    state.persistent.devices[deviceId] = cloneRuntimeDeviceState(previousDeviceState);
    if (nextDevice.waterPurifierNode !== undefined && nextDevice.waterPurifierNode !== null) {
      state.persistent.waterPurifierManualRemainders[deviceId] =
        (options.previousState.persistent.waterPurifierManualRemainders ?? {})[deviceId] ?? 0;
    }
    for (const portId of nextDevice.portIds) {
      const nextPort = options.topology.ports[portId];
      if (
        nextPort !== undefined
        && canPreserveFixedWindowCounter({
          previousTopology: options.previousTopology,
          topology: options.topology,
          previousPortId: portId,
          portId,
        })
      ) {
        state.persistent.admissionCounters[portId] =
          options.previousState.persistent.admissionCounters[portId] ?? 0;
        const previousFixedWindowCounter = options.previousState.persistent.fixedWindowCounters[portId];
        if (previousFixedWindowCounter !== undefined) {
          state.persistent.fixedWindowCounters[portId] =
            cloneFixedWindowCounterState(previousFixedWindowCounter);
        }
      }
    }
    for (const cursorKey of Object.keys(state.persistent.routingCursors)) {
      if (!cursorKey.startsWith(`${deviceId}:`)) {
        continue;
      }
      const previousCursor = options.previousState.persistent.routingCursors[cursorKey];
      if (previousCursor !== undefined) {
        state.persistent.routingCursors[cursorKey] = previousCursor;
      }
    }
  }

  normalizeShareAllSources(state.persistent.slots, state.persistent.shareAllTargetSlotIdBySourceSlotId);
  resetConflictingTransportComponents(options.topology, state);
  return state;
}

/**
 * 克隆可变运行时状态。缓存未来 tick 时可省略仅供当前 tick 展示/求解的 transient，
 * 后续推进会由 buildSolveGraph 重建这些数据。
 */
export function cloneSimulationMutableRuntimeState(
  state: SimulationMutableRuntimeState,
  includeTransientState = true,
): SimulationMutableRuntimeState {
  return {
    tickNumber: state.tickNumber,
    lastAdvancedTickNumber: state.lastAdvancedTickNumber,
    persistent: {
      cultivationSeconds: state.persistent.cultivationSeconds,
      slots: Object.fromEntries(Object.entries(state.persistent.slots).map(([slotId, slot]) => [
        slotId,
        cloneRuntimeSlotState(slot),
      ])),
      devices: Object.fromEntries(Object.entries(state.persistent.devices).map(([deviceId, device]) => [
        deviceId,
        cloneRuntimeDeviceState(device),
      ])),
      admissionCounters: { ...state.persistent.admissionCounters },
      fixedWindowCounters: Object.fromEntries(
        Object.entries(state.persistent.fixedWindowCounters).map(([portId, counter]) => [
          portId,
          cloneFixedWindowCounterState(counter),
        ]),
      ),
      routingCursors: { ...state.persistent.routingCursors },
      shareAllTargetSlotIdBySourceSlotId: { ...state.persistent.shareAllTargetSlotIdBySourceSlotId },
      sharedCapacitySlotIdsBySlotId: Object.fromEntries(
        Object.entries(state.persistent.sharedCapacitySlotIdsBySlotId).map(([slotId, slotIds]) => [
          slotId,
          [...slotIds],
        ]),
      ),
      sharedCapacityLimitBySlotId: { ...state.persistent.sharedCapacityLimitBySlotId },
      nextRecipeRunIndex: state.persistent.nextRecipeRunIndex,
      transportComponentDomain: { ...state.persistent.transportComponentDomain },
      baseBatteryJoules: state.persistent.baseBatteryJoules,
      waterPurifierManualRemainders: { ...(state.persistent.waterPurifierManualRemainders ?? {}) },
      regionalResourceRemainderSixths: {
        ...(state.persistent.regionalResourceRemainderSixths ?? {}),
      },
      recipeStats: cloneRecipeStatsState(state.persistent.recipeStats),
    },
    transient: includeTransientState
      ? cloneTransientState(state.transient)
      : createEmptyTransientState(),
  };
}

export function createEmptyTransientState(): SimulationTickTransientState {
  return {
    nodes: {},
    edges: {},
    transfers: [],
    diagnostics: [],
    blockedInputNodeIds: new Set(),
    reservedAmountByStorageSlotId: null,
    activeConsumptionDeviceIds: new Set(),
    activeEnvironments: [],
    isPowerOutage: false,
    recipeStatsDelta: createRecipeStatsDelta(),
  };
}

function buildRuntimeLinkState(topology: CompiledSimulationTopology): Pick<
  SimulationPersistentRuntimeState,
  "shareAllTargetSlotIdBySourceSlotId" | "sharedCapacitySlotIdsBySlotId" | "sharedCapacityLimitBySlotId"
> {
  const shareAllTargetSlotIdBySourceSlotId: Record<string, string> = {};
  const sharedCapacitySlotIdsBySlotId: Record<string, readonly string[]> = {};
  const sharedCapacityLimitBySlotId: Record<string, number> = {};

  for (const link of Object.values(topology.links)) {
    if (link.linkType === "share-all") {
      Object.assign(shareAllTargetSlotIdBySourceSlotId, link.targetSlotIdBySourceSlotId);
      continue;
    }

    const componentSlotIds = [...new Set([...link.sourceSlotIds, ...link.targetSlotIds])].sort();
    const capacityLimit = Math.max(
      0,
      ...componentSlotIds.map((slotId) => topology.slots[slotId]?.capacity ?? 0),
    );
    for (const slotId of componentSlotIds) {
      sharedCapacitySlotIdsBySlotId[slotId] = componentSlotIds;
      sharedCapacityLimitBySlotId[slotId] = capacityLimit;
    }
  }

  return {
    shareAllTargetSlotIdBySourceSlotId,
    sharedCapacitySlotIdsBySlotId,
    sharedCapacityLimitBySlotId,
  };
}

function normalizeShareAllSources(
  slots: Record<string, RuntimeSlotState>,
  targetSlotIdBySourceSlotId: Readonly<Record<string, string>>,
): void {
  for (const [sourceSlotId, targetSlotId] of Object.entries(targetSlotIdBySourceSlotId)) {
    const source = slots[sourceSlotId];
    const target = slots[targetSlotId];
    if (source === undefined || target === undefined) {
      continue;
    }

    if (target.itemType === null && source.itemType !== null) {
      target.itemType = source.itemType;
    }
    target.count += source.count;
    source.itemType = null;
    source.count = 0;
  }
}

function createInitialSlotState(slot: CompiledSimulationSlot): RuntimeSlotState {
  return {
    itemType: slot.initialItemType ?? slot.lock,
    count: Math.max(0, slot.initialCount),
  };
}

function createInitialAdmissionCounters(
  topology: CompiledSimulationTopology,
): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const portId of topology.ordering.portOrder) {
    const port = topology.ports[portId];
    if (port?.admissionRule !== null && port?.admissionRule !== undefined) {
      counters[portId] = 0;
    }
  }
  return counters;
}

function createWaterPurifierManualRemainders(
  topology: CompiledSimulationTopology,
): Record<string, number> {
  const remainders: Record<string, number> = {};
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device?.waterPurifierNode !== undefined && device.waterPurifierNode !== null) {
      remainders[deviceId] = 0;
    }
  }
  return remainders;
}

function createInitialFixedWindowCounters(
  topology: CompiledSimulationTopology,
): Record<string, RuntimeFixedWindowCounterState> {
  const counters: Record<string, RuntimeFixedWindowCounterState> = {};
  for (const portId of topology.ordering.portOrder) {
    if (portUsesFixedWindowCounter(topology, portId)) {
      counters[portId] = { windowStartTick: 1, count: 0, pastWindowCounts: [], moveTicks: [] };
    }
  }
  return counters;
}


export function normalizeFixedWindowCountersForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const portId of topology.ordering.portOrder) {
    if (portUsesFixedWindowCounter(topology, portId)) {
      ensureFixedWindowCounterForCurrentWindow(topology, state, portId);
    }
  }
}

export function readFixedWindowCounterForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): RuntimeFixedWindowCounterState {
  return ensureFixedWindowCounterForCurrentWindow(topology, state, portId);
}

export function incrementFixedWindowCounterForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
  amount = 1,
): void {
  const counter = ensureFixedWindowCounterForCurrentWindow(topology, state, portId);
  counter.count += Math.max(0, Math.trunc(amount));
  for (let i = 0; i < Math.max(0, Math.trunc(amount)); i++) {
    counter.moveTicks.push(state.tickNumber);
  }
}

export function resetFixedWindowCounterForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): void {
  state.persistent.fixedWindowCounters[portId] = {
    windowStartTick: resolveCounterWindowStartTick(topology, state.tickNumber, portId),
    count: 0,
    pastWindowCounts: [],
    moveTicks: [],
  };
}

export function readAdmissionRateWindowRemainingAllowance(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): number {
  const rule = topology.ports[portId]?.admissionRule;
  if (
    rule === undefined
    || rule === null
    || rule.itemId === null
    || rule.perMinuteLimit === null
  ) {
    return Number.MAX_SAFE_INTEGER;
  }

  const rateWindowRemaining =
    Math.floor(rule.perMinuteLimit / ADMISSION_RATE_WINDOWS_PER_MINUTE)
    - readFixedWindowCounterForCurrentWindow(topology, state, portId).count;

  return Math.max(0, rateWindowRemaining);
}

export function readAdmissionOutputRemainingAllowance(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): number {
  const rule = topology.ports[portId]?.admissionRule;
  if (rule === undefined || rule === null || rule.itemId === null) {
    return Number.MAX_SAFE_INTEGER;
  }

  const totalRemaining = rule.limit === null
    ? Number.MAX_SAFE_INTEGER
    : rule.limit - (state.persistent.admissionCounters[portId] ?? 0);
  return Math.max(
    0,
    Math.min(
      totalRemaining,
      readAdmissionRateWindowRemainingAllowance(topology, state, portId),
    ),
  );
}

function ensureFixedWindowCounterForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): RuntimeFixedWindowCounterState {
  const windowStartTick = resolveCounterWindowStartTick(topology, state.tickNumber, portId);
  const counter = state.persistent.fixedWindowCounters[portId];
  if (counter === undefined || counter.windowStartTick !== windowStartTick) {
    // 窗口滚动时，将旧窗口计数推入环形缓冲。
    const oldCount = counter?.count ?? 0;
    const oldPast = counter?.pastWindowCounts ?? [];
    // 环形缓冲最多保留 ADMISSION_RATE_WINDOWS_PER_MINUTE（6）个已完成窗口。
    // oneMinuteCount 在最旧窗口上使用 moveTicks 精确计算，故这里保存完整计数。
    const nextPast = oldPast.length >= ADMISSION_RATE_WINDOWS_PER_MINUTE
      ? [...oldPast.slice(1), oldCount]
      : [...oldPast, oldCount];
    // Trim moveTicks to last 60 seconds.
    const cutoff = state.tickNumber - topology.standardTickRate * 60;
    const nextMoveTicks = (counter?.moveTicks ?? []).filter((t) => t > cutoff);
    const nextCounter = { windowStartTick, count: 0, pastWindowCounts: nextPast, moveTicks: nextMoveTicks };
    state.persistent.fixedWindowCounters[portId] = nextCounter;
    return nextCounter;
  }
  return counter;
}


function resolveCounterWindowStartTick(
  topology: CompiledSimulationTopology,
  tickNumber: number,
  _portId: string,
): number {
  const windowTicks = Math.max(1, topology.standardTickRate * 10);
  const currentTick = Math.max(0, Math.trunc(tickNumber));
  // tick 0 是初始快照；首个有效窗口从 tick 1 开始，后续窗口为
  // 1 + N * windowTicks（例如 1、11、21 或分钟窗口的 1、1201、2401）。
  return 1 + Math.floor(Math.max(0, currentTick - 1) / windowTicks) * windowTicks;
}

function portUsesFixedWindowCounter(
  topology: CompiledSimulationTopology,
  portId: string,
): boolean {
  const port = topology.ports[portId];
  return port?.admissionRule !== null && port?.admissionRule !== undefined;
}


function canPreserveFixedWindowCounter(options: {
  readonly previousTopology: CompiledSimulationTopology;
  readonly topology: CompiledSimulationTopology;
  readonly previousPortId: string;
  readonly portId: string;
}): boolean {
  const previousPort = options.previousTopology.ports[options.previousPortId];
  const nextPort = options.topology.ports[options.portId];
  const preservesAdmission = previousPort?.admissionRule !== undefined
    && previousPort.admissionRule !== null
    && nextPort?.admissionRule !== undefined
    && nextPort.admissionRule !== null
    && previousPort.admissionRule.itemId === nextPort.admissionRule.itemId;
  return preservesAdmission;
}


function cloneRuntimeSlotState(slot: RuntimeSlotState): RuntimeSlotState {
  return {
    itemType: slot.itemType,
    count: slot.count,
  };
}

function cloneFixedWindowCounterState(
  counter: RuntimeFixedWindowCounterState,
): RuntimeFixedWindowCounterState {
  return {
    windowStartTick: counter.windowStartTick,
    count: counter.count,
    pastWindowCounts: [...counter.pastWindowCounts],
    moveTicks: [...counter.moveTicks],
  };
}


function cloneRuntimeDeviceState(device: RuntimeDeviceState): RuntimeDeviceState {
  return {
    block: device.block,
    ...(device.deviceState ? { deviceState: { ...device.deviceState } } : {}),
    ...(device.cultivation ? { cultivation: { ...device.cultivation } } : {}),
    channelRecipes: Object.fromEntries(
      Object.entries(device.channelRecipes).map(([chId, recipe]) => [
        chId,
        recipe === null ? null : {
          ...recipe,
          // plan 是 topology 级不可变静态对象；检查点共享引用，仅克隆会随 tick 变化的运行字段。
          plan: recipe.plan,
          reservations: recipe.reservations.map((reservation) => ({ ...reservation })),
          inputItems: recipe.inputItems.map((item) => ({ ...item })),
        },
      ]),
    ),
  };
}


function cloneTransientState(transient: SimulationTickTransientState): SimulationTickTransientState {
  return {
    nodes: Object.fromEntries(Object.entries(transient.nodes).map(([nodeId, node]) => [
      nodeId,
      {
        ...node,
        excludedItemTypes: [...node.excludedItemTypes],
        acceptedInputEdgeIds: [...node.acceptedInputEdgeIds],
        acceptedOutputEdgeIds: [...node.acceptedOutputEdgeIds],
      },
    ])),
    edges: Object.fromEntries(Object.entries(transient.edges).map(([edgeId, edge]) => [
      edgeId,
      { ...edge },
    ])),
    transfers: transient.transfers.map((transfer) => ({ ...transfer })),
    diagnostics: transient.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    blockedInputNodeIds: new Set(transient.blockedInputNodeIds),
    reservedAmountByStorageSlotId: transient.reservedAmountByStorageSlotId === null
      ? null
      : { ...transient.reservedAmountByStorageSlotId },
    activeConsumptionDeviceIds: new Set(transient.activeConsumptionDeviceIds),
    activeEnvironments: transient.activeEnvironments.map((diffusion) => ({
      ...diffusion,
      gridRect: { ...diffusion.gridRect },
    })),
    isPowerOutage: transient.isPowerOutage,
    _perf: transient._perf === undefined ? undefined : { ...transient._perf },
    recipeStatsDelta: {
      produced: { ...transient.recipeStatsDelta.produced },
      consumed: { ...transient.recipeStatsDelta.consumed },
    },
  };
}

function listDeviceSlotIds(
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): readonly string[] {
  return device.nodeIds.flatMap((nodeId) => topology.nodes[nodeId]?.slotIds ?? []);
}

function resetConflictingTransportComponents(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const [componentId, component] of Object.entries(topology.transportComponents)) {
    const itemTypes = new Set<string>();
    for (const slotId of component.slotIds) {
      const slotState = state.persistent.slots[slotId];
      if (slotState !== undefined && slotState.count > 0 && slotState.itemType !== null) {
        itemTypes.add(slotState.itemType);
      }
    }

    if (itemTypes.size <= 1) {
      state.persistent.transportComponentDomain[componentId] = [...itemTypes][0] ?? null;
      continue;
    }

    for (const slotId of component.slotIds) {
      const slot = topology.slots[slotId];
      if (slot !== undefined) {
        state.persistent.slots[slotId] = createInitialSlotState(slot);
      }
    }
    for (const deviceId of component.deviceIds) {
      const deviceState = state.persistent.devices[deviceId];
      if (deviceState !== undefined) {
        deviceState.block = false;
        deviceState.channelRecipes = {};
      }
    }
    state.persistent.transportComponentDomain[componentId] = null;
  }
}

// ============================================================
// Recipe stats (1-minute sliding window)
// ============================================================

export function createRecipeStatsDelta(): RecipeStatsDelta {
  return { produced: {}, consumed: {} };
}

export function createRecipeStatsBucket(): RecipeStatsBucket {
  return { standardTicks: 0, produced: {}, consumed: {} };
}

export function createRecipeStatsState(standardTickRate: number): RecipeStatsState {
  const windowCapacity = Math.max(1, standardTickRate * 60); // 1 min simulation time
  return {
    windowDeltas: [],
    windowCursor: 0,
    windowCount: 0,
    windowCapacity,
    aggregated: {},
    lastChangedTick: {},
    windowBuckets: [],
    activeBucket: createRecipeStatsBucket(),
    coveredStandardTicks: 0,
    windowProducedTotals: {},
    windowConsumedTotals: {},
  };
}

export function cloneRecipeStatsState(state: RecipeStatsState): RecipeStatsState {
  return {
    windowDeltas: state.windowDeltas.map((delta) => ({
      produced: { ...delta.produced },
      consumed: { ...delta.consumed },
    })),
    windowCursor: state.windowCursor,
    windowCount: state.windowCount,
    windowCapacity: state.windowCapacity,
    aggregated: Object.fromEntries(
      Object.entries(state.aggregated).map(([itemType, stats]) => [
        itemType,
        { ...stats },
      ]),
    ),
    lastChangedTick: { ...state.lastChangedTick },
    windowBuckets: state.windowBuckets.map(cloneRecipeStatsBucket),
    activeBucket: cloneRecipeStatsBucket(state.activeBucket),
    coveredStandardTicks: state.coveredStandardTicks,
    windowProducedTotals: { ...state.windowProducedTotals },
    windowConsumedTotals: { ...state.windowConsumedTotals },
  };
}

/**
 * 将 tick 的配方统计增量累加到 delta 中。
 */
export function accumulateRecipeStatsDelta(accum: RecipeStatsDelta, inc: RecipeStatsDelta): void {
  for (const [itemType, amount] of Object.entries(inc.produced)) {
    accum.produced[itemType] = (accum.produced[itemType] ?? 0) + amount;
  }
  for (const [itemType, amount] of Object.entries(inc.consumed)) {
    accum.consumed[itemType] = (accum.consumed[itemType] ?? 0) + amount;
  }
}

/**
 * 将当前 tick 的 delta 写入环形缓冲，并重新计算聚合值。
 * 返回聚合后的 per-min 值。
 */
export function rollRecipeStatsWindow(
  stats: RecipeStatsState,
  tickDelta: RecipeStatsDelta,
  tickNumber: number,
  elapsedStandardTicks = 1,
  sealIntervalStandardTicks = 1,
): void {
  const standardTicks = Math.max(1, Math.trunc(elapsedStandardTicks));
  const sealInterval = Math.max(1, Math.trunc(sealIntervalStandardTicks));
  const firstStandardTick = tickNumber - standardTicks + 1;
  let segmentStartTick = firstStandardTick;

  while (segmentStartTick <= tickNumber) {
    const nextSealTick = Math.ceil(segmentStartTick / sealInterval) * sealInterval;
    const segmentEndTick = Math.min(tickNumber, nextSealTick);
    stats.activeBucket.standardTicks += segmentEndTick - segmentStartTick + 1;
    if (segmentEndTick === tickNumber) {
      accumulateRecipeStatsDelta(stats.activeBucket, tickDelta);
    }
    if (segmentEndTick === nextSealTick) {
      sealRecipeStatsBucket(stats);
    }
    segmentStartTick = segmentEndTick + 1;
  }

  for (const itemType of Object.keys(tickDelta.produced)) {
    stats.lastChangedTick[itemType] = tickNumber;
  }
  for (const itemType of Object.keys(tickDelta.consumed)) {
    stats.lastChangedTick[itemType] = tickNumber;
  }
}

function sealRecipeStatsBucket(stats: RecipeStatsState): void {
  const bucket = stats.activeBucket;
  if (bucket.standardTicks <= 0) {
    return;
  }

  const sealedBucket = cloneRecipeStatsBucket(bucket);
  stats.windowBuckets.push(sealedBucket);
  stats.coveredStandardTicks += sealedBucket.standardTicks;
  addRecipeStatsTotals(stats.windowProducedTotals, sealedBucket.produced);
  addRecipeStatsTotals(stats.windowConsumedTotals, sealedBucket.consumed);
  stats.activeBucket = createRecipeStatsBucket();

  trimRecipeStatsWindow(stats);
  refreshRecipeStatsAggregated(stats);
}

function trimRecipeStatsWindow(stats: RecipeStatsState): void {
  while (
    stats.windowBuckets.length > 1
    && stats.coveredStandardTicks - stats.windowBuckets[0]!.standardTicks >= stats.windowCapacity
  ) {
    const removed = stats.windowBuckets.shift()!;
    stats.coveredStandardTicks -= removed.standardTicks;
    subtractRecipeStatsTotals(stats.windowProducedTotals, removed.produced);
    subtractRecipeStatsTotals(stats.windowConsumedTotals, removed.consumed);
  }
  stats.windowCount = stats.windowBuckets.length;
}

function refreshRecipeStatsAggregated(stats: RecipeStatsState): void {
  stats.aggregated = {};
  if (stats.coveredStandardTicks < stats.windowCapacity) {
    return;
  }

  const normalization = stats.windowCapacity / stats.coveredStandardTicks;
  const itemTypes = new Set([
    ...Object.keys(stats.windowProducedTotals),
    ...Object.keys(stats.windowConsumedTotals),
  ]);
  for (const itemType of itemTypes) {
    const producedPerMinute = (stats.windowProducedTotals[itemType] ?? 0) * normalization;
    const consumedPerMinute = (stats.windowConsumedTotals[itemType] ?? 0) * normalization;
    if (producedPerMinute <= 0 && consumedPerMinute <= 0) {
      continue;
    }
    stats.aggregated[itemType] = { producedPerMinute, consumedPerMinute };
  }
}

function addRecipeStatsTotals(
  target: Record<string, number>,
  source: Record<string, number>,
): void {
  for (const [itemType, amount] of Object.entries(source)) {
    target[itemType] = (target[itemType] ?? 0) + amount;
  }
}

function subtractRecipeStatsTotals(
  target: Record<string, number>,
  source: Record<string, number>,
): void {
  for (const [itemType, amount] of Object.entries(source)) {
    const next = (target[itemType] ?? 0) - amount;
    if (next > 0) target[itemType] = next;
    else delete target[itemType];
  }
}

function cloneRecipeStatsBucket(bucket: RecipeStatsBucket): RecipeStatsBucket {
  return {
    standardTicks: bucket.standardTicks,
    produced: { ...bucket.produced },
    consumed: { ...bucket.consumed },
  };
}
