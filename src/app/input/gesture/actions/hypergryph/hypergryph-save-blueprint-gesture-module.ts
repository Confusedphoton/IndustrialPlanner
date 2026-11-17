import type { CanvasInteractionController } from "@/app/canvas";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { canSaveSelectionAsBlueprint } from "@/app/blueprint/save-blueprint";
import type { AppHost } from "@/app/host/app-host";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { RAIL_SELECTION_SAVE_BLUEPRINT_BUTTON_ID } from "../rail-buttons";

const FLOATING_SAVE_BUTTON_ID = "canvas-floating-toolbar-button-save-blueprint";

export function createHypergryphSaveBlueprintGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-save-blueprint-gesture",
    shortcutRoutes: [{
      id: "save-blueprint.selection",
      operation: "save-blueprint",
      actionId: SHORTCUT_KEY.SAVE_BLUEPRINT,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.SAVE_BLUEPRINT },
      scope: { inputLayers: ["canvas"], activeTools: ["select", "marquee"] },
      triggerPolicy: { kind: "exact" },
      claimsBrowserDefault: true,
      handle(_event, context) {
        if (!canSaveSelectionAsBlueprint(context.canvas.workbench.workspace)) {
          return { status: "ignored" };
        }

        context.canvas.workbench.saveBlueprintDialog.openSelection();
        return { status: "handled" };
      },
    }],
    handle(event, context) {
      const activeTool = context.canvas.state.activeTool;

      if (!canSaveBlueprintFromTool(activeTool) || !canSaveSelectionAsBlueprint(context.canvas.workbench.workspace)) {
        return { status: "ignored" };
      }

      switch (event.type) {

        case "ui-button-touch-tap":
          return isSaveBlueprintButton(event.uiButtonId)
            ? openSaveBlueprintDialog(context.canvas)
            : { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0 || !isSaveBlueprintButton(event.uiButtonId)) {
            return { status: "ignored" };
          }

          return openSaveBlueprintDialog(context.canvas);

        default:
          return { status: "ignored" };
      }
    },
  };
}

function canSaveBlueprintFromTool(activeTool: CanvasInteractionController["state"]["activeTool"]): boolean {
  return activeTool === "select" || activeTool === "marquee";
}

function isSaveBlueprintButton(uiButtonId: string): boolean {
  return uiButtonId === FLOATING_SAVE_BUTTON_ID || uiButtonId === RAIL_SELECTION_SAVE_BLUEPRINT_BUTTON_ID;
}

function openSaveBlueprintDialog(canvas: CanvasInteractionController): GestureHandleResult {
  canvas.workbench.saveBlueprintDialog.openSelection();
  return { status: "handled" };
}
