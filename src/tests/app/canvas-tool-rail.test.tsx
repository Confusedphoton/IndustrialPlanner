// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOGISTICS_CANCEL_ROUTE_BUTTON_ID,
  LOGISTICS_ROUTE_ORDER_BUTTON_ID,
  PLACEMENT_RAIL_CANCEL_BUTTON_ID,
  PLACEMENT_RAIL_ROTATE_BUTTON_ID,
} from "@/app/input/gesture/actions";
import type { AppHost } from "@/app/host/app-host";
import { recentPlacements } from "@/app/recent-placement-devices";
import { CanvasToolRail } from "@/app/shell/canvas/canvas-tool-rail";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createRegistryContract } from "@/registry";
import { createAppTestHost, createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

const editors = new Set<ReturnType<typeof createEditorTestHost>>();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
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
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("canvas tool rail", () => {
  it("keeps the rail's own buttons unchanged when belt drawing attaches its contextual buttons", async () => {
    const appHost = await createAppHost();
    renderRail(appHost);
    const before = mainRailButtonIds();

    penTap(button("placement-action-line-draw"));

    expect(appHost.mainCanvas.state.activeTool).toBe("logistics-placement");
    expect(mainRailButtonIds()).toEqual(before);
    expect(contextualButtonIds()).toEqual([LOGISTICS_ROUTE_ORDER_BUTTON_ID, LOGISTICS_CANCEL_ROUTE_BUTTON_ID]);
  });

  it("switches the line tool between belt and pipe with a second tap", async () => {
    const appHost = await createAppHost();
    renderRail(appHost);

    penTap(button("placement-action-line-draw"));
    expect(appHost.mainCanvas.state.runtime.logisticsPlacement.kind).toBe("belt");
    penTap(button("placement-action-line-draw"));
    expect(appHost.mainCanvas.state.activeTool).toBe("logistics-placement");
    expect(appHost.mainCanvas.state.runtime.logisticsPlacement.kind).toBe("pipe");
  });

  it("rotates the placement preview from the rail and cancels back to Select", async () => {
    const appHost = await createAppHost();
    renderRail(appHost);
    const before = mainRailButtonIds();
    act(() => {
      appHost.mainCanvas.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1000, height: 700 });
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: "ui-left-dock-placement-mode-storager_1-touch-tap",
        altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
      });
    });
    expect(appHost.mainCanvas.state.activeTool).toBe("single-placement");
    expect(recentPlacements.entries[0]?.deviceId).toBe("storager_1");
    expect(mainRailButtonIds()).toEqual(before);
    expect(contextualButtonIds()).toEqual([PLACEMENT_RAIL_ROTATE_BUTTON_ID, PLACEMENT_RAIL_CANCEL_BUTTON_ID]);

    const rotationBefore = previewRotation(appHost);
    penTap(button(PLACEMENT_RAIL_ROTATE_BUTTON_ID));
    expect(previewRotation(appHost)).not.toBe(rotationBefore);

    penTap(button(PLACEMENT_RAIL_CANCEL_BUTTON_ID));
    expect(appHost.mainCanvas.state.activeTool).toBe("select");
    expect(contextualButtonIds()).toEqual([]);
  });

  it("rotates and cancels a move from the rail like a placement", async () => {
    const appHost = await createAppHost();
    renderRail(appHost);
    const touchTap = (uiButtonId: string) => act(() => {
      appHost.gestureAdapter.handleUiButtonTouchTap({ uiButtonId, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
    });
    act(() => appHost.mainCanvas.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1000, height: 700 }));
    touchTap("ui-left-dock-placement-mode-storager_1-touch-tap");
    touchTap("canvas-floating-toolbar-button-ok");
    const editor = appHost.workspace.editor!;
    const [placedId] = editor.document.getSnapshot().entityOrder;
    expect(placedId).toBeDefined();
    act(() => {
      appHost.mainCanvas.actions.setActiveTool("select");
      editor.actions.clearCollection(EntityCollectionType.selection);
      editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: placedId! });
    });
    touchTap("canvas-floating-toolbar-button-move");
    expect(appHost.mainCanvas.state.activeTool).toBe("move");
    expect(contextualButtonIds()).toEqual([PLACEMENT_RAIL_ROTATE_BUTTON_ID, PLACEMENT_RAIL_CANCEL_BUTTON_ID]);

    const rotationBefore = previewRotation(appHost);
    penTap(button(PLACEMENT_RAIL_ROTATE_BUTTON_ID));
    expect(previewRotation(appHost)).not.toBe(rotationBefore);

    penTap(button(PLACEMENT_RAIL_CANCEL_BUTTON_ID));
    expect(appHost.mainCanvas.state.activeTool).toBe("select");
    expect(editor.document.getSnapshot().entities[placedId!]?.rotation).toBe(0);
    expect(contextualButtonIds()).toEqual([]);
  });

  it("moves the view tools into a More flyout when the canvas is too short for one column", async () => {
    stubShortCanvasLayout(184);
    const appHost = await createAppHost();
    renderRail(appHost);

    expect(container.querySelector('[data-ui-button-id="canvas-tool-rail-zoom-in"]')).toBeNull();
    expect(mainRailButtonIds()).toContain("canvas-tool-rail-undo");

    const more = button("canvas-tool-rail-more");
    act(() => more.click());
    const flyout = container.querySelector<HTMLElement>(`#${more.getAttribute("aria-controls")}`);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(flyout?.querySelector('[data-ui-button-id="canvas-tool-rail-zoom-in"]')).not.toBeNull();
    expect(flyout?.querySelector('[data-ui-button-id="canvas-tool-rail-fit-base"]')).not.toBeNull();

    act(() => {
      flyout!.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[data-ui-button-id="canvas-tool-rail-zoom-in"]')).toBeNull();
  });
});

