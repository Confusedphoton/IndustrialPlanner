import type { CanvasInteractionController } from "@/app/canvas";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import { action, reaction } from "mobx";
import type { UiKey } from "@/shared/i18n";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import {
  hasPlaceableEntityDefinitionInCurrentBase,
  canPlaceEntityDefinitionInCurrentBase,
} from "@/app/placement-zone-availability";
import type { CanvasRightDockToolbarItemRequest } from "@/app/state/state-impl";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import type {
  CreateLogisticsDraftStartOptions,
  LogisticsDraftActionResult,
  LogisticsDraftEndpoint,
  LogisticsDraftReadonlyState,
  LogisticsKind,
  LogisticsRouteOrder,
} from "@/domain/shared/logistics";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { createLogger } from "@/shared/logging/logger";

import type { GestureHandleResult, GestureMappingModule, ShortcutActionRoute } from "../types";
import {
  PLACEMENT_DEVICE_SHORTCUT_KEYS,
  resolveDeviceIdForPlacementGroupShortcut,
  setPendingSinglePlacementEnter,
} from "./hypergryph-single-placement-gesture-module";

const LOGISTICS_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-ok",
] as const;

const LOGISTICS_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "exit", presentation: "button" },
] as const;

const BELT_START_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "confirm-logistics-start", presentation: "shortcut" },
  { operationId: "change-belt-route-priority", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const BELT_END_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "confirm-logistics-end", presentation: "shortcut" },
  { operationId: "change-belt-route-priority", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const PIPE_START_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "confirm-logistics-start", presentation: "shortcut" },
  { operationId: "change-pipe-route-priority", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const PIPE_END_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "confirm-logistics-end", presentation: "shortcut" },
  { operationId: "change-pipe-route-priority", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];


/** 画布工具条在物流布设模式下的上下文按钮：切换优先方向、取消正在绘制的路线。 */
export const LOGISTICS_ROUTE_ORDER_BUTTON_ID = "canvas-tool-rail-logistics-route-order";
export const LOGISTICS_CANCEL_ROUTE_BUTTON_ID = "canvas-tool-rail-logistics-cancel-route";

const BELT_DRAW_BUTTON_ID = "placement-action-belt-draw";
const PIPE_DRAW_BUTTON_ID = "placement-action-pipe-draw";

const logisticsLogger = createLogger("logistics-placement");
const GRID_EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];

interface LogisticsPlacementBehaviorOptions {
  readonly allowEmptySource: boolean;
  readonly autoCreateSplittersAndConvergers: boolean;
}

// 模式拥有提示策略；统一观察阶段与设置，悬停草稿不视为正式起笔。
export function bindLogisticsPlacementAlert(canvas: CanvasInteractionController): () => void {
  return reaction(
    (): UiKey | null => {
      const runtime = canvas.state.runtime.logisticsPlacement;
      if (canvas.state.activeTool !== "logistics-placement"
        || runtime.kind === null || runtime.phase !== "idle") return null;
      const allowEmpty = canvas.workbench.state.settings.hypergryphAllowEmptyLogisticsEndpoints;
      if (runtime.kind === LOGISTICS_KIND.belt) {
        return allowEmpty ? "canvas.alert.beltStartWithEmpty" : "canvas.alert.beltStart";
      }
      return allowEmpty ? "canvas.alert.pipeStartWithEmpty" : "canvas.alert.pipeStart";
    },
    (messageKey) => canvas.actions.setCanvasAlert(messageKey),
    { fireImmediately: true },
  );
}

function showEmptyLogisticsStartToast(canvas: CanvasInteractionController): void {
  canvas.actions.showCanvasToast(
    canvas.state.runtime.logisticsPlacement.kind === LOGISTICS_KIND.belt
      ? "canvas.toast.beltStart" : "canvas.toast.pipeStart",
  );
}

