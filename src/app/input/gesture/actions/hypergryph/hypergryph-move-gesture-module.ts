import type { CanvasInteractionController } from "@/app/canvas";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { createMovePreviewBlueprintDocument } from "@/app/blueprint/save-blueprint";
import {
  SWITCH_DEVICE_MODE_BUTTON_ID,
  canSwitchEntityVariantDefinition,
  resolveNextSwitchableEntityVariantDefinitionId,
} from "@/app/entity-variant-availability";
import type { CanvasFloatingToolbarButtonId } from "@/app/state/state-impl";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { RAIL_SELECTION_MOVE_BUTTON_ID } from "../rail-buttons";
import { placeBlueprintFromMoveAndContinue } from "./hypergryph-blueprint-placement-gesture-module";
import { isPlacementCancelButtonId, isPlacementRotateButtonId } from "./hypergryph-single-placement-gesture-module";
import { recordEntityLandedBy } from "./entity-spin-tap";
import {
  didPreviewRectChange,
  isPreviewBoundingBoxAtClientPoint,
  resolveTouchDragAnchorAfterPreviewMove,
  TOUCH_PREVIEW_HIT_SLOP_PX,
} from "./mobile-preview-bounds";
import {
  openOverlapEntityMenuForCandidates,
  resolveOverlappingEntityCandidatesAtClientPoint,
} from "./overlap-entity-candidates";

const MOVE_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-copy",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const satisfies readonly CanvasFloatingToolbarButtonId[];

const MOVE_ENTRY_BUTTON_IDS = {
  marquee: RAIL_SELECTION_MOVE_BUTTON_ID,
  select: "canvas-floating-toolbar-button-move",
} as const;
const PLACEMENT_MARQUEE_TOOL_BUTTON_ID = "placement-tool-marquee";

