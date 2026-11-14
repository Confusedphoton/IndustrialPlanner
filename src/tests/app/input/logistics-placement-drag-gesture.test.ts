import { afterEach, describe, expect, it, vi } from "vitest";

import { createHypergryphLogisticsPlacementGestureModule } from "@/app/input/gesture/actions";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import type { GridPoint } from "@/domain/shared/grid";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
});

const EMPTY_MODIFIERS = { alt: false, ctrl: false, meta: false, shift: false };

describe("logistics placement mouse/pen drag", () => {
  it("draws from an existing belt end while dragging and commits on release", () => {
    const { context, editor } = createContext();
    const module = createHypergryphLogisticsPlacementGestureModule();
    const entityCountBefore = editor.document.getSnapshot().entityOrder.length;

    expect(module.handle(dragStart({ x: 6, y: 4 }, { x: 7, y: 4 }), context)).toEqual({ status: "claimed" });
    expect(module.handle(dragMove({ x: 8, y: 4 }), context)).toEqual({ status: "handled" });
    expect(module.handle(dragMove({ x: 9, y: 4 }), context)).toEqual({ status: "handled" });
    expect(editor.queries.resolveLogisticsDraftState()?.canApply).toBe(true);

    expect(module.handle(dragEnd({ x: 9, y: 4 }, "release"), context)).toEqual({ status: "handled" });
    expect(editor.queries.resolveLogisticsDraftState()).toBeNull();
    expect(editor.document.getSnapshot().entityOrder.length).toBeGreaterThan(entityCountBefore);
    expect(context.canvas.state.runtime.logisticsPlacement.phase).toBe("idle");
  });

  it("discards the dragged route when the drag is cancelled", () => {
    const { context, editor } = createContext();
    const module = createHypergryphLogisticsPlacementGestureModule();
    const documentBefore = editor.document.getSnapshot();

    module.handle(dragStart({ x: 6, y: 4 }, { x: 8, y: 4 }), context);
    module.handle(dragEnd({ x: 8, y: 4 }, "cancel"), context);

    expect(editor.queries.resolveLogisticsDraftState()).toBeNull();
    expect(editor.document.getSnapshot().entityOrder).toEqual(documentBefore.entityOrder);
  });

  it("leaves drags from empty cells to viewport panning", () => {
    const { context, editor } = createContext();
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(dragStart({ x: 2, y: 2 }, { x: 4, y: 2 }), context)).toEqual({ status: "ignored" });
    expect(module.handle(dragMove({ x: 5, y: 2 }), context)).toEqual({ status: "ignored" });
    expect(editor.queries.resolveLogisticsDraftState()).toBeNull();
  });

  it("flips the route priority and cancels the current route from the tool rail buttons", () => {
    const { context, editor } = createContext();
    const module = createHypergryphLogisticsPlacementGestureModule();
    const runtime = context.canvas.state.runtime.logisticsPlacement;

    expect(module.handle(uiButtonTap("canvas-tool-rail-logistics-route-order"), context)).toEqual({ status: "handled" });
    expect(runtime.routeOrder).toBe("horizontal-first");

    module.handle(mouseTap({ x: 6, y: 4 }), context);
    expect(editor.queries.resolveLogisticsDraftState()).not.toBeNull();

    expect(module.handle(uiButtonTap("canvas-tool-rail-logistics-cancel-route"), context)).toEqual({ status: "handled" });
    expect(editor.queries.resolveLogisticsDraftState()).toBeNull();
    expect(runtime.phase).toBe("idle");
    expect(context.canvas.state.activeTool).toBe("logistics-placement");
  });
});

function createContext() {
  const test = createCanvasTestSession({
    activeTool: "logistics-placement",
    document: createWorldDocumentFromBlueprint(loadBlueprintFromFile(
      "src/tests/fixtures/blueprints/collections/req048/logistics-debug-belt.schema7.json")),
    viewport: { center: { x: 50, y: 50 }, gridSize: 1 / 16, displayRotation: 0 },
  });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
  test.app.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = false;
  test.app.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = false;
  const runtime = test.canvas.state.runtime.logisticsPlacement;
  runtime.kind = LOGISTICS_KIND.belt;
  runtime.pointerMode = "mouse";
  runtime.routeOrder = "vertical-first";
  runtime.phase = "idle";
  return { context: test.context, editor: test.editor };
}

function cellCenter(cell: GridPoint) {
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

function dragStart(start: GridPoint, current: GridPoint): Extract<GestureEvent, { type: "mouse dragstart" }> {
  return {
    type: "mouse dragstart", gestureId: "drag-1", originButton: 0, button: 0, buttons: 1,
    position: cellCenter(current), startPosition: cellCenter(start), longPress: false, pointerEntity: null,
    modifiers: EMPTY_MODIFIERS, sourceEvent: null,
  };
}

function dragMove(cell: GridPoint): Extract<GestureEvent, { type: "mouse dragmove" }> {
  return {
    type: "mouse dragmove", gestureId: "drag-1", originButton: 0, buttons: 1,
    position: cellCenter(cell), delta: { x: 1, y: 0 }, longPress: false,
    modifiers: EMPTY_MODIFIERS, sourceEvent: null,
  };
}

function dragEnd(cell: GridPoint, reason: "release" | "cancel"): Extract<GestureEvent, { type: "mouse dragend" }> {
  return {
    type: "mouse dragend", gestureId: "drag-1", originButton: 0, releaseButton: 0, button: 0, buttons: 0,
    position: cellCenter(cell), reason, longPress: false, modifiers: EMPTY_MODIFIERS, sourceEvent: null,
  };
}

function mouseTap(cell: GridPoint): Extract<GestureEvent, { type: "mouse tap" }> {
  return {
    type: "mouse tap", gestureId: "tap-1", button: 0, buttons: 0, position: cellCenter(cell),
    longPress: false, pointerEntity: null, modifiers: EMPTY_MODIFIERS, sourceEvent: null,
  };
}

function uiButtonTap(uiButtonId: string): Extract<GestureEvent, { type: "ui-button-touch-tap" }> {
  return { type: "ui-button-touch-tap", gestureId: `ui-${uiButtonId}`, uiButtonId, modifiers: EMPTY_MODIFIERS, sourceEvent: null };
}