export function createHypergryphLogisticsPlacementGestureModule(): GestureMappingModule<AppHost> {
  let activeTouchLogisticsDragGestureId: string | null = null;
  let activeMouseLogisticsDragGestureId: string | null = null;

  return {
    id: "hypergryph-logistics-placement-gesture",
    cancel() {
      activeTouchLogisticsDragGestureId = null;
      activeMouseLogisticsDragGestureId = null;
    },
    shortcutRoutes: [
      ...([
        [SHORTCUT_KEY.PLACE_CONVEYOR, LOGISTICS_KIND.belt],
        [SHORTCUT_KEY.PLACE_PIPE, LOGISTICS_KIND.pipe],
      ] as const).map<ShortcutActionRoute<AppHost>>(([shortcutId, kind]) => ({
        id: `logistics-placement.switch-${kind}`,
        operation: "logistics-placement",
        actionId: shortcutId,
        binding: { kind: "configurable", shortcutId },
        scope: { inputLayers: ["canvas"], activeTools: ["select", "logistics-placement"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        handle: action<ShortcutActionRoute<AppHost>["handle"]>((_event, context) => {
          if (kind === LOGISTICS_KIND.pipe && !hasPlaceableEntityDefinitionInCurrentBase(context.canvas, "pipeLogistics")) {
            return { status: "ignored" };
          }
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          enterLogisticsPlacementMode({
            canvas: context.canvas,
            editor,
            kind,
            pointerMode: "mouse",
          });
          return { status: "handled" };
        }),
      })),
      ...PLACEMENT_DEVICE_SHORTCUT_KEYS.map<ShortcutActionRoute<AppHost>>((shortcut, shortcutIndex) => ({
        id: `logistics-placement.device-${shortcutIndex}`,
        operation: "logistics-placement",
        actionId: `fixed.placement-device.${shortcutIndex}`,
        binding: { kind: "fixed", value: shortcut },
        scope: { inputLayers: ["canvas"], activeTools: ["logistics-placement"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        handle: action<ShortcutActionRoute<AppHost>["handle"]>((_event, context) => handleLogisticsDeviceShortcutIndex({
          canvas: context.canvas,
          editor: context.canvas.editor,
          shortcutIndex,
        })),
      })),
      {
        id: "current-operation.flip-logistics-route",
        operation: "logistics-placement",
        actionId: SHORTCUT_KEY.ROTATE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.ROTATE },
        scope: { inputLayers: ["canvas"], activeTools: ["logistics-placement"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        claimsBrowserDefault: true,
        handle: action<ShortcutActionRoute<AppHost>["handle"]>((_event, context) => {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          handleRouteOrderChange(context.canvas, editor);
          return { status: "handled" };
        }),
      },
    ],
    handle: action<GestureMappingModule<AppHost>["handle"]>((event, context) => {
      if (event.type === "on-exit-active-tool") {
        if (event.from !== "logistics-placement" || event.to === "logistics-placement") {
          return { status: "ignored" };
        }

        activeTouchLogisticsDragGestureId = null;
        activeMouseLogisticsDragGestureId = null;
        cleanupLogisticsPlacement(context.canvas);
        context.canvas.actions.hideCanvasTopLeftCornerToolbar();
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "logistics-placement") {
          return { status: "ignored" };
        }

        syncLogisticsPlacementEntryUi(context.canvas);
        return { status: "handled" };
      }

      const editor = context.canvas.editor;

      if (event.type === "mouse move") {
        context.canvas.state.runtime.logisticsPlacement.lastMousePosition = event.position;
      }

      if (editor === null) {
        if (
          context.canvas.state.activeTool === "logistics-placement"
          && event.type === "mouse tap"
          && event.button === 0
        ) {
          const runtime = context.canvas.state.runtime.logisticsPlacement;
          logMouseLogisticsPlacementFailure(
            runtime.phase === "idle" ? "start" : "apply",
            "editor-unavailable",
            {
              kind: runtime.kind,
              longPress: event.longPress,
              position: event.position,
            },
          );
        }
        return { status: "ignored" };
      }

      if (event.type === "ui-button-mouse-tap" && event.button === 0) {
        const kind = resolveKindFromOperationButton(event.uiButtonId);
        if (kind !== null) {
          if (
            kind === LOGISTICS_KIND.pipe
            && !hasPlaceableEntityDefinitionInCurrentBase(context.canvas, "pipeLogistics")
          ) {
            return { status: "ignored" };
          }

          enterLogisticsPlacementMode({
            canvas: context.canvas,
            editor,
            kind,
            pointerMode: "mouse",
          });
          return { status: "handled" };
        }
      }

      if (event.type === "ui-button-touch-tap") {
        const kind = resolveKindFromOperationButton(event.uiButtonId);
        if (kind !== null) {
          if (
            kind === LOGISTICS_KIND.pipe
            && !hasPlaceableEntityDefinitionInCurrentBase(context.canvas, "pipeLogistics")
          ) {
            return { status: "ignored" };
          }

          enterLogisticsPlacementMode({
            canvas: context.canvas,
            editor,
            kind,
            pointerMode: "touch",
          });
          return { status: "handled" };
        }
      }

      if (context.canvas.state.activeTool !== "logistics-placement") {
        activeTouchLogisticsDragGestureId = null;
        activeMouseLogisticsDragGestureId = null;
        return { status: "ignored" };
      }

      switch (event.type) {
        case "touch tap":
          return handleTouchTap({
            canvas: context.canvas,
            editor,
            position: event.position,
            pointerEntityId: event.pointerEntity?.id ?? null,
          });

        case "touch dragstart": {
          const result = handleTouchDragStart({
            canvas: context.canvas,
            editor,
            position: event.position,
            startPosition: event.startPosition,
          });
          activeTouchLogisticsDragGestureId = result.status === "claimed" ? event.gestureId : null;
          return result;
        }

        case "touch dragmove":
          if (activeTouchLogisticsDragGestureId !== event.gestureId) {
            return { status: "ignored" };
          }

          return handleTouchDragMove({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "touch dragend": {
          if (activeTouchLogisticsDragGestureId !== event.gestureId) {
            return { status: "ignored" };
          }

          activeTouchLogisticsDragGestureId = null;
          return context.canvas.state.runtime.logisticsPlacement.phase === "idle"
            ? { status: "ignored" }
            : { status: "handled" };
        }

        case "mouse dragstart": {
          if (event.originButton !== 0) {
            return { status: "ignored" };
          }

          const claimed = startMouseLogisticsDrag({
            canvas: context.canvas,
            editor,
            position: event.position,
            startPosition: event.startPosition,
          });
          activeMouseLogisticsDragGestureId = claimed ? event.gestureId : null;
          return claimed ? { status: "claimed" } : { status: "ignored" };
        }

        case "mouse dragmove":
          if (activeMouseLogisticsDragGestureId !== event.gestureId) {
            return { status: "ignored" };
          }

          moveMouseLogisticsDragEnd(context.canvas, editor, event.position);
          return { status: "handled" };

        case "mouse dragend":
          if (activeMouseLogisticsDragGestureId !== event.gestureId) {
            return { status: "ignored" };
          }

          activeMouseLogisticsDragGestureId = null;
          finishMouseLogisticsDrag(context.canvas, editor, event.reason === "release");
          return { status: "handled" };

        case "mouse move": {
          const runtime = context.canvas.state.runtime.logisticsPlacement;
          if (runtime.phase === "idle") {
            editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          } else {
            editor.actions.clearHoverPoint();
          }
          return driveMouseLogisticsPreview({
            canvas: context.canvas,
            editor,
            position: event.position,
          });
        }

        case "mouse tap":
          if (event.button === 2) {
            const draftState = editor.queries.resolveLogisticsDraftState();
            if (draftState !== null) {
              cancelLogisticsPlacement(context.canvas, editor);
              return { status: "handled" };
            }

            exitLogisticsPlacementToSelect(context.canvas, editor);
            return { status: "handled" };
          }

          if (event.button !== 0) {
            return { status: "ignored" };
          }

          if (event.longPress) {
            const runtime = context.canvas.state.runtime.logisticsPlacement;
            logMouseLogisticsPlacementFailure(
              runtime.phase === "idle" || runtime.isHoverPreview ? "start" : "apply",
              "long-press-does-not-place-logistics",
              {
                kind: runtime.kind,
                position: event.position,
              },
            );
            return { status: "ignored" };
          }

          return handleMouseLeftTap({
            canvas: context.canvas,
            editor,
            position: event.position,
            pointerEntityId: event.pointerEntity?.id ?? null,
          });

        case "ui-button-touch-tap":
        case "ui-button-mouse-tap":
          if (event.type === "ui-button-mouse-tap" && event.button !== 0) {
            return { status: "ignored" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyTouchLogisticsPlacement(context.canvas, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelLogisticsPlacement(context.canvas, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-right-dock-toolbar-button-exit") {
            exitLogisticsPlacementToSelect(context.canvas, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === LOGISTICS_ROUTE_ORDER_BUTTON_ID) {
            handleRouteOrderChange(context.canvas, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === LOGISTICS_CANCEL_ROUTE_BUTTON_ID) {
            cancelLogisticsPlacement(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    }),
  };
}

export function cleanupLogisticsPlacement(canvas: CanvasInteractionController): void {
  const editor = canvas.editor;
  if (editor !== null) {
    safelyCancelLogisticsDraft(editor);
  }

  resetLogisticsRuntime(canvas);
  canvas.actions.hideCanvasFloatingToolbar();
  canvas.actions.hideCanvasRightDockToolbar();
}

function enterLogisticsPlacementMode(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  pointerMode: "mouse" | "touch";
}): void {
  const wasLogisticsPlacement = options.canvas.state.activeTool === "logistics-placement";
  if (wasLogisticsPlacement) {
    safelyCancelLogisticsDraft(options.editor);
  }

  resetLogisticsRuntime(options.canvas);
  const runtime = options.canvas.state.runtime.logisticsPlacement;
  runtime.kind = options.kind;
  runtime.shortcutPlacementGroup = options.kind === LOGISTICS_KIND.belt
    ? "beltLogistics"
    : "pipeLogistics";
  runtime.pointerMode = options.pointerMode;
  runtime.phase = "idle";
  runtime.routeOrder = "vertical-first";
  options.canvas.state.runtime.selectingPlacementGroup = runtime.shortcutPlacementGroup;
  options.canvas.editor?.actions.setLogisticsSuppression(
    options.kind === LOGISTICS_KIND.belt
      ? LOGISTICS_KIND.pipe
      : LOGISTICS_KIND.belt,
    true,
  );
  options.canvas.actions.showCanvasTopLeftCornerToolbar(
    options.kind === LOGISTICS_KIND.belt
      ? ["canvas-top-left-corner-toolbar-button-toggle-pipe-off"]
      : ["canvas-top-left-corner-toolbar-button-toggle-belt-off"],
  );
  options.canvas.actions.setActiveTool("logistics-placement");
  options.editor.actions.clearCollection(EntityCollectionType.selection);

  if (wasLogisticsPlacement) {
    syncLogisticsPlacementEntryUi(options.canvas);
  }
}

function handleTouchTap(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
  pointerEntityId: string | null;
}): GestureHandleResult {
  const kind = options.canvas.state.runtime.logisticsPlacement.kind;
  const gridPoint = resolveGridPointFromGesturePosition(options.canvas.view, options.position);
  if (kind !== null && gridPoint !== null && options.pointerEntityId === null
    && options.canvas.state.runtime.logisticsPlacement.phase === "idle"
    && !resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource) {
    showEmptyLogisticsStartToast(options.canvas);
    return { status: "handled" };
  }
  if (kind === null || gridPoint === null || options.pointerEntityId === null) {
    return { status: "ignored" };
  }

  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(gridPoint, kind);
  if (endpoint?.type !== "device-port" || endpoint.portDirection !== "output") {
    return { status: "ignored" };
  }

  const result = options.editor.actions.createLogisticsDraftStart({
    kind,
    allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
    source: resolveDevicePortStartSource(endpoint, gridPoint),
    routeOrder: options.canvas.state.runtime.logisticsPlacement.routeOrder,
  });

  updateRuntimeFromResult({
    canvas: options.canvas,
    pointerMode: "touch",
    phase: "drawing",
    result,
  });

  // 设备源创建 draft 后立即生成首个 freehand cell，
  // 保证 logisticsHead collection 非空，后续拖拽可正常继续。
  // 而非触摸点所在设备内部格，否则第一节管道出现在设备身上而非向外伸出。
  moveTouchLogisticsEnd({
    canvas: options.canvas,
    editor: options.editor,
    gridPoint: endpoint.outsideGridPoint,
  });

  // showTouchToolbar 必须在 moveTouchLogisticsEnd 填充 logisticsHead 之后调用，
  // 否则 alignCanvasFloatingToolbar 因 collection 为空而失败，导致工具条被隐藏。
  showTouchToolbar(options.canvas);

  return { status: "handled" };
}

function handleTouchDragStart(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
  startPosition: GesturePosition;
}): GestureHandleResult {
  const kind = options.canvas.state.runtime.logisticsPlacement.kind;
  const startGridPoint = resolveGridPointFromGesturePosition(options.canvas.view, options.startPosition);
  const pointerGridPoint = resolveGridPointFromGesturePosition(options.canvas.view, options.position);
  if (kind === null || startGridPoint === null || pointerGridPoint === null) {
    return { status: "ignored" };
  }

  if (options.editor.queries.resolveLogisticsDraftState() !== null) {
    const onHead = isTouchDragStartOnLogisticsHead(options.editor, options.canvas.view, options.startPosition);
    if (!onHead) {
      return { status: "ignored" };
    }

    options.canvas.state.runtime.logisticsPlacement.pointerMode = "touch";
    moveTouchLogisticsEnd({
      canvas: options.canvas,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    return { status: "claimed" };
  }

  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
    startGridPoint,
    kind,
  );
  if (endpoint?.type === "device-port" && endpoint.portDirection === "output") {
    const runtime = options.canvas.state.runtime.logisticsPlacement;
    runtime.pointerMode = "touch";
    runtime.phase = "waiting-touch-device-exit";
    runtime.sourceEntityId = endpoint.entityId;
    runtime.anchorGridPoint = startGridPoint;

    if (isGridPointInsideEntity(options, endpoint.entityId, pointerGridPoint)) {
      return { status: "claimed" };
    }

    const result = options.editor.actions.createLogisticsDraftStart({
      kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
      source: resolveDevicePortStartSource(endpoint, pointerGridPoint),
      routeOrder: runtime.routeOrder,
    });
    updateRuntimeFromResult({
      canvas: options.canvas,
      pointerMode: "touch",
      phase: "drawing",
      result,
    });
    moveTouchLogisticsEnd({
      canvas: options.canvas,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    showTouchToolbar(options.canvas);
    return { status: "claimed" };
  }

  if (endpoint?.type === "logistics-entity") {
    const result = options.editor.actions.createLogisticsDraftStart({
      kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
      source: {
        type: "logistics-entity",
        entityId: endpoint.entityId,
        gridPoint: endpoint.gridPoint,
      },
      routeOrder: options.canvas.state.runtime.logisticsPlacement.routeOrder,
    });
    updateRuntimeFromResult({
      canvas: options.canvas,
      pointerMode: "touch",
      phase: "drawing",
      result,
    });
    moveTouchLogisticsEnd({
      canvas: options.canvas,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    showTouchToolbar(options.canvas);
    return { status: "claimed" };
  }

  const startEntity = options.editor.queries.findEntityAtClientPixelPoint(options.startPosition, options.canvas.view.state);
  if (startEntity === null) {
    if (!resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource) {
      showEmptyLogisticsStartToast(options.canvas);
      return { status: "ignored" };
    }

    const result = options.editor.actions.createLogisticsDraftStart({
      kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
      source: {
        type: "empty-cell",
        gridPoint: startGridPoint,
      },
      routeOrder: options.canvas.state.runtime.logisticsPlacement.routeOrder,
    });
    updateRuntimeFromResult({
      canvas: options.canvas,
      pointerMode: "touch",
      phase: "drawing",
      result,
    });
    moveTouchLogisticsEnd({
      canvas: options.canvas,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    showTouchToolbar(options.canvas);
    return { status: "claimed" };
  }

  return { status: "ignored" };
}

function handleTouchDragMove(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
}): GestureHandleResult {
  const runtime = options.canvas.state.runtime.logisticsPlacement;
  const kind = runtime.kind;
  const gridPoint = resolveGridPointFromGesturePosition(options.canvas.view, options.position);
  if (kind === null || gridPoint === null) {
    return { status: "ignored" };
  }

  // 记录是否在本帧从 waiting-touch-device-exit 转为 drawing，
  // 确保 showTouchToolbar 在 moveLogisticEnd 填充 logisticsHead 之后才调用。
  let didExitWaitingForDevice = false;

  if (runtime.phase === "waiting-touch-device-exit") {
    if (runtime.sourceEntityId === null || isGridPointInsideEntity(options, runtime.sourceEntityId, gridPoint)) {
      return { status: "handled" };
    }

    const startResult = options.editor.actions.createLogisticsDraftStart({
      kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
      source: {
        type: "device",
        entityId: runtime.sourceEntityId,
        pointerGridPoint: gridPoint,
      },
      routeOrder: runtime.routeOrder,
    });
    updateRuntimeFromResult({
      canvas: options.canvas,
      pointerMode: "touch",
      phase: "drawing",
      result: startResult,
    });
    didExitWaitingForDevice = true;
  }

  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: gridPoint,
    ...resolveMoveLogisticsDraftBehaviorOptions(options.canvas),
    routeMode: { type: "freehand" },
  });
  updateRuntimeFromResult({
    canvas: options.canvas,
    pointerMode: "touch",
    phase: result.targetEntityId === null ? "drawing" : "snapped-target",
    result,
  });
  options.canvas.actions.alignCanvasFloatingToolbar();

  if (didExitWaitingForDevice) {
    showTouchToolbar(options.canvas);
  }

  return { status: "handled" };
}

function driveMouseLogisticsPreview(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
}): GestureHandleResult {
  const runtime = options.canvas.state.runtime.logisticsPlacement;
  const kind = runtime.kind;
  const gridPoint = resolveGridPointFromGesturePosition(options.canvas.view, options.position);
  if (kind === null || gridPoint === null) {
    return { status: "ignored" };
  }

  const draftState = options.editor.queries.resolveLogisticsDraftState();
  if (draftState === null || runtime.isHoverPreview) {
    return driveMouseLogisticsStartPreview({
      canvas: options.canvas,
      editor: options.editor,
      kind,
      gridPoint,
    });
  }

  if (
    runtime.lastPreviewGridPoint !== null
    && areGridPointsEqual(runtime.lastPreviewGridPoint, gridPoint)
  ) {
    return { status: "handled" };
  }

  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: gridPoint,
    ...resolveMoveLogisticsDraftBehaviorOptions(options.canvas),
    routeMode: {
      type: "single-bend",
      routeOrder: runtime.routeOrder,
      allowTemporaryOrderFlip: true,
    },
  });
  updateRuntimeFromResult({
    canvas: options.canvas,
    pointerMode: "mouse",
    phase: result.targetEntityId === null ? "drawing" : "snapped-target",
    result,
  });
  runtime.lastPreviewGridPoint = gridPoint;
  return { status: "handled" };
}

function driveMouseLogisticsStartPreview(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  gridPoint: GridPoint;
}): GestureHandleResult {
  const runtime = options.canvas.state.runtime.logisticsPlacement;
  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
    options.gridPoint,
    options.kind,
  );

  if (endpoint?.type !== "device-port" || endpoint.portDirection !== "output") {
    if (runtime.isHoverPreview) {
      options.editor.actions.cancelLogisticsDraft();
      softResetLogisticsRuntime(options.canvas);
    }
    runtime.lastPreviewGridPoint = options.gridPoint;
    return { status: "ignored" };
  }

  if (
    runtime.isHoverPreview
    && runtime.lastPreviewGridPoint !== null
    && areGridPointsEqual(runtime.lastPreviewGridPoint, options.gridPoint)
  ) {
    return { status: "handled" };
  }

  const result = options.editor.actions.createLogisticsDraftStart({
    kind: options.kind,
    allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
    source: resolveDevicePortStartSource(endpoint, options.gridPoint),
    routeOrder: runtime.routeOrder,
  });
  updateRuntimeFromResult({
    canvas: options.canvas,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
  runtime.phase = "idle";
  runtime.isHoverPreview = true;
  runtime.lastPreviewGridPoint = options.gridPoint;
  showMouseLogisticsPlacementShortcuts(options.canvas);
  return { status: "handled" };
}

function handleMouseLeftTap(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
  pointerEntityId: string | null;
}): GestureHandleResult {
  const runtime = options.canvas.state.runtime.logisticsPlacement;
  const kind = runtime.kind;
  const gridPoint = resolveGridPointFromGesturePosition(options.canvas.view, options.position);
  if (kind === null) {
    logMouseLogisticsPlacementFailure("start", "logistics-kind-missing", {
      kind,
      phase: runtime.phase,
      position: options.position,
    });
    return { status: "ignored" };
  }

  if (gridPoint === null) {
    logMouseLogisticsPlacementFailure(
      runtime.phase === "idle" || runtime.isHoverPreview ? "start" : "apply",
      "pointer-outside-editor-grid",
      {
        kind,
        phase: runtime.phase,
        position: options.position,
      },
    );
    return { status: "ignored" };
  }

  const draftState = options.editor.queries.resolveLogisticsDraftState();
  if (draftState === null) {
    runtime.isHoverPreview = false;
    return createMouseLogisticsStart({
      ...options,
      kind,
      gridPoint,
    });
  }

  if (runtime.isHoverPreview) {
    runtime.isHoverPreview = false;
    runtime.phase = "drawing";
    runtime.pointerMode = "mouse";
    runtime.lastPreviewGridPoint = gridPoint;
    showMouseLogisticsPlacementShortcuts(options.canvas);
    return { status: "handled" };
  }

  const headGridPoint = runtime.headGridPoint;
  const targetEntityId = runtime.targetEntityId;
  const headDraftId = draftState?.headDraftEntityId ?? null;
  const headEntity = headDraftId !== null
    ? options.editor.queries.getEntityById(headDraftId)
    : null;
  const isHeadConverger = headEntity !== null
    && options.canvas.registry.queries.resolveLogisticsRole(headEntity.definitionId)
      === "converger";
  const shouldStopAtExistingBeltStart = shouldStopAfterApplyingToExistingBeltStart({
    canvas: options.canvas,
    editor: options.editor,
    draftState,
    headGridPoint,
    targetEntityId,
    kind,
  });

  if (!options.editor.actions.applyLogisticDraft()) {
    const rejectedDraftState =
      options.editor.queries.resolveLogisticsDraftState() ?? draftState;
    const invalidReason = rejectedDraftState.invalidReason;
    const previewEntityIds =
      options.editor.state.collections[EntityCollectionType.preview];
    const failureReason = invalidReason
      ?? (
        !rejectedDraftState.canApply
          ? "draft-not-applicable"
          : rejectedDraftState.cells.length === 0
            ? "empty-path"
            : previewEntityIds.length === 0
              ? "preview-collection-empty"
              : "editor-apply-rejected"
    );
    runtime.statusMessageKey = invalidReason ?? "unknown";
    logMouseLogisticsPlacementFailure("apply", failureReason, {
      kind,
      gridPoint,
      phase: runtime.phase,
      invalidReason,
      canApply: rejectedDraftState.canApply,
      cellCount: rejectedDraftState.cells.length,
      sourceType: rejectedDraftState.source?.type ?? null,
      targetType: rejectedDraftState.target?.type ?? null,
      headDraftEntityId: rejectedDraftState.headDraftEntityId,
      previewEntityCount: previewEntityIds.length,
    });
    return { status: "handled" };
  }

  // 自动创建汇流器后终止本次绘制，用户需重新选起点
  if (isHeadConverger || shouldStopAtExistingBeltStart) {
    softResetLogisticsRuntime(options.canvas);
    return { status: "handled" };
  }

  // 若终止于设备端口则回到准备起笔状态，不从入口前那一格继续
  if (headGridPoint !== null && targetEntityId === null) {
    createContinuedMouseLogisticsStart({
      canvas: options.canvas,
      editor: options.editor,
      kind,
      gridPoint: headGridPoint,
      entityId: headDraftId,
    });
  } else {
    softResetLogisticsRuntime(options.canvas);
  }

  return { status: "handled" };
}

function createMouseLogisticsStart(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  gridPoint: GridPoint;
  pointerEntityId: string | null;
}): GestureHandleResult {
  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
    options.gridPoint,
    options.kind,
  );
  const behavior = resolveLogisticsPlacementBehaviorOptions(options.canvas);
  let result: LogisticsDraftActionResult | null = null;

  if (endpoint?.type === "device-port" && endpoint.portDirection === "output") {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: behavior.allowEmptySource,
      source: resolveDevicePortStartSource(endpoint, options.gridPoint),
      routeOrder: options.canvas.state.runtime.logisticsPlacement.routeOrder,
    });
  } else if (endpoint?.type === "logistics-entity") {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: behavior.allowEmptySource,
      source: {
        type: "logistics-entity",
        entityId: endpoint.entityId,
        gridPoint: endpoint.gridPoint,
      },
      routeOrder: options.canvas.state.runtime.logisticsPlacement.routeOrder,
    });
  } else if (options.pointerEntityId === null) {
    if (!behavior.allowEmptySource) {
      showEmptyLogisticsStartToast(options.canvas);
      logMouseLogisticsPlacementFailure("start", "empty-source-disallowed", {
        kind: options.kind,
        gridPoint: options.gridPoint,
        pointerEntityId: options.pointerEntityId,
        endpointType: endpoint?.type ?? null,
      });
      return { status: "ignored" };
    }

    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: behavior.allowEmptySource,
      source: {
        type: "empty-cell",
        gridPoint: options.gridPoint,
      },
      routeOrder: options.canvas.state.runtime.logisticsPlacement.routeOrder,
    });
  }

  if (result === null) {
    const failureReason = endpoint?.type === "device-port"
      ? "source-port-is-not-output"
      : "clicked-entity-has-no-compatible-output";
    logMouseLogisticsPlacementFailure("start", failureReason, {
      kind: options.kind,
      gridPoint: options.gridPoint,
      pointerEntityId: options.pointerEntityId,
      endpointType: endpoint?.type ?? null,
      endpointPortDirection: endpoint?.type === "device-port" ? endpoint.portDirection : null,
    });
    return { status: "ignored" };
  }

  if (result.status === "ignored") {
    logMouseLogisticsPlacementFailure(
      "start",
      result.invalidReason ?? "draft-start-ignored",
      {
        kind: options.kind,
        gridPoint: options.gridPoint,
        pointerEntityId: options.pointerEntityId,
        endpointType: endpoint?.type ?? null,
        actionStatus: result.status,
        invalidReason: result.invalidReason,
        canApply: result.canApply,
      },
    );
  } else {
    logisticsLogger.debug("mouse-logistics-start OK", {
      kind: options.kind,
      gridPoint: options.gridPoint,
      endpointType: endpoint?.type ?? null,
      pointerEntityId: options.pointerEntityId,
    });
  }
  updateRuntimeFromResult({
    canvas: options.canvas,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
  options.canvas.state.runtime.logisticsPlacement.lastPreviewGridPoint = options.gridPoint;
  return { status: "handled" };
}

/**
 * 鼠标左键或笔尖从可起笔处（设备输出口、物流线）拖动时直接绘制路线，抬起即提交；
 * 从其他位置拖动不认领，交给视口平移。点按起笔后的路线仍按点按流程处理。
 */
function startMouseLogisticsDrag(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
  startPosition: GesturePosition;
}): boolean {
  const runtime = options.canvas.state.runtime.logisticsPlacement;
  const kind = runtime.kind;
  const startGridPoint = resolveGridPointFromGesturePosition(options.canvas.view, options.startPosition);
  if (kind === null || startGridPoint === null) {
    return false;
  }

  const hasDraft = options.editor.queries.resolveLogisticsDraftState() !== null;
  if (hasDraft && !runtime.isHoverPreview) {
    return false;
  }

  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(startGridPoint, kind);
  const source: CreateLogisticsDraftStartOptions["source"] | null =
    endpoint?.type === "device-port" && endpoint.portDirection === "output"
      ? resolveDevicePortStartSource(endpoint, startGridPoint)
      : endpoint?.type === "logistics-entity"
        ? { type: "logistics-entity", entityId: endpoint.entityId, gridPoint: endpoint.gridPoint }
        : null;
  if (source === null) {
    return false;
  }

  if (hasDraft) {
    options.editor.actions.cancelLogisticsDraft();
  }
  const result = options.editor.actions.createLogisticsDraftStart({
    kind,
    allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
    source,
    routeOrder: runtime.routeOrder,
  });
  if (result.status === "ignored") {
    safelyCancelLogisticsDraft(options.editor);
    softResetLogisticsRuntime(options.canvas);
    return false;
  }

  runtime.isHoverPreview = false;
  options.editor.actions.clearHoverPoint();
  updateRuntimeFromResult({
    canvas: options.canvas,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
  runtime.lastPreviewGridPoint = null;
  moveMouseLogisticsDragEnd(options.canvas, options.editor, options.position);
  return true;
}

function moveMouseLogisticsDragEnd(
  canvas: CanvasInteractionController,
  editor: NonNullable<AppHost["workspace"]["editor"]>,
  position: GesturePosition,
): void {
  const runtime = canvas.state.runtime.logisticsPlacement;
  const gridPoint = resolveGridPointFromGesturePosition(canvas.view, position);
  if (
    gridPoint === null
    || (runtime.lastPreviewGridPoint !== null && areGridPointsEqual(runtime.lastPreviewGridPoint, gridPoint))
  ) {
    return;
  }

  const result = editor.actions.moveLogisticEnd({
    pointerGridPoint: gridPoint,
    ...resolveMoveLogisticsDraftBehaviorOptions(canvas),
    routeMode: { type: "freehand" },
  });
  updateRuntimeFromResult({
    canvas,
    pointerMode: "mouse",
    phase: result.targetEntityId === null ? "drawing" : "snapped-target",
    result,
  });
  runtime.lastPreviewGridPoint = gridPoint;
}

function finishMouseLogisticsDrag(
  canvas: CanvasInteractionController,
  editor: NonNullable<AppHost["workspace"]["editor"]>,
  commit: boolean,
): void {
  const draftState = editor.queries.resolveLogisticsDraftState();
  const applied = commit && draftState?.canApply === true && editor.actions.applyLogisticDraft();
  if (!applied) {
    safelyCancelLogisticsDraft(editor);
  }
  softResetLogisticsRuntime(canvas);
}

function logMouseLogisticsPlacementFailure(
  stage: "start" | "apply",
  reason: string,
  context: Readonly<Record<string, unknown>>,
): void {
  const failureType = stage === "start" ? "起笔失败" : "落笔失败";
  logisticsLogger.debug(`mouse-left-tap ${failureType}: ${reason}`, {
    ...context,
    failureStage: stage,
    failureType,
    failureReason: reason,
  });
}

function applyTouchLogisticsPlacement(
  canvas: CanvasInteractionController,
  editor: NonNullable<AppHost["workspace"]["editor"]>,
): void {
  const applied = editor.actions.applyLogisticDraft();
  if (!applied) {
    canvas.state.runtime.logisticsPlacement.statusMessageKey =
      editor.queries.resolveLogisticsDraftState()?.invalidReason ?? "unknown";
    return;
  }

  softResetLogisticsRuntime(canvas);
  canvas.actions.hideCanvasFloatingToolbar();
}

function moveTouchLogisticsEnd(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  gridPoint: GridPoint;
}): void {
  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: options.gridPoint,
    ...resolveMoveLogisticsDraftBehaviorOptions(options.canvas),
    routeMode: { type: "freehand" },
  });
  updateRuntimeFromResult({
    canvas: options.canvas,
    pointerMode: "touch",
    phase: result.targetEntityId === null ? "drawing" : "snapped-target",
    result,
  });
  options.canvas.actions.alignCanvasFloatingToolbar();
}

function createContinuedMouseLogisticsStart(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  gridPoint: GridPoint;
  entityId: string | null;
}): void {
  const continuedEntity = options.entityId === null
    ? null
    : options.editor.queries.getEntityById(options.entityId);
  const continuedEntityKind = continuedEntity === null
    ? null
    : options.canvas.registry.queries.resolveDedicatedLogisticsKind(
        continuedEntity.definitionId,
      );
  let result: LogisticsDraftActionResult;
  // 自动续画必须继承刚提交的普通物流末端，不能被同格相邻设备输出端口重新解释。
  if (
    continuedEntity !== null
    && continuedEntityKind === options.kind
  ) {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
      source: {
        type: "logistics-entity",
        entityId: continuedEntity.id,
        gridPoint: { ...continuedEntity.position },
      },
      routeOrder: options.canvas.state.runtime.logisticsPlacement.routeOrder,
    });
  } else {
    const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
      options.gridPoint,
      options.kind,
    );
    if (endpoint?.type !== "device-port" || endpoint.portDirection !== "output") {
      // endpoint 非 logistics-entity 也非有效输出 device-port（如分流器/汇流器/桥接器
      // 已替代原普通物流段），不应从该格以 empty-cell 继续，否则会产生重叠管道。
      softResetLogisticsRuntime(options.canvas);
      return;
    }

    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.canvas).allowEmptySource,
      source: resolveDevicePortStartSource(endpoint, options.gridPoint),
      routeOrder: options.canvas.state.runtime.logisticsPlacement.routeOrder,
    });
  }

  updateRuntimeFromResult({
    canvas: options.canvas,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
  options.canvas.state.runtime.logisticsPlacement.lastPreviewGridPoint = options.gridPoint;
}

function cancelLogisticsPlacement(
  canvas: CanvasInteractionController,
  editor: NonNullable<AppHost["workspace"]["editor"]>,
): void {
  editor.actions.cancelLogisticsDraft();
  softResetLogisticsRuntime(canvas);
  canvas.actions.hideCanvasFloatingToolbar();
}

function exitLogisticsPlacementToSelect(
  canvas: CanvasInteractionController,
  editor: NonNullable<AppHost["workspace"]["editor"]> | null,
): void {
  if (editor !== null) {
    safelyCancelLogisticsDraft(editor);
  }

  resetLogisticsRuntime(canvas);
  canvas.actions.setActiveTool("select");
}

function handleRouteOrderChange(
  canvas: CanvasInteractionController,
  editor: NonNullable<AppHost["workspace"]["editor"]>,
): void {
  const runtime = canvas.state.runtime.logisticsPlacement;
  runtime.routeOrder = flipRouteOrder(runtime.routeOrder);

  const gridPoint = resolveGridPointFromGesturePosition(canvas.view, runtime.lastMousePosition);
  if (
    gridPoint !== null
    && editor.queries.resolveLogisticsDraftState() !== null
    && !runtime.isHoverPreview
  ) {
    const result = editor.actions.moveLogisticEnd({
      pointerGridPoint: gridPoint,
      ...resolveMoveLogisticsDraftBehaviorOptions(canvas),
      routeMode: {
        type: "single-bend",
        routeOrder: runtime.routeOrder,
        allowTemporaryOrderFlip: true,
      },
    });
    updateRuntimeFromResult({
      canvas,
      pointerMode: "mouse",
      phase: result.targetEntityId === null ? "drawing" : "snapped-target",
      result,
    });
  }
}

function handleLogisticsDeviceShortcutIndex(options: {
  canvas: CanvasInteractionController;
  editor: AppHost["workspace"]["editor"];
  shortcutIndex: number;
}): GestureHandleResult {
  if (options.editor === null) {
    return { status: "ignored" };
  }

  const group = options.canvas.state.runtime.logisticsPlacement.shortcutPlacementGroup;
  if (group === null) {
    return { status: "ignored" };
  }

  if (group === "pipeLogistics" && !hasPlaceableEntityDefinitionInCurrentBase(options.canvas, "pipeLogistics")) {
    return { status: "ignored" };
  }

  const deviceId = resolveDeviceIdForPlacementGroupShortcut({
    registry: options.canvas.registry,
    group,
    shortcutIndex: options.shortcutIndex,
    canUseDefinition: (definition) => canPlaceEntityDefinitionInCurrentBase(
      options.canvas,
      definition,
    ),
  });
  if (deviceId === null) {
    return { status: "ignored" };
  }

  const anchor = resolveGridPointFromGesturePosition(
    options.canvas.view,
    options.canvas.state.runtime.logisticsPlacement.lastMousePosition,
  ) ?? resolveViewportCenterGridPoint(options.canvas.view);
  if (anchor === null) {
    return { status: "ignored" };
  }

  // logistics-placement 的 on-exit 自动清理 logistics draft，
  // single-placement 的 on-enter 读取桥接变量创建 placement draft；
  // 传入 logistics 追踪的鼠标位置，使 on-enter 能判断鼠标是否在 viewport 内并立即创建 draft。
  setPendingSinglePlacementEnter(options.canvas, {
    deviceId,
    anchor,
    pointerMode: "mouse",
    initialMousePosition: options.canvas.state.runtime.logisticsPlacement.lastMousePosition,
  });
  options.canvas.state.runtime.selectingPlacementGroup = group;
  options.canvas.actions.setActiveTool("single-placement");

  return { status: "handled" };
}

function updateRuntimeFromResult(options: {
  canvas: CanvasInteractionController;
  pointerMode: "mouse" | "touch";
  phase: "drawing" | "snapped-target";
  result: LogisticsDraftActionResult;
}): void {
  const runtime = options.canvas.state.runtime.logisticsPlacement;
  const previousConfirmationOperationId = resolveLogisticsConfirmationOperationId(
    runtime.phase,
  );
  runtime.pointerMode = options.pointerMode;
  runtime.phase = options.phase;
  runtime.sourceEntityId = options.result.sourceEntityId;
  runtime.targetEntityId = options.result.targetEntityId;
  runtime.headGridPoint = options.result.headGridPoint;
  runtime.statusMessageKey = options.result.invalidReason;

  if (options.result.status === "created") {
    runtime.anchorGridPoint = options.result.headGridPoint;
  } else if (runtime.anchorGridPoint === null && options.result.headGridPoint !== null) {
    runtime.anchorGridPoint = options.result.headGridPoint;
  }

  if (
    options.pointerMode === "mouse"
    && previousConfirmationOperationId !== resolveLogisticsConfirmationOperationId(runtime.phase)
  ) {
    showMouseLogisticsPlacementShortcuts(options.canvas);
  }
}

function resolveLogisticsPlacementBehaviorOptions(canvas: CanvasInteractionController): LogisticsPlacementBehaviorOptions {
  return {
    allowEmptySource: canvas.workbench.state.settings.hypergryphAllowEmptyLogisticsEndpoints,
    autoCreateSplittersAndConvergers:
      canvas.workbench.state.settings.hypergryphAutoCreateSplittersAndConvergers,
  };
}

function resolveDevicePortStartSource(
  endpoint: Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>,
  pointerGridPoint: GridPoint,
): CreateLogisticsDraftStartOptions["source"] {
  if (endpoint.fixedSource === true) {
    return {
      type: "fixed-device-port",
      entityId: endpoint.entityId,
      portGroupId: endpoint.portGroupId,
      portId: endpoint.portId,
      outsideGridPoint: { ...endpoint.outsideGridPoint },
    };
  }

  return {
    type: "device",
    entityId: endpoint.entityId,
    pointerGridPoint,
  };
}

function resolveMoveLogisticsDraftBehaviorOptions(canvas: CanvasInteractionController): {
  readonly allowEmptyTarget: boolean;
  readonly autoCreateSplittersAndConvergers: boolean;
} {
  const behavior = resolveLogisticsPlacementBehaviorOptions(canvas);
  return {
    allowEmptyTarget: true,
    autoCreateSplittersAndConvergers: behavior.autoCreateSplittersAndConvergers,
  };
}

function showTouchToolbar(canvas: CanvasInteractionController): void {
  canvas.actions.showCanvasFloatingToolbarForCollection(
    LOGISTICS_TOOLBAR_BUTTON_IDS,
    EntityCollectionType.logisticsHead,
  );
}

function syncLogisticsPlacementEntryUi(canvas: CanvasInteractionController): void {
  canvas.actions.hideCanvasFloatingToolbar();
  canvas.actions.hideCanvasRightDockToolbar();

  const pointerMode = canvas.state.runtime.logisticsPlacement.pointerMode;
  if (pointerMode === "mouse") {
    showMouseLogisticsPlacementShortcuts(canvas);
    return;
  }

  if (pointerMode !== "touch") {
    return;
  }

  canvas.actions.showCanvasRightDockToolbar(LOGISTICS_RIGHT_DOCK_TOOLBAR_ITEMS);
  if (canvas.workbench.internalState.workbench.rightDockOpen) {
    canvas.workbench.internalActions.toggleRightDock();
  }
}

function showMouseLogisticsPlacementShortcuts(canvas: CanvasInteractionController): void {
  const items = resolveLogisticsRightDockToolbarItems(canvas);
  if (items.length === 0) {
    canvas.actions.hideCanvasRightDockToolbar();
    return;
  }

  canvas.actions.showCanvasRightDockToolbar(items);
}

function resolveLogisticsRightDockToolbarItems(
  canvas: CanvasInteractionController,
): readonly CanvasRightDockToolbarItemRequest[] {
  const runtime = canvas.state.runtime.logisticsPlacement;
  const confirmsStart = resolveLogisticsConfirmationOperationId(runtime.phase)
    === "confirm-logistics-start";

  if (runtime.kind === LOGISTICS_KIND.belt) {
    return confirmsStart
      ? BELT_START_RIGHT_DOCK_TOOLBAR_ITEMS
      : BELT_END_RIGHT_DOCK_TOOLBAR_ITEMS;
  }

  if (runtime.kind === LOGISTICS_KIND.pipe) {
    return confirmsStart
      ? PIPE_START_RIGHT_DOCK_TOOLBAR_ITEMS
      : PIPE_END_RIGHT_DOCK_TOOLBAR_ITEMS;
  }

  return [];
}

function resolveLogisticsConfirmationOperationId(
  phase: CanvasInteractionController["state"]["runtime"]["logisticsPlacement"]["phase"],
): "confirm-logistics-end" | "confirm-logistics-start" {
  return phase === "idle"
    ? "confirm-logistics-start"
    : "confirm-logistics-end";
}

function resetLogisticsRuntime(canvas: CanvasInteractionController): void {
  const runtime = canvas.state.runtime.logisticsPlacement;
  canvas.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, false);
  canvas.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, false);
  runtime.kind = null;
  runtime.shortcutPlacementGroup = null;
  runtime.pointerMode = null;
  runtime.phase = "idle";
  runtime.isHoverPreview = false;
  runtime.routeOrder = "vertical-first";
  runtime.sourceEntityId = null;
  runtime.targetEntityId = null;
  runtime.anchorGridPoint = null;
  runtime.headGridPoint = null;
  runtime.lastPreviewGridPoint = null;
  runtime.statusMessageKey = null;
}