async function createAppHost(): Promise<AppHost> {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null,
  };
  const editor = createEditorTestHost(workspace);
  editors.add(editor);
  await editor.internalDocuments.ready();
  editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "wuling_protocol_core" }));
  return createAppTestHost(workspace);
}

function renderRail(appHost: AppHost): void {
  act(() => root.render(<CanvasToolRail appHost={appHost} />));
}

function button(uiButtonId: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(`[data-ui-button-id="${uiButtonId}"]`);
  if (element === null) throw new Error(`Missing rail button ${uiButtonId}`);
  return element;
}

function mainRailButtonIds(): string[] {
  const rail = container.querySelector('[role="toolbar"]')!;
  return Array.from(rail.querySelectorAll<HTMLElement>("[data-ui-button-id]"))
    .filter((element) => element.closest('[role="group"]') === null)
    .map((element) => element.dataset.uiButtonId!);
}

function contextualButtonIds(): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="group"] [data-ui-button-id]'))
    .map((element) => element.dataset.uiButtonId!);
}

function previewRotation(appHost: AppHost): number | undefined {
  const editor = appHost.workspace.editor!;
  const [previewId] = editor.state.collections.preview;
  return previewId === undefined ? undefined : editor.queries.getEntityById(previewId)?.rotation;
}

function penTap(target: Element): void {
  act(() => {
    const event = new Event("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: 7 }, pointerType: { value: "pen" }, clientX: { value: 10 }, clientY: { value: 10 },
      button: { value: 0 }, buttons: { value: 0 },
      altKey: { value: false }, ctrlKey: { value: false }, metaKey: { value: false }, shiftKey: { value: false },
    });
    target.dispatchEvent(event);
  });
}

/** jsdom 没有布局：让画布量尺报告给定高度、按钮报告 44px，其余元素为 0。 */
function stubShortCanvasLayout(canvasHeight: number): void {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    if (this.tagName === "BUTTON") return 44;
    return this.getAttribute("aria-hidden") === "true" && this.tagName === "DIV" ? canvasHeight : 0;
  });
}
