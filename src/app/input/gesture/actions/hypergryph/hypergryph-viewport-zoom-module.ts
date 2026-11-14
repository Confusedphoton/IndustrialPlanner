import type { AppHost } from "@/app/host/app-host";
import type { GestureMappingModule } from "../types";
import { resolveWheelZoomDirection } from "@/shared/browser/wheel-zoom";
import {
  nudgeMobilePreviewIntoSafeViewport,
} from "./mobile-preview-bounds";

const PINCH_ZOOM_STEPS_PER_DOUBLING = 4;
const MIN_WHEEL_ZOOM_STEP = 1;
const MAX_WHEEL_ZOOM_STEP = 2;

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
          nudgeMobilePreviewIntoSafeViewport({
            canvas: context.canvas,
            editor,
          });
          context.canvas.actions.alignCanvasFloatingToolbar();
          return { status: "handled" };
        }

        case "pinch in":
        case "pinch out": {
          const step = resolvePinchZoomStep(event.scaleDelta);

          if (step === null) {
            return { status: "ignored" };
          }

          context.canvas.view.actions.zoom(step);
          nudgeMobilePreviewIntoSafeViewport({
            canvas: context.canvas,
            editor,
          });
          context.canvas.actions.alignCanvasFloatingToolbar();
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
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
