import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { expect, it } from "vitest";

import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import type { WorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

describeSimulationEngineMatrix("runtime slot patch", (engineKind) => {
  it("patches current simulation slot state without persisting to initial config", async () => {
    const documentStore = createSnapshotStore(createWorldDocumentFromBlueprint(
      loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/runtime-slot-patch/scene-01-runtime-slot-patch-45d43076.schema7.json"),
    ));
    const workspace = createWorkspace(documentStore);
    const simulationHost = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      await simulationHost.actions.start();

      expect(readSlot(simulationHost, "storage", "storage_slot_1", "slot_1"))
        .toMatchObject({
          itemType: null,
          count: 0,
          ignoreStock: false,
        });

      await simulationHost.actions.patchRuntimeSlot({
        entityId: "storage",
        storageGroupId: "storage_slot_1",
        slotId: "slot_1",
        itemType: "item_copper_ore",
        count: 11,
        ignoreStock: true,
      });

      expect(readSlot(simulationHost, "storage", "storage_slot_1", "slot_1"))
        .toMatchObject({
          itemType: "item_copper_ore",
          count: 11,
          ignoreStock: true,
        });

      simulationHost.actions.stop();
      await simulationHost.actions.start();

      expect(readSlot(simulationHost, "storage", "storage_slot_1", "slot_1"))
        .toMatchObject({
          itemType: null,
          count: 0,
          ignoreStock: false,
        });
    } finally {
      simulationHost.dispose();
    }
  });
});

function createWorkspace(
  documentSnapshot: SnapshotStoreReadWrite<WorldDocument>,
): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: {
      document: documentSnapshot,
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
    sync: null,
    audio: null,
  };
}

function readSlot(
  simulationHost: ReturnType<typeof createSimulationHost>,
  entityId: string,
  storageGroupId: string,
  slotId: string,
) {
  const status = simulationHost.queries.getDeviceRuntimeStatus(entityId);
  return status?.slotItems.find((slot) =>
    slot.storageGroupId === storageGroupId && slot.slotId === slotId,
  ) ?? null;
}