export function createHypergryphMoveGestureModule(): GestureMappingModule<AppHost> {
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "hypergryph-move-gesture",
    shortcutRoutes: [
      {
        id: "move.enter-selection",
        operation: "move",
        actionId: SHORTCUT_KEY.MOVE_SELECTION,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.MOVE_SELECTION },
        scope: {
          inputLayers: ["canvas"],
          activeTools: ["select", "marquee"],
        },
        triggerPolicy: { kind: "exact" },
        handle(_event, context) {
          const editor = context.canvas.editor;
          return editor === null
            ? { status: "ignored" }
            : tryEnterMoveModeFromKeyboard(context.canvas, editor, lastMousePosition);
        },
      },
      {
        id: "move.switch-device-mode",
        operation: "switch-device-variant",
        actionId: SHORTCUT_KEY.SWITCH_DEVICE_MODE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.SWITCH_DEVICE_MODE },
        scope: { inputLayers: ["canvas"], activeTools: ["move"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        handle(_event, context) {
          const editor = context.canvas.editor;
          return editor === null
            ? { status: "ignored" }
            : switchMovePreviewVariant(context.canvas, editor, lastMousePosition);
        },
      },
      {
        id: "move.delete-operation",
        operation: "delete",
        actionId: SHORTCUT_KEY.DELETE_DEVICE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.DELETE_DEVICE },
        scope: { inputLayers: ["canvas"], activeTools: ["move"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          deleteMoveOperation(context.canvas, editor);
          return { status: "handled" };
        },
      },
      {
        id: "current-operation.rotate-move",
        operation: "rotate-placement",
        actionId: SHORTCUT_KEY.ROTATE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.ROTATE },
        scope: { inputLayers: ["canvas"], activeTools: ["move"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          rotateMovePreview(context.canvas, editor, lastMousePosition);
          return { status: "handled" };
        },
      },
    ],
    acceptsLongPress(context) {
      const tool = context.canvas.state.activeTool;
      return tool === "select" || tool === "marquee";
    },
    handle(event, context) {
      if (
        event.type === "mouse move"
        || event.type === "mouse dragstart"
        || event.type === "mouse dragmove"
      ) {
        lastMousePosition = event.position;
      }

      if (event.type === "on-exit-active-tool") {
        if (event.from !== "move" || event.to === "move") {
          return { status: "ignored" };
        }

        cleanupMoveOperationDraft(context.canvas);
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "move") {
          return { status: "ignored" };
        }

        syncMoveEntryUi(context.canvas);
        return { status: "handled" };
      }

      const editor = context.canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      if (context.canvas.state.activeTool === "move") {
        switch (event.type) {
          case "mouse-long-press-ready":
          case "tap-long-press-ready":
            return { status: "handled" };


          case "mouse dragstart":
            return handleMoveMouseDragStart({
              canvas: context.canvas,
              editor,
              entityDefinitionMap: createEntityDefinitionMap(context.canvas),
              originButton: event.originButton,
              position: event.position,
            });

          case "touch dragstart":
            return handleMoveTouchDragStart({
              canvas: context.canvas,
              editor,
              entityDefinitionMap: createEntityDefinitionMap(context.canvas),
              position: event.startPosition,
            });

          case "mouse move":
            return driveMovePreview({
              canvas: context.canvas,
              editor,
              position: event.position,
              allowMouseEntryAnchorInit: true,
            });

          case "mouse dragmove":
            if (event.originButton !== 0) {
              return { status: "ignored" };
            }

            return driveMovePreview({
              canvas: context.canvas,
              editor,
              position: event.position,
              allowMouseEntryAnchorInit: false,
            });

          case "touch dragmove":
            return driveMovePreview({
              canvas: context.canvas,
              editor,
              position: event.position,
              allowMouseEntryAnchorInit: false,
            });

          case "mouse dragend":
            return (
              event.originButton === 0
              && context.canvas.state.runtime.moveAnchor !== null
            )
              ? { status: "handled" }
              : { status: "ignored" };

          case "touch dragend":
            return context.canvas.state.runtime.moveAnchor !== null
              ? { status: "handled" }
              : { status: "ignored" };

          case "mouse tap":
            if (event.button === 2) {
              cancelMoveOperation(context.canvas, editor, "mouse");
              return { status: "handled" };
            }

            if (event.button === 0 && !event.longPress) {
              if (
                event.modifiers.ctrl
                && context.canvas.workbench.state.settings.hypergryphCopyWhileMoving
              ) {
                return copyMoveOperation({
                  canvas: context.canvas,
                  editor,
                  source: "mouse",
                  currentMousePosition: lastMousePosition,
                });
              }

              recordEntityLandedBy(context.canvas, editor, event.position, () => {
                applyMoveOperation(context.canvas, editor, "mouse");
              });
              return { status: "handled" };
            }

            return { status: "handled" };

          case "touch double tap":
            if (!isPreviewBoundingBoxAtClientPoint({
              editor,
              view: context.canvas.view,
              position: event.position,
              hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
            })) {
              return { status: "ignored" };
            }
            rotateMovePreview(context.canvas, editor, null);
            return { status: "handled" };

          case "ui-button-touch-tap":
            if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
              return switchMovePreviewVariant(context.canvas, editor, null);
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
              applyMoveOperation(context.canvas, editor, "touch");
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-copy") {
              return copyMoveOperation({
                canvas: context.canvas,
                editor,
                source: "touch",
                currentMousePosition: null,
              });
            }

            if (isPlacementRotateButtonId(event.uiButtonId)) {
              rotateMovePreview(context.canvas, editor, null);
              return { status: "handled" };
            }

            if (isPlacementCancelButtonId(event.uiButtonId)) {
              cancelMoveOperation(context.canvas, editor, "touch");
              return { status: "handled" };
            }

            return { status: "ignored" };

          case "ui-button-mouse-tap":
            if (event.button !== 0) {
              return { status: "ignored" };
            }

            if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
              return switchMovePreviewVariant(context.canvas, editor, lastMousePosition);
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
              applyMoveOperation(context.canvas, editor, "mouse");
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-copy") {
              return copyMoveOperation({
                canvas: context.canvas,
                editor,
                source: "mouse",
                currentMousePosition: lastMousePosition,
              });
            }

            if (isPlacementRotateButtonId(event.uiButtonId)) {
              rotateMovePreview(context.canvas, editor, lastMousePosition);
              return { status: "handled" };
            }

            if (isPlacementCancelButtonId(event.uiButtonId)) {
              cancelMoveOperation(context.canvas, editor, "mouse");
              return { status: "handled" };
            }

            return { status: "ignored" };

          default:
            return { status: "ignored" };
        }
      }

      switch (event.type) {
        case "ui-button-touch-tap":
          return handleMoveEntryButtonTap({
            canvas: context.canvas,
            editor,
            uiButtonId: event.uiButtonId,
            source: "touch",
            initialMousePosition: null,
          });

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          return handleMoveEntryButtonTap({
            canvas: context.canvas,
            editor,
            uiButtonId: event.uiButtonId,
            source: "mouse",
            initialMousePosition: lastMousePosition,
          });

        case "mouse dragstart":
          if (
            event.originButton !== 0
            || (!event.longPress && !context.canvas.workbench.state.settings.hypergryphImmediateMove)
          ) {
            return { status: "ignored" };
          }

          return tryEnterMoveModeFromPointerEvent({
            canvas: context.canvas,
            editor,
            pointerEntity: event.pointerEntity,
            candidatePosition: event.startPosition,
            menuPosition: event.startPosition,
            enterPosition: event.position,
            source: "mouse",
            directInitialMousePosition: event.position,
            menuInitialMousePosition: event.startPosition,
          });

        case "touch dragstart": {
          const canvas = context.canvas;
          if (!event.longPress || event.activeTouchCount !== 1 || canvas.state.activeTool !== "select") return { status: "ignored" };
          const result = tryEnterMoveModeFromPointerEvent({
            canvas,
            editor,
            pointerEntity: editor.queries.findEntityAtClientPixelPoint(event.startPosition, canvas.view.state),
            candidatePosition: event.startPosition,
            menuPosition: event.startPosition,
            enterPosition: event.startPosition,
            source: "touch",
            directInitialMousePosition: null,
            menuInitialMousePosition: null,
          });
          if (result.status === "handled" && canvas.state.runtime.movePointerMode === "touch") {
            driveMovePreview({ canvas, editor, position: event.position, allowMouseEntryAnchorInit: false });
          }
          return result;
        }

        case "mouse-long-press-ready":
          if (event.button !== 0 || (event.isPen && context.canvas.state.activeTool === "select")) {
            return { status: "ignored" };
          }

          return tryEnterMoveModeFromPointerEvent({
            canvas: context.canvas,
            editor,
            pointerEntity: event.pointerEntity,
            candidatePosition: event.position,
            menuPosition: event.position,
            enterPosition: event.position,
            source: "mouse",
            directInitialMousePosition: event.position,
            menuInitialMousePosition: event.position,
          });

        case "tap-long-press-ready":
          if (context.canvas.state.activeTool === "select") return { status: "ignored" };
          return tryEnterMoveModeFromPointerEvent({
            canvas: context.canvas,
            editor,
            pointerEntity: event.pointerEntity,
            candidatePosition: event.position,
            menuPosition: event.position,
            enterPosition: event.position,
            source: "touch",
            directInitialMousePosition: null,
            menuInitialMousePosition: null,
          });


        default:
          return { status: "ignored" };
      }
    },
  };
}

