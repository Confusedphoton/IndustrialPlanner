import type { CanvasInteractionController } from "@/app/canvas";
import { isClosedStroke, isPointInsideStroke } from "@/app/canvas/pen-strokes";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridPoint } from "@/domain/shared/grid";
import { resolveWorldVectorFromViewportVector, resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";

import type { GestureMappingModule } from "../types";
import { pourPlanIntoLasso, resolvePlanMachinesToPlace } from "./plan-lasso";

export function createHypergryphPenStrokeGestureModule(): GestureMappingModule<AppHost> {
  let tap: { position: GesturePosition; time: number; kind: "mouse" | "touch" } | null = null;
  let stroke: { id: string; canvas: CanvasInteractionController; points: GesturePosition[] } | null = null;

  let wedgeArmed: string | null = null;
  let wedge: {
    id: string; editor: EditorContract;
    start: GesturePosition; cell: GridPoint; axis: "x" | "y";
    direction: number; offset: number | null;
  } | null = null;
  const cancel = () => {
    wedgeArmed = null;
    wedge?.editor.actions.finishLayoutGap(false);
    wedge = null;
    tap = null;
    stroke?.canvas.setLassoPath(null);
    stroke = null;
  };

  return {
    id: "hypergryph-pen-stroke-gesture",
    priority: 225,
    cancel,
    handle(event, { canvas }) {

      if (event.type === "on-exit-active-tool") {
        cancel();
        canvas.setLassoActionsAt(null);
      }
      const editor = canvas.editor;
      if (canvas.state.activeTool !== "select" || editor === null) return { status: "ignored" };

      const updateWedge = (position: GesturePosition) => {
        if (wedge === null) return;
        const vector = worldVector(canvas, wedge.start, position);
        const offset = wedge.direction * Math.min(32, Math.max(0,
          Math.round(wedge.direction * vector[wedge.axis] / canvas.view.state.gridCellPixelSize)));
        if (offset === wedge.offset) return;
        wedge.offset = offset;
        if (offset === 0) wedge.editor.actions.finishLayoutGap(false);
        else wedge.editor.actions.previewLayoutGap(wedge.axis, wedge.cell[wedge.axis] + (offset < 0 ? 1 : 0), offset);
      };

      switch (event.type) {
        case "mouse-long-press-ready":
        case "tap-long-press-ready":
          if (tap !== null && event.pointerEntity === null && canvas.isOperationEnabled("move")
            && canvas.gestureAdapter.tapTimeMs() - tap.time <= 1100
            && distance(event.position, tap.position) <= 26
            && (event.type === "mouse-long-press-ready"
              ? tap.kind === "mouse" && event.isPen && event.button === 0
              : tap.kind === "touch" && event.activeTouchCount === 1)) {
            wedgeArmed = event.gestureId;
            return { status: "handled" };
          }
          return { status: "ignored" };

        case "mouse tap":
        case "touch tap":
          canvas.setLassoActionsAt(null);
          wedgeArmed = null;
          tap = !event.longPress && event.pointerEntity === null
            && (event.type === "touch tap" || (event.isPen && event.button === 0))
            ? { position: event.position, time: canvas.gestureAdapter.tapTimeMs(), kind: event.type === "touch tap" ? "touch" : "mouse" }
            : null;
          return { status: "ignored" };

        case "mouse dragstart":
        case "touch dragstart": {
          canvas.setLassoActionsAt(null);
          const armed = tap;
          if (wedgeArmed === event.gestureId) {
            wedgeArmed = null;
            tap = null;
            const cell = canvas.view.queries.findGridCellForClientPixelPoint(event.startPosition);
            if (cell === null) return { status: "ignored" };
            const vector = worldVector(canvas, event.startPosition, event.position);
            const axis = Math.abs(vector.x) >= Math.abs(vector.y) ? "x" : "y";
            wedge = { id: event.gestureId, editor, start: event.startPosition, cell, axis,
              direction: Math.sign(vector[axis]), offset: null };
            updateWedge(event.position);
            return { status: "claimed" };
          }
          tap = null;
          if (armed === null || event.longPress || !canvas.isOperationEnabled("marquee-select")
            || canvas.gestureAdapter.tapTimeMs() - armed.time > 500
            || distance(event.startPosition, armed.position) > 26
            || (event.type === "mouse dragstart"
              ? armed.kind !== "mouse" || !event.isPen || event.originButton !== 0
              : armed.kind !== "touch" || event.activeTouchCount !== 1)) return { status: "ignored" };
          stroke = { id: event.gestureId, canvas, points: [event.startPosition, event.position] };
          canvas.setLassoPath(stroke.points.slice());
          return { status: "claimed" };
        }

        case "mouse dragmove":
        case "touch dragmove":
          if (wedge?.id === event.gestureId) {
            if (event.type === "touch dragmove" && event.activeTouchCount !== 1) cancel();
            else updateWedge(event.position);
            return { status: "handled" };
          }
          if (stroke?.id !== event.gestureId) return { status: "ignored" };
          if (event.type === "touch dragmove" && event.activeTouchCount !== 1) {
            cancel();
            return { status: "handled" };
          }
          if (distance(stroke.points.at(-1)!, event.position) < 2) return { status: "handled" };
          stroke.points.push(event.position);
          canvas.setLassoPath(stroke.points.slice());
          return { status: "handled" };

        case "mouse dragend":
        case "touch dragend": {
          if (wedge?.id === event.gestureId) {
            const commit = event.reason === "release" && wedge.editor === editor && canvas.isOperationEnabled("move");
            if (commit) updateWedge(event.position);
            const hasOffset = wedge.offset !== null && wedge.offset !== 0;
            const applied = wedge.editor.actions.finishLayoutGap(commit);
            if (commit && hasOffset && !applied) canvas.actions.showCanvasToast("canvasGesture.gapBlocked");
            cancel();
            return { status: "handled" };
          }
          if (stroke?.id !== event.gestureId) return { status: "ignored" };
          const points = [...stroke.points, event.position];
          cancel();
          if (event.reason !== "release") return { status: "handled" };
          const selected = editor.queries.listEntities().filter((entity) => {
            const definition = canvas.registry.queries.findEntityDefinition(entity.definitionId);
            if (definition === null) return false;
            const view = canvas.view.state;
            const rect = resolveViewportRectFromWorldGridRect({
              gridRect: resolveEntityGridRect({ entity, definition }),
              viewportBounds: view.clientRect, viewportCenter: view.center,
              gridCellPixelSize: view.gridCellPixelSize, displayRotation: view.displayRotation,
            });
            return rect !== null && isPointInsideStroke({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, points);
          });
          if (selected.length > 0) {
            editor.actions.clearCollection(EntityCollectionType.selection);
            for (const entity of selected) {
              editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: entity.id });
            }
            canvas.setLassoActionsAt(event.position);
          } else if (canvas.canUseWorkbenchActions && canvas.isOperationEnabled("confirm-placement")) {
            const machines = resolvePlanMachinesToPlace(canvas.workbench);
            if (machines !== null && isClosedStroke(points)) pourPlanIntoLasso(canvas, machines, points);
          }
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}


function distance(a: GesturePosition, b: GesturePosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function worldVector(canvas: CanvasInteractionController, start: GesturePosition, end: GesturePosition) {
  return resolveWorldVectorFromViewportVector({
    viewportVector: { x: end.x - start.x, y: end.y - start.y },
    displayRotation: canvas.view.state.displayRotation,
  });
}
