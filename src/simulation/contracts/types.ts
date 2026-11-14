import type { SimulationDeviceStateReadModel, SimulationCropCultivationReadModel } from "@/domain/simulation/types/simulation-types";
import type { LinkType } from "@/domain/document/world-document";
import type {
  GridEdge,
  GridPoint,
  GridRect,
  GridRectSize,
  GridRotation,
} from "@/domain/shared/grid";
import type { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import type { RecipeType } from "@/domain/registry/types/recipe-definition";
import type {
  EntitySimulationBehaviorDeclaration,
} from "@/domain/registry/types/entity-simulation-behavior";
import type { SimulationMode } from "@/domain/shared/simulation-mode";
import type { WaterPurifierOutputMode } from "@/shared/water-purifier-node";

export type SimulationItemDomain = ItemDomainFlag;
export type SimulationItemDomainFilter = ItemDomainFlag;
export type SimulationPortKind = ItemDomainFlag;
export type SimulationPortDirection = "input" | "output";
export type SimulationNodeViewRole = "input-view" | "output-view";
export type SimulationPowerStatus = "no-power-needed" | "in-power-range" | "out-of-power-range";
/**
 * 仿真运输类别，决定设备在物流拓扑中的角色。
 *
 * - `strict-belt`：专用传送带（belt_straight_1x1 / belt_turn_cw_1x1 / belt_turn_ccw_1x1）。
 *
 * - `strict-pipe`：专用管道（pipe_straight_1x1 / pipe_turn_cw_1x1 / pipe_turn_ccw_1x1）。
 *
 * - `anchor`：非专用物流设备。包括：
 *   - 生产设备（如 item_port_hydro_planter_1、item_port_furnance_1 等）
 *   - 通用物流设备（item_pipe_splitter、item_pipe_converger、item_pipe_connector、
 *     item_log_splitter、item_log_converger、item_log_connector、
 *     item_pipe_admission、item_log_admission）
 *
 * - `non-graph`：无端口且无存储槽的空壳设备，不进入求解图。
 */
export type SimulationTransportClass = "strict-belt" | "strict-pipe" | "anchor" | "non-graph";
export type SimulationWorkerStatusMode = "idle" | "starting" | "running" | "stopped" | "error";
export type SimulationRecipeType = RecipeType;
export type SimulationLinkType = LinkType;

export interface SimulationAcceptRule {
  readonly base:
    | { readonly kind: "domain"; readonly flags: ItemDomainFlag }
    | { readonly kind: "item"; readonly itemId: string }
    | { readonly kind: "none" };
  readonly exclude: readonly string[];
}

export interface SimulationAdmissionRule {
  readonly itemId: string | null;
  readonly limit: number | null;
  readonly perMinuteLimit: number | null;
}

export interface SimulationCompileDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly entityId?: string;
  readonly definitionId?: string;
}

/**
 * 区域模式下入仓与出仓共用的仓库写边界。
 * Stage 1/3/5 的所有合法仓库写入都必须经过该上下文，不得直接改写隐藏仓库槽。
 */
export interface RegionalWarehouseWriteContext {
  /** 判断 storageSlotId 是否属于本基地隐藏仓库槽。 */
  isWarehouseStorageSlotId(storageSlotId: string): boolean;
  /** 把一件物品追加到当前 Epoch 的只写 deposit journal。 */
  deposit(itemType: string, amount: number): void;
}

export interface RegionalWarehouseStage3Options {
  /** Stage 3A 必须排除的区域仓库出货边。 */
  readonly excludedEdgeIds: ReadonlySet<string>;
  /** Stage 1/3/5 共用的入仓 journal 写边界；单基地模式为 null。 */
  readonly writeContext: RegionalWarehouseWriteContext | null;
}

/** 地区资源面板传入仿真的供给设置。有限速率统一以每分钟物品数表示。 */
export interface RegionalResourceSupplySetting {
  readonly itemId: string;
  readonly mode: "infinite" | "rate";
  readonly perMinute: number;
}

/** 编译后的地区资源供给策略；仅包含当前活动版本中仍可用的自然资源。 */
export interface CompiledRegionalResourceSupply {
  readonly infiniteItemIds: readonly string[];
  readonly finitePerMinuteByItemId: Readonly<Record<string, number>>;
}

