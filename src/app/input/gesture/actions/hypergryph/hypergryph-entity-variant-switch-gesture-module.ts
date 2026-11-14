import type { CanvasInteractionController } from "@/app/canvas";
import { SHORTCUT_KEY } from "@/app/actions";
import {
  SWITCH_DEVICE_MODE_BUTTON_ID,
  resolveNextSwitchableEntityVariantDefinitionId,
} from "@/app/entity-variant-availability";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureHandleResult, GestureMappingModule } from "../types";

export function createHypergryphEntityVariantSwitchGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-entity-variant-switch-gesture",
    shortcutRoutes: [{
      id: "switch-device-mode.selection",
      operation: "switch-device-variant",
      actionId: SHORTCUT_KEY.SWITCH_DEVICE_MODE,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.SWITCH_DEVICE_MODE },
      scope: { inputLayers: ["canvas"], activeTools: ["select"] },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        const editor = context.canvas.editor;
        if (editor === null || !context.canvas.workbench.state.settings.gameUseInspectorPanel) {
          return { status: "ignored" };
        }

        return switchSelectedEntityVariant(context.canvas, editor);
      },
    }],
    handle(event, context) {
      const editor = context.canvas.editor;
      if (editor === null || !canSwitchSelectionFromTool(context.canvas.state.activeTool)) {
        return { status: "ignored" };
      }

      switch (event.type) {

        case "ui-button-touch-tap":
          return event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID
            ? switchSelectedEntityVariant(context.canvas, editor)
            : { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0 || event.uiButtonId !== SWITCH_DEVICE_MODE_BUTTON_ID) {
            return { status: "ignored" };
          }

          return switchSelectedEntityVariant(context.canvas, editor);

        default:
          return { status: "ignored" };
      }
    },
  };
}

function canSwitchSelectionFromTool(activeTool: CanvasInteractionController["state"]["activeTool"]): boolean {
  return activeTool === "select" || activeTool === "marquee";
}

function switchSelectedEntityVariant(
  canvas: CanvasInteractionController,
  editor: EditorContract,
): GestureHandleResult {
  const selection = editor.state.collections[EntityCollectionType.selection];
  if (selection.length !== 1) {
    return { status: "ignored" };
  }

  const entityId = selection[0];
  if (entityId === undefined) {
    return { status: "ignored" };
  }

  const entity = editor.queries.getEntityById(entityId);
  if (entity === null) {
    return { status: "ignored" };
  }

  const nextDefinitionId = resolveNextSwitchableEntityVariantDefinitionId({
    canvas,
    definitionId: entity.definitionId,
  });
  if (nextDefinitionId === null) {
    return { status: "ignored" };
  }

  return editor.actions.replaceEntityDefinition(entity.id, nextDefinitionId)
    ? { status: "handled" }
    : { status: "ignored" };
}
