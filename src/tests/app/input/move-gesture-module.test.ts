import type { CanvasRightDockToolbarItemRequest } from "@/app/state";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { loadBlueprintFromFile, getBlueprintEntityArray, createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";





import {
  createHypergryphMoveGestureModule,

} from "@/app/input/gesture/actions";



import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import {
  EntityCollectionType,

} from "@/domain/editor/types/editor-types";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphMoveGestureModule", () => {
  it("opens the overlap entity menu before entering move from a stacked long-press cell", () => {

    const topEntity = entity("top-overlap-entity", { x: 2, y: 2 }, "pipe_straight_1x1");
    const { context, editor } = createContext({

      listedEntities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/scene-01-variant-1.schema7.json")),
    });
    const overlapEntityMenu = context.canvas.overlapEntityMenu;
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: topEntity,
        position: { x: 2, y: 2 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(overlapEntityMenu.visible).toBe(true);
    expect(overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "top-overlap-entity",
      "bottom-overlap-entity",
    ]);
    expect(editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();

    overlapEntityMenu.select("bottom-overlap-entity");

    expect(editor.actions.clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(editor.actions.addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "bottom-overlap-entity",
    });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.actions.setActiveTool).toHaveBeenCalledWith("move");
  });

  it("resolves immediate-drag overlap candidates from the drag start position", () => {

    const { context, editor } = createContext({

      listedEntities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/move-gesture-module/scene-02-variant-1.schema7.json")),
    });
    const overlapEntityMenu = context.canvas.overlapEntityMenu;
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      mouseDragStartEvent({
        originButton: 0,
        pointerEntity: null,
        startPosition: { x: 2, y: 2 },
        position: { x: 3, y: 2 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(overlapEntityMenu.visible).toBe(true);
    expect(overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "top-overlap-entity",
      "bottom-overlap-entity",
    ]);
    expect(editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
  });

  it("enters mouse move from select by selecting the pointer entity first", () => {
    const { context, editor } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.clearCollection).toHaveBeenCalledWith(
      EntityCollectionType.selection,
    );
    expect(editor.actions.addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "unselected-entity",
    });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 4, y: 4 }, context.canvas.view.state,
    );
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("select");
    expect(context.canvas.state.moveKind).toBe("ordinary");
    expect(context.canvas.actions.hideCanvasFloatingToolbar).not.toHaveBeenCalled();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.hideCanvasFloatingToolbar).toHaveBeenCalled();
  });

  it("requires an existing selection when mouse move enters from marquee", () => {
    const missed = createContext({
      activeTool: "marquee",
    });
    const handled = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const missedResult = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      missed.context,
    );

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      handled.context,
    );

    expect(missedResult).toEqual({ status: "ignored" });
    expect(missed.editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
    expect(missed.context.canvas.state.activeTool).toBe("marquee");
    expect(result).toEqual({ status: "handled" });
    expect(handled.editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(handled.context.canvas.state.activeTool).toBe("move");
    expect(handled.context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(handled.editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 2, y: 2 }, handled.context.canvas.view.state,
    );
    expect(handled.context.canvas.state.runtime.moveEnterFrom).toBe("marquee");
    expect(handled.context.canvas.state.moveKind).toBe("batch");
  });

  it("enters touch move from select by selecting the pointer entity first", () => {
    const marquee = createContext({
      activeTool: "marquee",
    });
    const select = createContext();
    const module = createHypergryphMoveGestureModule();

    const marqueeResult = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      marquee.context,
    );
    const selectResult = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      select.context,
    );

    expect(marqueeResult).toEqual({ status: "ignored" });
    expect(marquee.editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
    expect(selectResult).toEqual({ status: "handled" });
    expect(select.editor.actions.clearCollection).toHaveBeenCalledWith(
      EntityCollectionType.selection,
    );
    expect(select.editor.actions.addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "unselected-entity",
    });
    expect(select.editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(select.context.canvas.state.activeTool).toBe("move");
    expect(select.context.canvas.state.runtime.moveEnterFrom).toBe("select");
    expect(select.context.canvas.actions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "move"), select.context),
    ).toEqual({ status: "handled" });
    expect(select.context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("enters move from the marquee right dock button and initializes the touch move ui", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-move"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("marquee");
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("marquee", "move"), context),
    ).toEqual({ status: "handled" });
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("enters move from marquee via M key shortcut when selection is non-empty", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyM", key: "m" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("marquee");
  });

  it("enters move from select via M key shortcut when selection is non-empty", () => {
    const { context, editor } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyM", key: "m" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("select");
  });

  it("ignores M key shortcut when selection is empty", () => {
    const { context, editor } = createContext();
    const module = createHypergryphMoveGestureModule();

    editor.actions.clearCollection(EntityCollectionType.selection);

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyM", key: "m" }),
    });

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
  });

  it("moves mouse-entered preview by collection center point", () => {
    const { context, editor } = createContext({
      previewRect: {
        x: 9,
        y: 17,
        width: 4,
        height: 8,
      },
    });
    const module = createHypergryphMoveGestureModule();



    expect(
      module.handle(uiButtonMouseTapEvent("canvas-floating-toolbar-button-move"), context),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseMoveEvent({ position: { x: 20, y: 30 } }), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenNthCalledWith(
      1,
      EntityCollectionType.preview,
      { x: 20, y: 30 }, context.canvas.view.state,
    );
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseMoveEvent({ position: { x: 21, y: 31 } }), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenNthCalledWith(
      2,
      EntityCollectionType.preview,
      { x: 21, y: 31 }, context.canvas.view.state,
    );
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
  });

  it("enters move from the select floating button with touch and initializes the touch move ui", () => {
    const { context, editor } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-move"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("select");
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("moves the mouse preview center from drag start after entering move from the right dock button", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(
        uiButtonMouseTapEvent("canvas-right-dock-toolbar-button-move"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();

    const dragStartResult = module.handle(
      mouseDragStartEvent({
        originButton: 0,
        pointerEntity: null,
        position: { x: 5, y: 5 },
      }),
      context,
    );

    expect(dragStartResult).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 5, y: 5 }, context.canvas.view.state,
    );
  });

  it("rolls back draft state and restores selection when entering move cannot create a preview", () => {
    const { context, editor, selection } = createContext({ invalidSelection: "selected" });
    const module = createHypergryphMoveGestureModule();



    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect([...selection]).toEqual(["selected-entity"]);
    expect(context.canvas.state.activeTool).toBe("select");
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBeNull();
  });

  it("restores the original selection when touch move enter fails after retargeting selection", () => {
    const { context, editor, selection } = createContext({ invalidSelection: "unselected" });
    const module = createHypergryphMoveGestureModule();



    const result = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect([...selection]).toEqual(["selected-entity"]);
  });

  it("uses preview bounding box hit testing for touch drag start while already moving", () => {
    const { context } = createContext({
      activeTool: "move", pixelScale: 16,
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    const originalEntityResult = module.handle(
      touchDragStartEvent({
        position: { x: 32, y: 32 },
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(originalEntityResult).toEqual({ status: "ignored" });
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();

    const previewResult = module.handle(
      touchDragStartEvent({
        position: { x: 80, y: 80 },
        pointerEntity: null,
      }),
      context,
    );

    expect(previewResult).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
  });

  it("starts touch moving from an empty cell inside the preview bounding box", () => {
    const { context } = createContext({
      activeTool: "move", hollowPreview: true,
      moveAnchor: { x: 5, y: 5 },
      previewRect: { x: 5, y: 5, width: 4, height: 4 },
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        position: { x: 8, y: 8 },
        pointerEntity: null,
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 8, y: 8 });
  });

  it("starts touch moving from within the preview hit slop", () => {
    const { context } = createContext({
      activeTool: "move", pixelScale: 16,
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        position: { x: 70, y: 80 },
        pointerEntity: null,
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 4, y: 5 });
  });

  it("moves the preview by incremental grid vectors and follows it with the toolbar", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();



    const result = module.handle(
      touchDragMoveEvent({
        position: { x: 6, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 6, y: 4 },
    });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 6, y: 4 });
    expect(editor.actions.rotateCollectionToSnapOnBuilding).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      trigger: "after-move",
      pivotMode: "pivot-cell",
      clientPixelPoint: null, viewport: context.canvas.view.state,
    });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("updates touch move anchor per axis when snapping constrains one axis", () => {
    const { context } = createContext({
      activeTool: "move",
      moveAnchor: { x: 20, y: -9 },
      movePointerMode: "touch",
      previewDefinitionId: "water_purifier_node_1",
      previewRect: { x: 10, y: -10, width: 27, height: 3 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();



    const result = module.handle(touchDragMoveEvent({ position: { x: 21, y: -8 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 21, y: -9 });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the preview with the R key while moving", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
    expect(editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the mouse move preview around center and snaps it back to the current mouse", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      movePointerMode: "mouse",
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(mouseMoveEvent({ position: { x: 24, y: 32 } }), context)).toEqual({
      status: "handled",
    });
    vi.mocked(editor.actions.moveCollectionCenterPointTo).mockClear();
    vi.mocked(context.canvas.actions.alignCanvasFloatingToolbar).mockClear();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionAroundCenterPoint).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 24, y: 32 }, context.canvas.view.state,
    );
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the preview from the rotate toolbar button while moving", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-rotate"), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("uses building-snap rotation before the normal move-preview rotation", () => {
    const { context, editor } = createContext({
      activeTool: "move", previewDefinitionId: "loader_1",
      moveAnchor: { x: 5, y: 5 },
      movePointerMode: "touch",
    });
    const module = createHypergryphMoveGestureModule();


    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    })).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionToSnapOnBuilding).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      trigger: "before-rotate",
      pivotMode: "pivot-cell",
      clientPixelPoint: null, viewport: context.canvas.view.state,
    });
    expect(editor.actions.rotateCollectionAroundPivotCell).not.toHaveBeenCalled();
    expect(editor.actions.rotateCollectionAroundCenterPoint).not.toHaveBeenCalled();
  });

  it("switches the move preview variant, keeps the anchor, then continues moving and applies", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 12, y: 11 },
      previewDefinitionId: "filling_pd_mc_1",
      previewRect: { x: 10, y: 10, width: 6, height: 4 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();



    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "handled" });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "move-draft:selected-entity",
      "filling_pd_mc_1_liquid",
    );
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 12, y: 11 });

    expect(module.handle(touchDragMoveEvent({ position: { x: 13, y: 12 } }), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.moveCollectionTo).toHaveBeenLastCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 12, y: 11 },
      endGridPoint: { x: 13, y: 12 },
    });
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 13, y: 12 });

    expect(module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("select");
  });

  it("shows Tab only for switchable ordinary mouse move shortcuts", () => {
    const ordinary = createContext({
      activeTool: "move",
      moveEnterFrom: "select",
      movePointerMode: "mouse",
      previewDefinitionId: "filling_pd_mc_1",
    });
    const batch = createContext({
      activeTool: "move",
      moveEnterFrom: "marquee",
      movePointerMode: "mouse",
      previewDefinitionId: "filling_pd_mc_1",
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(
      onEnterActiveToolEvent("select", "move"),
      ordinary.context,
    )).toEqual({ status: "handled" });
    expect(ordinary.context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT_FOR_TEST,
    );

    expect(module.handle(
      onEnterActiveToolEvent("marquee", "move"),
      batch.context,
    )).toEqual({ status: "handled" });
    expect(batch.context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      BATCH_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_FOR_TEST,
    );

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: batch.context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "ignored" });
    expect(batch.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });

  it("hides and rejects variant switching during a single-device batch touch move", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      moveEnterFrom: "marquee",
      movePointerMode: "touch",
      previewDefinitionId: "filling_pd_mc_1",
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(onEnterActiveToolEvent("marquee", "move"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );

    expect(module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"),
      context,
    )).toEqual({ status: "ignored" });
    expect(editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });

  it("cancels a switched move preview without applying it", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 12, y: 11 },
      previewDefinitionId: "filling_pd_mc_1",
      previewRect: { x: 10, y: 10, width: 6, height: 4 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledTimes(1);

    expect(module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.applyMoveOerationDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
  });

  it("applies with a non-long-press left mouse tap and cancels with a right mouse tap", () => {
    const applyContext = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const cancelContext = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), applyContext.context),
    ).toEqual({ status: "handled" });
    expect(applyContext.editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(applyContext.context.canvas.state.activeTool).toBe("select");
    expect(applyContext.context.canvas.state.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseTapEvent({ button: 2, longPress: false }), cancelContext.context),
    ).toEqual({ status: "handled" });
    expect(cancelContext.editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(cancelContext.context.canvas.state.activeTool).toBe("select");
    expect(cancelContext.context.canvas.state.runtime.moveAnchor).toBeNull();
  });

  it("treats Ctrl+left-click as ordinary move apply when copy while moving is disabled", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      copyWhileMoving: false,
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({
        button: 0,
        longPress: false,
        modifiers: { ctrl: true },
      }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.cancelMoveOperationDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("select");
  });

  it("hides the touch copy button when copy while moving is disabled", () => {
    const { context } = createContext({
      activeTool: "move",
      movePointerMode: "touch",
      copyWhileMoving: false,
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      [
        "canvas-floating-toolbar-button-cancel",
        "canvas-floating-toolbar-button-rotate",
        "canvas-floating-toolbar-button-ok",
      ],
      EntityCollectionType.preview,
    );
  });

  it("keeps mouse move active when applying is rejected", () => {
    const { context, editor } = createContext({
      activeTool: "move", rejectApply: true,
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();



    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
  });

  it("keeps touch move active when applying is rejected", () => {
    const { context, editor } = createContext({
      activeTool: "move", rejectApply: true,
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();



    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
  });

  it("returns to marquee through a mouse tool tap when mouse applying a marquee-entered move", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBeNull();
    expect(context.canvas.gestureAdapter.handleUiButtonMouseTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(context.canvas.gestureAdapter.handleUiButtonTouchTap).not.toHaveBeenCalled();
  });

  it("returns to marquee through a touch tool tap when touch cancelling a marquee-entered move", () => {
    const { context, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.runtime.moveAnchor).toBeNull();
    expect(context.canvas.state.runtime.moveEnterFrom).toBeNull();
    expect(context.canvas.gestureAdapter.handleUiButtonTouchTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(context.canvas.gestureAdapter.handleUiButtonMouseTap).not.toHaveBeenCalled();
  });

  it("does not return to marquee after active exits from a select-entered move", () => {
    const { context } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "select",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(context.canvas.gestureAdapter.handleUiButtonMouseTap).not.toHaveBeenCalled();
    expect(context.canvas.gestureAdapter.handleUiButtonTouchTap).not.toHaveBeenCalled();
  });

  it("preserves selection through the marquee → move → marquee round-trip", () => {
    const { context, editor, selection } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();



    editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "another-selected" });

    // Enter move from marquee via mouse long-press.
    const enterResult = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(enterResult).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("move");
    expect(context.canvas.state.runtime.moveEnterFrom).toBe("marquee");
    expect([...selection]).toEqual(["selected-entity", "another-selected"]);

    // Apply the move — the module should trigger a return to marquee
    // without clearing selection.
    const applyResult = module.handle(
      mouseTapEvent({ button: 0, longPress: false }),
      context,
    );

    expect(applyResult).toEqual({ status: "handled" });
    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.actions.setActiveTool).toHaveBeenCalledWith("select");
    expect([...selection]).toEqual(["selected-entity", "another-selected"]);

    // The marquee re-entry is delegated to the marquee gesture module via
    // handleUiButtonMouseTap — selection clearing (or preservation) at that
    // point is the marquee module's responsibility.
    expect(context.canvas.gestureAdapter.handleUiButtonMouseTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
  });
});

function createContext(options: {
  activeTool?: ActiveTool;
  moveAnchor?: GridPoint | null;
  moveEnterFrom?: ActiveTool | null;
  movePointerMode?: "mouse" | "touch" | null;
  toolbarVisible?: boolean;
  previewRect?: GridRect;
  previewDefinitionId?: string;
  copyWhileMoving?: boolean;
  listedEntities?: readonly WorldEntity[];
  rejectApply?: boolean;
  invalidSelection?: "selected" | "unselected";
  hollowPreview?: boolean;
  pixelScale?: number;
} = {}) {
  const edge = options.previewDefinitionId === "water_purifier_node_1";
  const snap = options.previewDefinitionId === "loader_1";
  const fixture = options.invalidSelection !== undefined ? `invalid-${options.invalidSelection}`
    : options.hollowPreview ? "hollow" : edge ? "edge" : snap ? "snap"
    : options.previewDefinitionId === "filling_pd_mc_1" ? "variant" : "default";
  const document = options.listedEntities === undefined ? createWorldDocumentFromBlueprint(loadBlueprintFromFile(
    `src/tests/fixtures/blueprints/collections/req048/move-${fixture}.schema7.json`)) : {
    ...createWorldDocument({ baseId: "wuling_protocol_core" }),
    entities: Object.fromEntries(options.listedEntities.map(entity => [entity.id, entity])),
    entityOrder: options.listedEntities.map(entity => entity.id),
  };
  const pixelScale = options.pixelScale ?? 1;
  const test = createCanvasTestSession({ document, activeTool: options.activeTool,
    viewport: { center: { x: 50 / pixelScale, y: 50 / pixelScale }, gridSize: pixelScale / 16, displayRotation: 0 },
    space: edge ? { areas: [{ id: "test-space", bounds: { minX: null, maxX: null, minY: 0, maxY: null },
      outerRing: { top: 10, right: 0, bottom: 0, left: 0 } }] } : undefined,
    policy: { getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
      resolvePlacementAreaIds: (_entity, space) => space.areas.map(area => area.id),
      validateTransition: () => options.rejectApply ? ["test-policy-rejected"] : [] },
  });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
  test.app.internalState.settings.hypergryphImmediateMove = true;
  test.app.internalState.settings.hypergryphCopyWhileMoving = options.copyWhileMoving ?? false;
  test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "selected-entity" });
  if (options.hollowPreview) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "another-selected" });
  if (options.activeTool === "move") {
    test.editor.actions.createMoveOperationDraft();
    const rect = test.editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
    if (rect === null) throw new Error("Move fixture must produce a real preview");
    const target = snap ? { x: 3, y: 1 } : options.previewRect ?? { x: 5, y: 5 };
    test.editor.actions.moveCollectionTo({ collectionType: EntityCollectionType.preview,
      startGridPoint: { x: rect.x, y: rect.y }, endGridPoint: target });
  }
  Object.assign(test.canvas.state.runtime, { moveAnchor: options.moveAnchor ?? null,
    moveEnterFrom: options.moveEnterFrom ?? null, movePointerMode: options.movePointerMode ?? null });
  if (options.toolbarVisible) test.canvas.actions.showCanvasFloatingToolbarForCollection(MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST, EntityCollectionType.preview);
  for (const action of ["createMoveOperationDraft", "cancelMoveOperationDraft", "applyMoveOerationDraft", "moveCollectionTo",
    "moveCollectionCenterPointTo", "rotateCollection", "rotateCollectionAroundCenterPoint", "rotateCollectionAroundPivotCell",
    "rotateCollectionToSnapOnBuilding", "replaceEntityDefinition", "clearCollection", "addToCollection"] as const) vi.spyOn(test.editor.actions, action);
  for (const action of ["setActiveTool", "showCanvasFloatingToolbarForCollection", "hideCanvasFloatingToolbar",
    "showCanvasRightDockToolbar", "hideCanvasRightDockToolbar", "alignCanvasFloatingToolbar"] as const) vi.spyOn(test.canvas.actions, action);
  vi.spyOn(test.app.internalActions, "isShortcutFor");
  vi.spyOn(test.adapter, "handleUiButtonMouseTap");
  vi.spyOn(test.adapter, "handleUiButtonTouchTap");
  return { context: test.context, editor: test.editor, appHost: test.app,
    selection: test.editor.state.collections.selection, preview: test.editor.state.collections.preview };
}