export interface CompiledSimulationTopology {
  readonly schemaVersion: 6;
  /** 编译时使用的显式模式；Worker 与 runtime 不得从区域上下文存在性推断。 */
  readonly simulationMode: SimulationMode;
  readonly topologyId: string;
  readonly documentKey: string;
  readonly documentHash: string;
  readonly registryHash: string;
  readonly standardTickRate: number;
  readonly totalPowerDemand: number;
  /** 编译该拓扑时的确定性活动上下文；Worker 不得自行根据时间推断。 */
  readonly activeActivityIds: readonly string[];
  readonly devices: Record<string, CompiledSimulationDevice>;
  readonly nodes: Record<string, CompiledSimulationNode>;
  readonly slots: Record<string, CompiledSimulationSlot>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationSlotLink>;
  readonly physicalConnections: Record<string, CompiledSimulationPhysicalConnection>;
  readonly transferEdges: Record<string, CompiledSimulationTransferEdge>;
  /** 编译期邻接索引。旧测试夹具可省略，运行时会回退到 edgeOrder 扫描。 */
  readonly edgeIdsByInputPortId?: Readonly<Record<string, readonly string[]>>;
  readonly edgeIdsByOutputPortId?: Readonly<Record<string, readonly string[]>>;
  /** 编译期设备顺序索引，避免热路径排序反复调用 indexOf。 */
  readonly deviceOrderIndexById?: Readonly<Record<string, number>>;
  /** 地区资源供给策略。旧快照可以省略，等价于没有地区资源供给。 */
  readonly regionalResourceSupply?: CompiledRegionalResourceSupply;
  readonly ordering: {
    readonly deviceOrder: readonly string[];
    readonly nodeOrder: readonly string[];
    readonly slotOrder: readonly string[];
    readonly portOrder: readonly string[];
    readonly physicalConnectionOrder: readonly string[];
    readonly edgeOrder: readonly string[];
  };
  /** 相连的同类型严格运输设备构成的组件集合。键为组件 ID。 */
  readonly transportComponents: Record<string, CompiledTransportComponent>;
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
}


export interface CompiledSimulationGasDiffusionOutput {
  readonly itemId: string;
  readonly rangeId: string;
}


export interface CompiledSimulationDevice {
  readonly id: string;
  readonly sourceEntityId: string | null;
  readonly definitionId: string;
  readonly position: GridPoint | null;
  readonly rotation: GridRotation | null;
  readonly footprint: GridRectSize | null;
  readonly powerStatus: SimulationPowerStatus;
  readonly powerDemand: number;
  /** 是否需要电力才能运行。对应 EntityDefinition.requiresPower。 */
  readonly requiresPower: boolean;
  readonly transportClass: SimulationTransportClass;
  /** 若属于 strict-belt/strict-pipe 运输组件，则为该组件的 ID；否则为 null。 */
  readonly transportComponentId: string | null;
  readonly nodeIds: readonly string[];
  readonly recipeChannels: readonly CompiledSimulationRecipeChannel[];
  /** Registry 按 simulationMode 解析后固化到拓扑的设备行为。 */
  readonly simulationBehaviors: readonly EntitySimulationBehaviorDeclaration[];
  /** recipeChannels 前部连续的 consumption-channel 数量；生产拓扑始终由编译器填充。 */
  readonly consumptionChannelCount?: number;
  /** 不同 channel 是否允许同时运行同一配方；缺失时按 false 处理。 */
  readonly allowDuplicateRecipesAcrossChannels?: boolean;
  readonly portIds: readonly string[];
  readonly routing: Record<string, CompiledSimulationRoutingEntry>;
  readonly configHash: string;
  /** 显式声明的阻塞清理机制；未配置的设备运行时完全不生效。 */
  readonly blockageAutoClearance?: CompiledSimulationBlockageAutoClearance | null;
  /** 净水节点专用运行配置；其他设备为 null。 */
  readonly waterPurifierNode?: CompiledSimulationWaterPurifierNodeConfig | null;
}

export interface CompiledSimulationBlockageAutoClearanceSlotRef {
  readonly storageSlotGroupId: string;
  readonly slotId: string | null;
}

export interface CompiledSimulationBlockageAutoClearance {
  readonly enabled: boolean;
  readonly channelIds: readonly string[];
  readonly slotRefs: readonly CompiledSimulationBlockageAutoClearanceSlotRef[];
  readonly blockedChannelThreshold: number;
}

export interface CompiledSimulationWaterPurifierNodeConfig {
  readonly outputMode: WaterPurifierOutputMode;
  readonly manualOutputPerMinute: number;
  readonly outputStorageGroupId: string;
  readonly outputSlotId: string;
  readonly outputItemId: string;
}

