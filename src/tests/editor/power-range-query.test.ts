import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorldDocument } from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createRegistryContract } from "@/registry";

describe("EditorQuery.listPowerRangeProvidersCoveringGridRect", () => {
  let editorHost: ReturnType<typeof createEditorTestHost> | null = null;

  afterEach(() => {
    editorHost?.dispose();
    editorHost = null;
    localStorage.clear();
  });

  it("returns every power pole whose range intersects the queried footprint", () => {
    const workspace = createWorkspace();
    editorHost = createEditorTestHost(workspace);
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/editor/power-range-query/scene-01-variant-1.schema7.json"));
    const document = createWorldDocument();
    document.entities = Object.fromEntries(entities.map((entity) => [entity.id, entity]));
    document.entityOrder = entities.map((entity) => entity.id);
    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.queries.listPowerRangeProvidersCoveringGridRect({
      x: 5,
      y: 0,
      width: 3,
      height: 3,
    }).map((entity) => entity.id)).toEqual(["power-a", "power-b"]);
  });
});

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