function softResetLogisticsRuntime(canvas: CanvasInteractionController): void {
  const runtime = canvas.state.runtime.logisticsPlacement;
  runtime.phase = "idle";
  runtime.isHoverPreview = false;
  runtime.sourceEntityId = null;
  runtime.targetEntityId = null;
  runtime.anchorGridPoint = null;
  runtime.headGridPoint = null;
  runtime.lastPreviewGridPoint = null;
  runtime.statusMessageKey = null;
  if (runtime.pointerMode === "mouse") {
    showMouseLogisticsPlacementShortcuts(canvas);
  }
}

function resolveKindFromOperationButton(uiButtonId: string): LogisticsKind | null {
  if (uiButtonId === BELT_DRAW_BUTTON_ID) {
    return LOGISTICS_KIND.belt;
  }
  if (uiButtonId === PIPE_DRAW_BUTTON_ID) {
    return LOGISTICS_KIND.pipe;
  }

  return null;
}

function safelyCancelLogisticsDraft(editor: NonNullable<AppHost["workspace"]["editor"]>): void {
  try {
    editor.actions.cancelLogisticsDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; logistics placement should not leave stale preview state.
  }
}

function resolveGridPointFromGesturePosition(
  view: EditorViewContract,
  position: GesturePosition | null,
): GridPoint | null {
  if (position === null) {
    return null;
  }

  return view.queries.findGridCellForClientPixelPoint(position);
}

