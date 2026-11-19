import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import {
  EntityCollectionType,
  type MarqueeCollectionType,
} from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { collectTransportSegmentEntityIds } from "@/shared/transport-component";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "../shortcut-route-matching";
import {
  RAIL_TOGGLE_DIM_BELTS_BUTTON_ID,
  RAIL_TOGGLE_DIM_PIPES_BUTTON_ID,
  RAIL_TOGGLE_REVERSE_MARQUEE_BUTTON_ID,
} from "../rail-buttons";
import { openOverlapEntityMenuIfNeeded } from "./overlap-entity-candidates";

export function createHypergryphMarqueeGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-marquee-gesture",
    shortcutRoutes: [{
      id: "marquee.toggle",
      operation: "marquee-select",
      actionId: SHORTCUT_KEY.MARQUEE,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.MARQUEE },
      scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        const editor = context.canvas.editor;
        if (context.canvas.state.activeTool === "marquee") {
          exitMarqueeToSelect(context.canvas);
          return { status: "handled" };
        }

        enterMarqueeMode({ canvas: context.canvas, editor, source: "mouse" });
        return { status: "handled" };
      },
    }],
    acceptsLongPress(context, gridHasEntity) {
      const tool = context.canvas.state.activeTool;
      if (tool === "marquee") {
        return true;
      }

      if (
        tool === "select"
        && context.canvas.workbench.state.settings.hypergryphImmediateMarquee
        && !gridHasEntity
      ) {
        return true;
      }

      return false;
    },
    handle(event, context) {
      const editor = context.canvas.editor;

      switch (event.type) {
        case "on-enter-active-tool":
          if (event.to !== "marquee") {
            return { status: "ignored" };
          }

          return { status: "handled" };

        case "on-exit-active-tool":
          if (event.from !== "marquee" || event.to === "marquee") {
            return { status: "ignored" };
          }

          cleanupMarquee(context.canvas, editor, event.to === "move"
            || (event.to === "blueprint-placement"
              && context.canvas.state.runtime.blueprintPlacementFromCopy));
          return { status: "handled" };


        case "ui-button-touch-tap":
          return handleUiButtonTap({
            canvas: context.canvas,
            editor,
            uiButtonId: event.uiButtonId,
            source: "touch",
          });

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          return handleUiButtonTap({
            canvas: context.canvas,
            editor,
            uiButtonId: event.uiButtonId,
            source: "mouse",
          });

        case "mouse move":
          if (editor !== null) {
            editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          }
          return { status: "handled", consume: false };

        case "mouse tap":
          if (context.canvas.state.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          if (event.button === 2) {
            exitMarqueeToSelect(context.canvas);
            return { status: "handled" };
          }

          if (event.button === 0 && editor !== null && event.pointerEntity !== null) {
            if (
              openOverlapEntityMenuIfNeeded({
                canvas: context.canvas,
                editor,
                position: event.position,
                pointerEntity: event.pointerEntity,
                onSelect: (entity) => {
                  toggleEntityOrStrictLogisticsSegmentInSelection({
                    canvas: context.canvas,
                    editor,
                    entity,
                  });
                },
              })
            ) {
              return { status: "handled" };
            }

            toggleEntityOrStrictLogisticsSegmentInSelection({
              canvas: context.canvas,
              editor,
              entity: event.pointerEntity,
            });
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "touch tap":
          if (context.canvas.state.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          if (editor !== null && event.pointerEntity !== null) {
            if (
              openOverlapEntityMenuIfNeeded({
                canvas: context.canvas,
                editor,
                position: event.position,
                pointerEntity: event.pointerEntity,
                onSelect: (entity) => {
                  toggleEntityOrStrictLogisticsSegmentInSelection({
                    canvas: context.canvas,
                    editor,
                    entity,
                  });
                },
              })
            ) {
              return { status: "handled" };
            }

            toggleEntityOrStrictLogisticsSegmentInSelection({
              canvas: context.canvas,
              editor,
              entity: event.pointerEntity,
            });
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "mouse dragstart":
          if (editor === null) {
            return { status: "ignored" };
          }

          if (
            context.canvas.state.activeTool === "select"
            && context.canvas.workbench.state.settings.hypergryphImmediateMarquee
            && event.pointerEntity === null
            && event.originButton !== 1
            && !event.isPen
          ) {
            enterMarqueeMode({
              canvas: context.canvas,
              editor,
              source: "mouse",
            });
          }

          if (context.canvas.state.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          editor.actions.clearHoverPoint();
          return startMouseMarqueeDrag({
            canvas: context.canvas,
            editor,
            originButton: event.originButton,
            position: event.position,
          });

        case "touch dragstart":
          if (
            editor === null
            || !event.longPress
          ) {
            return { status: "ignored" };
          }

          if (
            context.canvas.state.activeTool === "select"
            && context.canvas.workbench.state.settings.hypergryphImmediateMarquee
            && event.pointerEntity === null
          ) {
            enterMarqueeMode({
              canvas: context.canvas,
              editor,
              source: "touch",
            });
          }

          if (context.canvas.state.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          return startMarqueeDrag({
            canvas: context.canvas,
            editor,
            position: event.position,
            marqueeType: context.canvas.state.toolInfo.marqueeType,
          });

        case "mouse dragmove":
        case "touch dragmove":
          if (
            editor === null
            || context.canvas.state.activeTool !== "marquee"
            || context.canvas.state.runtime.marqueeAnchor === null
          ) {
            return { status: "ignored" };
          }

          return updateMarqueeRange({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "mouse dragend":
        case "touch dragend":
          if (
            editor === null
            || context.canvas.state.activeTool !== "marquee"
            || context.canvas.state.runtime.marqueeAnchor === null
          ) {
            return { status: "ignored" };
          }

          editor.actions.applyMarquee();
          context.canvas.state.runtime.marqueeAnchor = null;
          editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function handleUiButtonTap(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract | null;
  uiButtonId: string;
  source: "mouse" | "touch";
}): GestureHandleResult {
  switch (options.uiButtonId) {
    case "placement-tool-marquee":
      enterMarqueeMode({
        canvas: options.canvas,
        editor: options.editor,
        source: options.source,
      });
      return { status: "handled" };

    case RAIL_TOGGLE_REVERSE_MARQUEE_BUTTON_ID:
      if (options.canvas.state.activeTool !== "marquee") {
        return { status: "ignored" };
      }

      options.canvas.state.toolInfo.marqueeType = options.canvas.state.toolInfo.marqueeType === EntityCollectionType.reverseMarquee
        ? EntityCollectionType.marquee
        : EntityCollectionType.reverseMarquee;
      return { status: "handled" };

    case RAIL_TOGGLE_DIM_PIPES_BUTTON_ID:
      options.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, !options.editor.state.suppressPipes);
      return { status: "handled" };

    case RAIL_TOGGLE_DIM_BELTS_BUTTON_ID:
      options.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, !options.editor.state.suppressBelts);
      return { status: "handled" };

    default:
      return { status: "ignored" };
  }
}

export function enterMarqueeMode(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract | null;
  source: "mouse" | "touch";
}): void {
  const wasMarquee = options.canvas.state.activeTool === "marquee";
  options.canvas.actions.setActiveTool("marquee");
  if (!wasMarquee) {
    resetMarqueeLogisticsSuppression(options.editor);
  }

  if (options.source === "touch" && options.canvas.workbench.internalState.workbench.rightDockOpen) {
    options.canvas.workbench.internalActions.toggleRightDock();
  }
}

function startMouseMarqueeDrag(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  originButton: number;
  position: GesturePosition;
}): GestureHandleResult {
  if (options.originButton === 1) {
    return { status: "ignored" };
  }

  if (options.originButton !== 0 && options.originButton !== 2) {
    return { status: "ignored" };
  }

  return startMarqueeDrag({
    canvas: options.canvas,
    editor: options.editor,
    position: options.position,
    marqueeType: options.originButton === 2
      ? EntityCollectionType.reverseMarquee
      : EntityCollectionType.marquee,
  });
}

function startMarqueeDrag(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  marqueeType: MarqueeCollectionType;
}): GestureHandleResult {
  const anchor = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
  if (anchor === null) {
    return { status: "ignored" };
  }

  options.canvas.state.runtime.marqueeAnchor = anchor;
  options.canvas.state.toolInfo.marqueeType = options.marqueeType;
  options.editor.actions.setMarqueeRange(
    options.marqueeType,
    resolveGridRectFromPoints(anchor, anchor),
  );
  return { status: "handled" };
}

function updateMarqueeRange(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  const anchor = options.canvas.state.runtime.marqueeAnchor;
  const currentPoint = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
  if (anchor === null || currentPoint === null) {
    return { status: "ignored" };
  }

  options.editor.actions.setMarqueeRange(
    options.canvas.state.toolInfo.marqueeType,
    resolveGridRectFromPoints(anchor, currentPoint),
  );
  return { status: "handled" };
}

function exitMarqueeToSelect(canvas: CanvasInteractionController): void {
  canvas.actions.setActiveTool("select");
}

export function cleanupMarquee(canvas: CanvasInteractionController, editor: EditorContract | null, skipClearSelection = false): void {
  editor?.actions.cancelMarquee();
  if (!skipClearSelection) {
    editor?.actions.clearCollection(EntityCollectionType.selection);
  }
  resetMarqueeLogisticsSuppression(editor);
  canvas.state.runtime.marqueeAnchor = null;
  canvas.state.toolInfo.marqueeType = EntityCollectionType.marquee;
}

function resetMarqueeLogisticsSuppression(editor: EditorContract | null): void {
  editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, false);
  editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, false);
}

function toggleEntityOrStrictLogisticsSegmentInSelection(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  entity: WorldEntity;
}): void {
  const entityIds = resolveStrictLogisticsSegmentSelectionIds(options);
  const shouldRemove = options.editor.state.collections.selection.contains(options.entity.id);

  for (const entityId of entityIds) {
    if (shouldRemove) {
      removeEntityFromSelection(options.editor, entityId);
    } else {
      addEntityToSelection(options.editor, entityId);
    }
  }
}

function resolveStrictLogisticsSegmentSelectionIds(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  entity: WorldEntity;
}): readonly string[] {
  const registry = options.canvas.registry;
  const segmentEntityIds = collectTransportSegmentEntityIds({
    startEntity: options.entity,
    document: options.editor.document.getSnapshot(),
    registry,
  });

  return segmentEntityIds.size > 0 ? Array.from(segmentEntityIds) : [options.entity.id];
}

function addEntityToSelection(editor: EditorContract, entityId: string): void {
  if (editor.state.collections.selection.contains(entityId)) {
    return;
  }

  editor.actions.addToCollection({
    collectionType: EntityCollectionType.selection,
    entityId,
  });
}

function removeEntityFromSelection(editor: EditorContract, entityId: string): void {
  if (editor.state.collections.selection.contains(entityId)) {
    editor.actions.removeFromCollection({
      collectionType: EntityCollectionType.selection,
      entityId,
    });
  }
}

function resolveGridRectFromPoints(start: GridPoint, end: GridPoint): GridRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  return {
    x,
    y,
    width: Math.abs(end.x - start.x) + 1,
    height: Math.abs(end.y - start.y) + 1,
  };
}
