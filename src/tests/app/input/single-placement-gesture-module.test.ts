import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile, createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });

import { afterEach, describe, expect, it, vi } from "vitest";



import type { CanvasRightDockToolbarItemRequest } from "@/app/state/state-impl";
import {
  createHypergryphSinglePlacementGestureModule,

} from "@/app/input/gesture/actions";



import {
  EntityCollectionType,
} from "@/domain/editor/types/editor-types";

import type { GridPoint, GridRect } from "@/domain/shared/grid";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphSinglePlacementGestureModule", () => {
  it("enters mouse single-placement from a placement device button at the viewport center", () => {
    const { context, editor } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementMouseTapEvent("log_splitter"), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理，
    // 触发点只写桥接变量 + setActiveTool。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    // 2026-06-23 订正：mouse 模式延迟创建 draft，鼠标不在 viewport 内时不创建
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(editor.actions.moveCollectionTo).not.toHaveBeenCalled();
    expect(editor.actions.moveCollectionCenterPointTo).not.toHaveBeenCalled();
    expect(context.canvas.state.runtime.placementAnchor).toBeNull();
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe("log_splitter");
    expect(context.canvas.actions.hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_FOR_TEST,
    );
  });

  it("enters from a placement button even when the current tool is not select", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementMouseTapEvent("log_splitter"), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("marquee", "single-placement"), context),
    ).toEqual({ status: "handled" });
    // 2026-06-23 订正：mouse 模式延迟创建 draft，鼠标不在 viewport 内时不创建
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
  });

  it("still only enters from select when using a number shortcut", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Digit3", key: "3" }),
    });

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("marquee");
  });

  it("enters touch single-placement and shows the floating toolbar for preview", () => {
    const { context } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementTouchTapEvent("log_splitter"), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    expect(context.canvas.actions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST,
    ]);
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      PLACEMENT_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
    expect(context.canvas.actions.hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);
    expect(context.canvas.actions.showCanvasRightDockToolbar).not.toHaveBeenCalled();
  });

  it("toggles touch continuous placement from the top-left toolbar", () => {
    const { context } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent(`${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-on`),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.singlePlacementContinuous).toBe(true);

    expect(
      module.handle(
        uiButtonTouchTapEvent(`${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-off`),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.singlePlacementContinuous).toBe(false);
  });

  it("closes the left dock when entering single-placement on mobile and tablet", () => {
    for (const deviceClass of ["mobile", "tablet"] as const) {
      const { context, appHost } = createContext({
        deviceClass,
        leftDockOpen: true,
      });
      const module = createHypergryphSinglePlacementGestureModule();

      const result = module.handle(placementMouseTapEvent("log_splitter"), context);

      expect(result).toEqual({ status: "handled" });
      expect(appHost.internalActions.setLeftDockSuppressed).not.toHaveBeenCalled();

      expect(
        module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
      ).toEqual({ status: "handled" });
      expect(appHost.internalActions.setLeftDockSuppressed).toHaveBeenCalledTimes(1);
      expect(appHost.internalActions.setLeftDockSuppressed).toHaveBeenCalledWith(true);
      expect(appHost.state.workbench.leftDockOpen).toBe(true);
      expect(appHost.internalState.workbench.leftDockSuppressed).toBe(true);
    }
  });

  it("selects a placement group from its configured shortcut while in select", () => {
    const { context, editor } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyG", key: "g" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.selectingPlacementGroup).toBe("resourcePower");
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
  });

  it("enters single-placement from the active placement group number shortcut", () => {
    const { context, editor } = createContext({
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Digit4", key: "4" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    // 2026-06-23 订正：mouse 模式延迟创建 draft，鼠标不在 viewport 内时不创建
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe("unloader_1");
  });

  it("uses the last mouse position when entering placement from a number shortcut", () => {
    const { context, editor } = createContext({
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(mouseMoveEvent({ position: { x: 7.8, y: 8.1 } }), context)).toEqual({
      status: "ignored",
    });

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Digit4", key: "4" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("single-placement");



    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith({ definitionId: "unloader_1", centerGridPoint: { x: 7, y: 8 } }
    );
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 7, y: 8 });
  });

  it("ignores number shortcuts when the active placement group has no target device for that slot", () => {
    const { context, editor } = createContext({
      selectingPlacementGroup: "resourcePower",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Digit0", key: "0" }),
    });

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("select");
  });

  it("ignores the same device while switching different devices without resetting activeTool", () => {
    const same = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 50, y: 40 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
    });
    const different = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 50, y: 40 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(placementMouseTapEvent("log_splitter"), same.context)).toEqual({
      status: "handled",
    });
    expect(same.editor.actions.cancelPlacementDraft).not.toHaveBeenCalled();
    expect(same.editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(module.handle(placementMouseTapEvent("log_converger"), different.context)).toEqual({
      status: "handled",
    });
    expect(different.editor.actions.cancelPlacementDraft).toHaveBeenCalledTimes(1);
    // 2026-06-23 订正：mouse 模式延迟创建 draft，切换设备后鼠标不在 viewport 内时不创建
    expect(different.editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(different.context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(different.context.canvas.state.activeTool).toBe("single-placement");
    expect(different.context.canvas.state.runtime.singlePlacementDeviceId).toBe("log_converger");
  });

  it("moves the placement preview by incremental grid vectors and aligns toolbar", () => {
    const { context, editor } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();



    const result = module.handle(touchDragMoveEvent({ position: { x: 6, y: 4 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 6, y: 4 },
    });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 6, y: 4 });
    expect(editor.actions.rotateCollectionToSnapOnBuilding).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      trigger: "after-move",
      pivotMode: "pivot-cell",
      clientPixelPoint: null, viewport: context.canvas.view.state,
    });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("updates touch placement anchor per axis when snapping constrains one axis", () => {
    const { context } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 20, y: -9 },
      singlePlacementDeviceId: "water_purifier_node_1",
      singlePlacementPointerMode: "touch",
      initialPreview: true,
      previewDefinitionId: "water_purifier_node_1",
      previewRect: { x: 10, y: -10, width: 27, height: 3 },
    });
    const module = createHypergryphSinglePlacementGestureModule();



    const result = module.handle(touchDragMoveEvent({ position: { x: 21, y: -8 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 21, y: -9 });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("moves the mouse placement preview by collection center point", () => {
    const { context, editor } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "mouse",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(mouseMoveEvent({ position: { x: 18, y: 23 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 18, y: 23 }, context.canvas.view.state,
    );
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 18, y: 23 });
    expect(context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("lets touch drag fall through when it does not start from the preview", () => {
    const { context } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

const missResult = module.handle(touchDragStartEvent({ position: { x: 32, y: 32 } }), context);

    expect(missResult).toEqual({ status: "ignored" });
    expect(context.canvas.state.runtime.placementAnchor).toBeNull();
  });

  it("starts touch dragging from the preview bounding box even when no entity is hit", () => {
    const { context } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "filling_pd_mc_1",
      previewDefinitionId: "filling_pd_mc_1",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 6, height: 4 },
    });
    const module = createHypergryphSinglePlacementGestureModule();



    const result = module.handle(touchDragStartEvent({ position: { x: 8, y: 8 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 8, y: 8 });
  });

  it("keeps a preview drag when the first movement leaves its bounds", () => {
    const { context, editor } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(touchDragStartEvent({
      startPosition: { x: 5, y: 5 },
      position: { x: 6, y: 5 },
    }), context);

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 5, y: 5 });

    expect(module.handle(touchDragMoveEvent({ position: { x: 7, y: 5 } }), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 7, y: 5 },
    });
  });

  it("rotates from the R key and toolbar button while placing", () => {
    const keyboard = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "mouse",
      initialPreview: true,
    });
    const toolbar = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: keyboard.context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    })).toEqual({ status: "handled" });
    expect(keyboard.appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
    expect(keyboard.editor.actions.rotateCollectionAroundCenterPoint).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(keyboard.context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-rotate"), toolbar.context),
    ).toEqual({ status: "handled" });
    expect(toolbar.editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(toolbar.context.canvas.actions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("uses building-snap rotation before the normal placement-preview rotation", () => {
    const { context, editor } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "loader_1",
      singlePlacementPointerMode: "touch",
      initialPreview: true,
      previewDefinitionId: "loader_1",
    });
    const module = createHypergryphSinglePlacementGestureModule();


    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-rotate"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionToSnapOnBuilding).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      trigger: "before-rotate",
      pivotMode: "pivot-cell",
      clientPixelPoint: null, viewport: context.canvas.view.state,
    });
    expect(editor.actions.rotateCollectionAroundPivotCell).not.toHaveBeenCalled();
    expect(editor.actions.rotateCollectionAroundCenterPoint).not.toHaveBeenCalled();
  });

  it("switches the placement preview variant from Tab and updates the touch toolbar", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 12, y: 11 },
      previewDefinitionId: "filling_pd_mc_1",
      previewRect: { x: 10, y: 10, width: 6, height: 4 },
      singlePlacementDeviceId: "filling_pd_mc_1",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "preview-entity",
      "filling_pd_mc_1_liquid",
    );
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe(
      "filling_pd_mc_1_liquid",
    );
    expect(context.canvas.actions.showCanvasFloatingToolbarForCollection).toHaveBeenLastCalledWith(
      [
        "canvas-floating-toolbar-button-cancel",
        "canvas-floating-toolbar-button-switch-mode",
        "canvas-floating-toolbar-button-rotate",
        "canvas-floating-toolbar-button-ok",
      ],
      EntityCollectionType.preview,
    );
  });

  it("shows the Tab shortcut for a switchable device in mouse placement", () => {
    const { context } = createContext({
      activeTool: "single-placement",
      singlePlacementDeviceId: "filling_pd_mc_1",
      singlePlacementPointerMode: "mouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(onEnterActiveToolEvent("select", "single-placement"), context)).toEqual({
      status: "handled",
    });
    expect(context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT_FOR_TEST,
    );
  });

  it("keeps mouse placement active when apply uses ctrl", () => {
    const { context, editor } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "mouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(
        mouseTapEvent({
          button: 0,
          longPress: false,
          modifiers: { ctrl: true },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith({ definitionId: "log_splitter", centerGridPoint: {
      x: 5,
      y: 5,
    } });
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 5, y: 5 });
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe("log_splitter");
  });

  it("keeps touch placement active and preserves rotation when continuous placement is enabled", () => {
    const { context, editor } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      previewRotation: 180,
      singlePlacementContinuous: true,
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith({ definitionId: "log_splitter", centerGridPoint: {
      x: 5,
      y: 5,
    } });
    expect(editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledTimes(2);
    expect(context.canvas.actions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      `${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-off`,
    ]);
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.state.runtime.singlePlacementContinuous).toBe(true);
  });

  it("keeps touch placement preview when the editor rejects apply", () => {
    const { context, editor, preview } = createContext({
      activeTool: "single-placement",
      applyPlacementDraftResult: false,
      initialPreview: true,
      placementAnchor: { x: -6, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(editor.actions.cancelPlacementDraft).not.toHaveBeenCalled();
    expect([...preview]).toEqual(["preview-entity"]);
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: -6, y: 5 });
    expect(context.canvas.state.runtime.singlePlacementDeviceId).toBe("log_splitter");
  });

  it("does not continue touch placement when the editor rejects apply", () => {
    const { context, editor, preview } = createContext({
      activeTool: "single-placement",
      applyPlacementDraftResult: false,
      initialPreview: true,
      placementAnchor: { x: -6, y: 5 },
      singlePlacementContinuous: true,
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect([...preview]).toEqual(["preview-entity"]);
    expect(context.canvas.actions.setActiveTool).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("single-placement");
    expect(context.canvas.state.runtime.singlePlacementContinuous).toBe(true);
  });

  it("applies with mouse left tap and cancels from the toolbar", () => {
    const apply = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "mouse",
      initialPreview: true,
    });
    const cancel = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementContinuous: true,
      singlePlacementDeviceId: "log_splitter",
      singlePlacementPointerMode: "touch",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(mouseTapEvent({ button: 0, longPress: false }), apply.context)).toEqual({
      status: "handled",
    });
    expect(apply.editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(apply.context.canvas.state.activeTool).toBe("select");
    expect(apply.context.canvas.state.runtime.placementAnchor).toBeNull();
    expect(apply.context.canvas.state.runtime.singlePlacementDeviceId).toBeNull();
    expect(apply.context.canvas.actions.hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), cancel.context),
    ).toEqual({ status: "handled" });
    expect(cancel.editor.actions.cancelPlacementDraft).toHaveBeenCalledTimes(1);
    expect(cancel.context.canvas.actions.hideCanvasTopLeftCornerToolbar).toHaveBeenCalledTimes(1);
    expect(cancel.context.canvas.state.activeTool).toBe("select");
    expect(cancel.context.canvas.state.runtime.placementAnchor).toBeNull();
    expect(cancel.context.canvas.state.runtime.singlePlacementContinuous).toBe(false);
    expect(cancel.context.canvas.state.runtime.singlePlacementDeviceId).toBeNull();
    expect(cancel.context.canvas.actions.hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);
  });
});