export interface CompiledSimulationRecipeChannel {
  readonly startPolicy?: "automatic" | "state" | "environment-demand";
  readonly id: string;
  readonly type: "normal-channel" | "consumption-channel";
  readonly ingredientNodeIds: readonly string[];
  readonly productNodeIds: readonly string[];
  readonly manualRecipeOnly: boolean;
  /** manualRecipeOnly channel 的用户预选配方 ID，null 表示未选择 */
  readonly defaultRecipeId: string | null;
}

export interface CompiledSimulationNode {
  readonly id: string;
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string | null;
  readonly viewRole: SimulationNodeViewRole;
  readonly slotIds: readonly string[];
  readonly inputPortIds: readonly string[];
  readonly outputPortIds: readonly string[];
  readonly groupOrder: number;
}

export interface CompiledSimulationSlot {
  readonly id: string;
  readonly nodeId: string;
  readonly sourceStorageSlotGroupId: string | null;
  readonly sourceSlotId: string | null;
  readonly capacity: number;
  readonly domain: SimulationItemDomainFilter;
  readonly lock: string | null;
  readonly initialItemType: string | null;
  readonly initialCount: number;
  readonly ignoreStock: boolean;
}

export interface CompiledSimulationPort {
  readonly id: string;
  readonly deviceId: string;
  readonly portGroupId: string;
  readonly portDefinitionId: string;
  readonly kind: SimulationPortKind;
  /** 是否为管道端口；物理连接类型只依据此字段判断。 */
  readonly isPipe: boolean;
  readonly direction: SimulationPortDirection;
  readonly insideGridPoint: GridPoint;
  readonly outsideGridPoint: GridPoint;
  readonly edge: GridEdge;
  readonly boundNodeIds: readonly string[];
  readonly acceptRule: SimulationAcceptRule;
  /** 仅 admission 设备 input port 使用；计数存放于 runtime persistent state。 */
  readonly admissionRule: SimulationAdmissionRule | null;
  readonly priorityGroup: number;
  readonly roundRobinSeed: number;
  readonly order: number;
}

export interface CompiledSimulationPhysicalConnection {
  readonly id: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sourceInsideGridPoint: GridPoint;
  readonly targetInsideGridPoint: GridPoint;
}

/**
 * 运输组件：相连的 strict-belt 或 strict-pipe 设备构成的无向连通分量。
 * 组件内所有槽位共享同一个物品类型域锁（domain），确保管道/传送带链路不混合多种物品。
 */
export interface CompiledTransportComponent {
  /** 同组件内所有设备的 ID 集合。 */
  readonly deviceIds: readonly string[];
  /** 同组件内所有节点的 ID 集合。 */
  readonly nodeIds: readonly string[];
  /** 同组件内所有槽位的 ID 集合。 */
  readonly slotIds: readonly string[];
}

export interface CompiledSimulationTransferEdge {
  readonly id: string;
  readonly physicalConnectionId: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly acceptRule: SimulationAcceptRule;
}

export interface CompiledSimulationSlotLink {
  readonly id: string;
  readonly linkType: SimulationLinkType;
  readonly sourceSlotIds: readonly string[];
  readonly targetSlotIds: readonly string[];
  readonly targetSlotIdBySourceSlotId: Readonly<Record<string, string>>;
}

export interface CompiledSimulationRecipePlan {
  readonly recipeId: string;
  readonly probability?: number;
  readonly recipeType: SimulationRecipeType;
  readonly durationTicks: number;
  readonly inputs: readonly CompiledSimulationRecipeItem[];
  readonly outputs: readonly CompiledSimulationRecipeItem[];
  readonly ingredientNodeIds: readonly string[];
  readonly productNodeIds: readonly string[];
  readonly requiredEnvironmentAnyOf: readonly string[] | null;
  readonly environmentOutput: CompiledSimulationGasDiffusionOutput | null;
}

export interface CompiledSimulationRecipeItem {
  readonly itemId: string | "any" | "same-as-input";
  readonly amount: number;
}

export interface CompiledSimulationRoutingEntry {
  readonly priorityGroup: number;
  readonly roundRobinSeed: number;
}

export type SimulationTickPullStatus =
  | {
      readonly status: "ready";
      readonly retainedFromTick: number;
      readonly latestTickNumber: number;
      readonly bufferSize: number;
    }
  | {
      readonly status: "not-ready";
      readonly requestedTickNumber: number;
      readonly retainedFromTick: number | null;
      readonly latestTickNumber: number | null;
      readonly bufferSize: number;
    }
  | {
      readonly status: "not-found";
      readonly reason: "cleared" | "missing-topology" | "unknown";
      readonly requestedTickNumber: number;
      readonly retainedFromTick: number | null;
      readonly latestTickNumber: number | null;
      readonly bufferSize: number;
    };