function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function isTouchDragStartOnLogisticsHead(
  editor: NonNullable<AppHost["workspace"]["editor"]>, view: EditorViewContract,
  startPosition: GesturePosition,
): boolean {
  const startEntity = editor.queries.findEntityAtClientPixelPoint(startPosition, view.state);
  return (
    startEntity !== null
    && editor.state.collections[EntityCollectionType.logisticsHead].contains(startEntity.id)
  );
}

function resolveViewportCenterGridPoint(
  view: EditorViewContract,
): GridPoint | null {
  const clientRect = view.state.clientRect;

  return view.queries.findGridCellForClientPixelPoint({
    x: clientRect.left + clientRect.width / 2,
    y: clientRect.top + clientRect.height / 2,
  });
}

function shouldStopAfterApplyingToExistingBeltStart(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  draftState: LogisticsDraftReadonlyState;
  headGridPoint: GridPoint | null;
  targetEntityId: string | null;
  kind: LogisticsKind;
}): boolean {
  if (
    options.kind !== LOGISTICS_KIND.belt
    || options.headGridPoint === null
    || options.targetEntityId !== null
    || options.draftState.target !== null
    || !options.draftState.canApply
  ) {
    return false;
  }

  const document = options.editor.document.getSnapshot();
  const originalHeadEntity = findTopDocumentEntityAtGridPoint({
    canvas: options.canvas,
    document,
    gridPoint: options.headGridPoint,
  });
  if (
    originalHeadEntity === null
    || !options.canvas.registry.queries.isBelt(originalHeadEntity.definitionId)
    || !options.editor.state.collections[EntityCollectionType.ghost].includes(originalHeadEntity.id)
  ) {
    return false;
  }

  const connectionInfo = resolveOrdinaryBeltConnectionInfo({
    canvas: options.canvas,
    document,
    entity: originalHeadEntity,
  });

  return connectionInfo !== null
    && !connectionInfo.inputConnected
    && connectionInfo.outputConnected;
}

