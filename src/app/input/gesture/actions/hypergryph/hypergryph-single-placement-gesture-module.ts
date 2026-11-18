import type { CanvasInteractionController } from "@/app/canvas";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import {
  SWITCH_DEVICE_MODE_BUTTON_ID,
  canSwitchEntityVariantDefinition,
  resolveNextSwitchableEntityVariantDefinitionId,
} from "@/app/entity-variant-availability";
import {
  canPlaceEntityDefinitionInCurrentBase,
  hasPlaceableEntityDefinitionInCurrentBase,
} from "@/app/placement-zone-availability";
import {
  SHORTCUT_KEY,
  type ShortcutKeyId,
} from "@/app/actions/keyboard-shortcut-manager";
import type {
  CanvasFloatingToolbarButtonId,
  PlacementGroup,
} from "@/app/state/state-impl";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { collapseEntityVariantDefinitions } from "@/shared/entity-variants";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";
import type { LogisticsRole } from "@/domain/shared/logistics";
import {
  resolveLogisticsDeviceIdForRole,
  resolveSingleSelectedLogisticsDevice,
  swapLogisticsDeviceRole,
} from "@/app/logistics-role-swap";
import { runInAction } from "mobx";
import { recentPlacements } from "@/app/recent-placement-devices";

import type { GestureHandleResult, GestureMappingModule, ShortcutActionRoute } from "../types";
import { RAIL_TOGGLE_CONTINUOUS_PLACEMENT_BUTTON_ID } from "../rail-buttons";
import { recordEntityLandedBy } from "./entity-spin-tap";
import {
  didPreviewRectChange,
  isPreviewBoundingBoxAtClientPoint,
  resolveTouchDragAnchorAfterPreviewMove,
  TOUCH_PREVIEW_HIT_SLOP_PX,
} from "./mobile-preview-bounds";

// 桥接变量：触发点（UI 按钮 / 快捷键）写入，on-enter-active-tool("single-placement") 读取后立即置 null。
// 用于在 setActiveTool 触发生命周期事件之前，将进入参数暂存在模块内部，
// 避免受 mobx action reaction 时序影响。
type PendingPlacementEnter = {
  deviceId: string;
  anchor: GridPoint;
  pointerMode: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
};
// 物流设备快捷插入
const TRANSPORT_INSERT_SHORTCUTS: readonly { readonly shortcutId: ShortcutKeyId; readonly role: LogisticsRole }[] = [
  { shortcutId: SHORTCUT_KEY.INSERT_SPLITTER, role: "splitter" },
  { shortcutId: SHORTCUT_KEY.INSERT_CONVERGER, role: "converger" },
  { shortcutId: SHORTCUT_KEY.INSERT_CONNECTOR, role: "connector" },
  { shortcutId: SHORTCUT_KEY.INSERT_ADMISSION, role: "admission" },
];

/**
 * 按光标下的设备（或正在绘制的物流类型）判定传送带/管道族，返回对应角色的物流设备 ID。
 * 光标不在管道族上时默认传送带族。
 */
function resolveTransportInsertDeviceId(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  role: LogisticsRole,
): string | null {
  const queries = canvas.registry.queries;
  const hoveredDefinitionId = editor.state.hoverTarget?.entity?.definitionId ?? null;
  const drawingKind = canvas.state.activeTool === "logistics-placement"
    ? canvas.state.runtime.logisticsPlacement.kind
    : null;
  const usePipe = hoveredDefinitionId !== null
    ? queries.isPipeFamily(hoveredDefinitionId)
    : drawingKind === "pipe";
  return resolveLogisticsDeviceIdForRole(canvas.registry, usePipe ? "pipe" : "belt", role);
}

export function setPendingSinglePlacementEnter(canvas: CanvasInteractionController, data: PendingPlacementEnter): void {
  canvas.pendingPlacementEnter = data;
}

export const PLACEMENT_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

/** 画布工具条在单设备、蓝图放置与移动模式下的上下文按钮：旋转预览、退出放置或移动；与浮动工具条的同名按钮行为一致。 */
export const PLACEMENT_RAIL_ROTATE_BUTTON_ID = "canvas-tool-rail-placement-rotate";
export const PLACEMENT_RAIL_CANCEL_BUTTON_ID = "canvas-tool-rail-placement-cancel";

export function isPlacementRotateButtonId(uiButtonId: string): boolean {
  return uiButtonId === "canvas-floating-toolbar-button-rotate" || uiButtonId === PLACEMENT_RAIL_ROTATE_BUTTON_ID;
}

export function isPlacementCancelButtonId(uiButtonId: string): boolean {
  return uiButtonId === "canvas-floating-toolbar-button-cancel" || uiButtonId === PLACEMENT_RAIL_CANCEL_BUTTON_ID;
}


const PLACEMENT_MODE_EVENT_PREFIX = "ui-left-dock-placement-mode-";
export const PLACEMENT_DEVICE_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

const PLACEMENT_GROUP_SHORTCUTS = {
  beltLogistics: SHORTCUT_KEY.PLACE_CONVEYOR,
  pipeLogistics: SHORTCUT_KEY.PLACE_PIPE,
  resourcePower: SHORTCUT_KEY.RESOURCES_POWER,
  warehouse: SHORTCUT_KEY.WAREHOUSE,
  basicProduction: SHORTCUT_KEY.BASIC_PRODUCTION,
  advancedManufacturing: SHORTCUT_KEY.SYNTHESIS,
  cheat: SHORTCUT_KEY.CHEAT,
} as const satisfies Partial<Record<PlacementGroup, ShortcutKeyId>>;

