import type { GridEdge, GridRectSize } from "../../shared/grid";
import type { ItemDomainFlag } from "../../shared/item-domain-flags";
import type { SlotLinkDefinition } from "../../shared/slot-link";
import type { EntityInspectorDeclaration } from "./entity-inspector";
import type { EntityPlacementBehaviorDeclaration } from "./entity-placement-behavior";
import type { EntitySimulationBehaviorDeclaration } from "./entity-simulation-behavior";
import type { DeviceSpriteAnimationDefinition } from "./device-sprite-animation";
import type { EntityPlacementWhitelistEntry } from "./entity-placement-whitelist";
import type { EntityRangeDefinition } from "./entity-range";

export type ItemDomain = ItemDomainFlag;
export type ItemFilterType = ItemDomainFlag;

// ---------------------------------------------------------------------------
// UI 分组 — 决定设备在放置面板中属于哪个折叠组
// ---------------------------------------------------------------------------

export type UiGroup =
  | "beltLogistics"           // 传送带物流
  | "pipeLogistics"           // 管道物流
  | "resourcePower"           // 资源与电力
  | "warehouse"               // 仓库存取
  | "basicProduction"         // 基础生产
  | "advancedManufacturing"   // 合成制造
  | "agriculture"             // 农业建筑
  | "cheat"                   // 作弊设备（仅在放置面板显示）
  | "hidden";                 // 隐藏设备（不在面板中显示，由绘制工具生成）

// =========================================================================
// EntityDefinition — 实体定义（对应设计文档《模拟器抽象方式》§2 Entity 定义层）
//
// 每个设备类型对应一个 EntityDefinition。它是所有属性的「默认值持有者」。
// 用户通过 entity.config（稀疏 JSON）覆盖其中字段，编译时由 Topology
// Compiler 执行 deepMerge(definitionDefaults, entityConfig) 得到最终值。
//
// 字段按设计文档的三大原语组织：
//   1. 缓存 (storageSlotGroups + portStorageBindings) → 对应 §3.1 缓存类型
//   2. 配方 (recipe)                                → 对应 §3.2 配方类型
//
// 求解图节点来源：每个存储槽组 (storageSlotGroup) 在编译时生成一个
// CacheGroup，每个 CacheGroup = 一个求解图节点（见《仿真运行原理》§5.1）。
// =========================================================================

export interface EntityDefinition {
  /** 只有声明状态机的设备参与状态处理。 */
  readonly stateMachine?: DeviceStateMachineDefinition;
  readonly cultivation?: CropCultivationDefinition;
  /** 设备定义唯一标识，如 "belt_straight_1x1" */
  id: string;
  /** i18n key，前端通过此 key 获取本地化设备名称 */
  nameKey: string;
  /** 精灵图 ID，渲染器据此查找设备纹理 */
  spriteId: string;
  /** 未声明时保持静态；四阶段素材按 spriteId 共享。 */
  readonly spriteAnimation?: DeviceSpriteAnimationDefinition;
  /** 相对于 public 目录的 UI 设备图标路径；不从 id 或 spriteId 推导 */
  iconPath: string;
  /** 设备占地尺寸（宽度 × 高度，单位：格子），基于 rotation=0 */
  footprint: GridRectSize;

  /**
   * 精灵相对于 footprint 的绘制偏移（可选）。
   *
   * 当精灵图片尺寸大于 footprint 时，footprint 可能只对应精灵图中
   * 的一个子区域。spriteOffset 描述精灵在 rotation=0 坐标系下
   * 相对于 footprint 左上角的位移及精灵总尺寸（单位：格子）。
   *
   * 例如：抽水泵 footprint 3×3，3D-top 精灵 5×3，footprint 位于精灵
   * 右侧 3×3 区域，则 topView = { x: -2, y: 0, width: 5, height: 3 }。
   *
   * topView 用于 3D-top 渲染模式，blueprint 用于蓝图渲染模式。
   * 未指定时，精灵尺寸 = footprint 尺寸，偏移 = (0, 0)。
   */
  spriteOffset?: {
    topView?: { x: number; y: number; width: number; height: number };
    blueprint?: { x: number; y: number; width: number; height: number };
  };
  /** 放置面板分组 */
  uiGroup: UiGroup;
  /** 展示排序权重，数字越小越靠前 */
  displayOrder: number;
  /** 语义标签，如 "BeltFamily"（传送带族）、"武陵"（场景限定） */
  tags: string[];
  /** 未声明时不限制地图和区域；空数组禁止所有地图。 */
  readonly placementWhitelist?: readonly EntityPlacementWhitelistEntry[];

