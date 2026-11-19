import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
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
  vi.restoreAllMocks();
});

describe("eyedropper", () => {
  it("picks up a placed device's type, recipe and facing with a pen barrel tap", async () => {
    const { appHost, recipeId } = await createAppHostWithGrinder();
    const editor = appHost.workspace.editor!;

    penTap(appHost, cellCenter(appHost, { x: 21, y: 21 }), { button: 2, pointerId: 1 });

    const runtime = appHost.mainCanvas.state.runtime;
    expect(appHost.mainCanvas.state.activeTool).toBe("single-placement");
    expect(runtime.singlePlacementDeviceId).toBe("grinder_1");
    const preview = editor.queries.getEntityById(editor.state.collections.preview[0]!)!;
    expect(preview.rotation).toBe(90);
    expect(Object.values(preview.config.channelRecipes as Record<string, string>)).toContain(recipeId);
  });

  it.each(["pen", "touch"])("picks up a device on %s hold and lift without moving it", async (pointerType) => {
    const { appHost, editor } = await createAppHostWithGrinder();
    const position = cellCenter(appHost, { x: 21, y: 21 });
    const pointer = {
      pointerId: 1, pointerType, clientX: position.x, clientY: position.y, button: 0, buttons: 1,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    };
    vi.useFakeTimers();
    try {
      appHost.gestureAdapter.handlePointerDown(pointer);
      vi.advanceTimersByTime(600);
      appHost.gestureAdapter.handlePointerUp({ ...pointer, buttons: 0 });
    } finally {
      vi.useRealTimers();
    }
    expect(appHost.mainCanvas.state.activeTool).toBe("single-placement");
    expect(editor.document.getSnapshot().entities.grinder?.position).toEqual({ x: 20, y: 20 });
    expect(editor.queries.getEntityById(editor.state.collections.preview[0]!)?.rotation).toBe(90);
  });

  it("keeps a barrel tap on empty canvas as the way to put the device down", async () => {
    const { appHost } = await createAppHostWithGrinder();
    penTap(appHost, cellCenter(appHost, { x: 21, y: 21 }), { button: 2, pointerId: 1 });

    penTap(appHost, cellCenter(appHost, { x: 60, y: 60 }), { button: 2, pointerId: 2 });

    expect(appHost.mainCanvas.state.activeTool).toBe("select");
  });
});

describe("one-handed placement", () => {
  it("holds the footprint in place while orbiting and commits the facing on lift", async () => {
    const { appHost, editor } = await createAppHostWithGrinder();
    penTap(appHost, cellCenter(appHost, { x: 21, y: 21 }), { button: 2, pointerId: 1 });
    const position = cellCenter(appHost, { x: 32, y: 33 });
    const pointer = (at: typeof position, buttons: number) => ({
      pointerId: 11, pointerType: "pen", clientX: at.x, clientY: at.y, button: 0, buttons,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    });
    vi.useFakeTimers();
    try {
      appHost.gestureAdapter.handlePointerMove(pointer(position, 0));
      appHost.gestureAdapter.handlePointerDown(pointer(position, 1));
      vi.advanceTimersByTime(600);
      const south = { x: position.x, y: position.y + 40 };
      appHost.gestureAdapter.handlePointerMove(pointer(south, 1));
      appHost.gestureAdapter.advanceFrame(0);
      appHost.gestureAdapter.handlePointerUp(pointer(south, 0));
    } finally {
      vi.useRealTimers();
    }
    const placed = Object.values(editor.document.getSnapshot().entities).find((entity) => entity.id !== "grinder");
    expect(placed?.rotation).toBe(180);
    expect(placed?.position.y).toBeLessThan(33);
    expect(placed?.position.y).toBeGreaterThan(29);
  });

  it.each([false, true])("returns a held device to the hotbar on an edge flick (continuous placement: %s)", async (continuous) => {
    const { appHost, editor } = await createAppHostWithGrinder();
    penTap(appHost, cellCenter(appHost, { x: 21, y: 21 }), { button: 2, pointerId: 1 });
    runInAction(() => { appHost.mainCanvas.state.runtime.singlePlacementContinuous = continuous; });
    const { left, width, top } = appHost.mainCanvas.unobstructedClientRect;
    let now = 0;
    vi.spyOn(appHost.gestureAdapter, "tapTimeMs").mockImplementation(() => (now += 12));
    penDrag(appHost, { x: left + width - 200, y: top + 350 }, { x: left + width - 2, y: top + 350 }, 11);

    expect(appHost.mainCanvas.state.activeTool).toBe("select");
    expect(editor.document.getSnapshot().entityOrder).toEqual(["grinder"]);
  });
});

