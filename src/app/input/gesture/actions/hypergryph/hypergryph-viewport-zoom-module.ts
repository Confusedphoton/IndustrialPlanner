import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridRect } from "@/domain/shared/grid";
import { resolveBaseDefinitionById } from "@/domain/registry/types/base-definition";
import type { GestureMappingModule } from "../types";
import { resolveWheelZoomDirection } from "@/shared/browser/wheel-zoom";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";
import { sceneBoundsToFiniteRect } from "@/shared/geometry/scene-space";
import { resolveWorldVectorFromViewportVector } from "@/shared/geometry/viewport-transform";
import {
  nudgeMobilePreviewIntoSafeViewport,
} from "./mobile-preview-bounds";

const PINCH_ZOOM_STEPS_PER_DOUBLING = 4;
const MIN_WHEEL_ZOOM_STEP = 1;
const MAX_WHEEL_ZOOM_STEP = 2;
const BUTTON_ZOOM_STEP = MAX_WHEEL_ZOOM_STEP;
/** 显示整个基地时基地外框占画布的最大比例，给边缘工具条留出余量。 */
const FIT_BASE_VIEWPORT_FRACTION = 0.92;
/** 逐档缩放的次数上限；缩放档位有限，正常在到达上下限前就会停止。 */
const MAX_FIT_ZOOM_STEPS = 64;

export function createHypergryphViewportZoomModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-viewport-zoom",
    handle(event, context) {
      const editor = context.canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "wheel up":
        case "wheel down": {
          const step = resolveWheelZoomStep(event.normalizedDelta, context.canvas.workbench.internalState.settings.invertWheelZoom);

          if (step === null) {
            return { status: "ignored" };
          }

          context.canvas.view.actions.zoom(step);
          syncViewportDependents(context.canvas, editor);
          return { status: "handled" };
        }

        case "pinch in":
        case "pinch out": {
          const step = resolvePinchZoomStep(event.scaleDelta);

          if (step === null) {
            return { status: "ignored" };
          }

          context.canvas.view.actions.zoom(step);
          syncViewportDependents(context.canvas, editor);
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

/** 画布缩放按钮：与滚轮共用缩放档位与后续对齐。 */
export function zoomCanvasViewportByButton(canvas: CanvasInteractionController, direction: 1 | -1): void {
  const editor = canvas.editor;
  if (editor === null) {
    return;
  }

  canvas.view.actions.zoom(direction * BUTTON_ZOOM_STEP);
  syncViewportDependents(canvas, editor);
}

/**
 * 把当前基地外框居中到画布未被遮挡的区域，并沿缩放档位调整到能完整显示基地的最大档位（受缩放上下限约束）。
 * 结果停在档位上，之后的滚轮与按钮缩放保持连续。
 */
export function fitCanvasViewportToBase(canvas: CanvasInteractionController): void {
  const obstruction = canvas.viewportObstruction;
  const editor = canvas.editor;
  const view = canvas.view;
  if (editor === null || view.state.clientRect.width <= 0 || view.state.clientRect.height <= 0) {
    return;
  }

  const base = resolveBaseDefinitionById({
    baseDefinitions: canvas.registry.baseDefinitions,
    baseId: editor.document.getSnapshot().baseId,
  });
  const outerBounds = base === null ? null : resolveBaseOuterBounds(base);
  const baseRect = outerBounds === null ? null : sceneBoundsToFiniteRect(outerBounds);
  if (baseRect === null) {
    return;
  }

  const obstructedWidth = Math.max(0, obstruction.left) + Math.max(0, obstruction.right);
  const visibleWidth = view.state.clientRect.width - obstructedWidth;
  if (visibleWidth <= 0) {
    return;
  }
  const fits = () => doesRectFitViewport(canvas, baseRect, visibleWidth);

  view.actions.focusOnBounds(baseRect, { durationMs: 0, gridSize: view.state.gridSize });
  const zoomOneStep = (step: 1 | -1): boolean => {
    const before = view.state.gridSize;
    view.actions.zoom(step);
    return view.state.gridSize !== before;
  };

  for (let index = 0; index < MAX_FIT_ZOOM_STEPS && !fits(); index += 1) {
    if (!zoomOneStep(-1)) break;
  }
  for (let index = 0; index < MAX_FIT_ZOOM_STEPS && fits(); index += 1) {
    if (!zoomOneStep(1)) break;
    if (!fits()) {
      zoomOneStep(-1);
      break;
    }
  }

  // 视口中心向遮挡较多的一侧偏移半个遮挡差，使基地落在未遮挡区域的中央。
  const shift = resolveWorldVectorFromViewportVector({
    viewportVector: { x: (obstruction.right - obstruction.left) / 2, y: 0 },
    displayRotation: view.state.displayRotation,
  });
  const cellSize = view.state.gridCellPixelSize;
  view.actions.focusOnBounds({
    x: baseRect.x + baseRect.width / 2 + shift.x / cellSize,
    y: baseRect.y + baseRect.height / 2 + shift.y / cellSize,
    width: 0,
    height: 0,
  }, { durationMs: 0, gridSize: view.state.gridSize });
  syncViewportDependents(canvas, editor);
}

function doesRectFitViewport(canvas: CanvasInteractionController, rect: GridRect, visibleWidth: number): boolean {
  const { clientRect, displayRotation, gridCellPixelSize } = canvas.view.state;
  const rotated = displayRotation === 90 || displayRotation === 270;
  const pixelWidth = (rotated ? rect.height : rect.width) * gridCellPixelSize;
  const pixelHeight = (rotated ? rect.width : rect.height) * gridCellPixelSize;
  return pixelWidth <= visibleWidth * FIT_BASE_VIEWPORT_FRACTION
    && pixelHeight <= clientRect.height * FIT_BASE_VIEWPORT_FRACTION;
}

function syncViewportDependents(canvas: CanvasInteractionController, editor: EditorContract): void {
  nudgeMobilePreviewIntoSafeViewport({ canvas, editor });
  canvas.actions.alignCanvasFloatingToolbar();
}

function resolveWheelZoomStep(normalizedDelta: number, inverted: boolean): number | null {
  const direction = resolveWheelZoomDirection(normalizedDelta, inverted);
  if (direction === 0) {
    return null;
  }

  const magnitude = Math.min(
    MAX_WHEEL_ZOOM_STEP,
    Math.max(MIN_WHEEL_ZOOM_STEP, Math.abs(normalizedDelta)),
  );

  return direction * magnitude;
}

function resolvePinchZoomStep(scaleDelta: number): number | null {
  if (!Number.isFinite(scaleDelta) || scaleDelta <= 0 || scaleDelta === 1) {
    return null;
  }

  return PINCH_ZOOM_STEPS_PER_DOUBLING * Math.log2(scaleDelta);
}
