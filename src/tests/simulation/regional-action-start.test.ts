import { describe, expect, it, vi } from "vitest";

import { createRegistryContract } from "@/registry";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createSimulationHost } from "@/simulation/simulation-host";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";
import regionalOutletJson from "../fixtures/blueprints/simulation/dense-host-regressions/regional-outlet.world.schema7.json";
import type { AppContract } from "@/domain/app/app-contract";

describe("区域多基地启动模式固化", () => {

  it("Legacy 忽略多基地设置并始终启动单基地会话", async () => {
    const registry = createRegistryContract();
    const currentDocument = normalizeWorldDocument(regionalOutletJson)!;
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(),
      registry,
      app: createRegionalMultiBaseAppContract({ regionalMultiBaseEnabled: true }),
      editor: {
        document: createSnapshotStore(currentDocument),
        state: {} as never,
        queries: {} as never,
        actions: {} as never,
      },
      render: null,
      simulation: null,
      sync: null,
      audio: null,
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createSimulationHost(workspace, {
      engineKind: "legacy",
      workerMode: "runtime",
    });

    try {
      await host.actions.start();

      expect(host.state.runningState).toBe("start");
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.singleBase);
      expect(host.internalState.runtimeStatus.error).toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      host.dispose();
      consoleError.mockRestore();
    }
  });
});

function createRegionalMultiBaseAppContract(
  settings: { regionalMultiBaseEnabled: boolean },
): AppContract {
  return {
    state: { settings },
    queries: {},
    actions: {},
  } as unknown as AppContract;
}