function resolveOrdinaryBeltConnectionInfo(options: {
  canvas: CanvasInteractionController;
  document: WorldDocument;
  entity: WorldEntity;
}): {
  inputConnected: boolean;
  outputConnected: boolean;
} | null {
  const definition = resolveEntityDefinition(options.canvas, options.entity.definitionId);
  if (definition === null) {
    return null;
  }

  const inputEndpoint = resolveEntityPortEndpoints({
    entity: options.entity,
    definition,
    kind: LOGISTICS_KIND.belt,
    direction: "input",
  })[0];
  const outputEndpoint = resolveEntityPortEndpoints({
    entity: options.entity,
    definition,
    kind: LOGISTICS_KIND.belt,
    direction: "output",
  })[0];
  if (inputEndpoint === undefined || outputEndpoint === undefined) {
    return null;
  }

  return {
    inputConnected: doesNeighborOutputConnectToGridPoint({
      canvas: options.canvas,
      document: options.document,
      neighborGridPoint: inputEndpoint.outsideGridPoint,
      targetGridPoint: options.entity.position,
      ignoredEntityId: options.entity.id,
    }),
    outputConnected: doesGridPointOutputConnectToNeighborInput({
      canvas: options.canvas,
      document: options.document,
      sourceGridPoint: options.entity.position,
      neighborGridPoint: outputEndpoint.outsideGridPoint,
      ignoredEntityId: options.entity.id,
    }),
  };
}