export function createHypergryphSinglePlacementGestureModule(): GestureMappingModule<AppHost> {
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "hypergryph-single-placement-gesture",
    shortcutRoutes: [
      ...(Object.entries(PLACEMENT_GROUP_SHORTCUTS) as Array<[PlacementGroup, ShortcutKeyId]>)
        .filter(([group]) => group !== "beltLogistics" && group !== "pipeLogistics")
        .map<ShortcutActionRoute<AppHost>>(([group, shortcutId]) => ({
          id: `placement-group.${group}`,
          operation: "confirm-placement",
          actionId: shortcutId,
          binding: { kind: "configurable" as const, shortcutId },
          scope: { inputLayers: ["canvas"] as const, activeTools: ["select"] as const },
          triggerPolicy: {
            kind: "allow-additional-modifiers" as const,
            modifiers: ["shift"] as const,
          },
          handle: (_event, context) => handleSelectPlacementGroup(context.canvas, group),
        })),
      ...TRANSPORT_INSERT_SHORTCUTS.map<ShortcutActionRoute<AppHost>>(({ shortcutId, role }) => ({
        id: `transport-insert.${role}`,
        operation: "confirm-placement",
        actionId: shortcutId,
        binding: { kind: "configurable", shortcutId },
        scope: {
          inputLayers: ["canvas"] as const,
          activeTools: ["select", "single-placement", "logistics-placement"] as const,
        },
        triggerPolicy: { kind: "exact" as const },
        handle: (_event, context) => {
          const editor = context.canvas.editor;
          if (editor === null) {
            return { status: "ignored" };
          }
          // 选择工具下恰好选中一个物流设备时，快捷键改为原位切换其类型。
          if (context.canvas.state.activeTool === "select") {
            const selected = resolveSingleSelectedLogisticsDevice(editor, context.canvas.registry);
            if (selected !== null) {
              swapLogisticsDeviceRole({ editor, registry: context.canvas.registry, entityId: selected.entityId, role });
              return { status: "handled" };
            }
          }
          const deviceId = resolveTransportInsertDeviceId(context.canvas, editor, role);
          if (deviceId === null) {
            return { status: "ignored" };
          }
          // 光标在同族传送带/管道上时沿用其朝向，单击即可替换该格完成插入。
          const hovered = editor.state.hoverTarget?.entity ?? null;
          const queries = context.canvas.registry.queries;
          const alignedRotation = hovered !== null
            && (queries.isBeltFamily(hovered.definitionId) || queries.isPipeFamily(hovered.definitionId))
            ? hovered.rotation
            : null;
          const applyRuntime = () => runInAction(() => {
            context.canvas.state.runtime.singlePlacementRotation = alignedRotation;
            context.canvas.state.runtime.singlePlacementConfig = null;
            context.canvas.state.runtime.singlePlacementWarehouseItemId = null;
          });
          applyRuntime();
          const result = handlePlacementEntryButtonTap({
            canvas: context.canvas,
            editor,
            deviceId,
            source: "mouse",
            allowFromAnyTool: true,
            initialMousePosition: lastMousePosition,
          });
          if (context.canvas.state.runtime.singlePlacementDeviceId === deviceId) {
            applyRuntime();
          }
          return result;
        },
      })),
      ...PLACEMENT_DEVICE_SHORTCUT_KEYS.map<ShortcutActionRoute<AppHost>>((shortcut, shortcutIndex) => ({
        id: `placement-device.${shortcutIndex}`,
        operation: "confirm-placement",
        actionId: `fixed.placement-device.${shortcutIndex}`,
        binding: { kind: "fixed" as const, value: shortcut },
        scope: { inputLayers: ["canvas"] as const, activeTools: ["select"] as const },
        triggerPolicy: { kind: "exact" as const },
        handle: (_event, context) => handleSelectPlacementDeviceShortcutIndex({
          canvas: context.canvas,
          editor: context.canvas.editor,
          registry: context.canvas.registry,
          lastMousePosition,
          shortcutIndex,
        }),
      })),
      {
        id: "single-placement.switch-device-mode",
        operation: "switch-device-variant",
        actionId: SHORTCUT_KEY.SWITCH_DEVICE_MODE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.SWITCH_DEVICE_MODE },
        scope: { inputLayers: ["canvas"], activeTools: ["single-placement"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        handle(_event, context) {
          const editor = context.canvas.editor;
          return editor === null
            ? { status: "ignored" }
            : switchPlacementPreviewVariant(context.canvas, editor, lastMousePosition);
        },
      },
      {
        id: "current-operation.rotate-single-placement",
        operation: "rotate-placement",
        actionId: SHORTCUT_KEY.ROTATE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.ROTATE },
        scope: { inputLayers: ["canvas"], activeTools: ["single-placement"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          rotatePlacementPreview(context.canvas, editor, {
            pointerMode: context.canvas.state.runtime.singlePlacementPointerMode,
            currentMousePosition: lastMousePosition,
          });
          return { status: "handled" };
        },
      },
    ],
    handle(event, context) {
      if (event.type === "on-exit-active-tool") {
        if (event.from !== "single-placement" || event.to === "single-placement") {
          return { status: "ignored" };
        }

        context.canvas.pendingPlacementEnter = null;
        cleanupPlacementDraft(context.canvas);
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "single-placement") {
          return { status: "ignored" };
        }

        // 桥接变量路径：触发点已写入全部参数，在此创建 draft 并同步 UI
        if (context.canvas.pendingPlacementEnter !== null) {
          const { deviceId, anchor, pointerMode, initialMousePosition } = context.canvas.pendingPlacementEnter;
          context.canvas.pendingPlacementEnter = null;

          const editor = context.canvas.editor;

          // mouse 模式延迟创建 draft，鼠标滑入 canvas 时才出现；
          // 但如果鼠标在点击时已位于 viewport 内（如快捷键触发），则立即创建。
          if (pointerMode === "mouse") {
            context.canvas.state.runtime.singlePlacementPointerMode = pointerMode;
            runInAction(() => {
              context.canvas.state.runtime.singlePlacementDeviceId = deviceId;
            });

            if (
              editor !== null
              && initialMousePosition !== null
              && isClientPointInsideViewport(context.canvas.view, initialMousePosition)
            ) {
              const gridPoint = context.canvas.view.queries.findGridCellForClientPixelPoint(initialMousePosition);
              if (gridPoint !== null) {
                try {
                  context.canvas.createPlacementDraft({ definitionId: deviceId, centerGridPoint: gridPoint });
                  context.canvas.state.runtime.placementAnchor = gridPoint;
                } catch {
                  restoreFailedPlacementEnter(context.canvas, editor);
                  return { status: "handled" };
                }
              } else {
                context.canvas.state.runtime.placementAnchor = null;
              }
            } else {
              context.canvas.state.runtime.placementAnchor = null;
            }

            syncPlacementEntryUi(context.canvas, pointerMode);
            return { status: "handled" };
          }

          // touch 模式保持原有逻辑：立即创建 draft
          context.canvas.state.runtime.placementAnchor = anchor;
          context.canvas.state.runtime.singlePlacementPointerMode = pointerMode;

          if (editor !== null) {
            try {
              context.canvas.createPlacementDraft({ definitionId: deviceId, centerGridPoint: anchor });
              const previewRect = editor.queries.findEntityCollectionGridRect(
                EntityCollectionType.preview,
              );
              if (previewRect === null) {
                restoreFailedPlacementEnter(context.canvas, editor);
                return { status: "handled" };
              }
              runInAction(() => {
                context.canvas.state.runtime.singlePlacementDeviceId = deviceId;
              });
            } catch {
              restoreFailedPlacementEnter(context.canvas, editor);
              return { status: "handled" };
            }
          }

          syncPlacementEntryUi(context.canvas, pointerMode);
          return { status: "handled" };
        }

        // 兜底：无桥接变量时保持原有逻辑
        syncPlacementEntryUi(context.canvas);
        return { status: "handled" };
      }

      if (
        event.type === "mouse move"
        || event.type === "mouse dragstart"
        || event.type === "mouse dragmove"
      ) {
        lastMousePosition = event.position;
      }


      const editor = context.canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      if (event.type === "ui-button-touch-tap") {
        const deviceId = parsePlacementModeDeviceId(event.uiButtonId, "touch");
        if (deviceId !== null) {
          return handlePlacementEntryButtonTap({
            canvas: context.canvas,
            editor,
            deviceId,
            source: "touch",
            allowFromAnyTool: true,
          });
        }
      }

      if (event.type === "ui-button-mouse-tap" && event.button === 0) {
        const deviceId = parsePlacementModeDeviceId(event.uiButtonId, "mouse");
        if (deviceId !== null) {
          return handlePlacementEntryButtonTap({
            canvas: context.canvas,
            editor,
            deviceId,
            source: "mouse",
            allowFromAnyTool: true,
            initialMousePosition: lastMousePosition,
          });
        }
      }

      if (context.canvas.state.activeTool !== "single-placement") {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse-long-press-ready":
        case "tap-long-press-ready":
          return { status: "handled" };

        case "mouse dragstart":
          if (!ensurePlacementDraftForMouse(context.canvas, editor, event.position)) {
            return { status: "handled" };
          }
          return handlePlacementMouseDragStart({
            canvas: context.canvas,
            editor,
            originButton: event.originButton,
            position: event.position,
          });

        case "touch dragstart":
          return primePlacementAnchorFromPreview({
            canvas: context.canvas,
            editor,
            position: event.startPosition,
            hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
          });

        case "mouse move":
          if (!ensurePlacementDraftForMouse(context.canvas, editor, event.position)) {
            return { status: "handled" };
          }
          return driveMousePlacementPreview({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "mouse dragmove":
          if (event.originButton !== 0) {
            return { status: "ignored" };
          }

          if (!ensurePlacementDraftForMouse(context.canvas, editor, event.position)) {
            return { status: "handled" };
          }
          return driveMousePlacementPreview({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "touch dragmove":
          return drivePlacementPreview({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "mouse dragend":
          return (
            event.originButton === 0
            && context.canvas.state.runtime.placementAnchor !== null
          )
            ? { status: "handled" }
            : { status: "ignored" };

        case "touch dragend":
          return context.canvas.state.runtime.placementAnchor !== null
            ? { status: "handled" }
            : { status: "ignored" };

        case "touch tap":
          if (dismissPlacementOnFacility(context.canvas, editor, event.position)) return { status: "handled" };
          return handleTouchPlacementTap(context.canvas, editor, event.position, () => {
            recordEntityLandedBy(context.canvas, editor, event.position, () => applyPlacementOperation(context.canvas, editor, {
              keepPlacement: context.canvas.state.runtime.singlePlacementContinuous,
              currentMousePosition: null,
            }));
          });

        case "mouse tap":
          if (event.button === 2) {
            cancelPlacementOperation(context.canvas, editor);
            return { status: "handled" };
          }

          if (event.button === 0 && !event.longPress) {
            if (dismissPlacementOnFacility(context.canvas, editor, event.position)) return { status: "handled" };
            // 不支持悬停的笔第一次落笔前预览还没出现：先在落笔处生成预览。
            if (!ensurePlacementDraftForMouse(context.canvas, editor, event.position)) {
              return { status: "handled" };
            }
            // 笔没有 Shift/Ctrl：用笔放下后设备仍在手上，笔杆键点按（右键）才放下工具。
            recordEntityLandedBy(context.canvas, editor, event.position, () => applyPlacementOperation(context.canvas, editor, {
              keepPlacement: event.isPen === true || event.modifiers.ctrl || event.modifiers.shift
                || context.canvas.state.runtime.singlePlacementContinuous,
              currentMousePosition: event.position,
            }));
            return { status: "handled" };
          }

          return { status: "handled" };

        case "ui-button-touch-tap":
          {
            const toggleResult = handleContinuousPlacementToggleTap(
              context.canvas,
              event.uiButtonId,
            );
            if (toggleResult !== null) {
              return toggleResult;
            }
          }

          if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
            return switchPlacementPreviewVariant(context.canvas, editor, null);
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyPlacementOperation(context.canvas, editor, {
              keepPlacement: context.canvas.state.runtime.singlePlacementContinuous,
              currentMousePosition: null,
            });
            return { status: "handled" };
          }

          if (isPlacementRotateButtonId(event.uiButtonId)) {
            rotatePlacementPreview(context.canvas, editor, {
              pointerMode: "touch",
              currentMousePosition: null,
            });
            return { status: "handled" };
          }

          if (isPlacementCancelButtonId(event.uiButtonId)) {
            cancelPlacementOperation(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          {
            const toggleResult = handleContinuousPlacementToggleTap(
              context.canvas,
              event.uiButtonId,
            );
            if (toggleResult !== null) {
              return toggleResult;
            }
          }

          if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
            return switchPlacementPreviewVariant(context.canvas, editor, lastMousePosition);
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyPlacementOperation(context.canvas, editor, {
              keepPlacement: context.canvas.state.runtime.singlePlacementContinuous,
              currentMousePosition: lastMousePosition,
            });
            return { status: "handled" };
          }

          if (isPlacementRotateButtonId(event.uiButtonId)) {
            rotatePlacementPreview(context.canvas, editor, {
              pointerMode: "mouse",
              currentMousePosition: lastMousePosition,
            });
            return { status: "handled" };
          }

          if (isPlacementCancelButtonId(event.uiButtonId)) {
            cancelPlacementOperation(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function handlePlacementEntryButtonTap(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  deviceId: string;
  source: "mouse" | "touch";
  initialPlacementAnchor?: GridPoint | null;
  initialMousePosition?: GesturePosition | null;
  allowFromAnyTool?: boolean;
}): GestureHandleResult {
  const previousTool = options.canvas.state.activeTool;
  const definition = options.canvas.registry.entityDefinitions.find((entry) => entry.id === options.deviceId);
  if (definition !== undefined && !canPlaceEntityDefinitionInCurrentBase(options.canvas, definition)) {
    return { status: "ignored" };
  }

  if (previousTool === "single-placement") {
    if (
      options.canvas.state.runtime.singlePlacementDeviceId
      === options.deviceId
    ) {
      return { status: "handled" };
    }

    // 切换到另一台设备时保留调用方为它写入的初始配置与朝向（例如配方树指定的配方）。
    const { singlePlacementConfig, singlePlacementRotation, singlePlacementWarehouseItemId } = options.canvas.state.runtime;
    safelyCancelPlacementDraft(options.editor);
    clearPlacementUi(options.canvas);
    runInAction(() => {
      options.canvas.state.runtime.singlePlacementConfig = singlePlacementConfig;
      options.canvas.state.runtime.singlePlacementRotation = singlePlacementRotation;
      options.canvas.state.runtime.singlePlacementWarehouseItemId = singlePlacementWarehouseItemId;
    });

    return finalizePlacementEnter({
      canvas: options.canvas,
      editor: options.editor,
      deviceId: options.deviceId,
      source: options.source,
      initialPlacementAnchor: options.initialPlacementAnchor,
      initialMousePosition: options.initialMousePosition ?? null,
      shouldSetActiveTool: false,
    });
  }

  if (previousTool !== "select" && !options.allowFromAnyTool) {
    return { status: "ignored" };
  }

  return finalizePlacementEnter({
    canvas: options.canvas,
    editor: options.editor,
    deviceId: options.deviceId,
    source: options.source,
    initialPlacementAnchor: options.initialPlacementAnchor,
    initialMousePosition: options.initialMousePosition ?? null,
    shouldSetActiveTool: true,
  });
}

function handleSelectPlacementGroup(canvas: CanvasInteractionController, group: PlacementGroup): GestureHandleResult {
  if (!canvas.canUseWorkbenchActions || !canvas.isOperationEnabled("confirm-placement")
    || !hasPlaceableEntityDefinitionInCurrentBase(canvas, group)) {
    return { status: "ignored" };
  }

  canvas.state.runtime.selectingPlacementGroup = group;
  return { status: "handled" };
}

function handleSelectPlacementDeviceShortcutIndex(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract | null;
  registry: RegistryContract;
  lastMousePosition: GesturePosition | null;
  shortcutIndex: number;
}): GestureHandleResult {
  if (options.editor === null || !options.canvas.canUseWorkbenchActions
    || !options.canvas.isOperationEnabled("confirm-placement")) {
    return { status: "ignored" };
  }

  const selectingGroup = options.canvas.state.runtime.selectingPlacementGroup;
  if (selectingGroup === null) {
    return { status: "ignored" };
  }

  const deviceId = resolveDeviceIdForPlacementGroupShortcut({
    registry: options.registry,
    group: selectingGroup,
    shortcutIndex: options.shortcutIndex,
    collapseDeviceModes: options.canvas.workbench.state.settings.collapseDeviceModes,
    selectedVariantNameByCraftGroup:
      options.canvas.workbench.state.workbench.selectedPlacementVariantByCraftGroup,
    canUseDefinition: (definition) => canPlaceEntityDefinitionInCurrentBase(
      options.canvas,
      definition,
    ),
  });
  if (deviceId === null) {
    return { status: "ignored" };
  }

  const initialPlacementAnchor = resolveGridPointFromGesturePosition(
    options.canvas.view,
    options.lastMousePosition,
  );

  return handlePlacementEntryButtonTap({
    canvas: options.canvas,
    editor: options.editor,
    deviceId,
    source: "mouse",
    initialPlacementAnchor,
    initialMousePosition: options.lastMousePosition,
  });
}

function finalizePlacementEnter(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  deviceId: string;
  source: "mouse" | "touch";
  initialPlacementAnchor?: GridPoint | null;
  initialMousePosition: GesturePosition | null;
  shouldSetActiveTool: boolean;
}): GestureHandleResult {
  const placementAnchor = options.initialPlacementAnchor
    ?? resolveViewportCenterGridPoint(options.canvas.view);

  if (placementAnchor === null) {
    return { status: "ignored" };
  }
  if (options.canvas.canUseWorkbenchActions) {
    recentPlacements.record(options.deviceId, options.canvas.state.runtime.singlePlacementConfig);
  }

  // shouldSetActiveTool 路径只写桥接变量 + setActiveTool，
  // draft 创建和 UI 同步交由 on-enter-active-tool 统一处理，
  // 避免"先切工具 vs 先创建 draft"的时序问题。
  if (options.shouldSetActiveTool) {
    setPendingSinglePlacementEnter(options.canvas, {
      deviceId: options.deviceId,
      anchor: placementAnchor,
      pointerMode: options.source,
      initialMousePosition: options.initialMousePosition,
    });
    options.canvas.actions.setActiveTool("single-placement");
    return { status: "handled" };
  }

  // shouldSetActiveTool: false 路径：已在 single-placement 中，不走生命周期，保持原位创建
  try {
    // mouse 模式延迟创建 draft：仅当鼠标不在 viewport 内且为全新入口（无 initialPlacementAnchor）时才延迟。
    // 有 initialPlacementAnchor 时（如快捷键、continuation）说明鼠标在 canvas 内，立即创建。
    const isFreshMouseEntry =
      options.initialPlacementAnchor === undefined
      && options.source === "mouse"
      && (options.initialMousePosition === null
          || !isClientPointInsideViewport(options.canvas.view, options.initialMousePosition));

    if (isFreshMouseEntry) {
      options.canvas.state.runtime.placementAnchor = null;
      options.canvas.state.runtime.singlePlacementPointerMode = options.source;
      runInAction(() => {
        options.canvas.state.runtime.singlePlacementDeviceId = options.deviceId;
      });
      syncPlacementEntryUi(options.canvas);
      return { status: "handled" };
    }

    options.canvas.state.runtime.placementAnchor = placementAnchor;
    options.canvas.state.runtime.singlePlacementPointerMode = options.source;
    options.canvas.createPlacementDraft({ definitionId: options.deviceId, centerGridPoint: placementAnchor });

    const previewRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (previewRect === null) {
      restoreFailedPlacementEnter(options.canvas, options.editor);
      return { status: "ignored" };
    }

    if (
      options.source === "mouse"
      && options.initialMousePosition !== null
      && isClientPointInsideViewport(options.canvas.view, options.initialMousePosition)
    ) {
      options.editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        options.initialMousePosition, options.canvas.view.state,
      );
      const movedRect = options.editor.queries.findEntityCollectionGridRect(
        EntityCollectionType.preview,
      );
      if (movedRect !== null && didPreviewRectChange(previewRect, movedRect)) {
        rotatePlacementPreviewToBuildingSnap({
          canvas: options.canvas,
          editor: options.editor,
          trigger: "after-move",
          pointerMode: "mouse",
          currentMousePosition: options.initialMousePosition,
        });
      }
    }

    runInAction(() => {
      options.canvas.state.runtime.singlePlacementDeviceId = options.deviceId;
    });

    if (!syncPlacementEntryUi(options.canvas)) {
        restoreFailedPlacementEnter(options.canvas, options.editor);
        return { status: "ignored" };
    }

    return { status: "handled" };
  } catch {
    restoreFailedPlacementEnter(options.canvas, options.editor);
    return { status: "ignored" };
  }
}

function handlePlacementMouseDragStart(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  originButton: number;
  position: GesturePosition;
}): GestureHandleResult {
  if (options.originButton !== 0) {
    return { status: "ignored" };
  }

  if (options.canvas.state.runtime.placementAnchor !== null) {
    return { status: "handled" };
  }

  return primePlacementAnchorFromPreview({
    canvas: options.canvas,
    editor: options.editor,
    position: options.position,
  });
}

export function primePlacementAnchorFromPreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  hitSlopPx?: number;
}): GestureHandleResult {
  options.canvas.actions.trackCanvasFloatingToolbarHover(null);
  try {
    if (!isPreviewEntityAtClientPoint(
      options.editor, options.canvas.view,
      options.position,
      options.hitSlopPx,
    )) {
      options.canvas.state.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    const anchor = options.canvas.view.queries.findGridCellForClientPixelPoint(
      options.position,
    );

    if (anchor === null) {
      options.canvas.state.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    options.canvas.state.runtime.placementAnchor = anchor;
    return { status: "handled" };
  } catch {
    options.canvas.state.runtime.placementAnchor = null;
    return { status: "ignored" };
  }
}

export function drivePlacementPreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  try {
    const placementAnchor = options.canvas.state.runtime.placementAnchor;
    if (placementAnchor === null) {
      return { status: "ignored" };
    }

    const nextGridPoint = options.canvas.view.queries.findGridCellForClientPixelPoint(
      options.position,
    );

    if (nextGridPoint === null) {
      return { status: "ignored" };
    }

    if (areGridPointsEqual(placementAnchor, nextGridPoint)) {
      return { status: "handled" };
    }

    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (beforeRect === null) {
      options.canvas.state.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    options.editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: placementAnchor,
      endGridPoint: nextGridPoint,
    });

    const movedRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (movedRect !== null && didPreviewRectChange(beforeRect, movedRect)) {
      rotatePlacementPreviewToBuildingSnap({
        canvas: options.canvas,
        editor: options.editor,
        trigger: "after-move",
        pointerMode: options.canvas.state.runtime.singlePlacementPointerMode,
        currentMousePosition: null,
      });
    }

    const afterRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (afterRect !== null) {
      options.canvas.state.runtime.placementAnchor = resolveTouchDragAnchorAfterPreviewMove({
        beforeRect,
        afterRect,
        startGridPoint: placementAnchor,
        endGridPoint: nextGridPoint,
      });

      if (didPreviewRectChange(beforeRect, afterRect)) {
        options.canvas.actions.alignCanvasFloatingToolbar();
      }
    }

    return { status: "handled" };
  } catch {
    options.canvas.state.runtime.placementAnchor = null;
    return { status: "ignored" };
  }
}

export function driveMousePlacementPreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  try {
    options.canvas.actions.trackCanvasFloatingToolbarHover(options.position);
    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (beforeRect === null) {
      return { status: "ignored" };
    }

    options.editor.actions.moveCollectionCenterPointTo(
      EntityCollectionType.preview,
      options.position, options.canvas.view.state,
    );
    const movedRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (movedRect !== null && !areGridRectsEqual(beforeRect, movedRect)) {
      rotatePlacementPreviewToBuildingSnap({
        canvas: options.canvas,
        editor: options.editor,
        trigger: "after-move",
        pointerMode: "mouse",
        currentMousePosition: options.position,
      });
    }
    const afterRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    const currentGridPoint = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
    if (currentGridPoint !== null) {
      options.canvas.state.runtime.placementAnchor = currentGridPoint;
    }

    if (afterRect !== null && !areGridRectsEqual(beforeRect, afterRect)) {
      options.canvas.actions.alignCanvasFloatingToolbar();
    }

    return { status: "handled" };
  } catch {
    return { status: "ignored" };
  }
}

function applyPlacementOperation(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  options: {
    keepPlacement?: boolean;
    currentMousePosition?: GesturePosition | null;
  } = {},
): boolean {
  const continuation = options.keepPlacement && canvas.isOperationEnabled("continuous-placement")
    ? capturePlacementContinuationSnapshot(canvas, editor)
    : null;

  try {
    const applied = editor.actions.applyPlacementDraft();
    if (!applied) {
      return false;
    }

    if (continuation !== null && canvas.deferPlacementContinuation(
      () => (continuation.pointerMode === "mouse" || canvas.state.runtime.singlePlacementContinuous)
        && continuePlacementOperation(canvas, editor, continuation, options.currentMousePosition ?? null),
      () => { clearPlacementUi(canvas); canvas.actions.setActiveTool("select"); },
    )) return true;

    if (continuation !== null && continuePlacementOperation(
      canvas,
      editor,
      continuation,
      options.currentMousePosition ?? null,
    )) {
      return true;
    }
  } catch {
    safelyCancelPlacementDraft(editor);
  }

  clearPlacementUi(canvas);
  canvas.actions.setActiveTool("select");
  return true;
}

function dismissPlacementOnFacility(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  position: GesturePosition,
): boolean {
  const entity = editor.queries.findEntityAtClientPixelPoint(position, canvas.view.state, { includeDrafts: false });
  if (entity === null || canvas.registry.queries.isDedicatedLogisticsDevice(entity.definitionId)) return false;
  cancelPlacementOperation(canvas, editor);
  return true;
}

function cancelPlacementOperation(canvas: CanvasInteractionController, editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } finally {
    clearPlacementUi(canvas);
    canvas.actions.setActiveTool("select");
  }
}

export function rotatePlacementPreview(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  options: {
    pointerMode: "mouse" | "touch" | null;
    currentMousePosition: GesturePosition | null;
  } = {
    pointerMode: canvas.state.runtime.singlePlacementPointerMode,
    currentMousePosition: null,
  },
): void {
  if (rotatePlacementPreviewToBuildingSnap({
    canvas,
    editor,
    trigger: "before-rotate",
    pointerMode: options.pointerMode,
    currentMousePosition: options.currentMousePosition,
  })) {
    canvas.actions.alignCanvasFloatingToolbar();
    return;
  }

  if (options.pointerMode === "mouse") {
    editor.actions.rotateCollectionAroundCenterPoint(EntityCollectionType.preview, 90);
    if (
      options.currentMousePosition !== null
      && isClientPointInsideViewport(canvas.view, options.currentMousePosition)
    ) {
      editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        options.currentMousePosition, canvas.view.state,
      );
    }
    canvas.actions.alignCanvasFloatingToolbar();
    return;
  }

  editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
  canvas.actions.alignCanvasFloatingToolbar();
}

function rotatePlacementPreviewToBuildingSnap(options: {
  readonly canvas: CanvasInteractionController;
  readonly editor: EditorContract;
  readonly trigger: "after-move" | "before-rotate";
  readonly pointerMode: "mouse" | "touch" | null;
  readonly currentMousePosition: GesturePosition | null;
}): boolean {
  const isMouse = options.pointerMode === "mouse";
  const clientPixelPoint = isMouse
    && options.currentMousePosition !== null
    && isClientPointInsideViewport(options.canvas.view, options.currentMousePosition)
    ? options.currentMousePosition
    : null;

  return options.editor.actions.rotateCollectionToSnapOnBuilding({
    collectionType: EntityCollectionType.preview,
    trigger: options.trigger,
    pivotMode: isMouse ? "center" : "pivot-cell",
    clientPixelPoint, viewport: options.canvas.view.state,
  });
}

/**
 * 从面板（设备列表、配方树、流程图）拖出设备：指针进入画布时进入该设备的放置，预览跟随指针，
 * 贴近画布边缘时地图跟着平移。配方等初始配置由调用方事先写入 runtime.singlePlacementConfig。
 * 返回是否处于该设备的放置中。
 */
export function dragPlacementFromPanel(
  canvas: CanvasInteractionController,
  deviceId: string,
  position: GesturePosition,
): boolean {
  const editor = canvas.editor;
  if (editor === null) {
    return false;
  }

  if (
    canvas.state.activeTool !== "single-placement"
    || canvas.state.runtime.singlePlacementDeviceId !== deviceId
  ) {
    handlePlacementEntryButtonTap({
      canvas,
      editor,
      deviceId,
      source: "mouse",
      initialMousePosition: position,
      allowFromAnyTool: true,
    });
    if (
      canvas.state.activeTool !== "single-placement"
      || canvas.state.runtime.singlePlacementDeviceId !== deviceId
    ) {
      return false;
    }
  }

  if (!ensurePlacementDraftForMouse(canvas, editor, position)) {
    return false;
  }
  const redrive = (next: GesturePosition) => {
    driveMousePlacementPreview({ canvas, editor, position: next });
  };
  redrive(position);
  canvas.edgePan.track(position, redrive);
  return true;
}

/** 结束从面板拖出的放置：落在画布上（position 非 null）放下一台，否则取消；keepInHand 时放下后设备仍在手上。 */
export function dropPlacementFromPanel(
  canvas: CanvasInteractionController,
  position: GesturePosition | null,
  keepInHand = false,
): void {
  canvas.edgePan.stop();
  const editor = canvas.editor;
  if (editor === null || canvas.state.activeTool !== "single-placement") {
    return;
  }

  if (position === null || !isClientPointInsideViewport(canvas.view, position)) {
    cancelPlacementOperation(canvas, editor);
    return;
  }

  driveMousePlacementPreview({ canvas, editor, position });
  if (!applyPlacementOperation(canvas, editor, { keepPlacement: keepInHand, currentMousePosition: position })) {
    cancelPlacementOperation(canvas, editor);
  }
}

/**
 * 触控放置中点按画布：点在预览上即放下；点在别处把预览移到该处，再点一次放下。
 * 预览在整个基地的缩放下只有几个像素宽，手指很难先拖住它。
 */
export function handleTouchPlacementTap(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  position: GesturePosition,
  place: () => void,
): GestureHandleResult {
  // 在画布上落笔即结束对浮动工具条的悬停冻结。
  canvas.actions.trackCanvasFloatingToolbarHover(null);
  if (editor.state.collections.preview.length === 0 || !isClientPointInsideViewport(canvas.view, position)) {
    return { status: "ignored" };
  }
  if (isPreviewEntityAtClientPoint(editor, canvas.view, position, TOUCH_PREVIEW_HIT_SLOP_PX)) {
    place();
    return { status: "handled" };
  }
  editor.actions.moveCollectionCenterPointTo(EntityCollectionType.preview, position, canvas.view.state);
  const cell = canvas.view.queries.findGridCellForClientPixelPoint(position);
  if (cell !== null) {
    canvas.state.runtime.placementAnchor = cell;
  }
  canvas.actions.alignCanvasFloatingToolbar();
  return { status: "handled" };
}

/** 交到手上的设备：类型，以及放下时带上的初始配置（配方等）与朝向。 */
export interface HeldDevice {
  readonly deviceId: string;
  readonly config?: Readonly<Record<string, unknown>> | null;
  readonly rotation?: GridRotation | null;
  readonly warehouseItemId?: string | null;
}

/**
 * 把一台设备交到手上（进入或留在放置工具）：快捷栏、吸管、环形菜单、待放清单与暂存托盘共用。
 * 已在放置时原地换成这台设备，预览留在原来的位置；给出 position 时预览出现在该点并跟随指针。
 * 返回是否已处于该设备的放置中。
 */
export function holdDeviceForPlacement(
  canvas: CanvasInteractionController,
  device: HeldDevice,
  options: { readonly source: "mouse" | "touch"; readonly position?: GesturePosition | null },
): boolean {
  const editor = canvas.editor;
  if (editor === null) {
    return false;
  }

  const runtime = canvas.state.runtime;
  runInAction(() => {
    runtime.singlePlacementConfig = device.config ?? null;
    runtime.singlePlacementRotation = device.rotation ?? null;
    runtime.singlePlacementWarehouseItemId = device.warehouseItemId ?? null;
  });
  const position = options.position ?? null;
  const placing = canvas.state.activeTool === "single-placement";
  const source = position !== null || !placing ? options.source : runtime.singlePlacementPointerMode ?? options.source;
  // 触控按锚点格放预览；鼠标与笔让预览出现在指针处并跟随。
  const anchor = position !== null && source === "touch"
    ? canvas.view.queries.findGridCellForClientPixelPoint(position)
    : placing && position === null ? runtime.placementAnchor : null;
  if (placing && runtime.singlePlacementDeviceId === device.deviceId) {
    // 同一台设备只更新配置与朝向：重建预览让新配置生效。
    safelyCancelPlacementDraft(editor);
    runtime.singlePlacementDeviceId = null;
  }
  handlePlacementEntryButtonTap({
    canvas,
    editor,
    deviceId: device.deviceId,
    source,
    initialPlacementAnchor: anchor ?? undefined,
    initialMousePosition: source === "mouse" ? position : null,
    allowFromAnyTool: true,
  });
  if (canvas.state.activeTool !== "single-placement" || runtime.singlePlacementDeviceId !== device.deviceId) {
    return false;
  }

  if (position !== null && source === "mouse") {
    ensurePlacementDraftForMouse(canvas, editor, position);
  }
  if (device.rotation !== null && device.rotation !== undefined && editor.state.collections.preview.length > 0) {
    const steps = ((device.rotation - resolveSinglePlacementPreviewRotation(editor)) / 90 + 4) % 4;
    for (let step = 0; step < steps; step += 1) {
      editor.actions.rotateCollectionAroundCenterPoint(EntityCollectionType.preview, 90);
    }
    if (position !== null && source === "mouse") {
      editor.actions.moveCollectionCenterPointTo(EntityCollectionType.preview, position, canvas.view.state);
    }
    canvas.actions.alignCanvasFloatingToolbar();
  }
  return true;
}

export function cleanupPlacementDraft(canvas: CanvasInteractionController): void {
  const editor = canvas.editor;
  if (editor !== null) {
    safelyCancelPlacementDraft(editor);
  }

  clearPlacementUi(canvas);
}

function clearPlacementUi(canvas: CanvasInteractionController): void {
  runInAction(() => {
    canvas.state.runtime.placementAnchor = null;
    canvas.state.runtime.singlePlacementDeviceId = null;
    canvas.state.runtime.singlePlacementConfig = null;
    canvas.state.runtime.singlePlacementWarehouseItemId = null;
    canvas.state.runtime.singlePlacementRotation = null;
    canvas.state.runtime.singlePlacementPointerMode = null;
  });
  canvas.actions.hideCanvasFloatingToolbar();
}

function restoreFailedPlacementEnter(canvas: CanvasInteractionController, editor: EditorContract): void {
  canvas.pendingPlacementEnter = null;
  safelyCancelPlacementDraft(editor);
  clearPlacementUi(canvas);
  canvas.actions.setActiveTool("select");
}

function safelyCancelPlacementDraft(editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; placement should not leave UI half-entered.
  }
}