  // ---- 电力 ----
  /**
   * 是否需要电力才能运行。
   * 注意：即使 requiresPower=false，设备在电网中仍会消耗 powerDemand。
   * 区别在于 requiresPower=false 的设备可以在电网外运行。
   */
  requiresPower: boolean;
  /** 在电网中每 tick 消耗的电量 */
  powerDemand: number;
  readonly ranges?: readonly EntityRangeDefinition[];
  /** 基地未停电时，将设备的 idle 展示状态规一化为 normal。 */
  readonly isIdleAsRunning?: boolean;

  /**
   * Inspector 面板声明（对应《模拟器抽象方式》§4 Inspector 层）。
   * Inspector 不持有数据，只声明"用哪个面板类型编辑哪个路径"。
   * 前端遍历此数组，按 type 挂载对应面板组件。
   */
  inspectors: EntityInspectorDeclaration[];


  /** 不随仿真模式变化的基础运行行为。 */
  readonly simulationBehaviors?: readonly EntitySimulationBehaviorDeclaration[];

  /**
   * 放置行为声明。
   * 与 Inspector 类似，definition 只声明"使用哪类放置规则"；
   * editor 在运行态根据这些声明校验当前位置是否合法。
   */
  placementBehaviors: EntityPlacementBehaviorDeclaration[];

  /**
   * 放置默认值。
   * 声明设备放置时自动写入 entity.config 的默认值，以及自动创建的 slotLinks。
   * slotLinks 中 entityId 使用 "[Self]" 占位符，由 editor placement 层展开为实际实体 ID。
   * 未声明时无默认行为。
   */
  readonly placementDefaults?: EntityPlacementDefaults;

  /**
   * Recipe Channel 的设备级运行行为。
   * 未声明时不提供自动/手动切换，且不同 channel 默认不可同时运行同一配方。
   */
  readonly recipeChannelBehavior?: EntityRecipeChannelBehaviorDefinition;

  /**
   * 配方堵塞自动清除配置。
   * 未声明时设备不具备该能力；声明后由仿真 runtime 按配置检测指定 channel 堵塞并清空指定槽位。
   */
  readonly blockageAutoClearance?: EntityBlockageAutoClearanceDefinition;


  // ---- 端口与存储槽组 ----

  /**
   * 端口组（对应《仿真运行原理》§3.1 缓存类型中 Port 与 Cache 的关系）。
   * 每个端口有 acceptRule（允许的物品类型）；准入口可额外声明 admissionRule
   * 用于跨 tick 的准入计数与上限。
   */
  portGroups: PortGroupDefinition[];

  /**
   * 存储槽组（对应《仿真运行原理》§3.1 缓存类型 + §3.4 缓存组）。
   *
   * 存储槽组 = 设备内部的一个缓存区域，编译后对应一个求解图节点。
   * 存储组的输入/输出能力由 portStorageBindings 中绑定的端口方向决定；
   * 配方原料/产物角色由 Recipe Channel 声明。
   */
  storageSlotGroups: StorageSlotGroupDefinition[];

  /**
   * Recipe Channel（配方通道）声明。
   * 一个设备可声明 0~N 个 channel，每个 channel 独立运行一个配方。
   * 未声明 channel 的设备不运行配方。
   */
  recipeChannels: RecipeChannelDefinition[];

