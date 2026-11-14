import { runInAction } from "mobx";
import type { SimulationAction } from "@/domain/simulation/simulation-action";

import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import {
  resolveStandardStepTicks,
  SimulationPerformanceRateWindow,
  STANDARD_TICK_RATE_PER_SECOND,
} from "../contracts";
import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
  SimulationTickPullStatus,
} from "../contracts";


import type { LegacyPresentationState } from "./state";
import type { SimulationStateReadWrite } from "../contracts";
import type { SimulationWorkerBridge } from "./bridge-contract";


import { PLAYBACK_HOT_QUEUE_CAPACITY, PLAYBACK_HOT_QUEUE_LOW_WATER } from "./controller-support";


const PLAYBACK_PREFETCH_RETRY_MS = 50;

interface TopologyPresentationBoundary {
  readonly maxPlaybackTickNumber: number;
  readonly reached: Promise<void>;
  readonly resolveReached: () => void;
}

interface PlaybackSnapshotConsumption {
  readonly snapshot: RuntimeTickSnapshot;
  readonly consumedTickCount: number;
}

interface LegacyPlaybackContext {
  readonly stateReadWrite: SimulationStateReadWrite;
  readonly presentation: LegacyPresentationState;
  readonly topology: SnapshotStoreReadWrite<CompiledSimulationTopology | null>;
  readonly bridge: SimulationWorkerBridge;
  readonly getPerfEnabled: (() => boolean) | undefined;
  isTopologyRefreshing(): boolean;
  syncTimelineCursorFromPlayback(options?: { retargetWindow?: boolean }): void;
  checkTimelineSafetySync(tickNumber: number): Promise<void>;
  restartTimelineAfterPlaybackRollbackIfNeeded(): Promise<void>;
  syncToTick(tickNumber: number, playbackTickNumberOnReady?: number): Promise<SimulationTickPullStatus>;
  pollPerfReport(tickNumber: number): Promise<void>;
}

export class LegacyPlaybackController {
  public constructor(private readonly context: LegacyPlaybackContext) {}

  public get pendingRequest(): Promise<void> | null { return this.playbackTickRequestCompletion; }
  public get bufferedSize(): number { return this.playbackHotQueue.size; }
  public get tickPerSecond(): number { return this.tickRateWindow.ratePerSecond; }
  public get latestBufferedTick(): number {
    let latest = 0;
    for (const snapshot of this.playbackHotQueue.values()) latest = Math.max(latest, snapshot.tickNumber);
    return latest;
  }
  public enqueueSnapshot(snapshot: RuntimeTickSnapshot): void {
    this.playbackHotQueue.set(snapshot.tickNumber, snapshot);
  }
  public resetStatistics(): void {
    this.tickRateWindow.reset();
  }

  private readonly tickRateWindow = new SimulationPerformanceRateWindow();

  private playbackTickRequestInFlight = false;

  private playbackTickRequestCompletion: Promise<void> | null = null;

  public playbackTargetTickNumber = 0;

  private readonly playbackHotQueue = new Map<number, RuntimeTickSnapshot>();

  private playbackHotQueueGeneration = 0;

  private playbackPrefetchRetryAfterMs = 0;

  private playbackAckRequestInFlight = false;

  private pendingPlaybackAckTickNumber: number | null = null;

  private topologyPresentationBoundary: TopologyPresentationBoundary | null = null;

  // === 诊断计数器：10 秒输出一次 ===
  private diagFrameCount = 0;

  private diagCrossCount = 0;

  private diagInFlightSkipCount = 0;

  private diagNotReadyCount = 0;

  private diagTickConsumedCount = 0;

  private diagTotalDeltaMs = 0;

  private diagLastLogFrame = 0;

  private diagLastLogPlaybackTick = 0;

  private diagConsecutiveRollbacks = 0;

  private diagMaxConsecutiveRollbacks = 0;