function doesNeighborOutputConnectToGridPoint(options: {
  canvas: CanvasInteractionController;
  document: WorldDocument;
  neighborGridPoint: GridPoint;
  targetGridPoint: GridPoint;
  ignoredEntityId: string;
}): boolean {
  const neighbor = findTopDocumentEntityAtGridPoint({
    canvas: options.canvas,
    document: options.document,
    gridPoint: options.neighborGridPoint,
  });
  if (neighbor === null || neighbor.id === options.ignoredEntityId) {
    return false;
  }

  const definition = resolveEntityDefinition(options.canvas, neighbor.definitionId);
  if (definition === null) {
    return false;
  }

  return resolveEntityPortEndpoints({
    entity: neighbor,
    definition,
    kind: LOGISTICS_KIND.belt,
    direction: "output",
  }).some((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.targetGridPoint));
}

function doesGridPointOutputConnectToNeighborInput(options: {
  canvas: CanvasInteractionController;
  document: WorldDocument;
  sourceGridPoint: GridPoint;
  neighborGridPoint: GridPoint;
  ignoredEntityId: string;
}): boolean {
  const neighbor = findTopDocumentEntityAtGridPoint({
    canvas: options.canvas,
    document: options.document,
    gridPoint: options.neighborGridPoint,
  });
  if (neighbor === null || neighbor.id === options.ignoredEntityId) {
    return false;
  }

  const definition = resolveEntityDefinition(options.canvas, neighbor.definitionId);
  if (definition === null) {
    return false;
  }

  return resolveEntityPortEndpoints({
    entity: neighbor,
    definition,
    kind: LOGISTICS_KIND.belt,
    direction: "input",
  }).some((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.sourceGridPoint));
}

