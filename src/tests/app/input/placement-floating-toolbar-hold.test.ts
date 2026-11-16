import { afterEach, describe, expect, it } from "vitest";
import { createHypergryphSinglePlacementGestureModule } from "@/app/input/gesture/actions";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); });

const PLACEMENT_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

describe("placement floating toolbar while a pen hovers toward it", () => {
  it("stays put near the pointer and catches up once the pointer moves away", () => {
    const { canvas, context, editor, module } = createTouchPlacement();
    const frozen = { ...canvas.state.runtime.canvasFloatingToolbar.anchor! };
    const previewBefore = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview)!;

    // 笔从预览中心向工具条移动：预览继续跟随，工具条不再跳开。
    for (const offset of [60, 40, 20]) {
      module.handle(hoverMove({ x: frozen.x, y: frozen.y + offset }), context);
    }
    expect(editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview)!.y).toBeLessThan(previewBefore.y);
    expect(canvas.state.runtime.canvasFloatingToolbar.anchor).toEqual(frozen);

    module.handle(hoverMove({ x: frozen.x + 300, y: frozen.y + 250 }), context);
    const followed = canvas.state.runtime.canvasFloatingToolbar.anchor!;
    expect(followed.x).toBeCloseTo(frozen.x + 300, -1);
    expect(followed.y).toBeGreaterThan(frozen.y + 150);
  });

  it("releases the hold and follows the preview when a tap moves it elsewhere", () => {
    const { canvas, context, editor, module } = createTouchPlacement();
    const frozen = { ...canvas.state.runtime.canvasFloatingToolbar.anchor! };

    module.handle(hoverMove({ x: frozen.x + 70, y: frozen.y + 40 }), context);
    expect(canvas.state.runtime.canvasFloatingToolbar.anchor).toEqual(frozen);

    module.handle(touchTap({ x: frozen.x + 300, y: frozen.y + 250 }), context);
    expect(editor.state.collections.preview.length).toBe(1);
    expect(canvas.state.runtime.canvasFloatingToolbar.anchor!.x).toBeGreaterThan(frozen.x + 200);
  });

  it("follows the preview again after the viewport zooms", () => {
    const { canvas, context, module, view } = createTouchPlacement();
    const frozen = { ...canvas.state.runtime.canvasFloatingToolbar.anchor! };

    module.handle(hoverMove({ x: frozen.x + 70, y: frozen.y + 40 }), context);
    view.actions.zoom(2);
    canvas.actions.alignCanvasFloatingToolbar();

    expect(canvas.state.runtime.canvasFloatingToolbar.anchor).not.toEqual(frozen);
  });
});

function createTouchPlacement() {
  const test = createCanvasTestSession({
    activeTool: "single-placement",
    viewport: { center: { x: 0, y: 0 }, gridSize: 1, displayRotation: 0 },
  });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1000, height: 800 });
  test.canvas.state.runtime.singlePlacementDeviceId = "log_splitter";
  test.canvas.state.runtime.singlePlacementPointerMode = "touch";
  test.canvas.state.runtime.placementAnchor = { x: 0, y: 0 };
  test.editor.actions.createSinglePlacementDraft({ definitionId: "log_splitter", centerGridPoint: { x: 0, y: 0 } });
  test.canvas.actions.showCanvasFloatingToolbarForCollection(PLACEMENT_TOOLBAR_BUTTON_IDS, EntityCollectionType.preview);
  test.canvas.actions.setCanvasFloatingToolbarSize({ width: 130, height: 40 });
  return { ...test, module: createHypergryphSinglePlacementGestureModule() };
}

const modifiers = { alt: false, ctrl: false, meta: false, shift: false };

function hoverMove(position: { x: number; y: number }) {
  return {
    type: "mouse move" as const,
    gestureId: "pen-hover",
    buttons: 0,
    position,
    delta: { x: 0, y: 0 },
    modifiers,
    sourceEvent: null,
  };
}

function touchTap(position: { x: number; y: number }) {
  return {
    type: "touch tap" as const,
    gestureId: "pen-tap",
    primaryId: 1,
    position,
    longPress: false,
    pointerEntity: null,
    modifiers,
    sourceEvent: null,
  };
}