export interface SimulationRuntimeStatus {
  readonly mode: SimulationWorkerStatusMode;
  readonly topologyId: string | null;
  readonly documentHash: string | null;
  readonly retainedFromTick: number | null;
  readonly latestTickNumber: number | null;
  readonly bufferSize: number;
  readonly maxBufferSize: number;
  readonly dynamicTickRate: number | null;
  readonly error: string | null;
}

export interface SimulationStartResult {
  readonly status: "started" | "failed";
  readonly topologyId: string | null;
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
  readonly error?: string;
  readonly runtimeTransition?: SimulationRuntimeTransition;
}

/**
 * 一次拓扑装载对运行时的实际影响。
 * 用于区分首次初始化、保留状态的热替换与无法迁移时的完整重置。
 */
export interface SimulationRuntimeTransition {
  readonly kind: "initialization" | "topology-hot-swap" | "full-reset" | "migration-rejected";
  readonly reason: string;
  readonly baseTickNumber: number;
  readonly invalidatedFromTickNumber: number;
  readonly resetDeviceIds: readonly string[];
}

export interface SimulationTopologyMigration {
  readonly baseTickNumber: number;
  readonly resetDeviceIds: readonly string[];
}


export interface SimulationTickSnapshotResult {
  readonly status: SimulationTickPullStatus;
  readonly currentTick: RuntimeTickSnapshot | null;
}

export interface RuntimeTickSnapshot {
  readonly topologyId: string;
  readonly documentHash: string;
  readonly tickNumber: number;
  /** 当前引擎的标准 tick 频率。 */
  readonly standardTickRate: number;
  /** 从当前真实 tick 到下一真实 tick 之间采用的运行频率。 */
  readonly tickRate: number;
  readonly status: "initial" | "running";
  /** 调试模式下为完整 Tick 与 Worker 可序列化内部状态的 JSON；非调试模式不传输该属性。 */
  readonly debugData?: string;
  readonly totalPowerDemand: number;
  readonly currentPowerGeneration: number;
  /** 真实电力模式下发电量不足总需求时为 true；无限电力模式下始终为 false */
  readonly isPowerOutage: boolean;
  /** 基地电池当前电量（焦耳） */
  readonly baseBatteryJoules: number;
  /** 基地电池满容量（焦耳） */
  readonly baseBatteryCapacity: number;
  readonly slots: Record<string, RuntimeSlotSnapshot>;
  readonly devices: Record<string, RuntimeDeviceSnapshot>;
  readonly nodes: Record<string, RuntimeNodeSnapshot>;
  readonly transfers: readonly RuntimeTransferSnapshot[];
  readonly routingCursors: Record<string, number>;
  readonly transportComponentDomain: Record<string, string | null>;
  readonly diagnostics: readonly RuntimeDiagnosticSnapshot[];
  readonly environments: readonly RuntimeEnvironmentSnapshot[];
  /** 仓库统计快照：配方产出/消耗 per-min 与当前库存。仿真未启动时为 null。 */
  readonly warehouseStats: WarehouseStats | null;
}

export interface RuntimeEnvironmentSnapshot {
  readonly sourceDeviceId: string;
  readonly rangeId: string;
  readonly rotation: GridRotation;
  readonly itemId: string;
  readonly gridRect: GridRect;
}

/** 单种物品的仓库统计数据 */
export interface WarehouseItemStats {
  /** 1 分钟滑动窗口内产出速率（/min 仿真时间） */
  readonly producedPerMinute: number;
  /** 1 分钟滑动窗口内消耗速率（/min 仿真时间） */
  readonly consumedPerMinute: number;
  /** 当前仓库中该物品的数量 */
  readonly warehouseCount: number;
  /** 当前仓库是否对该物品提供无限库存。 */
  readonly infinite: boolean;
  /** 最后一次发生变化（产出或消耗）的 tick 号 */
  readonly lastChangedTick: number;
}

/** 仓库统计快照 */
export interface WarehouseStats {
  /** key 为 itemType */
  readonly items: Record<string, WarehouseItemStats>;
  /** 首个 1 分钟统计窗口是否已就绪（coveredStandardTicks >= windowCapacity） */
  readonly statsWindowReady: boolean;
}

export interface RuntimeSlotSnapshot {
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: number;
  readonly ignoreStock: boolean;
}

