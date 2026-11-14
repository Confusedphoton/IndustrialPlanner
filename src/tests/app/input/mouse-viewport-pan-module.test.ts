import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";



import { createHypergryphMouseViewportPanModule } from "@/app/input/gesture/actions";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";



describe("createHypergryphMouseViewportPanModule", () => {
  it("accepts left mouse drag in select mode", () => {
    const {
      context,
      alignCanvasFloatingToolbar,
      moveViewportByClientPixelVector,
    } = createContext("select");
    const module = createHypergryphMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "mouse dragstart",
        gestureId: "mouse-pan-1",
        originButton: 0,
        button: 0,
        buttons: 1,
        position: { x: 130, y: 70 },
        startPosition: { x: 120, y: 80 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(startResult).toEqual({ status: "handled" });
    expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
      startClientPixel: { x: 120, y: 80 },
      endClientPixel: { x: 130, y: 70 },
    });
    expect(alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("ignores left mouse drag in marquee mode", () => {
    const {
      context,
      alignCanvasFloatingToolbar,
      moveViewportByClientPixelVector,
    } = createContext("marquee");
    const module = createHypergryphMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "mouse dragstart",
        gestureId: "mouse-pan-2",
        originButton: 0,
        button: 0,
        buttons: 1,
        position: { x: 130, y: 70 },
        startPosition: { x: 120, y: 80 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(startResult).toEqual({ status: "ignored" });
    expect(moveViewportByClientPixelVector).not.toHaveBeenCalled();
    expect(alignCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("pans the viewport for non-long-press touch drag gestures", () => {
    const {
      context,
      alignCanvasFloatingToolbar,
      moveViewportByClientPixelVector,
    } = createContext();
    const module = createHypergryphMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-pan-1",
        primaryId: 1,
        position: { x: 136, y: 64 },
        startPosition: { x: 120, y: 80 },
        activeTouchCount: 1,
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const moveResult = module.handle(
      {
        type: "touch dragmove",
        gestureId: "touch-pan-1",
        primaryId: 1,
        position: { x: 140, y: 72 },
        delta: { x: 4, y: 8 },
        activeTouchCount: 1,
        longPress: false,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const endResult = module.handle(
      {
        type: "touch dragend",
        gestureId: "touch-pan-1",
        primaryId: 1,
        position: { x: 140, y: 72 },
        reason: "release",
        longPress: false,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(startResult).toEqual({ status: "handled" });
    expect(moveResult).toEqual({ status: "handled" });
    expect(endResult).toEqual({ status: "handled" });
    expect(moveViewportByClientPixelVector).toHaveBeenNthCalledWith(1, {
      startClientPixel: { x: 120, y: 80 },
      endClientPixel: { x: 136, y: 64 },
    });
    expect(moveViewportByClientPixelVector).toHaveBeenNthCalledWith(2, {
      startClientPixel: { x: 136, y: 64 },
      endClientPixel: { x: 140, y: 72 },
    });
    expect(alignCanvasFloatingToolbar).toHaveBeenCalledTimes(2);
  });

  it("ignores long-press touch drag gestures", () => {
    const {
      context,
      alignCanvasFloatingToolbar,
      moveViewportByClientPixelVector,
    } = createContext();
    const module = createHypergryphMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-pan-2",
        primaryId: 1,
        position: { x: 136, y: 64 },
        startPosition: { x: 120, y: 80 },
        activeTouchCount: 1,
        longPress: true,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const moveResult = module.handle(
      {
        type: "touch dragmove",
        gestureId: "touch-pan-2",
        primaryId: 1,
        position: { x: 140, y: 72 },
        delta: { x: 4, y: 8 },
        activeTouchCount: 1,
        longPress: true,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const endResult = module.handle(
      {
        type: "touch dragend",
        gestureId: "touch-pan-2",
        primaryId: 1,
        position: { x: 140, y: 72 },
        reason: "release",
        longPress: true,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(startResult).toEqual({ status: "ignored" });
    expect(moveResult).toEqual({ status: "ignored" });
    expect(endResult).toEqual({ status: "ignored" });
    expect(moveViewportByClientPixelVector).not.toHaveBeenCalled();
    expect(alignCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("pans long-press touch drags while placing", () => {
    const {
      context,
      moveViewportByClientPixelVector,
    } = createContext("single-placement");
    const module = createHypergryphMouseViewportPanModule();

    const result = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-placement-pan-1",
        primaryId: 1,
        position: { x: 136, y: 64 },
        startPosition: { x: 120, y: 80 },
        activeTouchCount: 1,
        longPress: true,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
      startClientPixel: { x: 120, y: 80 },
      endClientPixel: { x: 136, y: 64 },
    });
  });

  it("nudges a mobile placement preview back into the safe viewport after touch pan", () => {
    const {
      context,
      moveCollectionTo,
      previewRectRef,
    } = createMobilePlacementContext();
    const module = createHypergryphMouseViewportPanModule();

    const result = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-pan-preview-1",
        primaryId: 1,
        position: { x: 136, y: 64 },
        startPosition: { x: 120, y: 80 },
        activeTouchCount: 1,
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 20, y: 0 },
      endGridPoint: { x: 3, y: 0 },
    });
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });

});

function createContext(activeTool: "select" | "marquee" | "single-placement" = "select") {
  const test = createCanvasTestSession({ activeTool }); cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 100, top: 50, width: 100, height: 100 });
  return { context: test.context, alignCanvasFloatingToolbar: vi.spyOn(test.canvas.actions, "alignCanvasFloatingToolbar"),
    moveViewportByClientPixelVector: vi.spyOn(test.view.actions, "moveViewportByClientPixelVector") };
}

function createMobilePlacementContext() {
  // 真实相机执行后仍以中心 0、10×10 世界格验证原回推断言。
  const test = createCanvasTestSession({ activeTool: "single-placement",
    viewport: { center: { x: 16, y: -16 }, gridSize: 1 / 16, displayRotation: 0 } }); cleanups.push(test.dispose);
  test.app.internalActions.setScreenProfile({ ...test.app.state.screenProfile, deviceClass: "mobile" });
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 10, height: 10 });
  test.canvas.state.runtime.placementAnchor = { x: 20, y: 0 };
  test.editor.actions.createSinglePlacementDraft({ definitionId: "power_sta_1", centerGridPoint: { x: 20, y: 0 } });
  return { context: test.context, moveCollectionTo: vi.spyOn(test.editor.actions, "moveCollectionTo"),
    zoom: vi.spyOn(test.view.actions, "zoom"), previewRectRef: { get current() { return test.editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview); } } };
}







function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}
