import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, expect, it, vi } from "vitest";

import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import {
  buildBaseBuiltinEntityId,
  type BaseBuiltinEntityDefinition,
} from "@/domain/registry/types/base-definition";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createWarehouseSlotLink } from "./blueprint-test-helpers";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

const TEST_BUILTIN_BASE_ID = "test_simulation_builtin_base";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
    audio: null,
  };
}


function createDocumentWithEntities(
  entities: readonly WorldEntity[],
  baseId?: string,
): WorldDocument {
  return {
    ...createWorldDocument({ baseId }),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  };
}

function registerBuiltinBase(
  workspace: WorkspaceContract,
  builtinEntities: readonly BaseBuiltinEntityDefinition[],
): void {
  workspace.registry.baseDefinitions = [
    ...workspace.registry.baseDefinitions,
    {
      id: TEST_BUILTIN_BASE_ID,
      name: "测试仿真内置设备基地",
      areas: [{
        id: TEST_BUILTIN_BASE_ID,
        bounds: { minX: 0, maxX: 40, minY: 0, maxY: 40 },
        outerRing: { top: 0, right: 0, bottom: 0, left: 0 },
      }],
      tag: "测试",
      tags: [],
      builtinEntities,
    },
  ];
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describeSimulationEngineMatrix("invalid placement simulation compile", (engineKind) => {
  it("treats invalid placement entities as absent when compiling topology", async () => {
    const workspace = createWorkspace();
    const editorHost = createEditorTestHost(workspace);
    const document = createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/scene-01-variant-1.schema7.json")));

    editorHost.internalDocument.setSnapshot(document);

    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement],
    ).toEqual(["outside-belt"]);

    const simulationHost = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      const result = await simulationHost.internalActions.refreshFromCurrentDocument();
      const topology = simulationHost.topology.getSnapshot();

      expect(result.status).toBe("started");
      expect(topology?.devices["device:outside-belt"]).toBeUndefined();
      expect(topology?.devices["device:valid-pipe"]).toBeDefined();
    } finally {
      simulationHost.dispose();
    }
  });

  it("compiles base builtin entities and resolves document slot links to them", async () => {
    const workspace = createWorkspace();
    const builtinEntityId = buildBaseBuiltinEntityId({
      baseId: TEST_BUILTIN_BASE_ID,
      builtinEntityId: "storage",
    });
    registerBuiltinBase(workspace, [
      {
        id: "storage",
        definitionId: "storager_1",
        position: { x: 0, y: 0 },
        rotation: 0,
      },
    ]);
    const editorHost = createEditorTestHost(workspace);
    const document = {
      ...createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/scene-02-variant-1.schema7.json")), TEST_BUILTIN_BASE_ID),
      slotLinks: [
        {
          id: "builtin-storage-link",
          linkType: "share-all",
          source: {
            entityId: builtinEntityId,
            storageSlotGroupId: "storage_slot_1",
            slotId: "slot_1",
          },
          target: {
            entityId: "document-storage",
            storageSlotGroupId: "storage_slot_1",
            slotId: "slot_1",
          },
        },
      ],
    } satisfies WorldDocument;

    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.document.getSnapshot().entities[builtinEntityId]).toBeUndefined();

    const simulationHost = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      const result = await simulationHost.internalActions.refreshFromCurrentDocument();
      const topology = simulationHost.topology.getSnapshot();

      expect(result.status).toBe("started");
      expect(topology?.devices[`device:${builtinEntityId}`]).toBeDefined();
      expect(topology?.devices["device:document-storage"]).toBeDefined();
      expect(topology?.links["document-link:builtin-storage-link"]).toBeDefined();
    } finally {
      simulationHost.dispose();
    }
  });

  it("keeps warehouse ports connected to valley4 non-core builtin bus seeds in simulation topology", async () => {
    const workspace = createWorkspace();
    const editorHost = createEditorTestHost(workspace);
    const document = {
      ...createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/scene-03-variant-1.schema7.json")), "valley4_infra_outpost"),
      slotLinks: [
        createWarehouseSlotLink("unloader", "item_plant_moss_3"),
      ],
    } satisfies WorldDocument;

    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.state.collections[EntityCollectionType.invalidPlacement].contains("unloader"))
      .toBe(false);

    const simulationHost = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      const result = await simulationHost.internalActions.refreshFromCurrentDocument();
      const topology = simulationHost.topology.getSnapshot();
      const warehouseLink = topology?.links["document-link:warehouse-link:unloader:unloader_buffer:slot_1"];

      expect(result.status).toBe("started");
      expect(topology?.devices["device:unloader"]).toBeDefined();
      expect(warehouseLink).toBeDefined();
      expect(warehouseLink?.sourceSlotIds.length).toBeGreaterThan(0);
      expect(warehouseLink?.targetSlotIds.length).toBeGreaterThan(0);
    } finally {
      simulationHost.dispose();
    }
  });
});
