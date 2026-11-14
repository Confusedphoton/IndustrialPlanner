import {
  createSimulationStateReadWrite,
  type SimulationStateReadWrite,
  type RuntimeTickSnapshot,
} from "../contracts";

/** Legacy 的完整快照不参与公共状态，也不需要 MobX 深度观察。 */
export interface LegacyPresentationState {
  currentSnapshot: RuntimeTickSnapshot | null;
}

export interface LegacySimulationState {
  readonly state: SimulationStateReadWrite;
  readonly presentation: LegacyPresentationState;
}

export function createLegacySimulationState(): LegacySimulationState {
  return { state: createSimulationStateReadWrite(), presentation: { currentSnapshot: null } };
}

