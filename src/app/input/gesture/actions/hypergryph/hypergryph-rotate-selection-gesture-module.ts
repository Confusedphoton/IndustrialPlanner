import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { UiKey } from "@/shared/i18n";

import type { GestureHandleResult, GestureMappingModule } from "../types";

export const ROTATE_SELECTION_BUTTON_ID = "canvas-floating-toolbar-button-rotate";

const BLOCKED_ROTATION_TOAST_KEYS: Record<"outside-base" | "overlap", UiKey> = {
  "outside-base": "placementReason.outsideBase",
  overlap: "placementReason.overlap",
};

/**
 * 选择工具下原地旋转已放置的设备：经编辑器历史提交，可撤销；
 * 旋转后越出基地或压到其他设备时不落地，并用画布提示说明原因。
 */
export function createHypergryphRotateSelectionGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-rotate-selection-gesture",
    handle(event, context) {
      const editor = context.canvas.editor;
      if (editor === null || context.canvas.state.activeTool !== "select") {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "ui-button-touch-tap":
          return event.uiButtonId === ROTATE_SELECTION_BUTTON_ID
            ? rotateSelectionInPlace(context.canvas, editor)
            : { status: "ignored" };

        case "ui-button-mouse-tap":
          return event.button === 0 && event.uiButtonId === ROTATE_SELECTION_BUTTON_ID
            ? rotateSelectionInPlace(context.canvas, editor)
            : { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function rotateSelectionInPlace(canvas: CanvasInteractionController, editor: EditorContract): GestureHandleResult {
  if (editor.state.collections.selection.length === 0) {
    return { status: "ignored" };
  }

  const result = editor.actions.rotateCollection(EntityCollectionType.selection);
  if (result.status === "blocked") {
    canvas.actions.showCanvasToast(BLOCKED_ROTATION_TOAST_KEYS[result.reason]);
  } else if (result.status === "rotated") {
    canvas.actions.alignCanvasFloatingToolbar();
  }
  return { status: "handled" };
}
