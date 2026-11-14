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