describe("painting a row", () => {
  it("lays copies at footprint pitch along a pen drag and places them as one undo step", async () => {
    const { appHost, recipeId } = await createAppHostWithGrinder();
    const editor = appHost.workspace.editor!;
    penTap(appHost, cellCenter(appHost, { x: 21, y: 21 }), { button: 2, pointerId: 1 });
    runInAction(() => { appHost.mainCanvas.state.runtime.singlePlacementContinuous = true; });
    const width = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview)!.width;

    const start = cellCenter(appHost, { x: 31, y: 31 });
    const end = cellCenter(appHost, { x: 31 + width * 3, y: 32 });
    penDrag(appHost, start, end, 3);

    const grinders = () => Object.values(editor.document.getSnapshot().entities).filter((entity) => entity.definitionId === "grinder_1");
    expect(grinders()).toHaveLength(5);
    expect(grinders().every((entity) => entity.rotation === 90
      && Object.values(entity.config.channelRecipes as Record<string, string>).includes(recipeId))).toBe(true);
    expect(appHost.mainCanvas.state.activeTool).toBe("single-placement");
    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(grinders()).toHaveLength(1);
  });
});

describe("multi-finger taps", () => {
  it("undoes with a two-finger tap and redoes with a three-finger tap", async () => {
    const { appHost } = await createAppHostWithGrinder();
    const editor = appHost.workspace.editor!;
    editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "grinder" });
    editor.actions.deleteCollection(EntityCollectionType.selection);
    expect(editor.document.getSnapshot().entities.grinder).toBeUndefined();

    fingerTap(appHost, 2);
    expect(editor.document.getSnapshot().entities.grinder).toBeDefined();

    fingerTap(appHost, 3);
    expect(editor.document.getSnapshot().entities.grinder).toBeUndefined();
  });
});

async function createAppHostWithGrinder(): Promise<{ appHost: AppHost; recipeId: string; editor: ReturnType<typeof createEditorTestHost> }> {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null,
  };
  const editor = createEditorTestHost(workspace);
  editors.add(editor);
  await editor.internalDocuments.ready();
  const recipeId = workspace.registry.queries.findRecipeDefinitionsByMachine("grinder_1")[0]!.id;
  const channelId = workspace.registry.queries.findEntityDefinition("grinder_1")!.recipeChannels
    .find((channel) => channel.type !== "consumption-channel")!.id;
  const grinder: WorldEntity = {
    id: "grinder", definitionId: "grinder_1", position: { x: 20, y: 20 }, rotation: 90,
    config: { channelRecipes: { [channelId]: recipeId } }, tags: [],
  };
  const entities = [grinder];
  editor.internalDocument.setSnapshot({
    ...createWorldDocument({ baseId: "wuling_protocol_core" }),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  });
  const appHost = createAppTestHost(workspace);
  appHost.mainCanvas.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1600, height: 1200 });
  appHost.mainCanvas.view.actions.focusOnBounds({ x: 32, y: 32, width: 0, height: 0 }, { durationMs: 0, gridSize: 1 });
  return { appHost, recipeId, editor };
}

function cellCenter(appHost: AppHost, cell: GridPoint) {
  const rect = appHost.mainCanvas.view.queries.findClientRectForGridCell(cell)!;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function penTap(appHost: AppHost, at: { x: number; y: number }, options: { button: number; pointerId: number }): void {
  const pointer = (buttons: number) => ({
    pointerId: options.pointerId, pointerType: "pen", clientX: at.x, clientY: at.y, button: options.button, buttons,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  });
  appHost.gestureAdapter.handlePointerDown(pointer(options.button === 2 ? 2 : 1));
  appHost.gestureAdapter.handlePointerUp(pointer(0));
}

function fingerTap(appHost: AppHost, fingers: number): void {
  const touch = (index: number) => ({
    pointerId: 100 + index, pointerType: "touch", clientX: 400 + index * 60, clientY: 400, button: 0, buttons: 1,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  });
  for (let index = 0; index < fingers; index += 1) appHost.gestureAdapter.handlePointerDown(touch(index));
  for (let index = 0; index < fingers; index += 1) appHost.gestureAdapter.handlePointerUp({ ...touch(index), buttons: 0 });
}

function penDrag(appHost: AppHost, from: { x: number; y: number }, to: { x: number; y: number }, pointerId: number): void {
  const pointer = (at: { x: number; y: number }, buttons: number) => ({
    pointerId, pointerType: "pen", clientX: at.x, clientY: at.y, button: 0, buttons,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  });
  appHost.gestureAdapter.handlePointerMove(pointer(from, 0));
  appHost.gestureAdapter.handlePointerDown(pointer(from, 1));
  for (let step = 1; step <= 6; step += 1) {
    appHost.gestureAdapter.handlePointerMove(pointer({
      x: from.x + (to.x - from.x) * step / 6,
      y: from.y + (to.y - from.y) * step / 6,
    }, 1));
    appHost.gestureAdapter.advanceFrame(step * 16);
  }
  appHost.gestureAdapter.handlePointerUp(pointer(to, 0));
}
