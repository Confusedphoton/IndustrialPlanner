import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";



import { createHypergryphViewportZoomModule } from "@/app/input/gesture/actions";


import { EntityCollectionType } from "@/domain/editor/types/editor-types";


describe("createHypergryphViewportZoomModule", () => {
  it("nudges a mobile placement preview back into the safe viewport after pinch zoom", () => {
    const {
      context,
      moveCollectionTo,
      previewRectRef,
      zoom,
    } = createMobilePlacementContext();
    const module = createHypergryphViewportZoomModule();

    const result = module.handle(
      {
        type: "pinch out",
        gestureId: "pinch-preview-1",
        center: { x: 5, y: 5 },
        scaleDelta: 2,
        distanceDelta: 10,
        activeTouchCount: 2,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(zoom).toHaveBeenCalledWith(4);
    expect(moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 20, y: 0 },
      endGridPoint: { x: 3, y: 0 },
    });
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });
});

function createMobilePlacementContext() {
  // 真实相机执行后仍以中心 0、10×10 世界格验证原回推断言。
  const test = createCanvasTestSession({ activeTool: "single-placement",
    viewport: { center: { x: 0, y: 0 }, gridSize: 2 ** (-2 / 3), displayRotation: 0 } }); cleanups.push(test.dispose);
  test.app.internalActions.setScreenProfile({ ...test.app.state.screenProfile, deviceClass: "mobile" });
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 160, height: 160 });
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