function handleMoveEntryButtonTap(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  uiButtonId: string;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  return tryEnterMoveModeFromSelection(options);
}

function tryEnterMoveModeFromPointerEvent(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  candidatePosition: GesturePosition;
  menuPosition: GesturePosition;
  enterPosition: GesturePosition;
  source: "mouse" | "touch";
  directInitialMousePosition: GesturePosition | null;
  menuInitialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  const previousTool = options.canvas.state.activeTool;
  const selection = options.editor.state.collections[EntityCollectionType.selection];
  const filterCandidate = previousTool === "marquee"
    ? (entity: WorldEntity) => selection.contains(entity.id)
    : undefined;
  const candidates = resolveOverlappingEntityCandidatesAtClientPoint({
    canvas: options.canvas,
    editor: options.editor,
    position: options.candidatePosition,
    pointerEntity: options.pointerEntity,
    filterCandidate,
  });

  if (
    openOverlapEntityMenuForCandidates({
      canvas: options.canvas,
      editor: options.editor,
      position: options.menuPosition,
      candidates,
      onSelect: (entity) => {
        tryEnterMoveMode({
          canvas: options.canvas,
          editor: options.editor,
          pointerEntity: entity,
          position: options.menuPosition,
          source: options.source,
          initialMousePosition: options.menuInitialMousePosition,
        });
      },
    })
  ) {
    return { status: "handled" };
  }

  return tryEnterMoveMode({
    canvas: options.canvas,
    editor: options.editor,
    pointerEntity: candidates[0] ?? options.pointerEntity,
    position: options.enterPosition,
    source: options.source,
    initialMousePosition: options.directInitialMousePosition,
  });
}

function tryEnterMoveMode(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  position: GesturePosition;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  const previousTool = options.canvas.state.activeTool;

  if (
    previousTool !== "select"
    && previousTool !== "marquee"
  ) {
    return { status: "ignored" };
  }

  const selection = options.editor.state.collections[EntityCollectionType.selection];
  const selectedEntityIds = [...selection];
  const anchor = options.canvas.view.queries.findGridCellForClientPixelPoint(
    options.position,
  );

  try {
    if (!prepareSelectionForMoveEnter({
      editor: options.editor,
      pointerEntity: options.pointerEntity,
      previousTool,
      selection,
      source: options.source,
    })) {
      if (didMouseSelectEnterMutateSelection({
        pointerEntity: options.pointerEntity,
        previousTool,
        source: options.source,
      })) {
        restoreFailedEnterMove({
          canvas: options.canvas,
          editor: options.editor,
          selectedEntityIds,
          previousTool,
        });
      }

      return { status: "ignored" };
    }

    return finalizeMoveEnter({
      canvas: options.canvas,
      editor: options.editor,
      selectedEntityIds,
      previousTool,
      source: options.source,
      anchor,
      requireAnchor: true,
      initialMousePosition: options.initialMousePosition,
    });
  } catch {
    restoreFailedEnterMove({
      canvas: options.canvas,
      editor: options.editor,
      selectedEntityIds,
      previousTool,
    });
    return { status: "ignored" };
  }
}