export interface RuntimeDeviceSnapshot {
  readonly deviceState?: SimulationDeviceStateReadModel;
  readonly cultivation?: SimulationCropCultivationReadModel;
  readonly deviceId: string;
  readonly block: boolean;
  // 原 recipe 仍为第一个运行中 recipe 的快照投影。
  readonly recipe: RuntimeDeviceRecipeSnapshot | null;
  /** 每个 channel 的当前运行时配方状态，key 为 channel id，null 表示该 channel 空闲 */
  readonly channelRecipes: Record<string, RuntimeDeviceRecipeSnapshot | null>;
  /** 准入口 runtime 计数，key 为 `${portGroupId}:${portId}`。 */
  readonly admissionCounters: Record<string, RuntimeAdmissionCounterSnapshot>;
}


export interface RuntimeAdmissionCounterSnapshot {
  readonly portId: string;
  readonly portGroupId: string;
  readonly portDefinitionId: string;
  readonly itemId: string | null;
  readonly limit: number | null;
  readonly count: number;
  readonly perMinuteLimit: number | null;
  readonly rateWindowCount: number;
  /** 已完成窗口的计数环形缓冲（最多 6 个 = ADMISSION_RATE_WINDOWS_PER_MINUTE）。最旧窗口可能仅部分落入 60 秒，oneMinuteCount 需配合 moveTicks 精确计算。 */
  readonly pastWindowCounts: readonly number[];
  /** 每次物品通过准入口输出口的 tick 号（用于精确计算过去一分钟真实通过数量）。 */
  readonly moveTicks: readonly number[];
}

export interface RuntimeDeviceRecipeSnapshot {
  readonly runId: string;
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  readonly progressTicks: number;
  readonly durationTicks: number;
  /** 当前真实 tick 之后的运行区间内是否会继续推进。 */
  readonly isProgressing: boolean;
  readonly state: "running" | "waiting-output";
}

export interface RuntimeNodeSnapshot {
  readonly nodeId: string;
  readonly result: "uncertain" | "solved-run" | "solved-block";
  readonly resolveState: "unresolved" | "visited" | "blocked-resolved";
  readonly acceptedInputEdgeIds: readonly string[];
  readonly acceptedOutputEdgeIds: readonly string[];
  readonly blockReason?: string;
}

export interface RuntimeTransferSnapshot {
  readonly edgeId: string;
  readonly sourceSlotId: string;
  readonly targetSlotId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface RuntimeDiagnosticSnapshot {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}


// ============================================================
// Perf instrumentation types
// ============================================================

export interface TickPerfEntry {
  readonly tickNumber: number;
  readonly totalMs: number;
  readonly stages: {
    readonly advanceDevices: number;
    readonly buildSolveGraph: number;
    readonly solveTransferGraph: number;
    readonly rotateRoutingCursors: number;
    readonly settleRecipes: number;
    readonly maintainDomains: number;
    readonly createSnapshot: number;
  };
  readonly stage3?: TickPerfStage3Details;
  readonly hotPath?: TickPerfHotPathDetails;
}

export interface TickPerfStage3Details {
  readonly layerCount: number;
  readonly anchorCount: number;
  readonly outputNodeCount: number;
  readonly moveCount: number;
  readonly refreshBlockedMs: number;
  readonly refreshBlockedCalls: number;
  readonly getReservedCalls: number;
  readonly canOutputProvideCalls: number;
  readonly findInputSlotCalls: number;
  readonly getRemainingCapacityCalls: number;
  readonly selectSourceCalls: number;
  readonly solveOutputEdgeChecks: number;
}

export interface TickPerfHotPathDetails {
  readonly inputEdgeLookupCalls: number;
  readonly inputEdgeLookupMs: number;
  readonly outputEdgeLookupCalls: number;
  readonly outputEdgeLookupMs: number;
  readonly edgeIndexFallbackScans: number;
  readonly reservedLookupCalls: number;
  readonly reservedLookupMs: number;
  readonly reservedIndexBuilds: number;
  readonly reservedIndexBuildMs: number;
  readonly reservationAdjustCalls: number;
  readonly recipeFinishCalls: number;
  readonly recipeFinishSuccesses: number;
  readonly recipeFinishFailures: number;
  readonly recipeFinishPreflightMs: number;
  readonly recipeFinishCommitMs: number;
  readonly recipeFinishChangedSlots: number;
}

export interface SimulationPerfReport {
  readonly tickRange: { readonly from: number; readonly to: number };
  readonly entries: readonly TickPerfEntry[];
  readonly summary: {
    readonly avgMs: number;
    readonly maxMs: number;
    readonly avgStageMs: {
      readonly advanceDevices: number;
      readonly buildSolveGraph: number;
      readonly solveTransferGraph: number;
      readonly rotateRoutingCursors: number;
      readonly settleRecipes: number;
      readonly maintainDomains: number;
      readonly createSnapshot: number;
    };
  };
}