  public readonly advancePlaybackByDeltaMs: SimulationAction["advancePlaybackByDeltaMs"] = async (
    deltaMs,
  ) => {
    // 诊断统计必须在调用点服从 debugMode 总开关，关闭时连每帧累计都不执行。
    if (this.context.getPerfEnabled?.() === true) {
      this.diagFrameCount += 1;
      this.diagTotalDeltaMs += deltaMs;

      if (this.diagFrameCount - this.diagLastLogFrame >= 600) {
        const intervalFrames = this.diagFrameCount - this.diagLastLogFrame;
        const avgDeltaMs = this.diagTotalDeltaMs / intervalFrames;
        const avgTickDelta = avgDeltaMs * STANDARD_TICK_RATE_PER_SECOND * this.context.stateReadWrite.simulationSpeed / 1000;
        const playbackProgress = this.context.stateReadWrite.currentPlaybackTickNumber - this.diagLastLogPlaybackTick;
        const inFlightRate = intervalFrames > 0 ? (this.diagInFlightSkipCount / intervalFrames * 100).toFixed(1) : '0';
        const notReadyRate = intervalFrames > 0 ? (this.diagNotReadyCount / intervalFrames * 100).toFixed(1) : '0';
        console.debug(
          `[PlaybackDiag] +${intervalFrames}f avgMs=${avgDeltaMs.toFixed(2)} tickΔ=${avgTickDelta.toFixed(4)} ` +
          `crosses=${this.diagCrossCount} consumed=${this.diagTickConsumedCount} ` +
          `inFlightSkip=${this.diagInFlightSkipCount}(${inFlightRate}%) notReady=${this.diagNotReadyCount}(${notReadyRate}%) ` +
          `rollbackMaxConsec=${this.diagMaxConsecutiveRollbacks} ` +
          `playbackΔ=${playbackProgress.toFixed(2)} ` +
          `tps=${this.tickPerSecond} buff=${this.context.stateReadWrite.runtimeStatus.bufferSize}`,
        );

        this.diagLastLogFrame = this.diagFrameCount;
        this.diagLastLogPlaybackTick = this.context.stateReadWrite.currentPlaybackTickNumber;
        this.diagTotalDeltaMs = 0;
        this.diagCrossCount = 0;
        this.diagInFlightSkipCount = 0;
        this.diagNotReadyCount = 0;
        this.diagTickConsumedCount = 0;
        this.diagMaxConsecutiveRollbacks = 0;
      }
    }

    if (this.context.stateReadWrite.runningState !== "start") {
      return;
    }

    this.ensurePlaybackHotQueue();

    const previousPlaybackTickNumber = this.context.stateReadWrite.currentPlaybackTickNumber;
    // simulationSpeed 有且仅有这一处可以参与运算：它只影响 add time 的推进速度。
    // 任何其他场合都不得使用该倍率做 tick/second 换算；换算只能依赖 standard tick rate。
    const standardTickRate = this.context.presentation.currentSnapshot?.standardTickRate
      ?? this.context.topology.getSnapshot()?.standardTickRate
      ?? STANDARD_TICK_RATE_PER_SECOND;
    const tickDelta = deltaMs
      * standardTickRate
      * this.context.stateReadWrite.simulationSpeed
      / 1000;

    // 位置始终按墙钟推进，不受 Worker bridge 在途状态影响。
    // playbackTickRequestInFlight 仅阻止并发请求，不冻结动画。
    // Worker 背压期间冻结在下一边界，恢复后逐步消费欠账，不能一次跳到最新墙钟目标。
    runInAction(() => {
      this.playbackTargetTickNumber = Math.max(
        this.playbackTargetTickNumber,
        this.context.stateReadWrite.currentPlaybackTickNumber,
      ) + tickDelta;
      const synchronizedTickNumber = this.context.presentation.currentSnapshot?.tickNumber
        ?? Math.min(
          Math.trunc(previousPlaybackTickNumber),
          this.context.stateReadWrite.runtimeStatus.latestTickNumber ?? 0,
        );
      const currentRealTickInterval = this.context.presentation.currentSnapshot === null
        ? 1
        : resolveStandardStepTicks(
            this.context.presentation.currentSnapshot.tickRate,
            this.context.presentation.currentSnapshot.standardTickRate,
          ) ?? 1;
      const maxFrameStepTicks = Math.max(
        currentRealTickInterval,
        Math.ceil(Math.max(0, tickDelta)),
      );
      const migrationBoundaryTickNumber = this.topologyPresentationBoundary?.maxPlaybackTickNumber
        ?? Number.POSITIVE_INFINITY;
      this.context.stateReadWrite.currentPlaybackTickNumber = Math.max(
        previousPlaybackTickNumber,
        Math.min(
          this.playbackTargetTickNumber,
          synchronizedTickNumber + maxFrameStepTicks,
          migrationBoundaryTickNumber,
        ),
      );
      this.context.syncTimelineCursorFromPlayback();
    });
    this.resolveReachedTopologyPresentationBoundary();

    const previousIntegerTickNumber = Math.trunc(previousPlaybackTickNumber);
    const nextIntegerTickNumber = Math.trunc(this.context.stateReadWrite.currentPlaybackTickNumber);

    // 计算本 delta 内实际获得的整数 tick 数，用于 TPS 统计
    let actualTicksProcessed = 0;

    const synchronizedTickNumber = this.context.presentation.currentSnapshot?.tickNumber
      ?? Math.min(
        previousIntegerTickNumber,
        this.context.stateReadWrite.runtimeStatus.latestTickNumber ?? 0,
      );
    if (synchronizedTickNumber >= nextIntegerTickNumber) {
      // 未跨越整数 tick 边界
      this.diagConsecutiveRollbacks = 0;
      this.accumulateTps(deltaMs, actualTicksProcessed);
      return;
    }

    this.diagCrossCount += 1;

    // bridge 在途时跳过本帧请求，但位置已推进；将位置回退到整数边界之下，
    // 确保 bridge 返回后下一帧再次跨越同一 tick 边界，不会丢 tick。
    // 仅在热队列缺口或拓扑刷新时冻结于边界，范围预取继续在后台补充。
    if (this.context.isTopologyRefreshing()) {
      this.diagInFlightSkipCount += 1;
      this.diagConsecutiveRollbacks += 1;
      this.diagMaxConsecutiveRollbacks = Math.max(this.diagMaxConsecutiveRollbacks, this.diagConsecutiveRollbacks);
      this.accumulateTps(deltaMs, 0);
      return;
    }

    const prefetchedSnapshot = this.takePlaybackSnapshotThrough(
      synchronizedTickNumber + 1,
      nextIntegerTickNumber,
    );
    if (prefetchedSnapshot === null) {
      if (this.playbackTickRequestInFlight) {
        this.diagInFlightSkipCount += 1;
      } else {
        this.diagNotReadyCount += 1;
      }
      this.diagConsecutiveRollbacks += 1;
      this.diagMaxConsecutiveRollbacks = Math.max(
        this.diagMaxConsecutiveRollbacks,
        this.diagConsecutiveRollbacks,
      );
      this.ensurePlaybackHotQueue();
      this.accumulateTps(deltaMs, 0);
      return;
    }

    this.diagConsecutiveRollbacks = 0;
    this.publishPlaybackSnapshot(prefetchedSnapshot.snapshot);
    actualTicksProcessed = prefetchedSnapshot.consumedTickCount;
    this.diagTickConsumedCount += actualTicksProcessed;
    this.accumulateTps(deltaMs, actualTicksProcessed);
    this.acknowledgePresentedTick(prefetchedSnapshot.snapshot.tickNumber);
    this.ensurePlaybackHotQueue();
  };