export function syncPlacementEntryUi(
  canvas: CanvasInteractionController,
  pointerMode = canvas.state.runtime.singlePlacementPointerMode,
  options: {
    readonly floatingToolbarButtonIds?: readonly CanvasFloatingToolbarButtonId[];
  } = {},
): boolean {
  if (pointerMode === null) {
    return true;
  }

  if (pointerMode !== "touch") {
    canvas.actions.hideCanvasFloatingToolbar();
    return true;
  }

  return canvas.actions.showCanvasFloatingToolbarForCollection(
    options.floatingToolbarButtonIds ?? resolvePlacementToolbarButtonIds(canvas),
    EntityCollectionType.preview,
  );
}

function handleContinuousPlacementToggleTap(
  canvas: CanvasInteractionController,
  uiButtonId: string,
): GestureHandleResult | null {
  if (canvas.state.activeTool !== "single-placement") {
    return null;
  }

  if (uiButtonId !== RAIL_TOGGLE_CONTINUOUS_PLACEMENT_BUTTON_ID) {
    return null;
  }
  if (!canvas.state.runtime.singlePlacementContinuous && !canvas.isOperationEnabled("continuous-placement")) {
    return { status: "ignored" };
  }
  canvas.state.runtime.singlePlacementContinuous = !canvas.state.runtime.singlePlacementContinuous;
  return { status: "handled" };
}