function tryEnterMoveModeFromSelection(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  uiButtonId: string;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  const previousTool = options.canvas.state.activeTool;
  const entryButtonId = resolveMoveEntryButtonId(previousTool);
  if (entryButtonId === null || options.uiButtonId !== entryButtonId) {
    return { status: "ignored" };
  }

  const selection = options.editor.state.collections[EntityCollectionType.selection];
  if (selection.length === 0) {
    return { status: "ignored" };
  }

  return finalizeMoveEnter({
    canvas: options.canvas,
    editor: options.editor,
    selectedEntityIds: [...selection],
    previousTool,
    source: options.source,
    anchor: null,
    requireAnchor: false,
    initialMousePosition: options.initialMousePosition,
  });
}

function tryEnterMoveModeFromKeyboard(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  initialMousePosition: GesturePosition | null,
): GestureHandleResult {
  const previousTool = canvas.state.activeTool;

  if (previousTool !== "select" && previousTool !== "marquee") {
    return { status: "ignored" };
  }

  const selection = editor.state.collections[EntityCollectionType.selection];
  if (selection.length === 0) {
    return { status: "ignored" };
  }

  return finalizeMoveEnter({
    canvas,
    editor,
    selectedEntityIds: [...selection],
    previousTool,
    source: "mouse",
    anchor: null,
    requireAnchor: false,
    initialMousePosition,
  });
}

function resolveMoveEntryButtonId(
  activeTool: CanvasInteractionController["state"]["activeTool"],
): string | null {
  if (activeTool === "marquee") {
    return MOVE_ENTRY_BUTTON_IDS.marquee;
  }

  if (activeTool === "select") {
    return MOVE_ENTRY_BUTTON_IDS.select;
  }

  return null;
}

function finalizeMoveEnter(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  selectedEntityIds: readonly string[];
  previousTool: CanvasInteractionController["state"]["activeTool"];
  source: "mouse" | "touch";
  anchor: GridPoint | null;
  requireAnchor: boolean;
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  try {
    options.editor.actions.createMoveOperationDraft();

    const previewRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (previewRect === null || (options.requireAnchor && options.anchor === null)) {
      restoreFailedEnterMove({
        canvas: options.canvas,
        editor: options.editor,
        selectedEntityIds: options.selectedEntityIds,
        previousTool: options.previousTool,
      });
      return { status: "ignored" };
    }

    options.canvas.state.runtime.movePointerMode = options.source;
    options.canvas.state.runtime.moveAnchor = options.source === "touch"
      ? options.anchor
      : null;
    options.canvas.state.runtime.moveEnterFrom = options.previousTool;

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
        rotateMovePreviewToBuildingSnap({
          canvas: options.canvas,
          editor: options.editor,
          trigger: "after-move",
          currentMousePosition: options.initialMousePosition,
        });
      }
    }

    options.canvas.actions.setActiveTool("move");
    return { status: "handled" };
  } catch {
    restoreFailedEnterMove({
      canvas: options.canvas,
      editor: options.editor,
      selectedEntityIds: options.selectedEntityIds,
      previousTool: options.previousTool,
    });
    return { status: "ignored" };
  }
}

function prepareSelectionForMoveEnter(options: {
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  previousTool: CanvasInteractionController["state"]["activeTool"];
  selection: EditorContract["state"]["collections"][typeof EntityCollectionType.selection];
  source: "mouse" | "touch";
}): boolean {
  if (options.pointerEntity === null) {
    return false;
  }

  if (options.previousTool === "marquee") {
    return (
      options.source === "mouse"
      &&
      options.selection.length > 0
      && options.selection.contains(options.pointerEntity.id)
    );
  }

  if (options.previousTool !== "select") {
    return false;
  }

  options.editor.actions.clearCollection(EntityCollectionType.selection);
  options.editor.actions.addToCollection({
    collectionType: EntityCollectionType.selection,
    entityId: options.pointerEntity.id,
  });

  return options.editor.state.collections[EntityCollectionType.selection].contains(
    options.pointerEntity.id,
  );
}

function didMouseSelectEnterMutateSelection(options: {
  pointerEntity: WorldEntity | null;
  previousTool: CanvasInteractionController["state"]["activeTool"];
  source: "mouse" | "touch";
}): boolean {
  return (
    options.previousTool === "select"
    && options.pointerEntity !== null
  );
}