  /** 仅当目标区间完整存在时才原子消费，避免跨过缺失 Tick。 */
  private takePlaybackSnapshotThrough(
    fromTickNumber: number,
    toTickNumber: number,
  ): PlaybackSnapshotConsumption | null {
    const availableTickNumbers = [...this.playbackHotQueue.keys()]
      .filter((tickNumber) => tickNumber >= fromTickNumber && tickNumber <= toTickNumber)
      .sort((left, right) => left - right);
    if (availableTickNumbers.length === 0) {
      return null;
    }

    let snapshot: RuntimeTickSnapshot | null = null;
    for (const tickNumber of availableTickNumbers) {
      snapshot = this.playbackHotQueue.get(tickNumber) ?? null;
      this.playbackHotQueue.delete(tickNumber);
    }
    return snapshot === null
      ? null
      : { snapshot, consumedTickCount: availableTickNumbers.length };
  }

  private publishPlaybackSnapshot(snapshot: RuntimeTickSnapshot): void {
    runInAction(() => {
      this.context.presentation.currentSnapshot = snapshot;
      this.context.syncTimelineCursorFromPlayback();
    });

    if (this.context.getPerfEnabled?.()) {
      void this.context.pollPerfReport(snapshot.tickNumber);
    }
    void this.context.checkTimelineSafetySync(snapshot.tickNumber);
  }

