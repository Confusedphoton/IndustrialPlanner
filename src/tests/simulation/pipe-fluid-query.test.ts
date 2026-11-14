import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest"

import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import { createWorkspaceState } from "@/domain/document/workspace-state"
import { createRegistryContract } from "@/registry"
import { createSimulationHost } from "@/simulation/simulation-host";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store"


describe("Simulation pipe fluid query", () => {
  it("returns filled strict-pipe fluid while running or paused and hides after stop", async () => {
    const workspace = createWorkspace()
    const host = createSimulationHost(workspace, {
      workerMode: "runtime",
    })

    try {
      await host.actions.start()
      const tickStatus = await host.internalActions.syncToTick(10)

      expect(tickStatus.status).toBe("ready")
      expect(host.queries.getPipeFluidItemId("pipe")).toBe("item_liquid_water")
      expect(host.queries.getPipeFluidItemId("source-liquid-storage")).toBeNull()

      host.actions.pause()
      expect(host.queries.getPipeFluidItemId("pipe")).toBe("item_liquid_water")

      host.actions.stop()
      expect(host.queries.getPipeFluidItemId("pipe")).toBeNull()
    } finally {
      host.dispose()
    }
  })
})

function createWorkspace(): WorkspaceContract {
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/pipe-fluid-query/scene-01-pipe-fluid-query-f1fc4156.schema7.json")
  const document = createSnapshotStore(createWorldDocumentFromBlueprint(blueprint))

  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: {
      document,
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
    sync: null,
    audio: null,
  }
}
