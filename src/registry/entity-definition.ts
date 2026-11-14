import { CROP_STATE_MACHINES } from "./crop-definitions";
import { WULING_FENCE_DEFINITIONS } from "./wuling-fence-definition";
// =========================================================================
// 实体定义注册表（Entity Definitions Registry）
//
// 本文件包含所有设备类型的完整定义。每个设备通过 createEntityDefinition()
// ／ createEmptyEntityDefinition() 构建，声明其端口、存储槽组、缓存链接、
// 配方和 Inspector 面板。
//
// 对应设计文档：
//   - 《模拟器抽象方式》§2 Entity 定义层 — EntityDefinition 的结构与默认值
//   - 《仿真运行原理》§3 核心原语 — 缓存类型 / 配方类型 / 缓存链接
//   - 《仿真运行原理》§5 图模型 — 节点来源与能力
//
// 设备分为两类：
//   1. 完整定义设备 — 声明了全部 portGroups/storageSlotGroups/
//      portStorageBindings/recipe/cacheLinks（如传送带、仓库、反应池等）。
//      这些设备直接参与仿真求解。
//   2. 空壳设备 — 通过 createEmptyEntityDefinition() 创建，
//      只声明 id/nameKey/spriteId/footprint/uiGroup/tags。
//
// Inspector 声明规则（对应《模拟器抽象方式》§4）：
//   每个设备的 inspectors[] 声明"用哪个面板编辑哪个路径"。
//   Inspector 不持有数据，只声明 type + targetPath + 最少必要参数。
//
// Placement Behavior 声明规则：
//   每个设备的 placementBehaviors 应在设备定义体内以数组字面量内联声明，
//   不通过文件顶部的组合常量间接引用。原因：
//   1. 保持 registry 的配置文件性质——读者无需跳转即可看清完整语义。
//   2. 避免组合常量被惯性复用，导致设备无意间继承不需要的额外行为。
//   3. 消除死常量问题（仅定义但无引用的孤立常量）。
// =========================================================================

import type {
  EntityDefinition,
  EntityBlockageAutoClearanceDefinition,
  ItemFilterType,
  EntityPlacementDefaults,
} from "@/domain/registry/types/entity-definition";
import {
  INSPECTOR_TYPE,
  type EntityInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";
import {
  PLACEMENT_BEHAVIOR_TYPE,
  type EntityPlacementBehaviorDeclaration,
} from "@/domain/registry/types/entity-placement-behavior";
import {
  ENTITY_INPUT_ROUTING_STRATEGY,
  ENTITY_SIMULATION_BEHAVIOR_TYPE,
} from "@/domain/registry/types/entity-simulation-behavior";
import {
  AnyDomain,
  FluidDomain,
  ItemDomainFlag,
  type ItemDomainFlag as ItemDomainFlags,
} from "@/domain/shared/item-domain-flags";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { DEFAULT_PORT_PRIORITY_GROUP } from "@/shared/port-priority-groups";
import { MAIN_CRAFT_GROUP_TAG } from "@/shared/entity-variants";
import { RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY } from "@/shared/recipe-channel-behavior";
import {
  CONSUMPTION_CHANNEL_IDS,
  CONSUMPTION_RECIPE_CHANNEL_TYPE,
  CONSUMPTION_SLOT_ID,
  CONSUMPTION_STORAGE_GROUP_ID,
  NORMAL_RECIPE_CHANNEL_TYPE,
} from "@/shared/consumption-channel";
import {
  BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
  WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
  WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE,
  WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
  WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS,
  WATER_PURIFIER_INTAKE_CHANNEL_IDS,
  WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY,
  WATER_PURIFIER_NODE_ENTITY_ID,
  WATER_PURIFIER_OUTPUT_ITEM_ID,
  WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY,
  WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
  WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID,
} from "@/shared/water-purifier-node";

import { ITEM_DEFINITIONS } from "./item-definition";
import {
  LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE,
  LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE,
} from "./logistics-definition-ids";
import { RECIPE_DEFINITIONS } from "./recipe-definition";

// ---------------------------------------------------------------------------
// 类型别名 — 从 EntityDefinition 中提取子类型
// ---------------------------------------------------------------------------

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];
type PortStorageBindingDefinition = EntityDefinition["portStorageBindings"][number];
type RecipeChannelDefinition = EntityDefinition["recipeChannels"][number];
type StorageSlotOptionsInput = Partial<Pick<
  StorageSlotDefinition,
  "lock" | "initialItemType" | "initialCount" | "ignoreStock"
>>;

/** 端口朝向简写：N=北 S=南 W=西 E=东（相对于设备 rotation=0） */
type PortEdgeInput = "N" | "S" | "W" | "E";

/** 槽位物品过滤类型：solid（固体）/ liquid（液体）/ any（任意） */
type FilterType = ItemFilterType;

/** createPort() 的输入类型 — 必填字段 + 可选覆盖字段 */
type PortDefinitionInput = Pick<
  PortDefinition,
  "id" | "localCellX" | "localCellY" | "edge"
> & Partial<Pick<
  PortDefinition,
  "acceptRule" | "admissionRule" | "priorityGroup" | "roundRobinSeed"
>>;

/** createEntityDefinition() 的输入类型 — inspectors / placementBehaviors / recipeChannels / displayOrder 可选，由工厂补全默认值 */
type EntityDefinitionInput = Omit<EntityDefinition, "inspectors" | "placementBehaviors" | "recipeChannels" | "displayOrder"> & {
  readonly inspectors?: readonly EntityInspectorDeclaration[];
  readonly placementBehaviors?: readonly EntityPlacementBehaviorDeclaration[];
  readonly recipeChannels?: readonly EntityDefinition["recipeChannels"][number][];
  readonly displayOrder?: number;
};

/** createEmptyEntityDefinition() 的输入类型 — 基础字段必填，电力字段可选 */
type EmptyEntityDefinitionInput = Pick<
  EntityDefinitionInput,
  "id" | "nameKey" | "spriteId" | "iconPath" | "footprint" | "uiGroup" | "tags"
> & Partial<Pick<EntityDefinitionInput,
  "requiresPower" | "powerDemand" | "ranges" | "isIdleAsRunning" | "displayOrder" | "spriteAnimation" | "spriteOffset" | "placementWhitelist"
>>;

const RECIPE_MACHINE_IDS = new Set(
  RECIPE_DEFINITIONS.map((recipe) => recipe.machineId),
);

const LIQUID_PURIFIER_LEFT_OUTPUT_ITEM_IDS = [
  "item_liquid_water",
  "item_liquid_acid",
] as const;

const LIQUID_PURIFIER_RIGHT_OUTPUT_ITEM_IDS = [
  "item_liquid_xiranite_poly",
  "item_liquid_copper_enr",
] as const;

function createLiquidPurifierOutputAcceptRule(
  itemIds: readonly string[],
): PortDefinition["acceptRule"] {
  const allowedItemIds = new Set<string>(itemIds);
  return {
    base: { kind: "domain", flags: FluidDomain },
    exclude: ITEM_DEFINITIONS
      .filter((item) => item.tags.includes("liquid") && !allowedItemIds.has(item.id))
      .map((item) => item.id)
      .sort(),
  };
}

const WAREHOUSE_SINK_TAG = "WarehouseSink";
const PRODUCER_TAG = "Producer";
/** 显式地图资格；地区 tag 仅作为可搜索元数据保留。 */
const WULING_PLACEMENT_WHITELIST = [
  { baseId: "wuling_protocol_core" },
  { baseId: "wuling_tianwangping_aid" },
  { baseId: "wuling_heart_repair_station" },
  { baseId: "stm_hongs_3" },
  { baseId: "wuling_agricultural_land" },
  { baseId: "draft_box" },
] as const satisfies NonNullable<EntityDefinition["placementWhitelist"]>;
const VAPORIZER_CONSUMPTION_ITEM_IDS = [
  "item_gas_acid",
  "item_gas_inert",
  "item_gas_water",
  "item_gas_xiranite",
] as const;

function createGasItemWhitelistAcceptRule(
  itemIds: readonly string[],
): PortDefinition["acceptRule"] {
  const allowedItemIds = new Set(itemIds);
  return {
    base: { kind: "domain", flags: ItemDomainFlag.Gas },
    exclude: ITEM_DEFINITIONS
      .filter((item) => item.tags.includes("gas") && !allowedItemIds.has(item.id))
      .map((item) => item.id)
      .sort(),
  };
}


// =========================================================================
// 工厂函数
// =========================================================================

/**
 * 创建完整实体定义。
 * 确保 recipeChannels/inspectors 始终为非 null/undefined 的规范化值。
 * 对应《模拟器抽象方式》§2 — Entity 定义层的完整属性默认值。
 * 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks。
 */
function createEntityDefinition(definition: EntityDefinitionInput): EntityDefinition {
  // 其 acceptRule/itemFilterType 转换为恒等映射，capacity 强制覆盖与当前显式定义冲突。
  // 管道族实体定义已直接使用 FluidDomain。
  const normalizedDefinition = definition;
  const declaredInspectors = [...(normalizedDefinition.inspectors ?? [])];
  const recipeMachineInspectors = createRecipeMachineIngredientSlotInspectors(normalizedDefinition);

  // 所有设备默认追加问题面板，用于展示放置/电力/堵塞等问题
  declaredInspectors.unshift({ type: INSPECTOR_TYPE.problem });
  if (normalizedDefinition.stateMachine !== undefined
    && !declaredInspectors.some((inspector) => inspector.type === INSPECTOR_TYPE.deviceState)) {
    declaredInspectors.push({ type: INSPECTOR_TYPE.deviceState });
  }
  if (
    normalizedDefinition.recipeChannels?.some(
      (channel) => channel.type === CONSUMPTION_RECIPE_CHANNEL_TYPE,
    ) === true
    && !declaredInspectors.some((inspector) => inspector.type === INSPECTOR_TYPE.meteredConsumption)
  ) {
    declaredInspectors.push({ type: INSPECTOR_TYPE.meteredConsumption });
  }

  return {
    ...normalizedDefinition,
    displayOrder: normalizedDefinition.displayOrder ?? 100,
    recipeChannels: [...(normalizedDefinition.recipeChannels ?? [])],
    placementBehaviors: normalizePlacementBehaviors(normalizedDefinition.placementBehaviors ?? []),
    inspectors: appendMissingInspectors(declaredInspectors, recipeMachineInspectors),
  };
}

function createProtocolCoreDefinitions(
  primaryDefinition: EntityDefinition,
): readonly EntityDefinition[] {
  return [
    primaryDefinition,
    {
      ...primaryDefinition,
      id: "sp_sub_hub_1",
      nameKey: "registry.entity.sp_sub_hub_1.name",
      spriteId: "item_port_sp_sub_hub_1",
      iconPath: "device-icons/item_port_sp_sub_hub_1.webp",
      spriteOffset: { topView: { x: -1, y: 0, width: 11, height: 9 } },
      uiGroup: "hidden",
    },
  ];
}



function normalizePlacementBehaviors(
  behaviors: readonly EntityPlacementBehaviorDeclaration[],
): EntityPlacementBehaviorDeclaration[] {
  const normalized: EntityPlacementBehaviorDeclaration[] = [];
  const seenTypes = new Set<string>();

  for (const behavior of [
    { type: PLACEMENT_BEHAVIOR_TYPE.defaultPlacement } as const,
    ...behaviors,
  ]) {
    if (seenTypes.has(behavior.type)) {
      continue;
    }

    seenTypes.add(behavior.type);
    normalized.push(behavior);
  }

  return normalized;
}

function createRecipeMachineIngredientSlotInspectors(
  definition: EntityDefinitionInput,
): EntityInspectorDeclaration[] {
  if (!RECIPE_MACHINE_IDS.has(definition.id)) {
    return [];
  }

  // 找出所有绑定了端口的存储槽组（即参与实际物流的槽组）
  const consumptionStorageGroupIds = new Set(
    definition.recipeChannels
      ?.filter((channel) => channel.type === CONSUMPTION_RECIPE_CHANNEL_TYPE)
      .flatMap((channel) => channel.ingredientStorageGroupIds)
    ?? [],
  );
  const dedicatedInspectorStorageGroupIds = new Set(
    definition.inspectors
      ?.filter((inspector) => inspector.type === INSPECTOR_TYPE.infiniteStorage)
      .flatMap((inspector) => inspector.slotGroupIds)
    ?? [],
  );
  const boundStorageSlotGroupIds = definition.storageSlotGroups
    .filter((storageSlotGroup) =>
      !consumptionStorageGroupIds.has(storageSlotGroup.id)
      && !dedicatedInspectorStorageGroupIds.has(storageSlotGroup.id)
      && definition.portStorageBindings.some(b => b.storageSlotGroupId === storageSlotGroup.id),
    )
    .map(g => g.id);

  if (boundStorageSlotGroupIds.length === 0) {
    return consumptionStorageGroupIds.size === 0
      ? []
      : [{ type: INSPECTOR_TYPE.slotConfig, slotGroupIds: [] }];
  }

  return [{
    type: INSPECTOR_TYPE.slotConfig,
    slotGroupIds: boundStorageSlotGroupIds,
  }];
}

function appendMissingInspectors(
  declaredInspectors: EntityInspectorDeclaration[],
  generatedInspectors: readonly EntityInspectorDeclaration[],
): EntityInspectorDeclaration[] {
  const inspectors = [...declaredInspectors];

  for (const generatedInspector of generatedInspectors) {
    // 该 type 是否已有声明（手写声明优先于自动生成）
    if (inspectors.some((inspector) => inspector.type === generatedInspector.type)) {
      continue;
    }

    inspectors.push(generatedInspector);
  }

  return inspectors;
}

/**
 * 创建空壳实体定义。
 * 只声明 id/nameKey/spriteId/footprint/uiGroup/tags + 电力字段。
 * inspectors/portGroups/storageSlotGroups/recipeChannels/portStorageBindings 均为空数组。
 * 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks。
 *
 * 空壳设备的实际端口/槽位/配方由外部配方注册表（recipe-definition.ts）中
 * machineId 对应关系在 Topology Compiler 编译时注入。
 * 标记 "v2 metadata sync" 的都属于此类。
 */