function resolvePlacementToolbarButtonIds(
  canvas: CanvasInteractionController,
): readonly CanvasFloatingToolbarButtonId[] {
  const deviceId = canvas.state.runtime.singlePlacementDeviceId;
  if (
    deviceId === null
    || !canSwitchEntityVariantDefinition({ canvas, definitionId: deviceId })
  ) {
    return PLACEMENT_TOOLBAR_BUTTON_IDS;
  }

  return [
    "canvas-floating-toolbar-button-cancel",
    SWITCH_DEVICE_MODE_BUTTON_ID,
    "canvas-floating-toolbar-button-rotate",
    "canvas-floating-toolbar-button-ok",
  ];
}

function switchPlacementPreviewVariant(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
): GestureHandleResult {
  const previewEntityId = editor.state.collections.preview[0] ?? null;
  if (previewEntityId === null) {
    return { status: "ignored" };
  }

  const previewEntity = editor.queries.getEntityById(previewEntityId);
  if (previewEntity === null) {
    return { status: "ignored" };
  }

  const nextDefinitionId = resolveNextSwitchableEntityVariantDefinitionId({
    canvas,
    definitionId: previewEntity.definitionId,
  });
  if (nextDefinitionId === null) {
    return { status: "ignored" };
  }

  if (!editor.actions.replaceEntityDefinition(previewEntity.id, nextDefinitionId)) {
    return { status: "ignored" };
  }

  runInAction(() => {
    canvas.state.runtime.singlePlacementDeviceId = nextDefinitionId;
  });
  if (canvas.state.runtime.singlePlacementPointerMode === "mouse") {
    if (
      currentMousePosition !== null
      && isClientPointInsideViewport(canvas.view, currentMousePosition)
    ) {
      editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        currentMousePosition, canvas.view.state,
      );
    }
    canvas.actions.alignCanvasFloatingToolbar();
  } else {
    recenterPlacementPreviewAtAnchor(canvas, editor);
  }
  syncPlacementEntryUi(canvas);
  return { status: "handled" };
}

