import type { SimulationMode } from "../../shared/simulation-mode";
import type { GridRotation } from "../../shared/grid";

export type SimulationEngineKind = "legacy";
export type SimulationRunState = "stop" | "starting" | "start" | "pause";

/** 设备在当前仿真快照中的互斥运行状态；不包含项目无法判定的游戏 INACTIVE 状态。 */
export type SimulationDeviceOperatingStatus =
  | "closed"
  | "idle"
  | "normal"
  | "blocked"
  | "no-power"
  | "not-in-power-net";


/** 仿真引擎内部采样后按需发布的性能诊断快照。 */
export interface SimulationPerformanceDiagnosticsReadModel {
  /** 最近一个完整采样窗口内实际展示的真实运行 tick 数量/墙钟秒。 */
  readonly tickPerSecond: number;
  /** 目标真实运行 TPS = simulationSpeed × 当前引擎 tickRate。 */
  readonly targetTickPerSecond: number;
  /** 主线程中无需等待 Worker 即可继续展示的帧数量。 */
  readonly playbackBufferedFrameCount: number;
  /** Worker 内为继续运行或历史重建保留的状态数量。 */
  readonly runtimeRetainedStateCount: number;
  /** 时间轴专用 Worker 当前保留的已计算帧数量；无独立时间轴缓存时为 0。 */
  readonly timelineRetainedFrameCount: number;
  /** 最近一个完整采样窗口内时间轴专用 Worker 计算的帧数量/墙钟秒。 */
  readonly timelineGeneratedFramePerSecond: number;
}

export interface SimulationState {
  readonly runningState: SimulationRunState;
  /** 当前编辑与下一次编译使用的仿真模式；仿真停止时同样可观察。 */
  readonly simulationMode: SimulationMode;
  /**
   * 仅作为 advancePlaybackByDeltaMs 的时间推进倍率使用。
   * 禁止在任何其他逻辑中直接消费该值；tick 和 second 的换算一律使用 standard tick rate。
  */
  readonly simulationSpeed: number;
  readonly timeline: SimulationTimelineState;
}

export interface SimulationTimelineMark {
  readonly id: string;
  readonly tickNumber: number;
  readonly kind: "document-change" | "runtime-change" | "safety-resync";
}

export interface SimulationTimelineState {
  readonly enabled: boolean;
  readonly readiness: "idle" | "preparing" | "catching-up" | "ready";
  readonly tickDurationSeconds: number;
  readonly rulerDurationSeconds: number;
  readonly windowStartTickNumber: number;
  readonly cursorTickNumber: number;
  readonly availableFromTickNumber: number;
  readonly availableToTickNumber: number;
  readonly marks: readonly SimulationTimelineMark[];
  readonly isSeeking: boolean;
}

export interface SimulationDeviceRuntimeChannelRecipeStatus {
  readonly channelId: string;
  readonly recipeId: string | null;
  readonly progressSeconds: number | null;
  readonly desiredSeconds: number | null;
  /** 当前真实 tick 之后的运行区间内，该配方是否会继续推进。 */
  readonly isProgressing: boolean;
  /** 配方运行时状态，用于判断产物堵塞等 */
  readonly state: "running" | "waiting-output" | null;
}

export interface SimulationDeviceRuntimeStatusReadModel {
  readonly deviceState?: SimulationDeviceStateReadModel;
  readonly cultivation?: SimulationCropCultivationReadModel;
  /** 每个 channel 的运行时配方状态，key 为 channel id */
  readonly channelRecipes: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null>;
  readonly slotItems: readonly SimulationDeviceRuntimeSlotItemReadModel[];
  /** 准入口 runtime 计数，key 为 `${portGroupId}:${portId}`。非 admission 设备或旧测试 mock 可省略。 */
  readonly admissionCounters?: Record<string, SimulationAdmissionCounterStatusReadModel>;
  /** 设备供电范围状态（编译期确定，非运行时变化） */
  readonly powerStatus: "no-power-needed" | "in-power-range" | "out-of-power-range" | null;
}