  /**
   * 端口-存储绑定（对应《仿真运行原理》§5.1）。
   * 将 portGroup 与 storageSlotGroup 关联，决定物品从哪个端口流入哪个缓存组。
   * 无显式绑定时，编译器自动生成 synthetic-input/synthetic-output 缓存组。
   */
  portStorageBindings: PortStorageBindingDefinition[];

}


// ---------------------------------------------------------------------------
// EntityPlacementDefaults — 设备放置时的默认行为
// ---------------------------------------------------------------------------

/**
 * 设备放置默认值。
 * 声明设备放置时自动应用的 config 覆盖和 slotLinks。
 * entityId 使用 "[Self]" 占位符，由 editor placement 层展开为实际实体 ID。
 */
export interface EntityPlacementDefaults {
  /** 放置时直接写入 entity.config */
  readonly config?: Record<string, unknown>;
  /** 放置时自动创建的 slot links。entityId 使用占位符 "[Self]" */
  readonly slotLinks?: readonly SlotLinkDefinition[];
}

// ---------------------------------------------------------------------------
// EntityRecipeChannelBehaviorDefinition — Recipe Channel 设备级行为
// ---------------------------------------------------------------------------

export interface EntityRecipeChannelBehaviorDefinition {
  /**
   * 自动模式开关在 entity.config 中的 key。
   * 未声明时设备不提供模式切换；已声明但 config 值缺失或不为 true 时按手动模式运行。
   */
  readonly automaticModeConfigKey?: string;
  /** 是否允许不同 channel 同时运行同一个配方。 */
  readonly allowDuplicateRecipesAcrossChannels: boolean;
}

// ---------------------------------------------------------------------------
// EntityBlockageAutoClearanceDefinition — 配方堵塞自动清除
// ---------------------------------------------------------------------------

export interface EntityBlockageAutoClearanceSlotRef {
  readonly storageSlotGroupId: string;
  readonly slotId?: string;
}

export interface EntityBlockageAutoClearanceDefinition {
  readonly enabledByDefault: boolean;
  readonly enabledConfigKey: string;
  readonly channelIds: readonly string[];
  readonly slotRefs: readonly EntityBlockageAutoClearanceSlotRef[];
  readonly blockedChannelThreshold: number;
}

// ---------------------------------------------------------------------------
// Recipe Channel
// ---------------------------------------------------------------------------

export interface RecipeChannelDefinition {
  /** channel 标识 */
  id: string;
  /** 新配方的启动依据；状态和环境需求频道不参与普通自动匹配。 */
  readonly startPolicy?: "automatic" | "state" | "environment-demand";
  /** 频道用途；省略时按普通生产频道处理。 */
  readonly type?: "normal-channel" | "consumption-channel";
  /** 配方原料从哪些存储组取 */
  ingredientStorageGroupIds: string[];
  /** 配方产物写入哪些存储组 */
  productStorageGroupIds: string[];
  /** 若为 true，仿真器不自动根据原料匹配配方，必须由用户手动指定配方后设备才运行 */
  manualRecipeOnly?: boolean;
}

// ---------------------------------------------------------------------------
// 物品过滤器 — 决定槽位/端口可容纳的物品类型
// ---------------------------------------------------------------------------

export interface ItemFilterDefinition {
  /** 过滤模式 */
  itemFilter: "type" | "tag-whitelist" | "whitelist" | "blacklist";
  /** 白名单/黑名单物品 ID 列表 */
  itemFilterIds?: string[];
  /** 按域过滤：solid（固体）、liquid（液体）、any（任意） */
  itemFilterType?: ItemFilterType;
  /** 按标签过滤 */
  itemFilterTag?: string[];
}

// ---------------------------------------------------------------------------
// 端口组与端口（对应《仿真运行原理》§3.1 中的 Port 概念）
// ---------------------------------------------------------------------------

