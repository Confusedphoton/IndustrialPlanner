import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "./types/simulation-types";
import type {
  SimulationBlueprintRunRequest,
  SimulationBlueprintRunReport,
} from "./types/simulation-blueprint-types";

export interface SimulationAction {
  runBlueprint(request: SimulationBlueprintRunRequest, signal?: AbortSignal): Promise<SimulationBlueprintRunReport>;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  setSimulationSpeed(value: number): void;
  advancePlaybackByDeltaMs(deltaMs: number): Promise<void>;
  patchRuntimeSlot(patch: SimulationRuntimeSlotPatch): Promise<void>;
  resetAdmissionCounter(reset: SimulationAdmissionCounterReset): Promise<void>;
  enableTimeline(): Promise<void>;
  disableTimeline(): void;
  seekTimelineToTick(timelineTickNumber: number): Promise<boolean>;
}