export interface SimulationDeviceStateReadModel {
  readonly stateId: string;
  readonly enteredAtSeconds: number;
  /** 与当前状态进入时间独立，继承计时器时保留。没有计时器时为 null。 */
  readonly timerStartedAtSeconds: number | null;
  readonly endsAtSeconds: number | null;
  readonly visualKey: string | null;
}

export interface SimulationCropCultivationReadModel {
  readonly neighborProgressSeconds: number;
  readonly adjacentPlotCount: number;
  readonly effectiveNeighborCount: number;
  readonly yieldBonusRatio: number;
  readonly isNeighborProgressing: boolean;
}


export interface SimulationEnvironmentRangeReadModel {
  readonly sourceDeviceId: string;
  readonly rangeId: string;
  readonly rotation: GridRotation;
  readonly itemId: string;
  readonly gridRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface SimulationAdmissionCounterStatusReadModel {
  readonly portGroupId: string;
  readonly portId: string;
  readonly itemType: string | null;
  readonly limit: number | null;
  /** 已经从准入口输出口真实移动到下游的跨窗口累计数量。 */
  readonly count: number;
  /** UI 配置单位仍为每分钟；运行时按该值除以 6 作为每个 10 秒窗口的额度。 */
  readonly perMinuteLimit: number | null;
  /** 当前对齐的 10 秒速率窗口内，已由准入口输出口真实移动到下游的数量。 */
  readonly rateWindowCount: number;
  /** 过去 6 个 10 秒窗口（含当前窗口）内累计通过的物品数量 = 过去一分钟真实经过总量。 */
  readonly oneMinuteCount: number;
}

// viewRole alone determines slot role for display.
export interface SimulationDeviceRuntimeSlotItemReadModel {
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly viewRole: "single-view" | "input-view" | "output-view";
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: number;
  readonly ignoreStock: boolean;
}

/** 单种物品的仓库统计只读视图 */
export interface WarehouseItemStatsReadModel {
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

/** 仓库统计快照只读视图 */
export interface WarehouseStatsReadModel {
  /** key 为 itemType */
  readonly items: Record<string, WarehouseItemStatsReadModel>;
  /** 首个 1 分钟统计窗口是否已就绪 */
  readonly statsWindowReady: boolean;
}

export interface SimulationRuntimeSlotPatch {
  readonly entityId: string;
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly ignoreStock: boolean;
}

export interface SimulationAdmissionCounterReset {
  readonly entityId: string;
  readonly portGroupId: string;
  readonly portId: string;
  /** 省略时重置累计计数；rate-window 只重置当前 10 秒速率窗口。 */
  readonly scope?: "total" | "rate-window";
}

/** 文档级仿真运行时只读视图 */
/** 当前公开 tick 中真实发生的物品交接；不包含预定或失败的搬运。 */
export interface SimulationItemTransferReadModel {
  readonly sourceDeviceId: string;
  readonly targetDeviceId: string;
  readonly itemId: string;
  readonly amount: number;
}

export interface SimulationDocumentRuntimeReadModel {
  /** 当前 tick 编号，仿真未启动时为 null */
  readonly tickNumber: number | null;
  /** 当前引擎每仿真秒包含的标准 tick 数。 */
  readonly standardTickRate: number;
  /** 当前真实运行 tick 频率；用于确定当前公开 tick 的展示区间。 */
  readonly tickRate: number;
  /** 总电力需求（kW），拓扑未编译时为 null */
  readonly totalPowerDemand: number | null;
  /** 当前动态发电量（kW），拓扑未编译或无限电力模式下为 null */
  readonly currentPowerGeneration: number | null;
  /** 真实电力模式下发电量不足总需求时为 true，无限电力模式下始终为 false */
  readonly isPowerOutage: boolean;
  /** 基地电池当前电量（焦耳）。 */
  readonly baseBatteryJoules: number;
  /** 基地电池满容量（焦耳）。 */
  readonly baseBatteryCapacity: number;
}