function createEmptyEntityDefinition(
  definition: EmptyEntityDefinitionInput,
): EntityDefinition {
  return createEntityDefinition({
    ...definition,
    requiresPower: definition.requiresPower ?? false,
    powerDemand: definition.powerDemand ?? 0,
    inspectors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
  });
}

/**
 * 将简写朝向转为标准 GridEdge 枚举。
 * N→NORTH  S→SOUTH  W→WEST  E→EAST
 */
function resolveEdge(edge: PortEdgeInput): PortDefinition["edge"] {
  switch (edge) {
    case "N":
      return "NORTH";
    case "S":
      return "SOUTH";
    case "W":
      return "WEST";
    case "E":
      return "EAST";
  }
}

/**
 * 创建端口定义。
 * acceptRule 默认按 portGroup.kind 推导（item→solid, fluid→liquid），
 * 可通过 options 覆盖。
 * admissionRule 仅由准入口 input port 显式声明。
 * priorityGroup 默认 5。
 * roundRobinSeed 默认等于端口在组内的 index。
 */
function createPort(
  id: string,
  localCellX: number,
  localCellY: number,
  edge: PortEdgeInput,
  options: Partial<Pick<
    PortDefinition,
    "acceptRule" | "admissionRule" | "priorityGroup" | "roundRobinSeed"
  >> = {},
): PortDefinitionInput {
  return {
    id,
    localCellX,
    localCellY,
    edge: resolveEdge(edge),
    ...options,
  };
}

/**
 * 创建端口组。
 * kind：item（固体物品端口）/ fluid（流体端口，含液体与气体）——决定默认 acceptRule。
 * direction：input（物品流入）/ output（物品流出）/ bidirectional（编译时分解为 input+output）。
 * 每个端口的 acceptRule 默认按 kind 推导，
 * priorityGroup 默认 5，roundRobinSeed 默认按 index 递增。
 *
 * 对应《仿真运行原理》§3.1 中 Port 的 accept-rule 配置。
 */
function createPortGroup(
  id: string,
  descriptor: Readonly<Pick<PortGroupDefinition, "kind" | "isPipe">>,
  direction: PortGroupDefinition["direction"],
  ports: PortDefinitionInput[],
): PortGroupDefinition {
  return {
    id,
    ...descriptor,
    direction,
    ports: ports.map((port, index) => ({
      ...port,
      acceptRule: port.acceptRule ?? acceptRuleFromPortKind(descriptor.kind),
      priorityGroup: port.priorityGroup ?? DEFAULT_PORT_PRIORITY_GROUP,
      roundRobinSeed: port.roundRobinSeed ?? index,
    })),
  };
}

/**
 * 创建单个存储槽位。
 *
 * 对应《仿真运行原理》§3.1 缓存类型中 slot 的概念。
 * - capacity：槽位最大容量
 * - itemFilterType：solid/liquid/any — 决定可存放的物品域
 * - lock：锁定物品 ID，null=不锁定。用户可通过 entity.config["slots[N].lock"] 覆盖
 * - ignoreStock：忽略仓库库存检查，取货口/出货口常用
 */
function createSlot(
  id: string,
  capacity: number,
  itemFilterType: FilterType,
  options: StorageSlotOptionsInput = {},
): StorageSlotDefinition {
  return {
    id,
    capacity,
    itemFilter: "type",
    itemFilterType,
    lock: options.lock ?? null,
    initialItemType: options.initialItemType ?? null,
    initialCount: options.initialCount ?? 0,
    ignoreStock: options.ignoreStock ?? false,
  };
}

/**
 * 批量创建同质槽位（相同 itemFilterType，不同 capacity）。
 * 槽位 ID 格式为 "${prefix}_1", "${prefix}_2", ...
 */
function createSlots(
  prefix: string,
  capacities: number[],
  itemFilterType: FilterType,
  options: StorageSlotOptionsInput = {},
): StorageSlotDefinition[] {
  return capacities.map((capacity, index) =>
    createSlot(`${prefix}_${index + 1}`, capacity, itemFilterType, options),
  );
}

/**
 * 创建存储槽组。
 *
 * 对应《仿真运行原理》§3.1 缓存类型 + §3.4 缓存组。
 * 存储组的输入/输出能力由绑定的端口方向决定；
 * 配方原料/产物角色由 Recipe Channel 声明。
 *
 * 原 role 推导 slotType → ingredientNodeIds/productNodeIds 的职责已由 Recipe Channel 接管。
 *
 * 每个存储槽组编译后对应一个求解图节点。
 * 组内 slot 互斥（同物品不能出现在多槽），跨组不互斥（§3.4）。
 */
function createStorageSlotGroup(
  id: string,
  kind: StorageSlotGroupDefinition["kind"],
  slots: StorageSlotDefinition[],
  splitLinkType: StorageSlotGroupDefinition["splitLinkType"] = "share-all",
): StorageSlotGroupDefinition {
  return {
    id,
    kind,
    slots,
    splitLinkType,
  };
}

/**
 * 创建端口-存储绑定。
 *
 * 将 portGroup 与 storageSlotGroup 关联，
 * 决定物品从哪个端口流入哪个缓存组。
 * 无显式绑定时，编译器自动生成 synthetic-input/synthetic-output 缓存组。
 *
 * 对应《仿真运行原理》§5.1 节点来源中的 port-cache 绑定关系。
 */
function createBinding(
  id: string,
  portGroupId: string,
  storageSlotGroupId: string,
): PortStorageBindingDefinition {
  return {
    id,
    portGroupId,
    storageSlotGroupId,
  };
}

function createRecipeChannel(
  id: string,
  ingredientStorageGroupIds: string[],
  productStorageGroupIds: string[],
  manualRecipeOnly?: boolean,
  type: RecipeChannelDefinition["type"] = NORMAL_RECIPE_CHANNEL_TYPE,
): RecipeChannelDefinition {
  return { id, type, ingredientStorageGroupIds, productStorageGroupIds, manualRecipeOnly };
}

function createConsumptionRecipeChannels(): RecipeChannelDefinition[] {
  return CONSUMPTION_CHANNEL_IDS.map((id) =>
    createRecipeChannel(
      id,
      [CONSUMPTION_STORAGE_GROUP_ID],
      [],
      false,
      CONSUMPTION_RECIPE_CHANNEL_TYPE,
    ),
  );
}

function createConsumptionStorageSlotGroup(
  itemFilterType: FilterType,
  itemIds: readonly string[],
): StorageSlotGroupDefinition {
  const slot = createSlot(CONSUMPTION_SLOT_ID, 5, itemFilterType);
  return createStorageSlotGroup(
    CONSUMPTION_STORAGE_GROUP_ID,
    FluidDomain,
    [{
      ...slot,
      itemFilter: "whitelist",
      itemFilterIds: [...itemIds],
    }],
  );
}

/**
 * 创建放置默认值。
 * 供设备定义在 placementDefaults 字段中使用，声明放置时自动写入的
 * entity.config 覆盖和自动创建的 slotLinks。
 */
function createPlacementDefaults(options: {
  config?: Record<string, unknown>;
  slotLinks?: EntityPlacementDefaults["slotLinks"];
}): EntityPlacementDefaults {
  return options;
}

function createBlockageAutoClearance(
  options: EntityBlockageAutoClearanceDefinition,
): EntityBlockageAutoClearanceDefinition {
  return options;
}

type DirectionalBufferLayoutInput = {
  idPrefix: string;
  domain: ItemDomainFlags;
  direction: "input" | "output";
  capacities: number[];
};

function resolveSlotFilterType(domain: DirectionalBufferLayoutInput["domain"]): FilterType {
  return domain;
}

/**
 * 简易生产设备工厂：批量生成 storageSlotGroups、portStorageBindings、recipeChannels 和 inspectors。
 *
 * 每个 layout 声明一个方向性缓冲（input/output, item/fluid, 多容量），
 * 函数自动生成对应的定义片段，减少样板代码。
 */
function createSimpleProductionDevice(
  layouts: readonly DirectionalBufferLayoutInput[],
): Pick<EntityDefinition, "storageSlotGroups" | "portStorageBindings" | "recipeChannels" | "inspectors"> {
  const ingGroupIds = layouts.filter(l => l.direction === "input").map(l => `${l.idPrefix}_${l.direction}_buffer`);
  const prodGroupIds = layouts.filter(l => l.direction === "output").map(l => `${l.idPrefix}_${l.direction}_buffer`);
  const hasChannel = ingGroupIds.length > 0 || prodGroupIds.length > 0;
  return {
    recipeChannels: hasChannel
      ? [createRecipeChannel("default", ingGroupIds, prodGroupIds)]
      : [],
    inspectors: hasChannel
      ? [
          {
            type: INSPECTOR_TYPE.recipeStatus,
            channelIds: ["default"],
          },
        ]
      : [],
    storageSlotGroups: layouts.map((layout) => createStorageSlotGroup(
      `${layout.idPrefix}_${layout.direction}_buffer`,
      layout.domain,
      createSlots(
        `${layout.direction}_${layout.idPrefix}_slot`,
        layout.capacities,
        resolveSlotFilterType(layout.domain),
      ),
    )),
    portStorageBindings: layouts.map((layout) => createBinding(
      `bind_${layout.idPrefix}_${layout.direction}`,
      `${layout.idPrefix}_${layout.direction}`,
      `${layout.idPrefix}_${layout.direction}_buffer`,
    )),
  };
}

/**
 * 从端口 kind 推导默认 acceptRule。
 * item → { base: { kind: "solid" }, exclude: [] }
 * fluid → { base: { kind: "fluid" }, exclude: [] }
 *
 * 对应《仿真运行原理》§3.1 表格中 Port 的 acceptRule 默认值。
 */
function acceptRuleFromPortKind(kind: PortGroupDefinition["kind"]): PortDefinition["acceptRule"] {
  return {
    base: { kind: "domain", flags: kind },
    exclude: [],
  };
}

const SOLID_BELT_PORT = {
  kind: ItemDomainFlag.Solid,
  isPipe: false,
} as const satisfies Pick<PortGroupDefinition, "kind" | "isPipe">;

const FLUID_PIPE_PORT = {
  kind: FluidDomain,
  isPipe: true,
} as const satisfies Pick<PortGroupDefinition, "kind" | "isPipe">;

/**
 * 创建搬运配方（传送带/管道用）。
 *
 * 对应《仿真运行原理》§3.2 配方类型中的 "reserved-item"：
 *   - 进度=100% 时消耗原料，占用存储
 *   - 原料在搬运过程中被"预定"，不可被他人使用
 *   - inputs: any(1) — 接受任意物品
 *   - outputs: same-as-input(1) — 输出与输入相同物品
 * 订正（2026-05-04）：传送带默认 2 秒；管道类设备在定义处显式传入 0.5 秒。
 * 订正（2026-05-05）：推进阶段若输出缓存可接收，则立即写入产物、消耗原料并结束当前 run；仅在推进阶段无法完整输出时，才留待二次结算阶段处理。
 */

/** 创建有向缓存代理链接定义。 */
// 订正（2026-05-06）：domain EntityDefinition 已移除 cacheLinks 字段，createCacheLink 已删除。

/** 创建传送带/管道标准有向代理链接。 */
// 订正（2026-05-06）：domain EntityDefinition 已移除 cacheLinks 字段，createTransportCacheLink 已删除。

// =========================================================================
// ENTITY_DEFINITIONS — 全部设备定义注册表
//
// 设备按 uiGroup 分组：
//   1. warehouse              — 仓库存取设备
//   2. beltLogistics          — 传送带物流设备
//   3. pipeLogistics          — 管道物流设备
//   4. basicProduction        — 基础生产设备
//   5. advancedManufacturing  — 高级合成制造
//   6. resourcePower          — 资源与电力
//   7. hidden                 — 隐藏设备（不显示在放置面板）
//
// 每个设备的注释标注了：
//   - 对应的游戏设备名称
//   - 缓存组数量与类型（ingredient/product/universal）
//   - 求解图节点数（每个 storageSlotGroup = 1 个节点，见《仿真运行原理》§5.1）
//   - 配方类型
//   - Link 类型
// =========================================================================

// 当前 EntityDefinition.id 已统一移除这些前缀，nameKey 与 spriteId 不随设备定义 ID 改名。

function createCheatInfiniteDeviceDefinition(options: {
  id: string;
  nameKey: string;
  iconPath: string;
  domain: ItemDomainFlags;
  isPipe: boolean;
  displayOrder: number;
}): EntityDefinition {
  const portDescriptor = {
    kind: options.domain,
    isPipe: options.isPipe,
  } as const satisfies Pick<PortGroupDefinition, "kind" | "isPipe">;

  return createEntityDefinition({
    id: options.id,
    nameKey: options.nameKey,
    spriteId: options.id,
    iconPath: options.iconPath,
    footprint: { width: 1, height: 1 },
    uiGroup: "cheat",
    displayOrder: options.displayOrder,
    tags: [
      "AvatarHidden",
      "ChevronHidden",
      ...(options.isPipe ? [] : ["BeltPortExtensionHidden"]),
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "infinite_input",
        portDescriptor,
        "input",
        [createPort("in_n", 0, 0, "N")],
      ),
      createPortGroup(
        "infinite_input_e",
        portDescriptor,
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "infinite_input_s",
        portDescriptor,
        "input",
        [createPort("in_s", 0, 0, "S")],
      ),
      createPortGroup(
        "infinite_input_w",
        portDescriptor,
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "infinite_output",
        portDescriptor,
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_e", 0, 0, "E"),
          createPort("out_s", 0, 0, "S"),
          createPort("out_w", 0, 0, "W"),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "destroy_buffer",
        options.domain,
        createSlots("destroy_slot", [500], options.domain),
      ),
      createStorageSlotGroup(
        "infinite_output_buffer",
        options.domain,
        createSlots("infinite_output_slot", [50], options.domain, {
          initialCount: 50,
          ignoreStock: true,
        }),
      ),
      createStorageSlotGroup(
        "destroy_buffer_e",
        options.domain,
        createSlots("destroy_slot", [500], options.domain),
      ),
      createStorageSlotGroup(
        "destroy_buffer_s",
        options.domain,
        createSlots("destroy_slot", [500], options.domain),
      ),
      createStorageSlotGroup(
        "destroy_buffer_w",
        options.domain,
        createSlots("destroy_slot", [500], options.domain),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("void_1", ["destroy_buffer"], []),
      createRecipeChannel("void_2", ["destroy_buffer_e"], []),
      createRecipeChannel("void_3", ["destroy_buffer_s"], []),
      createRecipeChannel("void_4", ["destroy_buffer_w"], []),
    ],
    recipeChannelBehavior: {
      allowDuplicateRecipesAcrossChannels: true,
    },
    portStorageBindings: [
      createBinding("bind_infinite_input", "infinite_input", "destroy_buffer"),
      createBinding("bind_infinite_input_e", "infinite_input_e", "destroy_buffer_e"),
      createBinding("bind_infinite_input_s", "infinite_input_s", "destroy_buffer_s"),
      createBinding("bind_infinite_input_w", "infinite_input_w", "destroy_buffer_w"),
      createBinding("bind_infinite_output", "infinite_output", "infinite_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.infiniteStorage,
        slotGroupIds: ["infinite_output_buffer"],
      },
    ],
  });
}