function restoreFailedEnterMove(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  selectedEntityIds: readonly string[];
  previousTool: CanvasInteractionController["state"]["activeTool"];
}): void {
  safelyCancelMoveDraft(options.editor);
  clearMoveUi(options.canvas);
  options.canvas.actions.setActiveTool(options.previousTool);

  try {
    options.editor.actions.clearCollection(EntityCollectionType.selection);

    for (const entityId of options.selectedEntityIds) {
      options.editor.actions.addToCollection({
        collectionType: EntityCollectionType.selection,
        entityId,
      });
    }
  } catch {
    // Selection restoration is best-effort after a failed move enter.
  }
}

function handleMoveTouchDragStart(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  position: GesturePosition;
}): GestureHandleResult {
  return primeMoveAnchorFromPreview({
    ...options,
    hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
  });
}

function handleMoveMouseDragStart(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  originButton: number;
  position: GesturePosition;
}): GestureHandleResult {
  if (options.originButton !== 0) {
    return { status: "ignored" };
  }

  if (options.canvas.state.runtime.movePointerMode === "mouse") {
    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    options.editor.actions.moveCollectionCenterPointTo(
      EntityCollectionType.preview,
      options.position, options.canvas.view.state,
    );
    const movedRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (
      beforeRect !== null
      && movedRect !== null
      && didPreviewRectChange(beforeRect, movedRect)
    ) {
      rotateMovePreviewToBuildingSnap({
        canvas: options.canvas,
        editor: options.editor,
        trigger: "after-move",
        currentMousePosition: options.position,
      });
    }
    return { status: "handled" };
  }

  if (options.canvas.state.runtime.moveAnchor !== null) {
    return { status: "handled" };
  }

  return primeMoveAnchorFromPreview({
    canvas: options.canvas,
    editor: options.editor,
    entityDefinitionMap: options.entityDefinitionMap,
    position: options.position,
  });
}

function primeMoveAnchorFromPreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  position: GesturePosition;
  hitSlopPx?: number;
}): GestureHandleResult {
  try {
    if (!isPreviewEntityAtClientPoint({
      editor: options.editor,
      entityDefinitionMap: options.entityDefinitionMap,
      position: options.position,
      hitSlopPx: options.hitSlopPx,
    }, options.canvas.view)) {
      options.canvas.state.runtime.moveAnchor = null;
      return { status: "ignored" };
    }

    const anchor = options.canvas.view.queries.findGridCellForClientPixelPoint(
      options.position,
    );

    if (anchor === null) {
      options.canvas.state.runtime.moveAnchor = null;
      return { status: "ignored" };
    }

    options.canvas.state.runtime.moveAnchor = anchor;
    return { status: "handled" };
  } catch {
    options.canvas.state.runtime.moveAnchor = null;
    return { status: "ignored" };
  }
}

export function driveMovePreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  allowMouseEntryAnchorInit: boolean;
}): GestureHandleResult {
  try {
    if (options.canvas.state.runtime.movePointerMode === "mouse") {
      return driveMouseMovePreview(options);
    }

    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (beforeRect === null) {
      options.canvas.state.runtime.moveAnchor = null;
      return { status: "ignored" };
    }

    const moveAnchor = resolveMovePreviewAnchor({
      canvas: options.canvas,
      beforeRect,
      allowMouseEntryAnchorInit: options.allowMouseEntryAnchorInit,
    });

    if (moveAnchor === null) {
      return { status: "ignored" };
    }

    if (options.canvas.state.runtime.moveAnchor === null) {
      options.canvas.state.runtime.moveAnchor = moveAnchor;
    }

    const nextGridPoint = resolveMovePreviewTargetGridPoint({
      view: options.canvas.view,
      position: options.position,
      moveAnchor,
    });

    if (nextGridPoint === null) {
      return { status: "ignored" };
    }

    if (areGridPointsEqual(moveAnchor, nextGridPoint)) {
      return { status: "handled" };
    }

    options.editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: moveAnchor,
      endGridPoint: nextGridPoint,
    });

    const movedRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (movedRect !== null && didPreviewRectChange(beforeRect, movedRect)) {
      rotateMovePreviewToBuildingSnap({
        canvas: options.canvas,
        editor: options.editor,
        trigger: "after-move",
        currentMousePosition: null,
      });
    }

    const afterRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (afterRect !== null) {
      options.canvas.state.runtime.moveAnchor = resolveTouchDragAnchorAfterPreviewMove({
        beforeRect,
        afterRect,
        startGridPoint: moveAnchor,
        endGridPoint: nextGridPoint,
      });

      if (didPreviewRectChange(beforeRect, afterRect)) {
        options.canvas.actions.alignCanvasFloatingToolbar();
      }
    }

    return { status: "handled" };
  } catch {
    options.canvas.state.runtime.moveAnchor = null;
    return { status: "ignored" };
  }
}

function driveMouseMovePreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
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
    rotateMovePreviewToBuildingSnap({
      canvas: options.canvas,
      editor: options.editor,
      trigger: "after-move",
      currentMousePosition: options.position,
    });
  }
  const afterRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );

  if (afterRect !== null && !areGridRectsEqual(beforeRect, afterRect)) {
    options.canvas.actions.alignCanvasFloatingToolbar();
  }

  return { status: "handled" };
}

function resolveMovePreviewAnchor(options: {
  canvas: CanvasInteractionController;
  beforeRect: GridRect;
  allowMouseEntryAnchorInit: boolean;
}): GridPoint | null {
  const currentAnchor = options.canvas.state.runtime.moveAnchor;

  if (currentAnchor !== null) {
    return currentAnchor;
  }

  if (
    !options.allowMouseEntryAnchorInit
    || options.canvas.state.runtime.movePointerMode !== "mouse"
  ) {
    return null;
  }

  return resolveGridCellCenterPoint(resolveGridRectCenterCell(options.beforeRect));
}

function resolveMovePreviewTargetGridPoint(options: {
  view: EditorViewContract;
  position: GesturePosition;
  moveAnchor: GridPoint;
}): GridPoint | null {
  const gridCell = options.view.queries.findGridCellForClientPixelPoint(
    options.position,
  );

  if (gridCell === null) {
    return null;
  }

  return usesGridCellCenterTracking(options.moveAnchor)
    ? resolveGridCellCenterPoint(gridCell)
    : gridCell;
}

function resolveGridRectCenterCell(gridRect: GridRect): GridPoint {
  return {
    x: gridRect.x + Math.floor((gridRect.width - 1) / 2),
    y: gridRect.y + Math.floor((gridRect.height - 1) / 2),
  };
}

function resolveGridCellCenterPoint(gridPoint: GridPoint): GridPoint {
  return {
    x: gridPoint.x + 0.5,
    y: gridPoint.y + 0.5,
  };
}

function usesGridCellCenterTracking(gridPoint: GridPoint): boolean {
  return !Number.isInteger(gridPoint.x) || !Number.isInteger(gridPoint.y);
}

function rotateMovePreview(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
): void {
  if (rotateMovePreviewToBuildingSnap({
    canvas,
    editor,
    trigger: "before-rotate",
    currentMousePosition,
  })) {
    canvas.actions.alignCanvasFloatingToolbar();
    return;
  }

  if (canvas.state.runtime.movePointerMode === "mouse") {
    editor.actions.rotateCollectionAroundCenterPoint(EntityCollectionType.preview, 90);
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
    return;
  }

  editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
  canvas.actions.alignCanvasFloatingToolbar();
}

function rotateMovePreviewToBuildingSnap(options: {
  readonly canvas: CanvasInteractionController;
  readonly editor: EditorContract;
  readonly trigger: "after-move" | "before-rotate";
  readonly currentMousePosition: GesturePosition | null;
}): boolean {
  const isMouse = options.canvas.state.runtime.movePointerMode === "mouse";
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

function switchMovePreviewVariant(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
): GestureHandleResult {
  if (canvas.state.moveKind !== "ordinary") {
    return { status: "ignored" };
  }

  const previewEntity = resolveSinglePreviewEntity(editor);
  if (previewEntity === null) {
    return { status: "ignored" };
  }

  const beforeRect = editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (beforeRect === null) {
    return { status: "ignored" };
  }

  const nextDefinitionId = resolveNextSwitchableEntityVariantDefinitionId({
    canvas,
    definitionId: previewEntity.definitionId,
  });
  if (nextDefinitionId === null) {
    return { status: "ignored" };
  }

  const moveAnchor = canvas.state.runtime.moveAnchor;
  if (!editor.actions.replaceEntityDefinition(previewEntity.id, nextDefinitionId)) {
    return { status: "ignored" };
  }

  if (canvas.state.runtime.movePointerMode === "mouse") {
    if (
      currentMousePosition !== null
      && isClientPointInsideViewport(canvas.view, currentMousePosition)
    ) {
      editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        currentMousePosition, canvas.view.state,
      );
    }
  } else if (moveAnchor !== null) {
    preserveMoveAnchorAfterVariantSwitch({
      editor,
      moveAnchor,
      beforeRect,
    });
  }

  canvas.actions.alignCanvasFloatingToolbar();
  syncMoveEntryUi(canvas);
  return { status: "handled" };
}

