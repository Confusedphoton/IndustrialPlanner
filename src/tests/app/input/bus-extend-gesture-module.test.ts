import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import type { GridPoint } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";
import { createAppTestHost, createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../../shared/fake-indexed-db";

const editors = new Set<ReturnType<typeof createEditorTestHost>>();

beforeEach(() => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
});

afterEach(async () => {
  try {
    for (const editor of editors) {
      await editor.internalHistory.flush();
      await editor.internalDocuments.flush();
      await editor.internalDocuments.settleMaintenance();
    }
  } finally {
    for (const editor of editors) editor.dispose();
    editors.clear();
  }
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("dragging a depot bus port out into bus sections", () => {
  it("lays one section per 8 cells along the drag and commits them as one undo step", async () => {
    const appHost = await createAppHostWithBus([source({ x: 20, y: 20 })]);

    penDrag(appHost, { x: 21, y: 21 }, [{ x: 30, y: 21 }, { x: 40, y: 22 }]);

    expect(segments(appHost)).toEqual([
      { position: { x: 24, y: 20 }, rotation: 90 },
      { position: { x: 32, y: 20 }, rotation: 90 },
      { position: { x: 40, y: 20 }, rotation: 90 },
    ]);
    expect(appHost.workspace.editor!.actions.undoDocumentHistory()).toBe(true);
    expect(segments(appHost)).toEqual([]);
  });

  it("continues past the sections already attached in the drag direction", async () => {
    const appHost = await createAppHostWithBus([
      source({ x: 20, y: 20 }),
      { id: "existing", definitionId: "log_hongs_bus", position: { x: 20, y: 24 }, rotation: 0, config: {}, tags: [] },
    ]);

    penDrag(appHost, { x: 21, y: 21 }, [{ x: 21, y: 30 }, { x: 21, y: 34 }]);

    expect(segments(appHost)).toEqual([
      { position: { x: 20, y: 24 }, rotation: 0 },
      { position: { x: 20, y: 32 }, rotation: 0 },
    ]);
  });

  it("extends a section only along its own direction", async () => {
    const appHost = await createAppHostWithBus([
      source({ x: 20, y: 20 }),
      { id: "existing", definitionId: "log_hongs_bus", position: { x: 24, y: 20 }, rotation: 90, config: {}, tags: [] },
    ]);

    penDrag(appHost, { x: 26, y: 21 }, [{ x: 26, y: 30 }, { x: 26, y: 40 }]);

    expect(segments(appHost)).toHaveLength(1);
  });
});

function source(position: GridPoint): WorldEntity {
  return { id: "source", definitionId: "log_hongs_bus_source", position, rotation: 0, config: {}, tags: [] };
}

function segments(appHost: AppHost) {
  return Object.values(appHost.workspace.editor!.document.getSnapshot().entities)
    .filter((entity) => entity.definitionId === "log_hongs_bus")
    .map(({ position, rotation }) => ({ position, rotation }))
    .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y);
}

async function createAppHostWithBus(entities: readonly WorldEntity[]): Promise<AppHost> {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null,
  };
  const editor = createEditorTestHost(workspace);
  editors.add(editor);
  await editor.internalDocuments.ready();
  editor.internalDocument.setSnapshot({
    ...createWorldDocument({ baseId: "wuling_protocol_core" }),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  });
  const appHost = createAppTestHost(workspace);
  appHost.mainCanvas.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1600, height: 1200 });
  appHost.mainCanvas.view.actions.focusOnBounds({ x: 32, y: 32, width: 0, height: 0 }, { durationMs: 0, gridSize: 1 });
  return appHost;
}

function cellCenter(appHost: AppHost, cell: GridPoint) {
  const rect = appHost.mainCanvas.view.queries.findClientRectForGridCell(cell)!;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function penDrag(appHost: AppHost, from: GridPoint, path: readonly GridPoint[]): void {
  const pointer = (cell: GridPoint, buttons: number) => {
    const { x, y } = cellCenter(appHost, cell);
    return { pointerId: 7, pointerType: "pen", clientX: x, clientY: y, button: 0, buttons,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  };
  appHost.gestureAdapter.handlePointerDown(pointer(from, 1));
  for (const cell of path) {
    appHost.gestureAdapter.handlePointerMove(pointer(cell, 1));
    appHost.gestureAdapter.advanceFrame(0);
  }
  appHost.gestureAdapter.handlePointerUp(pointer(path.at(-1)!, 0));
}