export const ENTITY_DEFINITIONS: EntityDefinition[] = [

  // =========================================================================
  // 仓库存取设备 (uiGroup: "warehouse")
  //
  // 仓储类设备的特点：
  //   - 大容量存储槽组（50+）
  //   - role="bidirectional" → universal 缓存类型
  //   - 通常 requiresPower=false（可在电网外运行）
  //   - 通过 warehouse-item-link 面板将槽位连接到仓库
  // =========================================================================

  /**
   * item_port_storager_1 — 协议存储箱（3×3）
   *
   * 缓存组：6 个 universal（每组 1 槽 × 50 容量）
   * 编译节点：12 个（6 个输入视图节点 + 6 个输出视图节点）
   * 端口：3 input(南) + 3 output(北)
   *
   * 对比《模拟器抽象方式》§2 的仓库取货口示例，
   * 本设备 slot.lock=null（未锁定），用户可通过 storageManagement 面板锁定。
   */
  createEntityDefinition({
    id: "storager_1",
    nameKey: "registry.entity.storager_1.name",
    spriteId: "item_port_storager_1",
    spriteAnimation: { closeIdleMode: "hold-last" },
    iconPath: "device-icons/item_port_storager_1.webp",
    footprint: { width: 3, height: 3 },
    spriteOffset: { topView: { x: 0, y: 0, width: 3, height: 3 } },
    uiGroup: "warehouse",
    displayOrder: 401,
    tags: [],
    requiresPower: true,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, 2 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, 2 - (x), 2, "S")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "storage_slot_1",
        ItemDomainFlag.Solid,
        createSlots("slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "storage_slot_2",
        ItemDomainFlag.Solid,
        createSlots("slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "storage_slot_3",
        ItemDomainFlag.Solid,
        createSlots("slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "storage_slot_4",
        ItemDomainFlag.Solid,
        createSlots("slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "storage_slot_5",
        ItemDomainFlag.Solid,
        createSlots("slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "storage_slot_6",
        ItemDomainFlag.Solid,
        createSlots("slot", [50], ItemDomainFlag.Solid),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("warehouse_submit", [], [], true),
    ],
    portStorageBindings: [
      createBinding("bind_item_input_1", "item_input", "storage_slot_1"),
      createBinding("bind_item_output_1", "item_output", "storage_slot_1"),
      createBinding("bind_item_input_2", "item_input", "storage_slot_2"),
      createBinding("bind_item_output_2", "item_output", "storage_slot_2"),
      createBinding("bind_item_input_3", "item_input", "storage_slot_3"),
      createBinding("bind_item_output_3", "item_output", "storage_slot_3"),
      createBinding("bind_item_input_4", "item_input", "storage_slot_4"),
      createBinding("bind_item_output_4", "item_output", "storage_slot_4"),
      createBinding("bind_item_input_5", "item_input", "storage_slot_5"),
      createBinding("bind_item_output_5", "item_output", "storage_slot_5"),
      createBinding("bind_item_input_6", "item_input", "storage_slot_6"),
      createBinding("bind_item_output_6", "item_output", "storage_slot_6"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["storage_slot_1", "storage_slot_2", "storage_slot_3", "storage_slot_4", "storage_slot_5", "storage_slot_6"],
      },
      {
        type: INSPECTOR_TYPE.submitToWarehouse,
      },
    ],
    placementDefaults: createPlacementDefaults({
      config: { channelRecipes: { warehouse_submit: "r_warehouse_submit" } },
    }),
  }),

  /**
   * item_port_log_hongs_bus — 物流洪斯总线（4×8）
   * 空壳设备，仅用于放置面板展示。不参与仿真求解。
   */
  createEntityDefinition({
    id: "log_hongs_bus",
    nameKey: "registry.entity.log_hongs_bus.name",
    spriteId: "item_port_log_hongs_bus",
    iconPath: "device-icons/item_port_log_hongs_bus.webp",
    footprint: { width: 4, height: 8 },
    spriteOffset: { topView: { x: 0, y: 0, width: 4, height: 8 } },
    uiGroup: "warehouse",
    displayOrder: 405,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "bus"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.mustConnectToHub },
      { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),

  /**
   * item_port_log_hongs_bus_source — 物流洪斯总线源桩（4×4）
   * 空壳设备，仅用于放置面板展示。
   */
  createEntityDefinition({
    id: "log_hongs_bus_source",
    nameKey: "registry.entity.log_hongs_bus_source.name",
    spriteId: "item_port_log_hongs_bus_source",
    iconPath: "device-icons/item_port_log_hongs_bus_source.webp",
    footprint: { width: 4, height: 4 },
    spriteOffset: { topView: { x: 0, y: 0, width: 4, height: 4 } },
    uiGroup: "warehouse",
    displayOrder: 406,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "bus"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),

  /**
   * item_port_unloader_1 — 取货口（3×1）
   *
   * 缓存组：1 个 universal（单槽 × 1 容量）
   * 求解图节点：1 个
   * 端口：1 output(南)
   *
   * 通过 warehouse-item-link 面板将槽位连接到仓库。
   * ignoreStock 可设为 true 实现无限取货。
   */
  createEntityDefinition({
    id: "unloader_1",
    nameKey: "registry.entity.unloader_1.name",
    spriteId: "item_port_unloader_1",
    iconPath: "device-icons/item_port_unloader_1.webp",
    footprint: { width: 3, height: 1 },
    spriteOffset: {
      topView: { x: 0, y: -1, width: 3, height: 2 },
    },
    uiGroup: "warehouse",
    displayOrder: 403,
    tags: ["AvatarHidden"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.mustConnectToHubViaOppositePortEdge },
      {
        type: PLACEMENT_BEHAVIOR_TYPE.rotateToSnapOnBuilding,
        targetDeviceIds: ["log_hongs_bus", "log_hongs_bus_source"],
      },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [createPort("p_out_mid", 1, 0, "S")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "unloader_buffer",
        ItemDomainFlag.Solid,
        createSlots("slot", [1], ItemDomainFlag.Solid),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_output", "item_output", "unloader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["unloader_buffer"],
      },
    ],
  }),

  /**
   * item_port_mix_pool_1 — 反应池（5×5）
   *
   * 缓存组：1 个（shared_input_buffer，5 槽 × 50 容量），共享承担输入与输出。
   *   - 输入/输出端口全部绑定到该组，compiler 检测双向绑定后自动展开为
   *     input-view / output-view 双 Node + share-all Slot Link。
   * 求解图节点：2 个（输入视图 + 输出视图，共享同一组真实槽位）
   * 端口：2 item-input(南) + 2 item-output(北) + 2 fluid-input(东) + 2 fluid-output(西)
   *      因为 itemFilterType="any"，该缓存组可接收固体和液体。
   *
   * 对应《仿真运行原理》§3.3 缓存组示例：
   *   - 1 个槽位组，5 个槽位（反应池普通版）
   *   - 组内互斥：同物品只能出现在一个槽
   *
   * recipeChannel 的 ingredient/product 都只引用 shared_input_buffer。
   * 配方：immediate-consume（进度 0% 时立即扣除原料）
   */
  createEntityDefinition({
    id: "mix_pool_1",
    nameKey: "registry.entity.mix_pool_1.name",
    spriteId: "item_port_mix_pool_1",
    iconPath: "device-icons/item_port_mix_pool_1.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: {
      closeIdleMode: "hold-last",
    },
    spriteOffset: {
      topView: { x: -1, y: 0, width: 7, height: 5 },
    },
    uiGroup: "advancedManufacturing",
    displayOrder: 606,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [1, 3].map((x) => createPort(`out_n_${x}`, 4 - (x), 4, "S", { acceptRule: { base: { kind: "none" }, exclude: [] } })),
      ),
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [1, 3].map((x) => createPort(`in_s_${x}`, 4 - (x), 0, "N")),
      ),
      createPortGroup(
        "fluid_output_a",
        FLUID_PIPE_PORT,
        "output",
        [createPort(`out_w_1`, 4, 3, "E", { acceptRule: { base: { kind: "none" }, exclude: [] } })],
      ),
      createPortGroup(
        "fluid_output_b",
        FLUID_PIPE_PORT,
        "output",
        [createPort(`out_w_3`, 4, 1, "E", { acceptRule: { base: { kind: "none" }, exclude: [] } })],
      ),
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [1, 3].map((y) => createPort(`in_e_${y}`, 0, 4 - (y), "W")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "shared_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_slot", [50, 50, 50, 50, 50], AnyDomain),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("ch1", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch2", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch3", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch4", ["shared_input_buffer"], ["shared_input_buffer"], true),
    ],
    recipeChannelBehavior: {
      automaticModeConfigKey: RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY,
      allowDuplicateRecipesAcrossChannels: false,
    },
    placementDefaults: createPlacementDefaults({
      config: {
        [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
      },
    }),
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "shared_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "shared_input_buffer"),
      createBinding("bind_item_output", "item_output", "shared_input_buffer"),
      createBinding("bind_fluid_output_a", "fluid_output_a", "shared_input_buffer"),
      createBinding("bind_fluid_output_b", "fluid_output_b", "shared_input_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["ch1", "ch2", "ch3", "ch4"],
      },
      {
        type: INSPECTOR_TYPE.portOutputConfig,
        portGroupIds: ["item_output", "fluid_output_a", "fluid_output_b"],
      },
    ],
  }),
  // =========================================================================
  // 基础生产设备 (uiGroup: "basicProduction")
  //
  // 生产设备的特点（对应《仿真运行原理》§3.2）：
  //   - immediate-consume 配方：进度 0% 时立即扣除原料
  //   - 独立的 ingredient 缓存组（输入缓冲）+ product 缓存组（输出缓冲）
  // 订正（2026-05-06）：domain EntityDefinition 已移除 recipe 字段，本注册表仅保留静态端口与缓存结构。
  // =========================================================================

  /**
   * item_port_grinder_1 — 粉碎机（3×3）
   *
   * 缓存组：2 个 — 1 ingredient（1 槽 × 50）+ 1 product（1 槽 × 50）
   * 端口：3 input(南) + 3 output(北)
   * 配方：immediate-consume + recipeShell（选择外部配方 "r_crusher_*"）
   */
  createEntityDefinition({
    id: "grinder_1",
    nameKey: "registry.entity.grinder_1.name",
    spriteId: "item_port_grinder_1",
    iconPath: "device-icons/item_port_grinder_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 503,
    tags: [PRODUCER_TAG],
    requiresPower: true,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, 2 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, 2 - (x), 2, "S")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        ItemDomainFlag.Solid,
        createSlots("output_slot", [50], ItemDomainFlag.Solid),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  /**
   * item_port_liquid_filling_pd_mc_1 — 液体填充器（6×4，液体变体）
   *
   * 缓存组：3 个 — 1 ingredient-item（1 槽 × 50）+ 1 ingredient-fluid（1 槽 × 50）+ 1 product（1 槽 × 50）
   * 端口：6 item-input(南) + 1 fluid-input(东) + 6 item-output(北)
   *
   * 本设备是 item_port_filling_pd_mc_1 的液体变体（alter-variant:liquid），
   * 增加了 fluid_input 端口和对应的 fluid 输入缓冲。
   */
  createEntityDefinition({
    id: "filling_pd_mc_1_liquid",
    nameKey: "registry.entity.filling_pd_mc_1_liquid.name",
    spriteId: "item_port_liquid_filling_pd_mc_1",
    iconPath: "device-icons/item_port_filling_pd_mc_1.webp",
    footprint: { width: 6, height: 4 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 603,
    tags: [PRODUCER_TAG, "alter:filling_pd_mc_1", "alter-variant:liquid"],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, 5 - (x), 0, "N")),
      ),
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_e_2", 0, 1, "W", {
          acceptRule: { base: { kind: "domain", flags: FluidDomain }, exclude: [] },
        })],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, 5 - (x), 3, "S")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_item_slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "fluid_input_buffer",
        FluidDomain,
        createSlots("input_fluid_slot", [50], FluidDomain),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        ItemDomainFlag.Solid,
        createSlots("output_slot", [50], ItemDomainFlag.Solid),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "fluid_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "filling_pd_mc_1",
    nameKey: "registry.entity.filling_pd_mc_1.name",
    spriteId: "item_port_filling_pd_mc_1",
    iconPath: "device-icons/item_port_filling_pd_mc_1.webp",
    footprint: { width: 6, height: 4 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 602,
    tags: [
      PRODUCER_TAG,
      "alter:filling_pd_mc_1",
      "alter-variant:normal",
      MAIN_CRAFT_GROUP_TAG,
    ],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, 5 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, 5 - (x), 3, "S")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_item_slot", [50,50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        ItemDomainFlag.Solid,
        createSlots("output_slot", [50], ItemDomainFlag.Solid),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  // =========================================================================
  // 传送带物流设备 (uiGroup: "beltLogistics" 或 "hidden")
  // 3 个传送带节使用 hidden，4 个传送带物流设备使用 beltLogistics。
  //
  // 传送带设备的特点（对应《仿真运行原理》§5.1.1-5.1.3）：
  //   - 2 个缓存组：ingredient + product（各 1 槽 × 1 容量）
  // 订正（2026-05-07）：传送带现定义为 1 个 bidirectional 缓存组（1 槽 × 1 容量），编译时按 share-cap 分解为 ingredient 输入视图 + product 输出视图。
  //   - 2 个求解图节点
  //   - Cache Link 约束两端累计容量上限=1
  //   - reserved-item 搬运配方：any × 1s → same-as-input
  // 订正（2026-05-04）：传送带搬运配方时间为 2 秒。
  //   - 分流器/汇流器/连接器：多端口绑定到同一组节点
  //   - uiGroup="hidden" 的设备不显示在放置面板（由传送带绘制工具自动生成）
  // 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks 字段，本注册表不再内联这些运行时配置。
  // =========================================================================


  /**
   * belt_straight_1x1 — 传送带直段（1×1）
   * 端口：W→E 流向
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[LOGISTICS_KIND.belt].straight,
    nameKey: "registry.entity.belt_straight_1x1.name",
    spriteId: "belt_straight_1x1",
    iconPath: "device-icons/belt_straight_1x1.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["ChevronHidden"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        ItemDomainFlag.Solid,
        createSlots("slot", [1], ItemDomainFlag.Solid),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),

  /**
   * belt_turn_cw_1x1 — 传送带顺时针转弯（1×1）
   * 端口：W→S 流向
   * 订正（2026-05-10）：当前端口基准改为 E→N 流向。
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[LOGISTICS_KIND.belt]["turn-cw"],
    nameKey: "registry.entity.belt_turn_cw_1x1.name",
    spriteId: "belt_turn_cw_1x1",
    iconPath: "device-icons/belt_turn_cw_1x1.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["ChevronHidden"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_n", 0, 0, "N")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        ItemDomainFlag.Solid,
        createSlots("slot", [1], ItemDomainFlag.Solid),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * belt_turn_ccw_1x1 — 传送带逆时针转弯（1×1）
   * 端口：W→N 流向
   * 订正（2026-05-10）：当前端口基准改为 N→E 流向。
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[LOGISTICS_KIND.belt]["turn-ccw"],
    nameKey: "registry.entity.belt_turn_ccw_1x1.name",
    spriteId: "belt_turn_ccw_1x1",
    iconPath: "device-icons/belt_turn_ccw_1x1.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["ChevronHidden"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n", 0, 0, "N")],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        ItemDomainFlag.Solid,
        createSlots("slot", [1], ItemDomainFlag.Solid),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),
  /**
   * item_log_splitter — 分流器（1×1）
   *
   * 缓存组：2 个 — ingredient + product（自动合成，各 1 槽 × 1 容量）
   * 求解图节点：2 个
   * 端口：1 input(东) + 3 output(北/南/西)
   *
   * 对应《仿真运行原理》§5.1.2：
   *   1 个 input port → ingredient 组节点，3 个 output port → product 组节点
   *   多个端口连接到同一个组节点是合法且预期的。
   *   调度由 port 的 priorityGroup 和 roundRobinSeed 控制。
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.belt].splitter,
    nameKey: "registry.entity.log_splitter.name",
    spriteId: "item_log_splitter",
    iconPath: "device-icons/item_log_splitter.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    displayOrder: 102,
    tags: ["OuterRingAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.autoRotateAlignPorts },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n", 0, 0, "N")],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [
          createPort("out_e", 0, 0, "E"),
          createPort("out_w", 0, 0, "W"),
          createPort("out_s", 0, 0, "S"),
        ],
      ),
    ],
    // 现改为 input=N, outputs=E/W/S，使得 rotation=0 时入口朝北。
    // 旧 v2 蓝图通过 LEGACY_DEVICE_REMAPPERS rotationOffset=90 兼容。
    // 现改为显式 bidirectional+share-cap，与 belt_straight_1x1 结构一致，
    // 使编译器生成 input-view/output-view 节点 + share-cap link + reserved-item 搬运配方。
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        ItemDomainFlag.Solid,
        createSlots("slot", [1], ItemDomainFlag.Solid),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * item_log_converger — 汇流器（1×1）
   *
   * 对应《仿真运行原理》§5.1.2：
   *   3 个 input port → ingredient 组节点，1 个 output port → product 组节点
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.belt].converger,
    nameKey: "registry.entity.log_converger.name",
    spriteId: "item_log_converger",
    iconPath: "device-icons/item_log_converger.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    displayOrder: 103,
    tags: ["OuterRingAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.autoRotateAlignPorts },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_e", 0, 0, "E"),
          createPort("in_w", 0, 0, "W"),
        ],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_s", 0, 0, "S")],
      ),
    ],
    // 现改为 inputs=N/E/W, output=S，使得 rotation=0 时出口朝南。
    // 旧 v2 蓝图通过 LEGACY_DEVICE_REMAPPERS rotationOffset=90 兼容。
    // 现改为显式 bidirectional+share-cap，与 belt_straight_1x1 结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        ItemDomainFlag.Solid,
        createSlots("slot", [1], ItemDomainFlag.Solid),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * item_log_connector — 连接器/十字路口（1×1）
   * 4 方向双通道独立运输：N↔S 与 W↔E 互不干扰。
   * 对应《仿真运行原理》§5.1 桥类设备双通道双槽位模型。
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.belt].connector,
    nameKey: "registry.entity.log_connector.name",
    spriteId: "item_log_connector",
    iconPath: "device-icons/item_log_connector.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    displayOrder: 101,
    tags: ["ChevronHidden"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input_ns",
        SOLID_BELT_PORT,
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "item_output_ns",
        SOLID_BELT_PORT,
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "item_input_ew",
        SOLID_BELT_PORT,
        "input",
        [
          createPort("in_w", 0, 0, "W"),
          createPort("in_e", 0, 0, "E"),
        ],
      ),
      createPortGroup(
        "item_output_ew",
        SOLID_BELT_PORT,
        "output",
        [
          createPort("out_w", 0, 0, "W"),
          createPort("out_e", 0, 0, "E"),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "ns_buffer",
        ItemDomainFlag.Solid,
        createSlots("ns_slot", [1], ItemDomainFlag.Solid),
        "share-cap",
      ),
      createStorageSlotGroup(
        "ew_buffer",
        ItemDomainFlag.Solid,
        createSlots("ew_slot", [1], ItemDomainFlag.Solid),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("NS", ["ns_buffer"], ["ns_buffer"]),
      createRecipeChannel("EW", ["ew_buffer"], ["ew_buffer"]),
    ],
    recipeChannelBehavior: {
      allowDuplicateRecipesAcrossChannels: true,
    },
    portStorageBindings: [
      createBinding("bind_item_input_ns", "item_input_ns", "ns_buffer"),
      createBinding("bind_item_output_ns", "item_output_ns", "ns_buffer"),
      createBinding("bind_item_input_ew", "item_input_ew", "ew_buffer"),
      createBinding("bind_item_output_ew", "item_output_ew", "ew_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),
  // =========================================================================
  // 管道物流设备 (uiGroup: "pipeLogistics" 或 "hidden")
  // 3 个管道节使用 hidden，4 个管道物流设备使用 pipeLogistics。
  //
  // 管道设备与传送带结构相同（对应《仿真运行原理》§5.1.4）：
  //   - 2 个缓存组：ingredient + product（自动合成，kind="fluid"）
  //   - Cache Link
  //   - reserved-item 搬运配方
  // 订正（2026-05-04）：管道类搬运配方时间为 0.5 秒。
  // 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks 字段，本注册表不再内联这些运行时配置。
  // =========================================================================



  /**
   * pipe_straight_1x1 — 管道直段（1×1）
   * 端口：W→E 流向
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[LOGISTICS_KIND.pipe].straight,
    nameKey: "registry.entity.pipe_straight_1x1.name",
    spriteId: "pipe_straight_1x1",
    iconPath: "device-icons/pipe_straight_1x1.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed", "ChevronHidden"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [],
    recipeChannels: [
      createRecipeChannel("default", ["synthetic-input"], ["synthetic-output"]),
    ],
    portStorageBindings: [],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * pipe_turn_cw_1x1 — 管道顺时针转弯（1×1）
   * 订正（2026-05-10）：当前端口基准为 E→N 流向。
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[LOGISTICS_KIND.pipe]["turn-cw"],
    nameKey: "registry.entity.pipe_turn_cw_1x1.name",
    spriteId: "pipe_turn_cw_1x1",
    iconPath: "device-icons/pipe_turn_cw_1x1.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed", "ChevronHidden"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_n", 0, 0, "N")],
      ),
    ],
    storageSlotGroups: [],
    recipeChannels: [
      createRecipeChannel("default", ["synthetic-input"], ["synthetic-output"]),
    ],
    portStorageBindings: [],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * pipe_turn_ccw_1x1 — 管道逆时针转弯（1×1）
   * 订正（2026-05-10）：当前端口基准为 N→E 流向。
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[LOGISTICS_KIND.pipe]["turn-ccw"],
    nameKey: "registry.entity.pipe_turn_ccw_1x1.name",
    spriteId: "pipe_turn_ccw_1x1",
    iconPath: "device-icons/pipe_turn_ccw_1x1.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed", "ChevronHidden"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_n", 0, 0, "N")],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [],
    recipeChannels: [
      createRecipeChannel("default", ["synthetic-input"], ["synthetic-output"]),
    ],
    portStorageBindings: [],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * item_pipe_splitter — 管道分流器（1×1）
   * 与 item_log_splitter 结构相同，kind 为 fluid。
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.pipe].splitter,
    nameKey: "registry.entity.pipe_splitter.name",
    spriteId: "item_pipe_splitter",
    iconPath: "device-icons/item_pipe_splitter.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    displayOrder: 202,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.autoRotateAlignPorts },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_n", 0, 0, "N")],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [
          createPort("out_e", 0, 0, "E"),
          createPort("out_w", 0, 0, "W"),
          createPort("out_s", 0, 0, "S"),
        ],
      ),
    ],
    // 现改为显式 bidirectional+share-cap（fluid），与 pipe 直段结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "fluid_buffer",
        FluidDomain,
        createSlots("slot", [1], FluidDomain),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_buffer"], ["fluid_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * item_pipe_converger — 管道汇流器（1×1）
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.pipe].converger,
    nameKey: "registry.entity.pipe_converger.name",
    spriteId: "item_pipe_converger",
    iconPath: "device-icons/item_pipe_converger.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    displayOrder: 203,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.autoRotateAlignPorts },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_e", 0, 0, "E"),
          createPort("in_w", 0, 0, "W"),
        ],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_s", 0, 0, "S")],
      ),
    ],
    // 现改为显式 bidirectional+share-cap（fluid），与 pipe 直段结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "fluid_buffer",
        FluidDomain,
        createSlots("slot", [1], FluidDomain),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_buffer"], ["fluid_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * item_pipe_connector — 管道连接器/十字路口（1×1）
   * 4 方向双通道独立运输：N↔S 与 W↔E 互不干扰，ChevronHidden=不显示方向箭头。
   * 对应《仿真运行原理》§5.1 桥类设备双通道双槽位模型。
   */
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.pipe].connector,
    nameKey: "registry.entity.pipe_connector.name",
    spriteId: "item_pipe_connector",
    iconPath: "device-icons/item_pipe_connector.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    displayOrder: 201,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input_ns",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "fluid_output_ns",
        FLUID_PIPE_PORT,
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "fluid_input_ew",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_w", 0, 0, "W"),
          createPort("in_e", 0, 0, "E"),
        ],
      ),
      createPortGroup(
        "fluid_output_ew",
        FLUID_PIPE_PORT,
        "output",
        [
          createPort("out_w", 0, 0, "W"),
          createPort("out_e", 0, 0, "E"),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "ns_buffer",
        FluidDomain,
        createSlots("ns_slot", [1], FluidDomain),
        "share-cap",
      ),
      createStorageSlotGroup(
        "ew_buffer",
        FluidDomain,
        createSlots("ew_slot", [1], FluidDomain),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("NS", ["ns_buffer"], ["ns_buffer"]),
      createRecipeChannel("EW", ["ew_buffer"], ["ew_buffer"]),
    ],
    recipeChannelBehavior: {
      allowDuplicateRecipesAcrossChannels: true,
    },
    portStorageBindings: [
      createBinding("bind_fluid_input_ns", "fluid_input_ns", "ns_buffer"),
      createBinding("bind_fluid_output_ns", "fluid_output_ns", "ns_buffer"),
      createBinding("bind_fluid_input_ew", "fluid_input_ew", "ew_buffer"),
      createBinding("bind_fluid_output_ew", "fluid_output_ew", "ew_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * item_port_udpipe_loader_1 — 地下管道装载口（3×3）
   * 流体输入方向。仅 1 个 input port(西)。
   */
  createEntityDefinition({
    id: "udpipe_loader_1",
    nameKey: "registry.entity.udpipe_loader_1.name",
    spriteId: "item_port_udpipe_loader_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_udpipe_loader_1.webp",
    footprint: { width: 3, height: 3 },
    spriteOffset: { topView: { x: 0, y: 0, width: 4, height: 3 } },
    uiGroup: "warehouse",
    displayOrder: 407,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    simulationBehaviors: [{
      type: ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting,
      strategy: ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked,
      storageSlotGroupIds: ["loader_buffer"],
    }],
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_w_1", 0, 1, "W")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "loader_buffer",
        FluidDomain,
        createSlots("slot", [500], FluidDomain),
      ),
    ],
    recipeChannels: [],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "loader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.darkPipeLink,
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["loader_buffer"],
      },
    ],
  }),

  /**
   * item_port_udpipe_unloader_1 — 暗管出口（3×3）
   *
   * 缓存组：1 个 universal（单槽 × 1 容量）
   * 求解图节点：1 个
   * 端口：1 fluid output(东)
   *
   * 通过 warehouse-item-link 面板将槽位连接到仓库。
   * 与取货口结构一致，区别在于 kind="fluid" 限制仅可选流体（液体和气体）。
   * ignoreStock 可设为 true 实现无限取货。
   */
  createEntityDefinition({
    id: "udpipe_unloader_1",
    nameKey: "registry.entity.udpipe_unloader_1.name",
    spriteId: "item_port_udpipe_unloader_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_udpipe_unloader_1.webp",
    footprint: { width: 3, height: 3 },
    spriteOffset: { topView: { x: -1, y: 0, width: 4, height: 3 } },
    uiGroup: "warehouse",
    displayOrder: 408,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_e_1", 2, 1, "E")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "unloader_buffer",
        FluidDomain,
        createSlots("slot", [500], FluidDomain),
      ),
      createStorageSlotGroup(
        "transport_input",
        FluidDomain,
        createSlots("slot", [500], FluidDomain),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("transport_1", ["transport_input"], ["unloader_buffer"]),
      createRecipeChannel("transport_2", ["transport_input"], ["unloader_buffer"]),
    ],
    recipeChannelBehavior: {
      allowDuplicateRecipesAcrossChannels: true,
    },
    portStorageBindings: [
      createBinding("bind_fluid_output", "fluid_output", "unloader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.darkPipeLink,
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["unloader_buffer"],
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["unloader_buffer"],
      },
    ],
  }),

  // =========================================================================
  // 空壳设备 (v2 metadata sync)
  //
  // 以下设备仅保留 name, footprint, sprite, tags 和基础放置组信息。
  // 其端口组、存储槽组、端口绑定、配方均在编译时通过外部配方注册表
  // (recipe-definition.ts) 中的 machineId 对应关系注入。
  //
  // 对应《模拟器抽象方式》§5 编译期合并：
  //   编译时 EntityDefinition + 外部 RecipeDefinition → 完整 CompiledSimulationDevice
  //
  // 这些设备属于"未完成迁移"的设备，等待在后续 v2 迭代中
  // 补全 portGroups/storageSlotGroups/portStorageBindings/recipe 定义。
  // =========================================================================
  // 订正（2026-05-09）：本区块中的大部分设备已按 v2 静态端口补齐为完整定义；
  // 目前仍保留为空壳的仅有 v2 本身未提供静态端口的设备。

  createEntityDefinition({
    id: "loader_1",
    nameKey: "registry.entity.loader_1.name",
    spriteId: "item_port_loader_1",
    iconPath: "device-icons/item_port_loader_1.webp",
    footprint: { width: 3, height: 1 },
    spriteOffset: {
      topView: { x: 0, y: 0, width: 3, height: 2 },
    },
    uiGroup: "warehouse",
    displayOrder: 402,
    tags: ["AvatarHidden", WAREHOUSE_SINK_TAG],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.mustConnectToHubViaOppositePortEdge },
      {
        type: PLACEMENT_BEHAVIOR_TYPE.rotateToSnapOnBuilding,
        targetDeviceIds: ["log_hongs_bus", "log_hongs_bus_source"],
      },
    ],
    requiresPower: false,
    powerDemand: 0,
    // 原端口朝北(N)，现改为朝南(S)，使 rotation=0 方向与显示 sprite 对齐。
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [createPort("p_in_mid", 1, 0, "N")],
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [1] },
    ]),
  }),
  createEntityDefinition({
    id: "furnance_1",
    nameKey: "registry.entity.furnance_1.name",
    spriteId: "item_port_furnance_1",
    iconPath: "device-icons/item_port_furnance_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 501,
    tags: [
      PRODUCER_TAG,
      "alter:furnance_1",
      "alter-variant:normal",
      MAIN_CRAFT_GROUP_TAG,
    ],
    requiresPower: true,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, 2 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, 2 - (x), 2, "S")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50] },
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "furnance_1_liquid",
    nameKey: "registry.entity.furnance_1_liquid.name",
    spriteId: "item_port_liquid_furnance_1",
    iconPath: "device-icons/item_port_liquid_furnance_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 502,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵", "alter:furnance_1", "alter-variant:liquid"],
    requiresPower: true,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, 2 - (x), 0, "N")),
      ),
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_e_1", 0, 1, "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_w_1", 2, 1, "E", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, 2 - (x), 2, "S")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup("item_input_buffer", ItemDomainFlag.Solid, createSlots("input_item_slot", [50], ItemDomainFlag.Solid)),
      createStorageSlotGroup("fluid_input_buffer", FluidDomain, createSlots("input_fluid_slot", [50], ItemDomainFlag.Liquid)),
      createStorageSlotGroup("fluid_output_buffer", FluidDomain, createSlots("output_fluid_slot", [50], ItemDomainFlag.Liquid)),
      createStorageSlotGroup("item_output_buffer", ItemDomainFlag.Solid, createSlots("output_item_slot", [50], ItemDomainFlag.Solid)),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "fluid_input_buffer"], ["fluid_output_buffer", "item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_output_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
    inspectors: [
      { type: INSPECTOR_TYPE.recipeStatus, channelIds: ["default"] },
    ],
  }),
  createEntityDefinition({
    id: "cmpt_mc_1",
    nameKey: "registry.entity.cmpt_mc_1.name",
    spriteId: "item_port_cmpt_mc_1",
    iconPath: "device-icons/item_port_cmpt_mc_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: {
      closeIdleMode: "hold-last",
    },
    uiGroup: "basicProduction",
    displayOrder: 504,
    tags: [PRODUCER_TAG],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, 2 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, 2 - (x), 2, "S")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50] },
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "shaper_1",
    nameKey: "registry.entity.shaper_1.name",
    spriteId: "item_port_shaper_1",
    iconPath: "device-icons/item_port_shaper_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 505,
    tags: [
      PRODUCER_TAG,
      "alter:shaper_1",
      "alter-variant:normal",
      MAIN_CRAFT_GROUP_TAG,
    ],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, 2 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, 2 - (x), 2, "S")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50] },
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "shaper_1_gas",
    nameKey: "registry.entity.shaper_1_gas.name",
    spriteId: "shaper_1_gas",
    iconPath: "device-icons/shaper_1_gas.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 506,
    tags: [
      PRODUCER_TAG,
      "alter:shaper_1",
      "alter-variant:gas",
    ],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, 2 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, 2 - (x), 2, "S")),
      ),
      createPortGroup(
        "gas_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_e_1", 0, 1, "W", {
            acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_item_slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        ItemDomainFlag.Solid,
        createSlots("output_item_slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "gas_input_buffer",
        FluidDomain,
        createSlots("input_gas_slot", [50], ItemDomainFlag.Gas),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "gas_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "seedcol_1",
    nameKey: "registry.entity.seedcol_1.name",
    spriteId: "item_port_seedcol_1",
    iconPath: "device-icons/item_port_seedcol_1.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 507,
    tags: [PRODUCER_TAG],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, 4 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, 4 - (x), 4, "S")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50] },
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "planter_1",
    nameKey: "registry.entity.planter_1.name",
    spriteId: "item_port_planter_1",
    iconPath: "device-icons/item_port_planter_1.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 508,
    tags: [
      PRODUCER_TAG,
      "alter:planter_1",
      "alter-variant:normal",
      MAIN_CRAFT_GROUP_TAG,
    ],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, 4 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, 4 - (x), 4, "S")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50] },
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "planter_1_liquid",
    nameKey: "registry.entity.planter_1_liquid.name",
    spriteId: "item_port_hydro_planter_1",
    iconPath: "device-icons/item_port_hydro_planter_1.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 509,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵", "alter:planter_1", "alter-variant:liquid"],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, 4 - (x), 0, "N")),
      ),
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_e_2", 0, 2, "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, 4 - (x), 4, "S")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup("item_input_buffer", ItemDomainFlag.Solid, createSlots("input_item_slot", [50], ItemDomainFlag.Solid)),
      createStorageSlotGroup("fluid_input_buffer", FluidDomain, createSlots("input_fluid_slot", [50], ItemDomainFlag.Liquid)),
      createStorageSlotGroup("item_output_buffer", ItemDomainFlag.Solid, createSlots("output_item_slot", [50], ItemDomainFlag.Solid)),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "fluid_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
    inspectors: [
      { type: INSPECTOR_TYPE.recipeStatus, channelIds: ["default"] },
    ],
  }),
  createEntityDefinition({
    id: "winder_1",
    nameKey: "registry.entity.winder_1.name",
    spriteId: "item_port_winder_1",
    iconPath: "device-icons/item_port_winder_1.webp",
    footprint: { width: 6, height: 4 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 601,
    tags: [PRODUCER_TAG],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, 5 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, 5 - (x), 3, "S")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50, 50] },
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "tools_asm_mc_1",
    nameKey: "registry.entity.tools_asm_mc_1.name",
    spriteId: "item_port_tools_asm_mc_1",
    iconPath: "device-icons/item_port_tools_asm_mc_1.webp",
    footprint: { width: 6, height: 4 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 604,
    tags: [PRODUCER_TAG],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, 5 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, 5 - (x), 3, "S")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50, 50] },
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "thickener_1",
    nameKey: "registry.entity.thickener_1.name",
    spriteId: "item_port_thickener_1",
    iconPath: "device-icons/item_port_thickener_1.webp",
    footprint: { width: 6, height: 4 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 605,
    tags: [PRODUCER_TAG],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, 5 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, 5 - (x), 3, "S")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50, 50] },
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "power_sta_1",
    nameKey: "registry.entity.power_sta_1.name",
    spriteId: "item_port_power_sta_1",
    iconPath: "device-icons/item_port_power_sta_1.webp",
    footprint: { width: 2, height: 2 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "resourcePower",
    displayOrder: 303,
    tags: [PRODUCER_TAG],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1].map((x) => createPort(`in_s_${x}`, 1 - (x), 0, "N")),
      ),
    ],
    ...createSimpleProductionDevice([
      { idPrefix: "item", domain: ItemDomainFlag.Solid, direction: "input", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "mix_pool_2",
    nameKey: "registry.entity.mix_pool_2.name",
    spriteId: "item_port_mix_pool_2",
    iconPath: "device-icons/item_port_mix_pool_2.webp",
    footprint: { width: 6, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    spriteOffset: { topView: { x: 0, y: 0, width: 6, height: 5 } },
    uiGroup: "advancedManufacturing",
    displayOrder: 607,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 100,
    portGroups: [
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, 5 - (x), 4, "S", { acceptRule: { base: { kind: "none" }, exclude: [] } })),
      ),
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, 5 - (x), 0, "N")),
      ),
      createPortGroup(
        "fluid_output_a",
        FLUID_PIPE_PORT,
        "output",
        [createPort(`out_w_1`, 5, 3, "E", { acceptRule: { base: { kind: "none" }, exclude: [] } })],
      ),
      createPortGroup(
        "fluid_output_b",
        FLUID_PIPE_PORT,
        "output",
        [createPort(`out_w_3`, 5, 1, "E", { acceptRule: { base: { kind: "none" }, exclude: [] } })],
      ),
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [1, 3].map((y) => createPort(`in_e_${y}`, 0, 4 - (y), "W")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "shared_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_slot", [50, 50, 50, 50, 50, 50, 50, 50], AnyDomain),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("ch1", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch2", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch3", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch4", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch5", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch6", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch7", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch8", ["shared_input_buffer"], ["shared_input_buffer"], true),
    ],
    recipeChannelBehavior: {
      automaticModeConfigKey: RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY,
      allowDuplicateRecipesAcrossChannels: false,
    },
    placementDefaults: createPlacementDefaults({
      config: {
        [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
      },
    }),
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "shared_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "shared_input_buffer"),
      createBinding("bind_item_output", "item_output", "shared_input_buffer"),
      createBinding("bind_fluid_output_a", "fluid_output_a", "shared_input_buffer"),
      createBinding("bind_fluid_output_b", "fluid_output_b", "shared_input_buffer"),
    ],
    blockageAutoClearance: createBlockageAutoClearance({
      enabledByDefault: true,
      enabledConfigKey: BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
      channelIds: ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8"],
      slotRefs: [{ storageSlotGroupId: "shared_input_buffer" }],
      blockedChannelThreshold: 2,
    }),
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8"],
      },
      {
        type: INSPECTOR_TYPE.portOutputConfig,
        portGroupIds: ["item_output", "fluid_output_a", "fluid_output_b"],
      },
      {
        type: INSPECTOR_TYPE.blockageAutoClearance,
      },
    ],
  }),
  createEntityDefinition({
    id: "liquid_purifier_1",
    nameKey: "registry.entity.liquid_purifier_1.name",
    spriteId: "item_port_liquid_purifier_1",
    iconPath: "device-icons/item_port_liquid_purifier_1.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 609,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [
      PRODUCER_TAG,
      "武陵",
      "alter:liquid_purifier_1",
      "alter-variant:liquid",
      MAIN_CRAFT_GROUP_TAG,
    ],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [1, 3].map((z) => createPort(`in_s_${z}`, 0, 4 - (4 - z), "W", {
          acceptRule: { base: { kind: "domain", flags: FluidDomain }, exclude: [] },
        })),
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [
          createPort("out_n_1", 4, 1, "E", {
            acceptRule: createLiquidPurifierOutputAcceptRule(LIQUID_PURIFIER_LEFT_OUTPUT_ITEM_IDS),
          }),
          createPort("out_n_3", 4, 3, "E", {
            acceptRule: createLiquidPurifierOutputAcceptRule(LIQUID_PURIFIER_RIGHT_OUTPUT_ITEM_IDS),
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "fluid_input_buffer",
        FluidDomain,
        createSlots("input_fluid_slot", [50], FluidDomain),
      ),
      createStorageSlotGroup(
        "fluid_output_buffer",
        FluidDomain,
        createSlots("output_fluid_slot", [50, 50], FluidDomain),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_input_buffer"], ["fluid_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "liquid_purifier_1_gas",
    nameKey: "registry.entity.liquid_purifier_1_gas.name",
    spriteId: "liquid_purifier_1_gas",
    iconPath: "device-icons/liquid_purifier_1_gas.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 610,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [
      PRODUCER_TAG,
      "武陵",
      "alter:liquid_purifier_1",
      "alter-variant:gas",
    ],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, 4 - (x), 0, "N")),
      ),
      createPortGroup(
        "gas_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_e_2", 0, 2, "W", {
            acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "gas_output",
        FLUID_PIPE_PORT,
        "output",
        [1, 3].map((z) => createPort(`out_w_${z}`, 4, 4 - (z), "E", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
        })),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_input_buffer",
        FluidDomain,
        createSlots("input_gas_slot", [50], ItemDomainFlag.Gas),
      ),
      createStorageSlotGroup(
        "gas_output_buffer",
        FluidDomain,
        createSlots("output_gas_slot", [50, 50], ItemDomainFlag.Gas),
      ),
      createStorageSlotGroup(
        "item_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_item_slot", [50], ItemDomainFlag.Solid),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["gas_input_buffer", "item_input_buffer"], ["gas_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "xiranite_oven_1",
    nameKey: "registry.entity.xiranite_oven_1.name",
    spriteId: "item_port_xiranite_oven_1",
    iconPath: "device-icons/item_port_xiranite_oven_1.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 608,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, 4 - (x), 0, "N")),
      ),
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_e_2", 0, 2, "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, 4 - (x), 4, "S")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup("item_input_buffer", ItemDomainFlag.Solid, createSlots("input_item_slot", [50], ItemDomainFlag.Solid)),
      createStorageSlotGroup("fluid_input_buffer", FluidDomain, createSlots("input_fluid_slot", [50], ItemDomainFlag.Liquid)),
      createStorageSlotGroup("item_output_buffer", ItemDomainFlag.Solid, createSlots("output_item_slot", [50], ItemDomainFlag.Solid)),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "fluid_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
    inspectors: [
      { type: INSPECTOR_TYPE.recipeStatus, channelIds: ["default"] },
    ],
  }),
  createEntityDefinition({
    id: "dismantler_1",
    nameKey: "registry.entity.dismantler_1.name",
    spriteId: "item_port_dismantler_1",
    iconPath: "device-icons/item_port_dismantler_1.webp",
    footprint: { width: 6, height: 4 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 611,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, 5 - (x), 0, "N")),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, 5 - (x), 3, "S")),
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_w_2", 5, 1, "E", {
          acceptRule: { base: { kind: "domain", flags: FluidDomain }, exclude: [] },
        })],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_item_slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        ItemDomainFlag.Solid,
        createSlots("output_item_slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "fluid_output_buffer",
        FluidDomain,
        createSlots("output_fluid_slot", [50], FluidDomain),
      ),
    ],
    recipeChannels: [
      createRecipeChannel(
        "default",
        ["item_input_buffer"],
        ["item_output_buffer", "fluid_output_buffer"],
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "transmuter_2_gastrans",
    nameKey: "registry.entity.transmuter_2_gastrans.name",
    spriteId: "transmuter_2_gastrans",
    iconPath: "device-icons/transmuter_2_gastrans.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    spriteOffset: { topView: { x: -1, y: 0, width: 7, height: 5 } },
    uiGroup: "advancedManufacturing",
    displayOrder: 612,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [
      PRODUCER_TAG,
      "武陵",
      "alter:transmuter_2",
      "alter-variant:gastrans",
      MAIN_CRAFT_GROUP_TAG,
    ],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [1, 3].map((x) => createPort(`in_s_${x}`, 4 - (x), 0, "N")),
      ),
      createPortGroup(
        "gas_output",
        FLUID_PIPE_PORT,
        "output",
        [1, 3].map((z) => createPort(`out_w_${z}`, 4, 4 - (z), "E", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
        })),
      ),
      createPortGroup(
        "consume_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_s_2", 2, 0, "N", {
            acceptRule: { base: { kind: "item", itemId: "item_gas_xiranite" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        ItemDomainFlag.Solid,
        createSlots("input_item_slot", [50], ItemDomainFlag.Solid),
      ),
      createStorageSlotGroup(
        "gas_output_buffer",
        FluidDomain,
        createSlots("output_gas_slot", [50], ItemDomainFlag.Gas),
      ),
      createConsumptionStorageSlotGroup(ItemDomainFlag.Gas, ["item_gas_xiranite"]),
    ],
    recipeChannels: [
      ...createConsumptionRecipeChannels(),
      createRecipeChannel(
        "default",
        ["item_input_buffer"],
        ["gas_output_buffer"],
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
      createBinding("bind_consume", "consume_input", CONSUMPTION_STORAGE_GROUP_ID),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "transmuter_2_solidtrans",
    nameKey: "registry.entity.transmuter_2_solidtrans.name",
    spriteId: "transmuter_2_solidtrans",
    iconPath: "device-icons/transmuter_2_solidtrans.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    spriteOffset: { topView: { x: -1, y: 0, width: 7, height: 5 } },
    uiGroup: "advancedManufacturing",
    displayOrder: 613,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵", "alter:transmuter_2", "alter-variant:solidtrans"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "gas_input",
        FLUID_PIPE_PORT,
        "input",
        [1, 3].map((z) => createPort(`in_e_${z}`, 0, 4 - (z), "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
        })),
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [1, 3].map((x) => createPort(`out_n_${x}`, 4 - (x), 4, "S")),
      ),
      createPortGroup(
        "consume_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_s_2", 2, 0, "N", {
            acceptRule: { base: { kind: "item", itemId: "item_gas_xiranite" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_input_buffer",
        FluidDomain,
        createSlots("input_gas_slot", [50], ItemDomainFlag.Gas),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        ItemDomainFlag.Solid,
        createSlots("output_item_slot", [50], ItemDomainFlag.Solid),
      ),
      createConsumptionStorageSlotGroup(ItemDomainFlag.Gas, ["item_gas_xiranite"]),
    ],
    recipeChannels: [
      ...createConsumptionRecipeChannels(),
      createRecipeChannel("default", ["gas_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
      createBinding("bind_consume", "consume_input", CONSUMPTION_STORAGE_GROUP_ID),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "gas_reactor_1",
    nameKey: "registry.entity.gas_reactor_1.name",
    spriteId: "item_port_gas_reactor_1",
    iconPath: "device-icons/item_port_gas_reactor_1.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "advancedManufacturing",
    displayOrder: 614,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "gas_input",
        FLUID_PIPE_PORT,
        "input",
        [1, 3].map((z) => createPort(`in_w_${z}`, 0, 4 - (4 - z), "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
        })),
      ),
      createPortGroup(
        "gas_output",
        FLUID_PIPE_PORT,
        "output",
        [1, 3].map((z) => createPort(`out_e_${z}`, 4, 4 - (4 - z), "E", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
        })),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_input_buffer",
        FluidDomain,
        createSlots("input_gas_slot", [50, 50], ItemDomainFlag.Gas),
      ),
      createStorageSlotGroup(
        "gas_output_buffer",
        FluidDomain,
        createSlots("output_gas_slot", [50], ItemDomainFlag.Gas),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["gas_input_buffer"], ["gas_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "transmuter_1_gastrans",
    nameKey: "registry.entity.transmuter_1_gastrans.name",
    spriteId: "transmuter_1_gastrans",
    iconPath: "device-icons/transmuter_1_gastrans.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    spriteOffset: { topView: { x: -1, y: 0, width: 7, height: 5 } },
    uiGroup: "advancedManufacturing",
    displayOrder: 615,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [
      PRODUCER_TAG,
      "武陵",
      "alter:transmuter_1",
      "alter-variant:gastrans",
      MAIN_CRAFT_GROUP_TAG,
    ],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "liquid_input",
        FLUID_PIPE_PORT,
        "input",
        [1, 3].map((z) => createPort(`in_e_${z}`, 0, 4 - (z), "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })),
      ),
      createPortGroup(
        "gas_output",
        FLUID_PIPE_PORT,
        "output",
        [1, 3].map((z) => createPort(`out_w_${z}`, 4, 4 - (z), "E", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
        })),
      ),
      createPortGroup(
        "consume_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_s_2", 2, 0, "N", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_xiranite" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "liquid_input_buffer",
        FluidDomain,
        createSlots("input_liquid_slot", [50], ItemDomainFlag.Liquid),
      ),
      createStorageSlotGroup(
        "gas_output_buffer",
        FluidDomain,
        createSlots("output_gas_slot", [50], ItemDomainFlag.Gas),
      ),
      createConsumptionStorageSlotGroup(ItemDomainFlag.Liquid, ["item_liquid_xiranite"]),
    ],
    recipeChannels: [
      ...createConsumptionRecipeChannels(),
      createRecipeChannel(
        "default",
        ["liquid_input_buffer"],
        ["gas_output_buffer"],
      ),
    ],
    portStorageBindings: [
      createBinding("bind_liquid_input", "liquid_input", "liquid_input_buffer"),
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
      createBinding("bind_consume", "consume_input", CONSUMPTION_STORAGE_GROUP_ID),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "transmuter_1_liquidtrans",
    nameKey: "registry.entity.transmuter_1_liquidtrans.name",
    spriteId: "transmuter_1_liquidtrans",
    iconPath: "device-icons/transmuter_1_liquidtrans.webp",
    footprint: { width: 5, height: 5 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    spriteOffset: { topView: { x: -1, y: 0, width: 7, height: 5 } },
    uiGroup: "advancedManufacturing",
    displayOrder: 616,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵", "alter:transmuter_1", "alter-variant:liquidtrans"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "gas_input",
        FLUID_PIPE_PORT,
        "input",
        [1, 3].map((z) => createPort(`in_e_${z}`, 0, 4 - (z), "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
        })),
      ),
      createPortGroup(
        "liquid_output",
        FLUID_PIPE_PORT,
        "output",
        [1, 3].map((z) => createPort(`out_w_${z}`, 4, 4 - (z), "E", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })),
      ),
      createPortGroup(
        "consume_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_s_2", 2, 0, "N", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_xiranite" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_input_buffer",
        FluidDomain,
        createSlots("input_gas_slot", [50], ItemDomainFlag.Gas),
      ),
      createStorageSlotGroup(
        "liquid_output_buffer",
        FluidDomain,
        createSlots("output_liquid_slot", [50], ItemDomainFlag.Liquid),
      ),
      createConsumptionStorageSlotGroup(ItemDomainFlag.Liquid, ["item_liquid_xiranite"]),
    ],
    recipeChannels: [
      ...createConsumptionRecipeChannels(),
      createRecipeChannel("default", ["gas_input_buffer"], ["liquid_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
      createBinding("bind_liquid_output", "liquid_output", "liquid_output_buffer"),
      createBinding("bind_consume", "consume_input", CONSUMPTION_STORAGE_GROUP_ID),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  /**
   * item_port_sp_hub_1 — 协议核心（9×9）
   *
   * 14 个独立输入端口（7N + 7S），各挂独立接收缓存。
   * 6 个独立输出端口（3W + 3E），各挂独立取货缓存 + warehouseItemLink inspector。
   * 每个输出端口等价于一个独立仓库取货口。
   *
   * 输入缓存组：14 个（各 1 槽 × 1 容量）
   * 输出缓存组：6 个（各 1 槽 × 1 容量）
   * 编译节点：20 个（14 input-view + 6 output-view）
   */
  ...createProtocolCoreDefinitions(createEntityDefinition({
    id: "sp_hub_1",
    nameKey: "registry.entity.sp_hub_1.name",
    spriteId: "item_port_sp_hub_1",
    iconPath: "device-icons/item_port_sp_hub_1.webp",
    footprint: { width: 9, height: 9 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    spriteOffset: { topView: { x: -1, y: -1, width: 11, height: 11 } },
    uiGroup: "warehouse",
    tags: [WAREHOUSE_SINK_TAG],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      // ---- 输出端口：W 侧 3 个 ----
      createPortGroup(
        "item_output_w2",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_w_2", 0, 1, "W")],
      ),
      createPortGroup(
        "item_output_w5",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_w_5", 0, 4, "W")],
      ),
      createPortGroup(
        "item_output_w8",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_w_8", 0, 7, "W")],
      ),
      // ---- 输出端口：E 侧 3 个 ----
      createPortGroup(
        "item_output_e2",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_e_2", 8, 1, "E")],
      ),
      createPortGroup(
        "item_output_e5",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_e_5", 8, 4, "E")],
      ),
      createPortGroup(
        "item_output_e8",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_e_8", 8, 7, "E")],
      ),
      // ---- 输入端口：N 侧 7 个 ----
      createPortGroup(
        "item_input_n2",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n_2", 1, 0, "N")],
      ),
      createPortGroup(
        "item_input_n3",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n_3", 2, 0, "N")],
      ),
      createPortGroup(
        "item_input_n4",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n_4", 3, 0, "N")],
      ),
      createPortGroup(
        "item_input_n5",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n_5", 4, 0, "N")],
      ),
      createPortGroup(
        "item_input_n6",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n_6", 5, 0, "N")],
      ),
      createPortGroup(
        "item_input_n7",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n_7", 6, 0, "N")],
      ),
      createPortGroup(
        "item_input_n8",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_n_8", 7, 0, "N")],
      ),
      // ---- 输入端口：S 侧 7 个 ----
      createPortGroup(
        "item_input_s2",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_s_2", 1, 8, "S")],
      ),
      createPortGroup(
        "item_input_s3",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_s_3", 2, 8, "S")],
      ),
      createPortGroup(
        "item_input_s4",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_s_4", 3, 8, "S")],
      ),
      createPortGroup(
        "item_input_s5",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_s_5", 4, 8, "S")],
      ),
      createPortGroup(
        "item_input_s6",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_s_6", 5, 8, "S")],
      ),
      createPortGroup(
        "item_input_s7",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_s_7", 6, 8, "S")],
      ),
      createPortGroup(
        "item_input_s8",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_s_8", 7, 8, "S")],
      ),
    ],
    storageSlotGroups: [
      // ---- 输出缓存 ----
      createStorageSlotGroup("unbuffer_w2", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("unbuffer_w5", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("unbuffer_w8", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("unbuffer_e2", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("unbuffer_e5", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("unbuffer_e8", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      // ---- 输入缓存 ----
      createStorageSlotGroup("inbuffer_n2", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_n3", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_n4", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_n5", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_n6", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_n7", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_n8", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_s2", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_s3", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_s4", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_s5", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_s6", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_s7", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
      createStorageSlotGroup("inbuffer_s8", ItemDomainFlag.Solid, createSlots("slot", [1], ItemDomainFlag.Solid)),
    ],
    portStorageBindings: [
      // ---- 输出绑定 ----
      createBinding("bind_output_w2", "item_output_w2", "unbuffer_w2"),
      createBinding("bind_output_w5", "item_output_w5", "unbuffer_w5"),
      createBinding("bind_output_w8", "item_output_w8", "unbuffer_w8"),
      createBinding("bind_output_e2", "item_output_e2", "unbuffer_e2"),
      createBinding("bind_output_e5", "item_output_e5", "unbuffer_e5"),
      createBinding("bind_output_e8", "item_output_e8", "unbuffer_e8"),
      // ---- 输入绑定 ----
      createBinding("bind_input_n2", "item_input_n2", "inbuffer_n2"),
      createBinding("bind_input_n3", "item_input_n3", "inbuffer_n3"),
      createBinding("bind_input_n4", "item_input_n4", "inbuffer_n4"),
      createBinding("bind_input_n5", "item_input_n5", "inbuffer_n5"),
      createBinding("bind_input_n6", "item_input_n6", "inbuffer_n6"),
      createBinding("bind_input_n7", "item_input_n7", "inbuffer_n7"),
      createBinding("bind_input_n8", "item_input_n8", "inbuffer_n8"),
      createBinding("bind_input_s2", "item_input_s2", "inbuffer_s2"),
      createBinding("bind_input_s3", "item_input_s3", "inbuffer_s3"),
      createBinding("bind_input_s4", "item_input_s4", "inbuffer_s4"),
      createBinding("bind_input_s5", "item_input_s5", "inbuffer_s5"),
      createBinding("bind_input_s6", "item_input_s6", "inbuffer_s6"),
      createBinding("bind_input_s7", "item_input_s7", "inbuffer_s7"),
      createBinding("bind_input_s8", "item_input_s8", "inbuffer_s8"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: [
          "unbuffer_w2",
          "unbuffer_w5",
          "unbuffer_w8",
          "unbuffer_e2",
          "unbuffer_e5",
          "unbuffer_e8",
        ],
      },
    ],
  })),
  createEntityDefinition({
    id: "water_pump_1",
    nameKey: "registry.entity.water_pump_1.name",
    spriteId: "item_port_water_pump_1",
    iconPath: "device-icons/item_port_water_pump_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "loop" },
    spriteOffset: {
      topView: { x: -2, y: 0, width: 5, height: 3 },
    },
    uiGroup: "resourcePower",
    displayOrder: 301,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed", "InnerRingNotAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge },
      { type: PLACEMENT_BEHAVIOR_TYPE.noNearSameEntity, range: 2 },
    ],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_e_1", 2, 1, "E", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })],
      ),
    ],

    // 改用 warehouseItemLink 模式从仓库获取液体，放置时默认链接清水并开启无限供应。
    // r_pump_water_basic / r_pump_acid_basic 配方保留在 recipe-definition.ts（见 4）。

    storageSlotGroups: [
      createStorageSlotGroup("fluid_output_buffer", ItemDomainFlag.Liquid,
        createSlots("output_fluid_slot", [50], ItemDomainFlag.Liquid),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_output", "fluid_output", "fluid_output_buffer"),
    ],
    recipeChannels: [
      createRecipeChannel("default", [], ["fluid_output_buffer"], true),
    ],

    inspectors: [
      { type: INSPECTOR_TYPE.recipeStatus, channelIds: ["default"] },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["fluid_output_buffer"] },
    ],

  }),
  createEntityDefinition({
    id: "udpipe_loader_2",
    nameKey: "registry.entity.udpipe_loader_2.name",
    spriteId: "item_port_udpipe_loader_2",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_udpipe_loader_2.webp",
    footprint: { width: 3, height: 5 },
    spriteOffset: { topView: { x: 0, y: 0, width: 4, height: 5 } },
    uiGroup: "warehouse",
    displayOrder: 409,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    simulationBehaviors: [{
      type: ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting,
      strategy: ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked,
      storageSlotGroupIds: ["loader_buffer"],
    }],
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_w_1", 0, 1, "W"),
          createPort("in_w_2", 0, 3, "W"),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "loader_buffer",
        FluidDomain,
        createSlots("slot", [500], FluidDomain),
      ),
    ],
    recipeChannels: [],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "loader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.darkPipeLink,
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["loader_buffer"],
      },
    ],
  }),
  createEntityDefinition({
    id: "udpipe_unloader_2",
    nameKey: "registry.entity.udpipe_unloader_2.name",
    spriteId: "item_port_udpipe_unloader_2",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_udpipe_unloader_2.webp",
    footprint: { width: 3, height: 5 },
    spriteOffset: { topView: { x: -1, y: 0, width: 4, height: 5 } },
    uiGroup: "warehouse",
    displayOrder: 410,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [
          createPort("out_e_1", 2, 3, "E"),
          createPort("out_e_2", 2, 1, "E"),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "unloader_buffer",
        FluidDomain,
        createSlots("slot", [500], FluidDomain),
      ),
      createStorageSlotGroup(
        "transport_input",
        FluidDomain,
        createSlots("slot", [500], FluidDomain),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("transport_1", ["transport_input"], ["unloader_buffer"]),
      createRecipeChannel("transport_2", ["transport_input"], ["unloader_buffer"]),
      createRecipeChannel("transport_3", ["transport_input"], ["unloader_buffer"]),
      createRecipeChannel("transport_4", ["transport_input"], ["unloader_buffer"]),
    ],
    recipeChannelBehavior: {
      allowDuplicateRecipesAcrossChannels: true,
    },
    portStorageBindings: [
      createBinding("bind_fluid_output", "fluid_output", "unloader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.darkPipeLink,
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["unloader_buffer"],
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["unloader_buffer"],
      },
    ],
  }),
  createEntityDefinition({
    id: "liquid_cleaner_1",
    nameKey: "registry.entity.liquid_cleaner_1.name",
    spriteId: "item_liquid_cleaner_1",
    iconPath: "device-icons/item_liquid_cleaner_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "basicProduction",
    displayOrder: 510,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵", "OuterRingAllowed"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_w_1", 0, 1, "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup("fluid_input_buffer", FluidDomain, createSlots("input_fluid_slot", [50], ItemDomainFlag.Liquid)),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_input_buffer"], []),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
    ],
    inspectors: [
      { type: INSPECTOR_TYPE.recipeStatus, channelIds: ["default"] },
    ],
  }),
  createEntityDefinition({
    id: WATER_PURIFIER_NODE_ENTITY_ID,
    nameKey: "registry.entity.water_purifier_node_1.name",
    spriteId: "item_water_purifier_node_1",
    iconPath: "device-icons/item_water_purifier_node_1.webp",
    footprint: { width: 27, height: 3 },
    spriteOffset: {
      topView: { x: 0, y: -5, width: 27, height: 8 },
    },
    uiGroup: "resourcePower",
    displayOrder: 305,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: [PRODUCER_TAG, "武陵", "OuterRingAllowed", "InnerRingNotAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input_1",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_s_1", 1, 2, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_sewage" }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "fluid_input_2",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_s_9", 9, 2, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_sewage" }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "fluid_input_3",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_s_17", 17, 2, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_sewage" }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [
          createPort("out_s_25", 25, 2, "S", {
            acceptRule: { base: { kind: "item", itemId: WATER_PURIFIER_OUTPUT_ITEM_ID }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[0],
        FluidDomain,
        createSlots("slot", [2], ItemDomainFlag.Liquid, { lock: "item_liquid_sewage" }),
      ),
      createStorageSlotGroup(
        WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[1],
        FluidDomain,
        createSlots("slot", [2], ItemDomainFlag.Liquid, { lock: "item_liquid_sewage" }),
      ),
      createStorageSlotGroup(
        WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[2],
        FluidDomain,
        createSlots("slot", [2], ItemDomainFlag.Liquid, { lock: "item_liquid_sewage" }),
      ),
      createStorageSlotGroup(
        WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID,
        FluidDomain,
        createSlots("slot", [500], ItemDomainFlag.Liquid, { lock: "item_liquid_sewage" }),
      ),
      createStorageSlotGroup(
        WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
        FluidDomain,
        createSlots("slot", [50], ItemDomainFlag.Liquid, { lock: WATER_PURIFIER_OUTPUT_ITEM_ID }),
      ),
    ],
    recipeChannels: [
      createRecipeChannel(
        WATER_PURIFIER_INTAKE_CHANNEL_IDS[0],
        [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[0]],
        [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
      ),
      createRecipeChannel(
        WATER_PURIFIER_INTAKE_CHANNEL_IDS[1],
        [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[1]],
        [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
      ),
      createRecipeChannel(
        WATER_PURIFIER_INTAKE_CHANNEL_IDS[2],
        [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[2]],
        [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
      ),
      createRecipeChannel(
        WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
        [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
        [WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID],
      ),
    ],
    recipeChannelBehavior: {
      allowDuplicateRecipesAcrossChannels: true,
    },
    portStorageBindings: [
      createBinding("bind_fluid_input_1", "fluid_input_1", WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[0]),
      createBinding("bind_fluid_input_2", "fluid_input_2", WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[1]),
      createBinding("bind_fluid_input_3", "fluid_input_3", WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[2]),
      createBinding("bind_fluid_output", "fluid_output", WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID),
    ],
    placementDefaults: createPlacementDefaults({
      config: {
        [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
        [WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY]:
          WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE,
      },
    }),
    blockageAutoClearance: createBlockageAutoClearance({
      enabledByDefault: true,
      enabledConfigKey: BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
      channelIds: WATER_PURIFIER_INTAKE_CHANNEL_IDS,
      slotRefs: [{ storageSlotGroupId: WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID }],
      blockedChannelThreshold: 1,
    }),
    inspectors: [
      {
        type: INSPECTOR_TYPE.waterPurifierNode,
      },
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: [
          ...WATER_PURIFIER_INTAKE_CHANNEL_IDS,
          WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
        ],
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: [WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID],
      },
    ],
  }),
  createEntityDefinition({
    id: "liquid_storager_1",
    nameKey: "registry.entity.liquid_storager_1.name",
    spriteId: "item_port_liquid_storager_1",
    iconPath: "device-icons/item_port_liquid_storager_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    uiGroup: "warehouse",
    displayOrder: 404,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_w_1", 0, 1, "W", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_e_1", 2, 1, "E", {
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] },
        })],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "liquid_storage",
        FluidDomain,
        createSlots("slot", [500], ItemDomainFlag.Liquid),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "liquid_storage"),
      createBinding("bind_fluid_output", "fluid_output", "liquid_storage"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["liquid_storage"],
      },
    ],
  }),
  createEntityDefinition({
    id: "gas_storager_1",
    nameKey: "registry.entity.gas_storager_1.name",
    spriteId: "gas_storager_1",
    iconPath: "device-icons/gas_storager_1.webp",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    displayOrder: 411,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "gas_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_w_1", 0, 1, "W", {
            acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "gas_output",
        FLUID_PIPE_PORT,
        "output",
        [
          createPort("out_e_1", 2, 1, "E", {
            acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_storage",
        FluidDomain,
        createSlots("slot", [500], ItemDomainFlag.Gas),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_storage"),
      createBinding("bind_gas_output", "gas_output", "gas_storage"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["gas_storage"],
      },
    ],
  }),
  createEmptyEntityDefinition({
    id: "power_diffuser_1",
    nameKey: "registry.entity.power_diffuser_1.name",
    spriteId: "item_port_power_diffuser_1",
    iconPath: "device-icons/item_port_power_diffuser_1.webp",
    footprint: { width: 2, height: 2 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    spriteOffset: { topView: { x: -1, y: -1, width: 4, height: 4 } },
    uiGroup: "resourcePower",
    displayOrder: 302,
    ranges: [{
      id: "power", localRect: { x: -5, y: -5, width: 12, height: 12 },
      coverage: "intersects", interactionKind: "power", visualId: "power",
    }],
    isIdleAsRunning: true,
    tags: [],
  }),
  createEntityDefinition({
    id: "vaporizer_1",
    nameKey: "registry.entity.vaporizer_1.name",
    spriteId: "vaporizer_1",
    ranges: [{
      id: "gas", localRect: { x: -5, y: -5, width: 13, height: 13 },
      coverage: "contains", interactionKind: "gas", visualId: "gas",
    }],
    iconPath: "device-icons/vaporizer_1.webp",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    displayOrder: 304,
    tags: [PRODUCER_TAG],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.noNearSameEntity, range: 10 },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "gas_input",
        FLUID_PIPE_PORT,
        "input",
        [
          createPort("in_w_1", 0, 1, "W", {
            acceptRule: createGasItemWhitelistAcceptRule(VAPORIZER_CONSUMPTION_ITEM_IDS),
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createConsumptionStorageSlotGroup(ItemDomainFlag.Gas, VAPORIZER_CONSUMPTION_ITEM_IDS),
    ],
    recipeChannels: [
      ...createConsumptionRecipeChannels(),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", CONSUMPTION_STORAGE_GROUP_ID),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: [],
      },
    ],
  }),
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.belt].admission,
    nameKey: "registry.entity.log_admission.name",
    spriteId: "item_log_admission",
    iconPath: "device-icons/item_log_admission.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    displayOrder: 104,
    tags: [],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.autoRotateAlignPorts },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        SOLID_BELT_PORT,
        "input",
        [createPort("in_w", 0, 0, "N", {
          admissionRule: { itemId: null, limit: null, perMinuteLimit: null },
        })],
      ),
      createPortGroup(
        "item_output",
        SOLID_BELT_PORT,
        "output",
        [createPort("out_e", 0, 0, "S")],
      ),
    ],
    // 现改为 bidirectional+share-cap，与 belt_straight_1x1 结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        ItemDomainFlag.Solid,
        createSlots("slot", [1], ItemDomainFlag.Solid),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
      {
        type: INSPECTOR_TYPE.admissionRule,
        portGroupId: "item_input",
        portId: "in_w",
      },
    ],
  }),
  createEntityDefinition({
    id: LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.pipe].admission,
    nameKey: "registry.entity.pipe_admission.name",
    spriteId: "item_pipe_admission",
    iconPath: "device-icons/item_pipe_admission.webp",
    footprint: { width: 1, height: 1 },
    spriteOffset: { topView: { x: 0, y: -1, width: 1, height: 3 } },
    uiGroup: "pipeLogistics",
    displayOrder: 204,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap },
      { type: PLACEMENT_BEHAVIOR_TYPE.autoRotateAlignPorts },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        FLUID_PIPE_PORT,
        "input",
        [createPort("in_w", 0, 0, "N", {
          admissionRule: { itemId: null, limit: null, perMinuteLimit: null },
        })],
      ),
      createPortGroup(
        "fluid_output",
        FLUID_PIPE_PORT,
        "output",
        [createPort("out_e", 0, 0, "S")],
      ),
    ],
    // 现改为 bidirectional+share-cap，与 pipe 直段结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "fluid_buffer",
        FluidDomain,
        createSlots("slot", [1], FluidDomain),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_buffer"], ["fluid_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
      {
        type: INSPECTOR_TYPE.admissionRule,
        portGroupId: "fluid_input",
        portId: "in_w",
      },
    ],
  }),
  // =========================================================================
  // 作弊设备 (uiGroup: "cheat")
  // =========================================================================

  /**
   * 本设备在游戏中不存在，是规划器专用作弊设备。
   * 只允许显示在放置面板的“作弊”分类，不应该在百科、快速放置或其他发现入口显示。
   */
  createCheatInfiniteDeviceDefinition({
    id: "cheat_infinite_solid",
    nameKey: "registry.entity.cheat_infinite_solid.name",
    iconPath: "device-icons/cheat_infinite_solid.webp",
    domain: ItemDomainFlag.Solid,
    isPipe: false,
    displayOrder: 701,
  }),

  /**
   * 本设备在游戏中不存在，是规划器专用作弊设备。
   * 只允许显示在放置面板的“作弊”分类，不应该在百科、快速放置或其他发现入口显示。
   */
  createCheatInfiniteDeviceDefinition({
    id: "cheat_infinite_liquid",
    nameKey: "registry.entity.cheat_infinite_liquid.name",
    iconPath: "device-icons/cheat_infinite_liquid.webp",
    domain: ItemDomainFlag.Liquid,
    isPipe: true,
    displayOrder: 702,
  }),

  /**
   * 本设备在游戏中不存在，是规划器专用作弊设备。
   * 只允许显示在放置面板的“作弊”分类，不应该在百科、快速放置或其他发现入口显示。
   */
  createCheatInfiniteDeviceDefinition({
    id: "cheat_infinite_gas",
    nameKey: "registry.entity.cheat_infinite_gas.name",
    iconPath: "device-icons/cheat_infinite_gas.webp",
    domain: ItemDomainFlag.Gas,
    isPipe: true,
    displayOrder: 703,
  }),

  // =========================================================================
  // 不可摆放设备（tag: "不可摆放"）
  //
  // uiGroup 归属正常分组以在百科中按分类检索，
  // placement-panel 通过 tag 筛掉，不在放置面板中显示。
  // =========================================================================

  /**
   * item_port_dumper_1 — 给水器（3×3）
   *
   * 不可摆放设备，无精灵定义，无端口/槽位/配方。
   * 仅作为倾倒配方的目标设备，产出的物品直接消失。
   */
  createEmptyEntityDefinition({
    id: "dumper_1",
    nameKey: "registry.entity.dumper_1.name",
    spriteId: "item_port_dumper_1",
    iconPath: "device-icons/item_port_dumper_1.webp",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
    requiresPower: true,
    powerDemand: 10,
  }),

  /**
   * gas_pump_1 — 气体收集泵（3×3）
   *
   * 气体采集设备，1 个管道输出口在东侧，仅限气体。
   */
  createEntityDefinition({
    id: "gas_pump_1",
    nameKey: "registry.entity.gas_pump_1.name",
    spriteId: "gas_pump_1",
    iconPath: "device-icons/gas_pump_1.webp",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    displayOrder: 300,
    placementWhitelist: WULING_PLACEMENT_WHITELIST,
    tags: ["武陵", "OuterRingAllowed", "InnerRingNotAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge },
      { type: PLACEMENT_BEHAVIOR_TYPE.noNearSameEntity, range: 2 },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "gas_output",
        FLUID_PIPE_PORT,
        "output",
        [
          createPort("out_e_1", 2, 1, "E", {
            acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Gas }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_output_buffer",
        ItemDomainFlag.Gas,
        createSlots("output_gas_slot", [50], ItemDomainFlag.Gas),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
    ],
    recipeChannels: [
      createRecipeChannel("default", [], ["gas_output_buffer"], true),
    ],

    inspectors: [
      { type: INSPECTOR_TYPE.recipeStatus, channelIds: ["default"] },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["gas_output_buffer"] },
    ],

  }),

  // AKEData 1.5.3@10731330-8：3×3、西侧中央液体输入；当前仅接入编辑与范围展示。
  createEntityDefinition({
    id: "squirter_1",
    nameKey: "registry.entity.squirter_1.name",
    spriteId: "item_port_squirter_1",
    iconPath: "device-icons/item_port_squirter_1.webp",
    footprint: { width: 3, height: 3 },
    spriteAnimation: { closeIdleMode: "hold-last" },
    spriteOffset: { topView: { x: 0, y: 0, width: 6, height: 3 } },
    uiGroup: "agriculture",
    displayOrder: 800,
    tags: [PRODUCER_TAG],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
    requiresPower: true,
    powerDemand: 10,
    ranges: [{
      id: "irrigation", localRect: { x: 3, y: -1, width: 4, height: 5 },
      coverage: "intersects", interactionKind: "irrigation", visualId: "irrigation",
    }],
    portGroups: [createPortGroup("fluid_input", FLUID_PIPE_PORT, "input", [
      createPort("in_w_1", 0, 1, "W", { acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Liquid }, exclude: [] } }),
    ])],
    // 不声明缓存、配方和耗水周期，避免编辑能力被误当成浇水仿真。
    storageSlotGroups: [createStorageSlotGroup("liquid", ItemDomainFlag.Liquid, [createSlot("liquid", 50, ItemDomainFlag.Liquid)])],
    portStorageBindings: [createBinding("liquid-input", "fluid_input", "liquid")],
    recipeChannels: [{ id: "irrigation", startPolicy: "environment-demand", ingredientStorageGroupIds: ["liquid"], productStorageGroupIds: [] }],
  }),

  // 普通田块的 raw renderer 共用 soil_1；蓝图使用无端口方框，3D 素材待提供。
  /** 锦草田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_grass_1",
    nameKey: "registry.entity.soil_grass_1.name",
    spriteId: "soil_grass_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_grass_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 801,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_grass_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 芽针田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_grass_2",
    nameKey: "registry.entity.soil_grass_2.name",
    spriteId: "soil_grass_2",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_grass_2.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 802,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_grass_2"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 荞花田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_moss_1",
    nameKey: "registry.entity.soil_moss_1.name",
    spriteId: "soil_moss_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_moss_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 803,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_moss_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 柑实田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_moss_2",
    nameKey: "registry.entity.soil_moss_2.name",
    spriteId: "soil_moss_2",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_moss_2.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 804,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_moss_2"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 砂叶田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_moss_3",
    nameKey: "registry.entity.soil_moss_3.name",
    spriteId: "soil_moss_3",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_moss_3.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 805,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_moss_3"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 酮化灌木田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_bbflower_1",
    nameKey: "registry.entity.soil_bbflower_1.name",
    spriteId: "soil_bbflower_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_bbflower_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 806,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_bbflower_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 灰芦麦田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_sp_1",
    nameKey: "registry.entity.soil_sp_1.name",
    spriteId: "soil_sp_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_sp_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 807,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_sp_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 苦叶椒田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_sp_2",
    nameKey: "registry.entity.soil_sp_2.name",
    spriteId: "soil_sp_2",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_sp_2.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 808,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_sp_2"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 琼叶参田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_sp_3",
    nameKey: "registry.entity.soil_sp_3.name",
    spriteId: "soil_sp_3",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_sp_3.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 809,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_sp_3"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 金石稻田块：4×4 普通田块，仅允许在农牧用地地图摆放。 */
  createEntityDefinition({
    id: "soil_sp_4",
    nameKey: "registry.entity.soil_sp_4.name",
    spriteId: "soil_sp_4",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_sp_4.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 810,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_sp_4"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  }),

  /** 球豆田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_bean_1",
    nameKey: "registry.entity.soil_corp_bean_1.name",
    spriteId: "soil_corp_bean_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_bean_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 811,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_bean_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 青菜田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_cabbage_1",
    nameKey: "registry.entity.soil_corp_cabbage_1.name",
    spriteId: "soil_corp_cabbage_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_cabbage_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 812,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_cabbage_1"],
    cultivation: { cropId: "item_corp_cabbage_1", growingStateIds: ["growing-1", "growing-refined"],
      refinedStateIds: ["growing-refined", "harvest-refined"], neighborDurationSeconds: 30, neighborBonusPerPlot: 0.2 },
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 优质青菜田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  // 按用户暂视为教学用途田块的假定隐藏入口，保留独立定义。
  createEntityDefinition({
    id: "soil_corp_cabbage_2",
    nameKey: "registry.entity.soil_corp_cabbage_2.name",
    spriteId: "soil_corp_cabbage_2",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_cabbage_2.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "hidden",
    displayOrder: 813,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_cabbage_2"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 籽油花田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_canolaflower_1",
    nameKey: "registry.entity.soil_corp_canolaflower_1.name",
    spriteId: "soil_corp_canolaflower_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_canolaflower_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 814,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_canolaflower_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 多味菇田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_mushroom_1",
    nameKey: "registry.entity.soil_corp_mushroom_1.name",
    spriteId: "soil_corp_mushroom_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_mushroom_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 815,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_mushroom_1"],
    cultivation: { cropId: "item_corp_mushroom_1", growingStateIds: ["growing-1", "growing-refined"],
      refinedStateIds: ["growing-refined", "harvest-refined"], neighborDurationSeconds: 30, neighborBonusPerPlot: 0.2 },
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 优质多味菇田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  // 按用户暂视为教学用途田块的假定隐藏入口，保留独立定义。
  createEntityDefinition({
    id: "soil_corp_mushroom_2",
    nameKey: "registry.entity.soil_corp_mushroom_2.name",
    spriteId: "soil_corp_mushroom_2",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_mushroom_2.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "hidden",
    displayOrder: 816,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_mushroom_2"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 平薯田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_potato_1",
    nameKey: "registry.entity.soil_corp_potato_1.name",
    spriteId: "soil_corp_potato_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_potato_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 817,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_potato_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 青叶莓田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_strawberry_1",
    nameKey: "registry.entity.soil_corp_strawberry_1.name",
    spriteId: "soil_corp_strawberry_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_strawberry_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 818,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_strawberry_1"],
    cultivation: { cropId: "item_corp_strawberry_1", growingStateIds: ["growing-1", "growing-refined"],
      refinedStateIds: ["growing-refined", "harvest-refined"], neighborDurationSeconds: 30, neighborBonusPerPlot: 0.2 },
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 优质青叶莓田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  // 按用户暂视为教学用途田块的假定隐藏入口，保留独立定义。
  createEntityDefinition({
    id: "soil_corp_strawberry_2",
    nameKey: "registry.entity.soil_corp_strawberry_2.name",
    spriteId: "soil_corp_strawberry_2",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_strawberry_2.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "hidden",
    displayOrder: 819,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_strawberry_2"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 脆蔗田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_sugarcane_1",
    nameKey: "registry.entity.soil_corp_sugarcane_1.name",
    spriteId: "soil_corp_sugarcane_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_sugarcane_1.webp",
    footprint: { width: 4, height: 4 },
    spriteOffset: { topView: { x: -1, y: -1, width: 6, height: 6 } },
    uiGroup: "agriculture",
    displayOrder: 820,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_sugarcane_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 茄果田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_tomato_1",
    nameKey: "registry.entity.soil_corp_tomato_1.name",
    spriteId: "soil_corp_tomato_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_tomato_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 821,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_tomato_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /** 白瓜田块：仅限缘缘庄，临时共用芽针田块的整套外观。 */
  createEntityDefinition({
    id: "soil_corp_whitegourd_1",
    nameKey: "registry.entity.soil_corp_whitegourd_1.name",
    spriteId: "soil_corp_whitegourd_1",
    spriteAnimation: { closeIdleMode: "loop" },
    iconPath: "device-icons/item_port_soil_corp_whitegourd_1.webp",
    footprint: { width: 4, height: 4 },
    uiGroup: "agriculture",
    displayOrder: 822,
    tags: ["AcceptsIrrigation", "Producer"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
    ],
    requiresPower: false, powerDemand: 0,
    portGroups: [], storageSlotGroups: [], portStorageBindings: [],
    stateMachine: CROP_STATE_MACHINES["soil_corp_whitegourd_1"],
    recipeChannels: [{ id: "growth", startPolicy: "state", ingredientStorageGroupIds: [], productStorageGroupIds: [] }],
    placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }],
  }),

  /**
   * item_port_miner_2 — 电驱矿机（3×3）
   *
   * 不可摆放设备，无精灵定义，无端口/槽位/配方。
   */
  createEmptyEntityDefinition({
    id: "miner_2",
    nameKey: "registry.entity.miner_2.name",
    spriteId: "item_port_miner_2",
    iconPath: "device-icons/item_port_miner_2.webp",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
    requiresPower: true,
    powerDemand: 5,
  }),

  /**
   * item_port_miner_3 — 二型电驱矿机（3×3）
   *
   * 不可摆放设备，无精灵定义，无端口/槽位/配方。
   */
  createEmptyEntityDefinition({
    id: "miner_3",
    nameKey: "registry.entity.miner_3.name",
    spriteId: "item_port_miner_3",
    iconPath: "device-icons/item_port_miner_3.webp",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
    requiresPower: true,
    powerDemand: 10,
  }),

  /**
   * item_port_miner_4 — 水驱矿机（3×3）
   *
   * 不可摆放设备，无精灵定义，无端口/槽位/配方。
   */
  createEmptyEntityDefinition({
    id: "miner_4",
    nameKey: "registry.entity.miner_4.name",
    spriteId: "item_port_miner_4",
    iconPath: "device-icons/item_port_miner_4.webp",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
  }),
  /** 自动农植机仅作为基地自带静态设备；5×5 项目占地由用户于 2026-10-28 确认。 */
  createEntityDefinition({
    id: "int_system_farm_terminal",
    nameKey: "registry.entity.int_system_farm_terminal.name",
    spriteId: "int_system_farm_terminal",
    iconPath: "3d-top-view/sprites/int_system_farm_terminal.webp",
    footprint: { width: 3, height: 3 },
    spriteOffset: {
      topView: { x: -0.5, y: -1, width: 5, height: 5 },
      blueprint: { x: -0.5, y: -1, width: 5, height: 5 },
    },
    uiGroup: "hidden",
    tags: ["AvatarHidden"],
    placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
  }),
  ...WULING_FENCE_DEFINITIONS.map(createEntityDefinition),
];