function recenterPlacementPreviewAtAnchor(
  canvas: CanvasInteractionController,
  editor: EditorContract,
): void {
  const placementAnchor = canvas.state.runtime.placementAnchor;
  if (placementAnchor === null) {
    return;
  }

  const previewRect = editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (previewRect === null) {
    return;
  }

  const nextTopLeft = {
    x: placementAnchor.x - Math.floor((previewRect.width - 1) / 2),
    y: placementAnchor.y - Math.floor((previewRect.height - 1) / 2),
  };
  if (previewRect.x !== nextTopLeft.x || previewRect.y !== nextTopLeft.y) {
    editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: {
        x: previewRect.x,
        y: previewRect.y,
      },
      endGridPoint: nextTopLeft,
    });
  }

  canvas.actions.alignCanvasFloatingToolbar();
}

function capturePlacementContinuationSnapshot(
  canvas: CanvasInteractionController,
  editor: EditorContract,
): {
  anchor: GridPoint;
  deviceId: string;
  pointerMode: "mouse" | "touch";
  position: GridPoint;
  rotation: GridRotation;
} | null {
  const deviceId = canvas.state.runtime.singlePlacementDeviceId;
  const anchor = canvas.state.runtime.placementAnchor;
  const pointerMode = canvas.state.runtime.singlePlacementPointerMode;
  const previewEntityId = editor.state.collections.preview[0] ?? null;
  const previewEntity = previewEntityId === null
    ? null
    : editor.queries.getEntityById(previewEntityId);

  if (deviceId === null || anchor === null || pointerMode === null || previewEntity === null) {
    return null;
  }

  return {
    anchor: { ...anchor },
    deviceId,
    pointerMode,
    position: { ...previewEntity.position },
    rotation: resolveSinglePlacementPreviewRotation(editor),
  };
}