export interface PortGroupDefinition {
  /** 端口组 ID，如 "item_input"、"fluid_output" */
  id: string;
  /** 物品域：item（固体物品）/ fluid（流体，含液体与气体） */
  kind: ItemDomainFlag;
  /** 是否为管道端口；物理连接类型只依据此字段判断。 */
  isPipe: boolean;
  /**
   * 端口组方向：
   *   - "input"：接收方向，物品流入设备
   *   - "output"：发送方向，物品流出设备
   *   - "bidirectional"：双向，编译时自动分解为 input + output 两个方向
   */
  direction: "input" | "output" | "bidirectional";
  ports: PortDefinition[];
}

// ---------------------------------------------------------------------------
// 存储槽组（对应《仿真运行原理》§3.1 缓存类型 + §3.4 缓存组）
//
// 存储槽组 = 设备内部的一个缓存区域，编译后对应一个求解图节点。
// 输入/输出能力由绑定的端口方向决定；配方参与由 Recipe Channel 声明。
// ---------------------------------------------------------------------------

export interface StorageSlotGroupDefinition {
  id: string;
  /** 物品域：item / fluid（液体+气体） / liquid / gas */
  kind: ItemDomainFlag;
  // 存储组的输入/输出能力由 portStorageBindings 绑定的端口方向推导；
  // 配方原料/产物角色由 Recipe Channel 的 ingredientStorageGroupIds / productStorageGroupIds 决定。
  /**
   * 当同一存储组同时绑定输入/输出端口并被编译器拆为 input-view/output-view 时，
   * 决定两视图之间采用 share-all 还是 share-cap 连接。
   * 默认值由注册表工厂补为 "share-all"。
   */
  splitLinkType?: StorageGroupSplitLinkType;
  /**
   * 槽位列表。
   * 关键规则（《仿真运行原理》§3.4）：
   *   - 组内互斥：同一组内不同槽不可容纳相同物品
   *   - 跨组不互斥：不同组之间可以容纳相同物品
   * 每个存储槽组编译为一个求解图节点。
   */
  slots: StorageSlotDefinition[];
}


export type StorageGroupSplitLinkType = "share-all" | "share-cap";

/**
 * 存储槽位定义。
 * 对应《仿真运行原理》§5.3 节点能力中的 entry：
 *   - ordered-port-input-capacities 的 entry 是 (slot, accept-rule, amount) 三元组
 *   - ordered-port-output-supplies 的 entry 是 (slot, item, amount) 三元组
 */
export interface StorageSlotDefinition extends ItemFilterDefinition {
  id: string;
  /** 槽位最大容量 */
  capacity: number;
  /** 锁定物品 ID，null = 不锁定。对应 entity.config 中的 "slots[N].lock" */
  lock: string | null;
  /** 初始物品类型（创建时预填充的物品） */
  initialItemType: string | null;
  /** 初始物品数量 */
  initialCount: number;
  /**
   * 忽略库存检查。
   * true 时该槽位不受仓库库存限制（取货口/出货口常用）。
   * 对应 entity.config 中的 "slots[N].ignoreStock"
   */
  ignoreStock: boolean;
}

// ---------------------------------------------------------------------------
// 端口-存储绑定
// ---------------------------------------------------------------------------

export interface RecipeChannelDefinition {
  /** channel 标识 */
  id: string;
  /** 频道用途；省略时按普通生产频道处理。 */
  readonly type?: "normal-channel" | "consumption-channel";
  /** 配方原料从哪些存储组取 */
  ingredientStorageGroupIds: string[];
  /** 配方产物写入哪些存储组 */
  productStorageGroupIds: string[];
  /** 若为 true，仿真器不自动根据原料匹配配方，必须由用户手动指定配方后设备才运行 */
  manualRecipeOnly?: boolean;
}

export interface PortStorageBindingDefinition {
  id: string;
  /** 绑定的端口组 ID */
  portGroupId: string;
  /** 绑定的存储槽组 ID */
  storageSlotGroupId: string;
}