function preserveMoveAnchorAfterVariantSwitch(options: {
  editor: EditorContract;
  moveAnchor: GridPoint;
  beforeRect: GridRect;
}): void {
  const afterRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (afterRect === null) {
    return;
  }

  if (usesGridCellCenterTracking(options.moveAnchor)) {
    const afterCenter = resolveGridCellCenterPoint(resolveGridRectCenterCell(afterRect));
    if (areGridPointsEqual(afterCenter, options.moveAnchor)) {
      return;
    }

    options.editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: afterCenter,
      endGridPoint: options.moveAnchor,
    });
    return;
  }

  const anchorOffset = {
    x: clamp(
      options.moveAnchor.x - options.beforeRect.x,
      0,
      Math.max(0, afterRect.width - 1),
    ),
    y: clamp(
      options.moveAnchor.y - options.beforeRect.y,
      0,
      Math.max(0, afterRect.height - 1),
    ),
  };
  const nextTopLeft = {
    x: options.moveAnchor.x - anchorOffset.x,
    y: options.moveAnchor.y - anchorOffset.y,
  };

  if (afterRect.x === nextTopLeft.x && afterRect.y === nextTopLeft.y) {
    return;
  }

  options.editor.actions.moveCollectionTo({
    collectionType: EntityCollectionType.preview,
    startGridPoint: {
      x: afterRect.x,
      y: afterRect.y,
    },
    endGridPoint: nextTopLeft,
  });
}

function applyMoveOperation(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  source: "mouse" | "touch",
): void {
  const shouldReturnToMarquee = canvas.state.runtime.moveEnterFrom === "marquee";

  try {
    const applied = editor.actions.applyMoveOerationDraft();
    if (!applied) {
      return;
    }
  } catch {
    safelyCancelMoveDraft(editor);
  }

  clearMoveUi(canvas);
  canvas.actions.setActiveTool("select");
  if (!shouldReturnToMarquee) {
    clearSingleSelectionIfNotInspectorMode(canvas, editor);
  }
  if (shouldReturnToMarquee) {
    triggerPlacementMarqueeToolTap(canvas, source);
  }
}

function copyMoveOperation(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  source: "mouse" | "touch";
  currentMousePosition: GesturePosition | null;
}): GestureHandleResult {
  if (!options.canvas.isOperationEnabled("copy") || !options.canvas.workbench.state.settings.hypergryphCopyWhileMoving) {
    return { status: "ignored" };
  }

  const blueprint = createMovePreviewBlueprintDocument({
    workspace: options.canvas.workbench.workspace,
    name: "Temp Blueprint",
  });
  if (blueprint === null) {
    return { status: "ignored" };
  }

  const placementAnchor = blueprint.initialGridPoint;
  const record = {
    ...blueprint,
    parentFolderId: null,
  };

  try {
    options.editor.actions.cancelMoveOperationDraft();
  } catch {
    return { status: "ignored" };
  }

  clearMoveUi(options.canvas);
  options.editor.actions.clearCollection(EntityCollectionType.selection);
  return placeBlueprintFromMoveAndContinue({
    canvas: options.canvas,
    editor: options.editor,
    record,
    source: options.source,
    placementAnchor,
    currentMousePosition: options.currentMousePosition,
  });
}

function cancelMoveOperation(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  source: "mouse" | "touch",
): void {
  const shouldReturnToMarquee = canvas.state.runtime.moveEnterFrom === "marquee";

  try {
    editor.actions.cancelMoveOperationDraft();
  } finally {
    clearMoveUi(canvas);
    canvas.actions.setActiveTool("select");
    if (!shouldReturnToMarquee) {
      clearSingleSelectionIfNotInspectorMode(canvas, editor);
    }
    if (shouldReturnToMarquee) {
      triggerPlacementMarqueeToolTap(canvas, source);
    }
  }
}

/**
 * 在移动模式下按 F 键删除当前设备。
 * 先取消移动草稿，再删除 selection 中的实体，最后清理 UI 并恢复工具状态。
 */
function deleteMoveOperation(
  canvas: CanvasInteractionController,
  editor: EditorContract,
): void {
  const shouldReturnToMarquee = canvas.state.runtime.moveEnterFrom === "marquee";

  try {
    editor.actions.cancelMoveOperationDraft();
    editor.actions.deleteCollection(EntityCollectionType.selection);
  } finally {
    clearMoveUi(canvas);
    canvas.actions.setActiveTool(shouldReturnToMarquee ? "marquee" : "select");
  }
}

export function cleanupMoveOperationDraft(canvas: CanvasInteractionController): void {
  const editor = canvas.editor;
  if (editor !== null) {
    safelyCancelMoveDraft(editor);
  }

  clearMoveUi(canvas);
}