function continuePlacementOperation(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  continuation: {
    anchor: GridPoint;
    deviceId: string;
    pointerMode: "mouse" | "touch";
    position: GridPoint;
    rotation: GridRotation;
  },
  currentMousePosition: GesturePosition | null,
): boolean {
  const result = finalizePlacementEnter({
    canvas,
    editor,
    deviceId: continuation.deviceId,
    source: continuation.pointerMode,
    initialPlacementAnchor: continuation.anchor,
    initialMousePosition: null,
    shouldSetActiveTool: false,
  });

  if (result.status !== "handled") {
    return false;
  }

  restorePlacementPreviewRotation(canvas, editor, continuation.rotation);
  const previewEntityId = editor.state.collections.preview[0] ?? null;
  const previewEntity = previewEntityId === null
    ? null
    : editor.queries.getEntityById(previewEntityId);
  if (previewEntity === null) {
    return false;
  }

  // 连续放置复用刚提交的实际位置；鼠标移动后 placementAnchor 仍是首次创建 draft 的锚点。
  // 触控模式下由笔尖在画布上点按提交时同样跟随指针，下一台设备不会停在刚放下的位置上。
  if (
    currentMousePosition !== null
    && isClientPointInsideViewport(canvas.view, currentMousePosition)
  ) {
    editor.actions.moveCollectionCenterPointTo(
      EntityCollectionType.preview,
      currentMousePosition, canvas.view.state,
    );
  } else {
    editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: previewEntity.position,
      endGridPoint: continuation.position,
    });
  }
  if (continuation.pointerMode === "touch") {
    canvas.actions.alignCanvasFloatingToolbar();
  }
  return true;
}