function createContext(options: {
  activeTool?: "select" | "move" | "marquee" | "single-placement";
  placementAnchor?: GridPoint | null;
  previewRotation?: 0 | 90 | 180 | 270;
  singlePlacementContinuous?: boolean;
  singlePlacementDeviceId?: string | null;
  singlePlacementPointerMode?: "mouse" | "touch" | null;
  selectingPlacementGroup?: "beltLogistics" | "pipeLogistics" | "resourcePower" | "warehouse" | "basicProduction" | "advancedManufacturing" | null;
  initialPreview?: boolean;
  previewRect?: GridRect;
  deviceClass?: "desktop" | "tablet" | "mobile";
  leftDockOpen?: boolean;
  applyPlacementDraftResult?: boolean;
  previewDefinitionId?: string;
} = {}) {
  const edgeSnapped = options.previewDefinitionId === "water_purifier_node_1";
  const buildingSnapped = options.previewDefinitionId === "loader_1";
  const test = createCanvasTestSession({ activeTool: options.activeTool,
    document: buildingSnapped ? createWorldDocumentFromBlueprint(loadBlueprintFromFile(
      "src/tests/fixtures/blueprints/collections/editor/editor-host/scene-12-variant-1.schema7.json")) : undefined,
    viewport: { center: { x: 50, y: 40 }, gridSize: 1 / 16, displayRotation: 0 },
    space: edgeSnapped ? { areas: [{ id: "test-space", bounds: { minX: null, maxX: null, minY: 0, maxY: null },
      outerRing: { top: 10, right: 0, bottom: 0, left: 0 } }] } : undefined,
    policy: { getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
      resolvePlacementAreaIds: (_entity, space) => space.areas.map(area => area.id),
      validateTransition: () => options.applyPlacementDraftResult === false ? ["test-policy-rejected"] : [] },
  });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 80 });
  test.app.internalState.screenProfile = { ...test.app.state.screenProfile, deviceClass: options.deviceClass ?? "desktop" };
  test.app.internalState.workbench.leftDockOpen = options.leftDockOpen ?? true;
  Object.assign(test.canvas.state.runtime, {
    placementAnchor: options.placementAnchor ?? null, singlePlacementContinuous: options.singlePlacementContinuous ?? false,
    singlePlacementDeviceId: options.singlePlacementDeviceId ?? null,
    singlePlacementPointerMode: options.singlePlacementPointerMode ?? null, selectingPlacementGroup: options.selectingPlacementGroup ?? null,
  });
  if (options.initialPreview) {
    const definitionId = options.previewDefinitionId ?? options.singlePlacementDeviceId ?? "log_splitter";
    const definition = test.workspace.registry.queries.findEntityDefinition(definitionId)!;
    const center = buildingSnapped ? { x: 4, y: 1 } : options.previewRect === undefined ? options.placementAnchor ?? { x: 0, y: 0 } : {
      x: options.previewRect.x + Math.floor((definition.footprint.width - 1) / 2),
      y: options.previewRect.y + Math.floor((definition.footprint.height - 1) / 2),
    };
    test.editor.actions.createSinglePlacementDraft({ definitionId, centerGridPoint: center, entityId: "preview-entity" });
    for (let angle = 0; angle < (options.previewRotation ?? 0); angle += 90) test.editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
  }
  for (const action of ["createSinglePlacementDraft", "cancelPlacementDraft", "applyPlacementDraft", "moveCollectionTo",
    "moveCollectionCenterPointTo", "rotateCollection", "rotateCollectionAroundCenterPoint", "rotateCollectionAroundPivotCell",
    "rotateCollectionToSnapOnBuilding", "replaceEntityDefinition"] as const) vi.spyOn(test.editor.actions, action);
  for (const action of ["setActiveTool", "showCanvasFloatingToolbarForCollection", "hideCanvasFloatingToolbar",
    "showCanvasTopLeftCornerToolbar", "hideCanvasTopLeftCornerToolbar", "showCanvasRightDockToolbar",
    "hideCanvasRightDockToolbar", "alignCanvasFloatingToolbar"] as const) vi.spyOn(test.canvas.actions, action);
  vi.spyOn(test.app.internalActions, "setLeftDockSuppressed");
  vi.spyOn(test.app.internalActions, "isShortcutFor");
  return { context: test.context, editor: test.editor, appHost: test.app,
    preview: test.editor.state.collections.preview };
}


const PLACEMENT_TOOLBAR_BUTTON_IDS_FOR_TEST = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

const CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST =
  "canvas-top-left-corner-toolbar-button-toggle-continuous-placement";

const PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_FOR_TEST = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "continuous-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT_FOR_TEST = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "switch-device-variant", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "continuous-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];









function placementMouseTapEvent(deviceId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "placement-mouse-tap-1",
    uiButtonId: `ui-left-dock-placement-mode-${deviceId}-mouse-tap`,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function placementTouchTapEvent(deviceId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "placement-touch-tap-1",
    uiButtonId: `ui-left-dock-placement-mode-${deviceId}-touch-tap`,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  position: GridPoint;
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
    pointerEntity: null,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragMoveEvent(options: { position: GridPoint }) {
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

function mouseMoveEvent(options: { position: { x: number; y: number } }) {
  return {
    type: "mouse move" as const,
    gestureId: "mouse-move-1",
    buttons: 0,
    position: options.position,
    delta: { x: 0, y: 0 },
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

function onEnterActiveToolEvent(
  from: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
  to: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
) {
  return {
    type: "on-enter-active-tool" as const,
    gestureId: "enter-active-tool-1",
    from,
    to,
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