  /** 低于低水位时补到容量上限；任意时刻最多一个范围请求在途。 */
  public ensurePlaybackHotQueue(): void {
    const currentSnapshot = this.context.presentation.currentSnapshot;
    if (
      currentSnapshot === null
      || this.context.stateReadWrite.runningState !== "start"
      || this.context.isTopologyRefreshing()
      || this.context.stateReadWrite.timeline.isSeeking
      || this.playbackTickRequestInFlight
      || this.playbackHotQueue.size >= PLAYBACK_HOT_QUEUE_LOW_WATER
      || performance.now() < this.playbackPrefetchRetryAfterMs
    ) {
      return;
    }

    const generation = this.playbackHotQueueGeneration;
    const fallbackPlaybackTickNumber = this.context.stateReadWrite.currentPlaybackTickNumber;
    const queuedTickNumbers = [...this.playbackHotQueue.keys()];
    const fromTickNumber = Math.max(
      currentSnapshot.tickNumber,
      queuedTickNumbers.length === 0
        ? currentSnapshot.tickNumber
        : Math.max(...queuedTickNumbers),
    ) + 1;
    const requestCount = PLAYBACK_HOT_QUEUE_CAPACITY - this.playbackHotQueue.size;
    const toTickNumber = fromTickNumber + requestCount - 1;
    this.playbackTickRequestInFlight = true;

    const completion = this.context.bridge.getTickSnapshotRange(
      fromTickNumber,
      toTickNumber,
      generation,
      this.context.stateReadWrite.simulationSpeed,
    ).then(async (response) => {
      if (
        generation !== this.playbackHotQueueGeneration
        || response.result.generation !== generation
      ) {
        return;
      }

      runInAction(() => {
        this.context.stateReadWrite.runtimeStatus = response.status;
      });

      let previousTickNumber = fromTickNumber - 1;
      for (const snapshot of response.result.snapshots) {
        if (
          snapshot.tickNumber <= previousTickNumber
          || snapshot.tickNumber > toTickNumber
          || snapshot.topologyId !== currentSnapshot.topologyId
          || snapshot.documentHash !== currentSnapshot.documentHash
        ) {
          break;
        }
        this.playbackHotQueue.set(snapshot.tickNumber, snapshot);
        previousTickNumber = snapshot.tickNumber;
      }

      if (response.result.snapshots.length === 0) {
        this.playbackPrefetchRetryAfterMs = performance.now() + PLAYBACK_PREFETCH_RETRY_MS;
      }

      if (response.result.status.status === "not-found") {
        await this.recoverPlaybackFromUnavailableTick(
          response.result.status,
          fallbackPlaybackTickNumber,
        );
      }
    }).catch((error: unknown) => {
      if (generation === this.playbackHotQueueGeneration) {
        this.playbackPrefetchRetryAfterMs = performance.now() + PLAYBACK_PREFETCH_RETRY_MS;
        console.error("[SimHost] Failed to prefetch playback ticks.", error);
      }
    });

    const trackedCompletion = completion.finally(() => {
      if (this.playbackTickRequestCompletion === trackedCompletion) {
        this.playbackTickRequestInFlight = false;
        this.playbackTickRequestCompletion = null;
      }
    });
    this.playbackTickRequestCompletion = trackedCompletion;
  }

  /** ACK 只影响 Worker 清理进度，不阻塞当前帧；在途期间合并到最新 Tick。 */
  private acknowledgePresentedTick(tickNumber: number): void {
    this.pendingPlaybackAckTickNumber = Math.max(
      this.pendingPlaybackAckTickNumber ?? tickNumber,
      tickNumber,
    );
    this.flushPlaybackAcknowledgement();
  }

  private flushPlaybackAcknowledgement(): void {
    if (
      this.playbackAckRequestInFlight
      || this.pendingPlaybackAckTickNumber === null
    ) {
      return;
    }

    const generation = this.playbackHotQueueGeneration;
    const tickNumber = this.pendingPlaybackAckTickNumber;
    this.pendingPlaybackAckTickNumber = null;
    this.playbackAckRequestInFlight = true;
    void this.context.bridge.acknowledgePresentedTick(tickNumber, generation)
      .then((response) => {
        if (
          generation === this.playbackHotQueueGeneration
          && response.generation === generation
        ) {
          runInAction(() => {
            this.context.stateReadWrite.runtimeStatus = response.status;
          });
        }
      })
      .catch((error: unknown) => {
        if (generation === this.playbackHotQueueGeneration) {
          console.error("[SimHost] Failed to acknowledge presented tick.", error);
        }
      })
      .finally(() => {
        this.playbackAckRequestInFlight = false;
        this.flushPlaybackAcknowledgement();
      });
  }

