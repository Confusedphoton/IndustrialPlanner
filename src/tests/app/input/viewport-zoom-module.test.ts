import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";



import {
  createHypergryphViewportZoomModule,
  fitCanvasViewportToBase,
  zoomCanvasViewportByButton,
} from "@/app/input/gesture/actions";
import { createWorldDocument } from "@/domain/document/world-document";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";


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

describe("canvas viewport zoom buttons", () => {
  it("zooms in and out through the same zoom steps as the wheel", () => {
    const test = createCanvasTestSession({ document: createWorldDocument({ baseId: "wuling_protocol_core" }) });
    cleanups.push(test.dispose);
    test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
    const initial = test.view.state.gridSize;

    zoomCanvasViewportByButton(test.canvas, 1);
    expect(test.view.state.gridSize).toBeGreaterThan(initial);
    zoomCanvasViewportByButton(test.canvas, -1);
    expect(test.view.state.gridSize).toBeCloseTo(initial);
  });

  it("centers the base and picks the largest zoom step that still shows the whole base", () => {
    const test = createCanvasTestSession({
      document: createWorldDocument({ baseId: "wuling_protocol_core" }),
      viewport: { center: { x: -40, y: 90 }, gridSize: 4, displayRotation: 0 },
    });
    cleanups.push(test.dispose);
    test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 2400, height: 1800 });
    const base = test.workspace.registry.baseDefinitions.find((candidate) => candidate.id === "wuling_protocol_core")!;
    const bounds = resolveBaseOuterBounds(base)!;
    const width = bounds.maxX! - bounds.minX!;
    const height = bounds.maxY! - bounds.minY!;
    const fits = () => width * test.view.state.gridCellPixelSize <= 2400 && height * test.view.state.gridCellPixelSize <= 1800;

    fitCanvasViewportToBase(test.canvas);

    expect(test.view.state.center.x).toBeCloseTo(bounds.minX! + width / 2);
    expect(test.view.state.center.y).toBeCloseTo(bounds.minY! + height / 2);
    expect(fits()).toBe(true);
    test.view.actions.zoom(1);
    test.view.actions.zoom(1);
    expect(fits()).toBe(false);
  });

  it("zooms out past the default floor to show the whole base beside the tool rail in a short canvas", () => {
    const test = createCanvasTestSession({ document: createWorldDocument({ baseId: "wuling_protocol_core" }) });
    cleanups.push(test.dispose);
    const base = test.workspace.registry.baseDefinitions.find((candidate) => candidate.id === "wuling_protocol_core")!;
    const bounds = resolveBaseOuterBounds(base)!;
    test.view.actions.setBoundsPolicy({ kind: "space", bounds, padding: 2 });
    test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1100, height: 300 });
    const rail = 70;

    vi.spyOn(test.canvas, "viewportObstruction", "get").mockReturnValue({ left: rail, right: 0 });

    fitCanvasViewportToBase(test.canvas);

    const { center, gridCellPixelSize } = test.view.state;
    const toScreenX = (worldX: number) => 550 + (worldX - center.x) * gridCellPixelSize;
    const toScreenY = (worldY: number) => 150 + (worldY - center.y) * gridCellPixelSize;
    expect(test.view.state.gridSize).toBeLessThan(0.5);
    expect(toScreenX(bounds.minX!)).toBeGreaterThanOrEqual(rail);
    expect(toScreenX(bounds.maxX!)).toBeLessThanOrEqual(1100);
    expect(toScreenY(bounds.minY!)).toBeGreaterThanOrEqual(0);
    expect(toScreenY(bounds.maxY!)).toBeLessThanOrEqual(300);
    expect((toScreenX(bounds.minX!) + toScreenX(bounds.maxX!)) / 2).toBeCloseTo(rail + (1100 - rail) / 2);

    // 缩小后滚轮仍连续：再缩小不会反向放大。
    const fitted = test.view.state.gridSize;
    zoomCanvasViewportByButton(test.canvas, -1);
    expect(test.view.state.gridSize).toBeLessThanOrEqual(fitted);
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