function clearMoveUi(canvas: CanvasInteractionController): void {
  canvas.state.runtime.moveAnchor = null;
  canvas.state.runtime.moveEnterFrom = null;
  canvas.state.runtime.movePointerMode = null;
  canvas.actions.hideCanvasFloatingToolbar();
}

/**
 * 从 Move 返回 Select 时，单选则取消选择，与 select gesture 中对已选中实体的二次点击行为保持一致。
 */
function clearSingleSelectionIfNotInspectorMode(
  canvas: CanvasInteractionController,
  editor: EditorContract,
): void {
  const selection = editor.state.collections[EntityCollectionType.selection];

  if (selection.length === 1) {
    editor.actions.clearCollection(EntityCollectionType.selection);
  }
}

function syncMoveEntryUi(canvas: CanvasInteractionController): boolean {
  const pointerMode = canvas.state.runtime.movePointerMode;
  if (pointerMode === null) {
    return true;
  }
  if (pointerMode !== "touch") {
    canvas.actions.hideCanvasFloatingToolbar();
    return true;
  }

  return canvas.actions.showCanvasFloatingToolbarForCollection(
    resolveMoveToolbarButtonIds(canvas),
    EntityCollectionType.preview,
  );
}

function resolveMoveToolbarButtonIds(
  canvas: CanvasInteractionController,
): readonly CanvasFloatingToolbarButtonId[] {
  if (canvas.state.moveKind !== "ordinary") {
    return resolveBaseMoveToolbarButtonIds(canvas);
  }

  const editor = canvas.editor;
  if (editor === null || editor === undefined) {
    return resolveBaseMoveToolbarButtonIds(canvas);
  }

  const previewEntity = resolveSinglePreviewEntity(editor);
  if (
    previewEntity === null
    || !canSwitchEntityVariantDefinition({
      canvas,
      definitionId: previewEntity.definitionId,
    })
  ) {
    return resolveBaseMoveToolbarButtonIds(canvas);
  }

  const buttonIds: CanvasFloatingToolbarButtonId[] = [
    "canvas-floating-toolbar-button-cancel",
    SWITCH_DEVICE_MODE_BUTTON_ID,
  ];
  if (canvas.workbench.state.settings.hypergryphCopyWhileMoving) {
    buttonIds.push("canvas-floating-toolbar-button-copy");
  }
  buttonIds.push(
    "canvas-floating-toolbar-button-rotate",
    "canvas-floating-toolbar-button-ok",
  );
  return buttonIds;
}

function resolveBaseMoveToolbarButtonIds(
  canvas: CanvasInteractionController,
): readonly CanvasFloatingToolbarButtonId[] {
  if (canvas.workbench.state.settings.hypergryphCopyWhileMoving) {
    return MOVE_TOOLBAR_BUTTON_IDS;
  }

  return [
    "canvas-floating-toolbar-button-cancel",
    "canvas-floating-toolbar-button-rotate",
    "canvas-floating-toolbar-button-ok",
  ];
}

function triggerPlacementMarqueeToolTap(
  canvas: CanvasInteractionController,
  source: "mouse" | "touch",
): void {
  const modifiers = {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  if (source === "touch") {
    canvas.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: PLACEMENT_MARQUEE_TOOL_BUTTON_ID,
      ...modifiers,
    });
    return;
  }

  canvas.gestureAdapter.handleUiButtonMouseTap({
    uiButtonId: PLACEMENT_MARQUEE_TOOL_BUTTON_ID,
    button: 0,
    ...modifiers,
  });
}

function safelyCancelMoveDraft(editor: EditorContract): void {
  try {
    editor.actions.cancelMoveOperationDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; move should not leave UI half-entered.
  }
}


function resolveSinglePreviewEntity(editor: EditorContract): WorldEntity | null {
  const preview = editor.state.collections[EntityCollectionType.preview];
  if (preview.length !== 1) {
    return null;
  }

  const entityId = preview[0];
  if (entityId === undefined) {
    return null;
  }

  return editor.queries.getEntityById(entityId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function areGridRectsEqual(left: GridRect, right: GridRect): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function isPreviewEntityAtClientPoint(options: {
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  position: GesturePosition;
  hitSlopPx?: number;
}, view: EditorViewContract): boolean {
  void options.entityDefinitionMap;
  return isPreviewBoundingBoxAtClientPoint({
    editor: options.editor,
    position: options.position,
    hitSlopPx: options.hitSlopPx, view: view,
  });
}



function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function createEntityDefinitionMap(
  canvas: CanvasInteractionController,
): ReadonlyMap<string, EntityDefinition> {
  return new Map(
    canvas.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
}
