// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SyncInitialSyncFeatureGate,
  SyncInitialSyncGate,
} from "@/app/shell/layout/sync-initial-sync-gate";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import type { SyncContract, SyncInitialSyncStage } from "@/domain/sync";
import { SyncStateImpl } from "@/sync/sync-state-impl";

describe("SyncInitialSyncGate", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: SyncStateImpl;
  let sync: SyncContract;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    state = new SyncStateImpl();
    state.setSettings({
      enabled: true,
      url: "https://dav.example.test",
      username: "",
      password: "",
      maxConcurrentRequests: 4,
    });
    sync = {
      state,
      actions: {
        resolveConflicts: vi.fn(),
        syncNow: vi.fn(async () => undefined),
        deleteRemoteData: vi.fn(async () => undefined),
        updateSettings: vi.fn(),
        abortCurrentTransaction: vi.fn(async () => undefined),
      },
      queries: {},
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("blocks the whole workbench only while the current canvas is checking", () => {
    act(() => {
      setInitialStage(state, "canvas");
      state.setStatus({
        ...state.status,
        tasks: [{
          kind: "canvas",
          phase: "running",
          direction: null,
          completedUnitCount: 55,
          totalUnitCount: 100,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastError: null,
        }],
      });
      root.render(
        <OverlayStackProvider>
          <SyncInitialSyncGate sync={sync} translate={(key) => key} />
        </OverlayStackProvider>,
      );
    });

    expect(document.querySelector(
      "[data-sync-initial-sync-stage='canvas']",
    )).not.toBeNull();
    expect(document.querySelector(
      "[data-sync-initial-sync-progress]",
    )).toHaveProperty("value", 55);
    expect(document.querySelector("output")?.textContent).toBe("55%");
    expect(document.querySelector("section")?.getAttribute("aria-label"))
      .toBe("syncInitialSync.canvasSyncing");

    act(() => {
      setInitialStage(state, "blueprints");
    });
    expect(document.querySelector(
      "[data-sync-initial-sync-stage='canvas']",
    )).toBeNull();
  });

  it("unlocks feature gates only after their first sync stage completes", () => {
    act(() => {
      setInitialStage(state, "blueprints");
      root.render(
        <>
          <SyncInitialSyncFeatureGate
            feature="blueprints"
            state={state}
            translate={(key) => key}
          >
            <span data-feature-content="blueprints" />
          </SyncInitialSyncFeatureGate>
          <SyncInitialSyncFeatureGate
            feature="modules"
            state={state}
            translate={(key) => key}
          >
            <span data-feature-content="modules" />
          </SyncInitialSyncFeatureGate>
        </>,
      );
    });

    expect(container.querySelector(
      "[data-sync-initial-sync-feature='blueprints']",
    )).not.toBeNull();
    expect(container.querySelector("[data-feature-content='blueprints']")).toBeNull();

    act(() => {
      setInitialStage(state, "modules");
    });
    expect(container.querySelector("[data-feature-content='blueprints']")).not.toBeNull();
    expect(container.querySelector("[data-feature-content='modules']")).toBeNull();

    act(() => {
      setInitialStage(state, "toolbox");
    });
    expect(container.querySelector("[data-feature-content='modules']")).not.toBeNull();

    act(() => {
      state.setStatus({
        ...state.status,
        phase: "downloading",
        initialSyncStage: "canvas",
        hasCompletedInitialFeatureSync: true,
      });
    });
    expect(container.querySelector("[data-feature-content='blueprints']")).not.toBeNull();
    expect(container.querySelector("[data-feature-content='modules']")).not.toBeNull();
  });
});

function setInitialStage(
  state: SyncStateImpl,
  initialSyncStage: SyncInitialSyncStage,
): void {
  state.setStatus({
    ...state.status,
    phase: initialSyncStage === "ready" ? "idle" : "downloading",
    initialSyncStage,
  });
}
