import { afterEach, describe, expect, it, vi } from "vitest";

import { createHypergryphPortDragLogisticsGestureModule } from "@/app/input/gesture/actions/hypergryph/hypergryph-port-drag-logistics-gesture-module";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import { createHypergryphLogisticsPlacementGestureModule } from "@/app/input/gesture/actions";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import type { GridPoint } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";
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

  it.each(["belt", "pipe"] as const)("turns an open %s end, then branches it only after an outlet is connected", (kind) => {
    const registry = createRegistryContract().queries;
    const belt = (id: string, x: number): WorldEntity => ({
      id, definitionId: registry.resolveLogisticsDefinitionId(kind, "straight")!,
      position: { x, y: 24 }, rotation: 0, tags: [], config: {},
    });
    const test = createCanvasTestSession({
      activeTool: "select",
      document: { ...createWorldDocument({ baseId: "draft_box" }), entities: { a: belt("a", 26), b: belt("b", 27) }, entityOrder: ["a", "b"] },
      viewport: { center: { x: 50, y: 50 }, gridSize: 1 / 16, displayRotation: 0 },
    });
    cleanups.push(test.dispose);
    test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
    const { context, editor } = test;
    const module = createHypergryphPortDragLogisticsGestureModule();

    module.handle(dragStart({ x: 27, y: 24 }, { x: 27, y: 25 }), context);
    module.handle(dragMove({ x: 27, y: 26 }), context);
    module.handle(dragEnd({ x: 27, y: 26 }, "release"), context);
    const bend = editor.queries.findTransportLineAtGridPoint({ x: 27, y: 24 }, kind);
    expect(bend).not.toBeNull();
    expect(bend?.definitionId).not.toBe(belt("b", 27).definitionId);
    const lastCell = { x: 27, y: 26 };
    const end = editor.queries.findTransportLineAtGridPoint(lastCell, kind);
    expect(end).not.toBeNull();

    module.handle(dragStart({ x: 27, y: 24 }, { x: 28, y: 24 }), context);
    module.handle(dragMove({ x: 29, y: 24 }), context);
    module.handle(dragEnd({ x: 29, y: 24 }, "release"), context);
    const entities = Object.values(editor.document.getSnapshot().entities);
    expect(entities.find((entity) => entity.position.x === 27 && entity.position.y === 24)?.definitionId)
      .toSatisfy((id: string | undefined) => id !== undefined && registry.resolveLogisticsRole(id) === "splitter");
    expect(editor.queries.findTransportLineAtGridPoint(lastCell, kind)?.id).toBe(end?.id);
    expect(editor.queries.findTransportLineAtGridPoint({ x: 29, y: 24 }, kind)).not.toBeNull();
  });

  it("connects a backward drag to the exact output port without capturing nearby cells", () => {
    const storage = (id: string, y: number): WorldEntity => ({
      id,
      definitionId: "storager_1",
      position: { x: 22, y },
      rotation: 0,
      tags: [],
      config: {},
    });
    const test = createCanvasTestSession({
      activeTool: "select",
      document: {
        ...createWorldDocument({ baseId: "draft_box" }),
        entities: { source: storage("source", 20), sink: storage("sink", 28) },
        entityOrder: ["source", "sink"],
      },
      viewport: { center: { x: 50, y: 50 }, gridSize: 1 / 16, displayRotation: 0 },
    });
    cleanups.push(test.dispose);
    test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
    const { context, editor } = test;
    const module = createHypergryphPortDragLogisticsGestureModule();

    module.handle(dragStart({ x: 23, y: 28 }, { x: 23, y: 26 }), context);
    module.handle(dragMove({ x: 23, y: 23 }), context);
    expect(editor.queries.resolveLogisticsDraftState()?.source?.type).toBe("empty-cell");

    module.handle(dragEnd({ x: 23, y: 22 }, "release"), context);

    const firstBelt = editor.queries.findTransportLineAtGridPoint({ x: 23, y: 23 }, LOGISTICS_KIND.belt);
    const lastBelt = editor.queries.findTransportLineAtGridPoint({ x: 23, y: 27 }, LOGISTICS_KIND.belt);
    expect(firstBelt?.rotation).toBe(90);
    expect(lastBelt?.rotation).toBe(90);
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