function resolveSinglePlacementPreviewRotation(editor: EditorContract): GridRotation {
  const previewEntityId = editor.state.collections.preview[0] ?? null;
  if (previewEntityId === null) {
    return 0;
  }

  return editor.queries.getEntityById(previewEntityId)?.rotation ?? 0;
}

function restorePlacementPreviewRotation(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  rotation: GridRotation,
): void {
  const rotateCount = rotation / 90;
  for (let step = 0; step < rotateCount; step += 1) {
    editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
  }

  if (rotateCount > 0 && canvas.state.runtime.singlePlacementPointerMode === "touch") {
    canvas.actions.alignCanvasFloatingToolbar();
  }
}

function parsePlacementModeDeviceId(
  uiButtonId: string,
  source: "mouse" | "touch",
): string | null {
  const suffix = source === "mouse" ? "-mouse-tap" : "-touch-tap";

  if (
    !uiButtonId.startsWith(PLACEMENT_MODE_EVENT_PREFIX)
    || !uiButtonId.endsWith(suffix)
  ) {
    return null;
  }

  const deviceId = uiButtonId.slice(
    PLACEMENT_MODE_EVENT_PREFIX.length,
    uiButtonId.length - suffix.length,
  );

  return deviceId.length > 0 ? deviceId : null;
}

