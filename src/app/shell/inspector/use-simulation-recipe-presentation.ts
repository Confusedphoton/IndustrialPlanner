import { useEffect, useState } from "react";

import type {
  SimulationDocumentRuntimeReadModel,
} from "@/domain/simulation/types/simulation-types";
import type { SimulationRecipePresentationState } from "@/shared/simulation-recipe-progress";
import type { InspectorRuntimeSample } from "./selection-inspector-model";

export interface SimulationRecipePresentationClock {
  readonly documentStatus: SimulationDocumentRuntimeReadModel | null;
  readonly simulationState: SimulationRecipePresentationState | null;
  readonly elapsedWallSeconds: number;
}

export interface SimulationRecipePresentationClockState {
  readonly presentationKey: string;
  readonly active: boolean;
  readonly nowMs: number;
  readonly observedAtMs: number | null;
}

export function resetSimulationRecipePresentationClock(
  current: SimulationRecipePresentationClockState,
  input: Pick<SimulationRecipePresentationClockState, "presentationKey" | "active"> & {
    readonly sampledAtMs?: number;
  },
): SimulationRecipePresentationClockState {
  return {
    ...input,
    nowMs: current.nowMs,
    observedAtMs: current.active === input.active ? input.sampledAtMs ?? null : null,
  };
}

export function advanceSimulationRecipePresentationClock(
  current: SimulationRecipePresentationClockState,
  input: {
    readonly presentationKey: string;
    readonly active: boolean;
    readonly nowMs: number;
  },
): SimulationRecipePresentationClockState {
  if (
    current.active !== input.active
    || current.presentationKey !== input.presentationKey
    || current.observedAtMs === null
  ) {
    return {
      ...input,
      observedAtMs: input.nowMs,
    };
  }
  return input.active
    ? { ...current, nowMs: input.nowMs }
    : current;
}

export function useSimulationRecipePresentation(
  sample: InspectorRuntimeSample | null,
  shouldAnimate: boolean,
): SimulationRecipePresentationClock {
  const documentStatus = sample?.documentStatus ?? null;
  const running = sample?.simulationState.runningState === "start";
  const seeking = sample?.simulationState.timeline.isSeeking === true;
  const active = shouldAnimate && running && !seeking;
  const presentationKey = resolvePresentationKey(
    documentStatus,
    sample?.entityId ?? "none",
    sample?.simulationState.simulationSpeed ?? 1,
  );
  const [clock, setClock] = useState<SimulationRecipePresentationClockState>(() => {
    const nowMs = performance.now();
    return {
      presentationKey,
      active,
      nowMs,
      observedAtMs: sample?.sampledAtMs ?? nowMs,
    };
  });

  if (clock.active !== active || clock.presentationKey !== presentationKey) {
    setClock((current) => resetSimulationRecipePresentationClock(current, {
      presentationKey,
      active,
      sampledAtMs: sample?.sampledAtMs,
    }));
  }



  useEffect(() => {
    if (!active || typeof requestAnimationFrame !== "function") {
      return;
    }
    let frameId = 0;
    const update = (frameNowMs: number) => {
      setClock((current) => current.presentationKey === presentationKey
        ? advanceSimulationRecipePresentationClock(current, {
            presentationKey,
            active: true,
            nowMs: frameNowMs,
          })
        : current);
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [active, presentationKey]);

  return {
    documentStatus,
    simulationState: sample?.simulationState ?? null,
    elapsedWallSeconds: Math.max(
      0,
      active
        && clock.active
        && clock.presentationKey === presentationKey
        && clock.observedAtMs !== null
        ? (clock.nowMs - clock.observedAtMs) / 1000
        : 0,
    ),
  };
}

function resolvePresentationKey(
  documentStatus: SimulationDocumentRuntimeReadModel | null,
  entityId: string,
  simulationSpeed: number,
): string {
  return documentStatus === null
    ? `${entityId}:none:${simulationSpeed}`
    : `${entityId}:${documentStatus.tickNumber}:${documentStatus.standardTickRate}:${documentStatus.tickRate}:${simulationSpeed}`;
}
