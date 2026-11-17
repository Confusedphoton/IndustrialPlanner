import type { CanvasInteractionController } from "@/app/canvas";
import { isLassoStroke, isScratchOutStroke, type StrokePoint } from "@/app/canvas/pen-strokes";
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
  last: GesturePosition;
}

/**
 * 笔在画布空白处的整笔手势（这类拖动本是平移视图，这里只旁观笔迹）：
 *
 * 圈出一块空地：钉了配方树规划时，把规划里还缺的设备按阶段摆进圈里（见 plan-lasso）。
 *
 * 涂抹删除：选择工具下用笔尖在画布上来回快速划几下，划过的设备被删除（与橡皮擦端拖动相同，一条撤销记录）。
 *
 * 笔尖在空白处拖动本是平移视图，所以这里只旁观笔迹：识别出涂抹的那一刻，把这一笔已平移的视图挪回原处，
 * 按落笔时的视图找出笔迹划过的设备，之后的移动由本模块接管、继续标记，抬笔删除。
 * 不是涂抹的拖动照常平移；被其他模块认领的拖动（从设备上起笔是移动设备、从端口起笔是拉线）收不到后续移动，
 * 所以涂抹要从设备旁的空地起笔，再来回划过设备。
 */
export function createHypergryphPenStrokeGestureModule(): GestureMappingModule<AppHost> {
  let tracker: StrokeTracker | null = null;

  return {
    id: "hypergryph-pen-stroke-gesture",
    // 高于平移，以便识别后截住后续移动；低于橡皮擦、标记菜单等明确的笔操作。
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
            ? {
                gestureId: event.gestureId,
                start: event.startPosition,
                points: [stamp(canvas, event.startPosition), stamp(canvas, event.position)],
                erasing: false,
                last: event.position,
              }
            : null;
          return { status: "ignored" };

        case "mouse dragmove": {
          if (tracker === null || tracker.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          if (tracker.erasing) {
            markAlong(canvas, tracker.last, event.position);
            tracker.last = event.position;
            return { status: "handled" };
          }
          tracker.points.push(stamp(canvas, event.position));
          if (!isScratchOutStroke(tracker.points)) {
            // 这次移动交给平移处理，视图随之跟到这里。
            tracker.last = event.position;
            return { status: "ignored" };
          }
          // 平移让落笔处的内容一直跟着笔尖（到上一次移动为止，这次移动由本模块截下）；挪回原处，笔迹才对得上用户看到的设备。
          canvas.view.actions.moveViewportByClientPixelVector({ startClientPixel: tracker.last, endClientPixel: tracker.start });
          tracker.erasing = true;
          editor.actions.clearCollection(EntityCollectionType.selection);
          canvas.actions.hideCanvasFloatingToolbar();
          canvas.actions.hideCanvasRightDockToolbar();
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
            return event.reason === "release" && canvas.isOperationEnabled("confirm-placement") && isLassoStroke(finished.points)
              ? pourPlanIfPinned(canvas, finished)
              : { status: "ignored" };
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
  canvas.view.actions.moveViewportByClientPixelVector({ startClientPixel: stroke.last, endClientPixel: stroke.start });
  pourPlanIntoLasso(canvas, machines, stroke.points);
  return { status: "handled" };
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
