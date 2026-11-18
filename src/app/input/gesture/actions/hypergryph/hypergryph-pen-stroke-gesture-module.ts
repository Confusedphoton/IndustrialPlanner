import type { CanvasInteractionController } from "@/app/canvas";
import { isLassoStroke, isScratchOutStroke, SCRATCH_WINDOW_MS, type StrokePoint } from "@/app/canvas/pen-strokes";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { deleteErasedSelection, markEntityForErase } from "./hypergryph-pen-eraser-gesture-module";
import { pourPlanIntoLasso, resolvePlanMachinesToPlace } from "./plan-lasso";

interface StrokeTracker {
  readonly gestureId: string;
  readonly start: GesturePosition;
  readonly points: StrokePoint[];
  erasing: boolean;
  panning: boolean;
  last: GesturePosition;
}

/**
 * 笔在画布空白处的整笔手势（这类拖动本是平移视图，这里只旁观笔迹）：
 *
 * 圈出一块空地：钉了配方树规划时，把规划里还缺的设备按阶段摆进圈里（见 plan-lasso）。
 *
 * 涂抹删除：选择工具下用笔尖在画布上来回快速划几下，划过的设备被删除（与橡皮擦端拖动相同，一条撤销记录）。
 *
 * 延迟平移到涂抹识别窗口结束，避免笔迹来回时画布跟着跳动。
 * 从设备或端口起笔仍由移动和铺线手势优先处理。
 */
export function createHypergryphPenStrokeGestureModule(): GestureMappingModule<AppHost> {
  let tracker: StrokeTracker | null = null;

  return {
    id: "hypergryph-pen-stroke-gesture",
    // 只接管从空地开始的笔迹。
    priority: 190,
    cancel() {
      tracker = null;
    },
    handle(event, context) {
      const canvas = context.canvas;
      const editor = canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse dragstart":
          tracker = event.isPen === true && event.originButton === 0 && canvas.state.activeTool === "select"
            && canvas.canUseWorkbenchActions && canvas.isOperationEnabled("delete")
            && editor.queries.findEntityAtClientPixelPoint(event.startPosition, canvas.view.state) === null
            ? {
                gestureId: event.gestureId,
                start: event.startPosition,
                points: [stamp(canvas, event.startPosition), stamp(canvas, event.position)],
                erasing: false,
                panning: false,
                last: event.position,
              }
            : null;
          return { status: tracker === null ? "ignored" : "claimed" };

        case "mouse dragmove": {
          if (tracker === null || tracker.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          if (tracker.erasing) {
            markAlong(canvas, tracker.last, event.position);
            tracker.last = event.position;
            return { status: "handled" };
          }
          const point = stamp(canvas, event.position);
          tracker.points.push(point);
          if (!isScratchOutStroke(tracker.points)) {
            if (point.timeMs - tracker.points[0]!.timeMs > SCRATCH_WINDOW_MS) {
              panStroke(canvas, tracker.panning ? tracker.last : tracker.start, event.position);
              tracker.panning = true;
            }
            tracker.last = event.position;
            return { status: "handled" };
          }
          tracker.erasing = true;
          editor.actions.clearCollection(EntityCollectionType.selection);
          canvas.actions.hideCanvasFloatingToolbar();
          tracker.points.forEach((point, index) => {
            if (index > 0) markAlong(canvas, tracker!.points[index - 1]!, point);
          });
          tracker.last = event.position;
          return { status: "handled" };
        }

        case "mouse dragend": {
          if (tracker === null || tracker.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          const finished = tracker;
          tracker = null;
          if (!finished.erasing) {
            finished.points.push(stamp(canvas, event.position));
            if (event.reason !== "release") return { status: "handled" };
            if (canvas.isOperationEnabled("confirm-placement") && isLassoStroke(finished.points)) {
              const result = pourPlanIfPinned(canvas, finished);
              if (result.status !== "ignored") return result;
            }
            panStroke(canvas, finished.panning ? finished.last : finished.start, event.position);
            return { status: "handled" };
          }
          if (event.reason !== "release") {
            editor.actions.clearCollection(EntityCollectionType.selection);
            return { status: "handled" };
          }
          markAlong(canvas, finished.last, event.position);
          return deleteErasedSelection(canvas);
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

/** 钉了规划时把圈当作“倒进这里”：先把这一笔平移的视图挪回原处，再按落笔时的视图找出圈住的区域。 */
function pourPlanIfPinned(canvas: CanvasInteractionController, stroke: StrokeTracker): GestureHandleResult {
  const machines = resolvePlanMachinesToPlace(canvas.workbench);
  if (machines === null) {
    return { status: "ignored" };
  }
  if (stroke.panning) panStroke(canvas, stroke.last, stroke.start);
  pourPlanIntoLasso(canvas, machines, stroke.points);
  return { status: "handled" };
}

function panStroke(canvas: CanvasInteractionController, start: GesturePosition, end: GesturePosition): void {
  canvas.view.actions.moveViewportByClientPixelVector({ startClientPixel: start, endClientPixel: end });
  canvas.actions.alignCanvasFloatingToolbar();
}

function stamp(canvas: CanvasInteractionController, position: GesturePosition): StrokePoint {
  return { x: position.x, y: position.y, timeMs: canvas.gestureAdapter.tapTimeMs() };
}

/** 沿两点之间按半格取样标记，快速划过时也不会漏掉中间的设备。 */
function markAlong(canvas: CanvasInteractionController, from: GesturePosition, to: GesturePosition): void {
  const step = Math.max(4, canvas.view.state.gridCellPixelSize / 2);
  const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
  for (let index = 0; index <= count; index += 1) {
    markEntityForErase(canvas, {
      x: from.x + (to.x - from.x) * index / count,
      y: from.y + (to.y - from.y) * index / count,
    });
  }
}