// ---------------------------------------------------------------------------
// 端口定义（对应《仿真运行原理》§3.1 中 port 的 accept-rule 配置）
// ---------------------------------------------------------------------------

export interface PortDefinition {
  id: string;
  /** 设备内局部坐标 x（基于 rotation=0 的 footprint） */
  localCellX: number;
  /** 设备内局部坐标 y */
  localCellY: number;
  /**
   * 端口朝向（相对于 rotation=0 时的设备）。
   * 编译时根据实体实际旋转角做旋转变换。
   * Port 的 edge 描述的是边的方向——物品从 output port 流出、经边流入 input port。
   * 这与 Cache 的 ingredient/product 正交（见《仿真运行原理》§3.1 关键区分）。
   */
  edge: GridEdge;
  /**
   * 物品接收规则（对应《仿真运行原理》§3.1 表格中 port 的 acceptRule）。
   * base 取值：any（任意）/ solid（固体）/ liquid（液体）/ item:itemId（指定物品）
   * exclude 为排除列表。
   * 编译时 sourcePort.acceptRule AND targetPort.acceptRule 合并为边的 acceptRule（§5.2）。
   */
  acceptRule: EntityAcceptRuleDefinition;
  /**
   * 准入口跨 tick 准入规则。
   *
   * 只应挂在 admission 设备的 input port 上。itemId=null 表示未选择准入物品；
   * limit=null 表示不设总量上限。计数由仿真 runtime 持久化，不随 tick 清零。
   */
  admissionRule?: EntityAdmissionRuleDefinition | null;
  /** 优先级分组（用于分流器调度，对应《仿真运行原理》中 routing 概念） */
  priorityGroup: number;
  /** 轮询种子（同一 priorityGroup 内用于 round-robin 调度） */
  roundRobinSeed: number;
}

// ---------------------------------------------------------------------------
// 物品接收规则详情
// ---------------------------------------------------------------------------

export interface EntityAcceptRuleDefinition {
  readonly base:
    | { readonly kind: "domain"; readonly flags: ItemDomainFlag }
    | { readonly kind: "item"; readonly itemId: string }
    | { readonly kind: "none" };
  readonly exclude: readonly string[];
}

export interface EntityAdmissionRuleDefinition {
  /** 准入物品。null 表示未选择，此时不启用准入口限制。 */
  readonly itemId: string | null;
  /** 跨 tick 总准入上限。null 表示无总量上限。 */
  readonly limit: number | null;
  /** 每仿真分钟准入上限。null 表示无每分钟上限。 */
  readonly perMinuteLimit?: number | null;
}

/** 设备自身的 state，与仿真 tick 的处理 stage 独立。 */
export interface DeviceStateMachineDefinition {
  readonly initialStateId: string;
  readonly channelId: string;
  readonly states: readonly DeviceStateDefinition[];
}

export interface CropCultivationDefinition {
  readonly cropId: string;
  readonly growingStateIds: readonly string[];
  readonly refinedStateIds: readonly string[];
  readonly neighborDurationSeconds: number;
  readonly neighborBonusPerPlot: number;
}

export interface DeviceStateDefinition {
  readonly id: string;
  readonly nameKey: string;
  readonly enterRecipeId?: string;
  readonly visualKey?: string;
  /** 进入时新建计时器；继承迁移保留来源状态的计时起点和截止时间。 */
  readonly timerDurationSeconds?: number;
  /** 按声明顺序选取首个满足条件的迁移。 */
  readonly transitions: readonly DeviceStateTransitionDefinition[];
}

export type DeviceStateTransitionDefinition = (
  | { readonly kind: "elapsed" }
  | { readonly kind: "recipe-completed"; readonly recipeId: string }
) & {
  readonly nextStateId: string;
  /** true 保留计时器；省略时按目标状态重新创建或清除。 */
  readonly inheritTimer?: boolean;
};