  /** 使所有已缓存及在途范围响应失效；异步响应由 generation 检查丢弃。 */
  public resetPlaybackHotQueue(): void {
    this.playbackHotQueueGeneration += 1;
    this.playbackHotQueue.clear();
    this.playbackPrefetchRetryAfterMs = 0;
    this.pendingPlaybackAckTickNumber = null;
    this.playbackTickRequestInFlight = false;
    this.playbackTickRequestCompletion = null;
  }

  public async recoverPlaybackFromUnavailableTick(
    status: Extract<SimulationTickPullStatus, { readonly status: "not-found" }>,
    fallbackPlaybackTickNumber: number,
  ): Promise<void> {
    const recoveryTickNumber = status.retainedFromTick
      ?? this.context.presentation.currentSnapshot?.tickNumber
      ?? status.latestTickNumber;
    if (recoveryTickNumber === null || recoveryTickNumber === undefined) {
      runInAction(() => {
        this.context.stateReadWrite.currentPlaybackTickNumber = fallbackPlaybackTickNumber;
        this.playbackTargetTickNumber = fallbackPlaybackTickNumber;
        this.context.syncTimelineCursorFromPlayback({ retargetWindow: false });
      });
      await this.context.restartTimelineAfterPlaybackRollbackIfNeeded();
      return;
    }

    const recoveryStatus = await this.context.syncToTick(recoveryTickNumber, recoveryTickNumber);
    if (recoveryStatus.status !== "ready") {
      runInAction(() => {
        this.context.stateReadWrite.currentPlaybackTickNumber = fallbackPlaybackTickNumber;
        this.playbackTargetTickNumber = fallbackPlaybackTickNumber;
        this.context.syncTimelineCursorFromPlayback({ retargetWindow: false });
      });
    }
    await this.context.restartTimelineAfterPlaybackRollbackIfNeeded();
  }

  public beginTopologyPresentationBoundary(
    maxPlaybackTickNumber: number,
  ): TopologyPresentationBoundary {
    let hasResolved = false;
    let resolvePromise: (() => void) | null = null;
    const reached = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const boundary: TopologyPresentationBoundary = {
      maxPlaybackTickNumber,
      reached,
      resolveReached: () => {
        if (hasResolved) {
          return;
        }
        hasResolved = true;
        resolvePromise?.();
      },
    };
    this.topologyPresentationBoundary = boundary;
    this.resolveReachedTopologyPresentationBoundary();
    return boundary;
  }

  private resolveReachedTopologyPresentationBoundary(): void {
    const boundary = this.topologyPresentationBoundary;
    if (
      boundary !== null
      && this.context.stateReadWrite.currentPlaybackTickNumber >= boundary.maxPlaybackTickNumber
    ) {
      boundary.resolveReached();
    }
  }

  public completeTopologyPresentationBoundary(snapToBoundary: boolean): void {
    const boundary = this.topologyPresentationBoundary;
    if (boundary === null) {
      return;
    }
    if (snapToBoundary) {
      this.context.stateReadWrite.currentPlaybackTickNumber = Math.max(
        this.context.stateReadWrite.currentPlaybackTickNumber,
        boundary.maxPlaybackTickNumber,
      );
      this.playbackTargetTickNumber = Math.max(
        this.playbackTargetTickNumber,
        boundary.maxPlaybackTickNumber,
      );
      this.context.syncTimelineCursorFromPlayback();
    }
    this.releaseTopologyPresentationBoundary(boundary);
  }

  public releaseTopologyPresentationBoundary(
    boundary: TopologyPresentationBoundary | null,
  ): void {
    if (boundary === null) {
      return;
    }
    boundary.resolveReached();
    if (this.topologyPresentationBoundary === boundary) {
      this.topologyPresentationBoundary = null;
    }
  }

  /** 累积 tick 和时间，每 TPS_WINDOW_MS 刷新一次 TPS 统计 */
  private accumulateTps(deltaMs: number, actualTicks: number): void {
    this.tickRateWindow.record(deltaMs, actualTicks);
  }

}