function findTopDocumentEntityAtGridPoint(options: {
  canvas: CanvasInteractionController;
  document: WorldDocument;
  gridPoint: GridPoint;
}): WorldEntity | null {
  for (let index = options.document.entityOrder.length - 1; index >= 0; index -= 1) {
    const entityId = options.document.entityOrder[index];
    const entity = entityId === undefined ? undefined : options.document.entities[entityId];
    if (entity === undefined) {
      continue;
    }

    const definition = resolveEntityDefinition(options.canvas, entity.definitionId);
    if (definition === null) {
      continue;
    }

    if (
      isPointInsideEntityFootprint({
        gridPoint: options.gridPoint,
        entityPosition: entity.position,
        definition,
        rotation: entity.rotation,
      })
    ) {
      return entity;
    }
  }

  return null;
}

function resolveEntityPortEndpoints(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
  direction: "input" | "output";
}): Array<{
  outsideGridPoint: GridPoint;
}> {
  const isPipe = options.kind === LOGISTICS_KIND.pipe;
  const endpoints: Array<{ outsideGridPoint: GridPoint }> = [];

  for (const portGroup of options.definition.portGroups) {
    if (portGroup.isPipe !== isPipe || portGroup.direction !== options.direction) {
      continue;
    }

    for (const port of portGroup.ports) {
      const localCell = rotateLocalPortCell({
        footprint: options.definition.footprint,
        port,
        rotation: options.entity.rotation,
      });
      const edge = rotateGridEdge(port.edge, options.entity.rotation);
      const insideGridPoint = {
        x: options.entity.position.x + localCell.x,
        y: options.entity.position.y + localCell.y,
      };
      const delta = resolveEdgeDelta(edge);
      endpoints.push({
        outsideGridPoint: {
          x: insideGridPoint.x + delta.x,
          y: insideGridPoint.y + delta.y,
        },
      });
    }
  }

  return endpoints;
}