export function resolveViewportCenterGridPoint(view: EditorViewContract): GridPoint | null {
  const clientRect = view.state.clientRect;

  return view.queries.findGridCellForClientPixelPoint({
    x: clientRect.left + clientRect.width / 2,
    y: clientRect.top + clientRect.height / 2,
  });
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

function isPreviewEntityAtClientPoint(
  editor: EditorContract, view: EditorViewContract,
  position: GesturePosition,
  hitSlopPx?: number,
): boolean {
  return isPreviewBoundingBoxAtClientPoint({
    editor,
    position,
    hitSlopPx, view: view,
  });
}

function isClientPointInsideViewport(
  view: EditorViewContract,
  position: GesturePosition,
): boolean {
  const clientRect = view.state.clientRect;

  return position.x >= clientRect.left
    && position.x <= clientRect.left + clientRect.width
    && position.y >= clientRect.top
    && position.y <= clientRect.top + clientRect.height;
}

// mouse 模式延迟创建 placement draft。
// 鼠标滑入 canvas 时才首次创建 draft，而非点击按钮时立即出现。
function ensurePlacementDraftForMouse(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  position: GesturePosition,
): boolean {
  const runtime = canvas.state.runtime;
  // 已有 draft 或 anchor 已设定，无需再创建
  if (runtime.placementAnchor !== null) return true;
  // 非 mouse 模式，不在此处理
  if (runtime.singlePlacementPointerMode !== "mouse") return true;
  // 无设备 id，不处理
  if (runtime.singlePlacementDeviceId === null) return false;

  // 鼠标不在 canvas 内，暂不创建
  if (!isClientPointInsideViewport(canvas.view, position)) return false;

  const gridPoint = canvas.view.queries.findGridCellForClientPixelPoint(position);
  if (gridPoint === null) return false;

  try {
    canvas.createPlacementDraft({ definitionId: runtime.singlePlacementDeviceId, centerGridPoint: gridPoint });
    const previewRect = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
    if (previewRect === null) {
      restoreFailedPlacementEnter(canvas, editor);
      return false;
    }
    runtime.placementAnchor = gridPoint;
    return true;
  } catch {
    restoreFailedPlacementEnter(canvas, editor);
    return false;
  }
}

function areGridRectsEqual(left: GridRect, right: GridRect): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}


export function resolveDeviceIdForPlacementGroupShortcut(options: {
  registry: RegistryContract;
  group: PlacementGroup;
  shortcutIndex: number;
  collapseDeviceModes?: boolean;
  selectedVariantNameByCraftGroup?: Readonly<Record<string, string>>;
  canUseDefinition?: (definition: EntityDefinition) => boolean;
}): string | null {
  const entities = options.registry.entityDefinitions
    .filter(
      (definition) =>
        definition.uiGroup === options.group
        && !definition.tags.includes("不可摆放"),
    )
    .filter((definition) => options.canUseDefinition?.(definition) ?? true)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id));

  const visibleEntities = options.collapseDeviceModes
    ? collapseEntityVariantDefinitions({
        definitions: entities,
        selectedVariantNameByCraftGroup: options.selectedVariantNameByCraftGroup ?? {},
      })
    : entities;

  return visibleEntities[options.shortcutIndex]?.id ?? null;
}


function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}
