import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
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

describe("rotating the selection from the action strip", () => {
  it("rotates a placed device in place with a pen tap and undoes back", async () => {
    const appHost = await createAppHostWithPlacedDevice();
    const editor = appHost.workspace.editor!;
    const [entityId] = editor.document.getSnapshot().entityOrder;

    penTap(appHost, "canvas-floating-toolbar-button-rotate");

    expect(appHost.mainCanvas.state.activeTool).toBe("select");
    expect(editor.document.getSnapshot().entities[entityId!]?.rotation).toBe(90);
    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(editor.document.getSnapshot().entities[entityId!]?.rotation).toBe(0);
  });

  it("explains a blocked rotation with a canvas toast instead of changing the device", async () => {
    const appHost = await createAppHostWithPlacedDevice();
    const editor = appHost.workspace.editor!;
    const [entityId] = editor.document.getSnapshot().entityOrder;
    const before = editor.document.getSnapshot().entities[entityId!];
    vi.spyOn(editor.actions, "rotateCollection").mockReturnValue({ status: "blocked", reason: "overlap" });

    penTap(appHost, "canvas-floating-toolbar-button-rotate");

    expect(appHost.mainCanvas.state.runtime.canvasToastKey).toBe("placementReason.overlap");
    expect(editor.document.getSnapshot().entities[entityId!]).toEqual(before);
  });
});

describe("double tapping a device to spin it", () => {
  it("rotates a device when the pen taps it twice in quick succession", async () => {
    const appHost = await createAppHostWithPlacedDevice();
    const editor = appHost.workspace.editor!;
    const [entityId] = editor.document.getSnapshot().entityOrder;
    editor.actions.clearCollection(EntityCollectionType.selection);
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);

    penCanvasTap(appHost, entityCenter(appHost, entityId!), 1);
    clock.mockReturnValue(1150);
    penCanvasTap(appHost, entityCenter(appHost, entityId!), 2);

    expect(editor.document.getSnapshot().entities[entityId!]?.rotation).toBe(90);
    expect([...editor.state.collections.selection]).toEqual([entityId]);
  });

  it("keeps a slow second tap as an ordinary tap that toggles the selection", async () => {
    const appHost = await createAppHostWithPlacedDevice();
    const editor = appHost.workspace.editor!;
    const [entityId] = editor.document.getSnapshot().entityOrder;
    editor.actions.clearCollection(EntityCollectionType.selection);
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);

    penCanvasTap(appHost, entityCenter(appHost, entityId!), 1);
    clock.mockReturnValue(2000);
    penCanvasTap(appHost, entityCenter(appHost, entityId!), 2);

    expect(editor.document.getSnapshot().entities[entityId!]?.rotation).toBe(0);
    expect(editor.state.collections.selection.length).toBe(0);
  });

  it("spins a device tapped again right after the pen tap that placed it", async () => {
    const appHost = await createAppHostWithPlacedDevice();
    const editor = appHost.workspace.editor!;
    const position = { x: 300, y: 300 };
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "ui-left-dock-placement-mode-storager_1-mouse-tap", button: 0,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    });
    penCanvasMove(appHost, position, 1);
    penCanvasTap(appHost, position, 2);
    const placedId = editor.document.getSnapshot().entityOrder.at(-1)!;
    expect(appHost.mainCanvas.state.activeTool).toBe("select");

    clock.mockReturnValue(1150);
    penCanvasTap(appHost, position, 3);

    expect(editor.document.getSnapshot().entities[placedId]?.rotation).toBe(90);
  });
});

function entityCenter(appHost: AppHost, entityId: string): { x: number; y: number } {
  const entity = appHost.workspace.editor!.document.getSnapshot().entities[entityId]!;
  const cell = appHost.mainCanvas.view.queries.findClientRectForGridCell({ x: entity.position.x + 1, y: entity.position.y + 1 })!;
  return { x: cell.left + cell.width / 2, y: cell.top + cell.height / 2 };
}

function penPointer(position: { x: number; y: number }, pointerId: number, buttons: number) {
  return {
    pointerId, pointerType: "pen", clientX: position.x, clientY: position.y, button: 0, buttons,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  };
}

function penCanvasMove(appHost: AppHost, position: { x: number; y: number }, pointerId: number): void {
  appHost.gestureAdapter.handlePointerMove(penPointer(position, pointerId, 0));
}

function penCanvasTap(appHost: AppHost, position: { x: number; y: number }, pointerId: number): void {
  appHost.gestureAdapter.handlePointerDown(penPointer(position, pointerId, 1));
  appHost.gestureAdapter.handlePointerUp(penPointer(position, pointerId, 0));
}

async function createAppHostWithPlacedDevice(): Promise<AppHost> {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null,
  };
  const editor = createEditorTestHost(workspace);
  editors.add(editor);
  await editor.internalDocuments.ready();
  editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "wuling_protocol_core" }));
  const appHost = createAppTestHost(workspace);
  appHost.mainCanvas.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1000, height: 700 });
  penTap(appHost, "ui-left-dock-placement-mode-storager_1-touch-tap");
  penTap(appHost, "canvas-floating-toolbar-button-ok");
  appHost.mainCanvas.actions.setActiveTool("select");
  const [entityId] = editor.document.getSnapshot().entityOrder;
  editor.actions.clearCollection(EntityCollectionType.selection);
  editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: entityId! });
  return appHost;
}

function penTap(appHost: AppHost, uiButtonId: string): void {
  appHost.gestureAdapter.handleUiButtonTouchTap({ uiButtonId, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
}
