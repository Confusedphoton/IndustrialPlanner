import type { SimulationStartResult, SimulationTickPullStatus } from "./types";

export interface SimulationInternalAction {
  refreshFromCurrentDocument(): Promise<SimulationStartResult>;
  syncToTick(tickNumber: number, playbackTickNumberOnReady?: number): Promise<SimulationTickPullStatus>;
  /** 同步轻量 Worker 性能统计；不会开启完整 debugData。 */
  setDebugEnabled(value: boolean): void;
  /** 单独控制完整 debugData 的构造与传输。 */
  setDebugDataEnabled(value: boolean): void;
  setSimulationSpeed(value: number): void;
  reset(): void;
}