function rotateLocalPortCell(options: {
  footprint: EntityDefinition["footprint"];
  port: EntityDefinition["portGroups"][number]["ports"][number];
  rotation: GridRotation;
}): GridPoint {
  const { width, height } = options.footprint;
  const { localCellX: x, localCellY: y } = options.port;

  switch (options.rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - 1 - y, y: x };
    case 180:
      return { x: width - 1 - x, y: height - 1 - y };
    case 270:
      return { x: y, y: width - 1 - x };
  }
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const currentIndex = GRID_EDGE_ORDER.indexOf(edge);
  const steps = rotation / 90;
  return GRID_EDGE_ORDER[(currentIndex + steps) % GRID_EDGE_ORDER.length] ?? edge;
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH":
      return { x: 0, y: -1 };
    case "EAST":
      return { x: 1, y: 0 };
    case "SOUTH":
      return { x: 0, y: 1 };
    case "WEST":
      return { x: -1, y: 0 };
  }
}

function resolveEntityDefinition(canvas: CanvasInteractionController, definitionId: string): EntityDefinition | null {
  return canvas.registry.entityDefinitions.find((definition) =>
    definition.id === definitionId,
  ) ?? null;
}

function isGridPointInsideEntity(options: {
  canvas: CanvasInteractionController;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
}, entityId: string, gridPoint: GridPoint): boolean {
  const entity = options.editor.queries.getEntityById(entityId);
  if (entity === null) {
    return false;
  }

  const definition = options.canvas.registry.entityDefinitions.find(
    (candidate) => candidate.id === entity.definitionId,
  );
  if (definition === undefined) {
    return false;
  }

  return isPointInsideEntityFootprint({
    gridPoint,
    entityPosition: entity.position,
    definition,
    rotation: entity.rotation,
  });
}

function isPointInsideEntityFootprint(options: {
  gridPoint: GridPoint;
  entityPosition: GridPoint;
  definition: EntityDefinition;
  rotation: 0 | 90 | 180 | 270;
}): boolean {
  const footprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.rotation,
  );

  return (
    options.gridPoint.x >= options.entityPosition.x
    && options.gridPoint.x < options.entityPosition.x + footprint.width
    && options.gridPoint.y >= options.entityPosition.y
    && options.gridPoint.y < options.entityPosition.y + footprint.height
  );
}

function flipRouteOrder(routeOrder: LogisticsRouteOrder): LogisticsRouteOrder {
  return routeOrder === "vertical-first" ? "horizontal-first" : "vertical-first";
}