function entity(
  id: string,
  position: GridPoint,
  definitionId = "belt_straight_1x1",
): WorldEntity {
  return {
    id,
    definitionId,
    position,
    rotation: 0,
    config: {},
    tags: [],
  };
}

function mouseLongPressReadyEvent(options: {
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "mouse-long-press-ready" as const,
    gestureId: "mouse-ready-1",
    button: 0,
    buttons: 1,
    position: options.position ?? { x: 2, y: 2 },
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

const MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

const ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT_FOR_TEST = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "delete-device", presentation: "shortcut" },
  { operationId: "switch-device-variant", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const BATCH_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_FOR_TEST = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "cancel-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

function tapLongPressReadyEvent(options: {
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "tap-long-press-ready" as const,
    gestureId: "tap-ready-1",
    primaryId: 1,
    position: options.position ?? { x: 2, y: 2 },
    activeTouchCount: 1,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  position: GridPoint;
  pointerEntity: WorldEntity | null;
  startPosition?: GridPoint;
}) {
  return {
    type: "touch dragstart" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    startPosition: options.startPosition ?? options.position,
    activeTouchCount: 1,
    longPress: true,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "touch dragmove" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    delta: { x: 1, y: -1 },
    activeTouchCount: 1,
    longPress: true,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseTapEvent(options: {
  button: number;
  longPress: boolean;
  modifiers?: Partial<ReturnType<typeof emptyModifiers>>;
}) {
  return {
    type: "mouse tap" as const,
    gestureId: "mouse-tap-1",
    button: options.button,
    buttons: 0,
    position: { x: 6, y: 4 },
    longPress: options.longPress,
    pointerEntity: null,
    modifiers: {
      ...emptyModifiers(),
      ...options.modifiers,
    },
    sourceEvent: null,
  };
}

function mouseMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "mouse move" as const,
    gestureId: "mouse-move-1",
    buttons: 0,
    position: options.position,
    delta: { x: 1, y: 1 },
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function keyDownEvent(options: {
  code: string | null;
  key: string | null;
}) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: options.key === null ? null : options.key.toUpperCase().charCodeAt(0),
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "ui-touch-tap-1",
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "ui-mouse-tap-1",
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function onEnterActiveToolEvent(from: ActiveTool, to: ActiveTool) {
  return {
    type: "on-enter-active-tool" as const,
    gestureId: "enter-active-tool-1",
    from,
    to,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragStartEvent(options: {
  originButton: number;
  pointerEntity: WorldEntity | null;
  position: GridPoint;
  startPosition?: GridPoint;
}) {
  return {
    type: "mouse dragstart" as const,
    gestureId: "mouse-drag-1",
    originButton: options.originButton,
    button: options.originButton,
    buttons: 1,
    position: options.position,
    startPosition: options.startPosition ?? options.position,
    longPress: false,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}



function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}
