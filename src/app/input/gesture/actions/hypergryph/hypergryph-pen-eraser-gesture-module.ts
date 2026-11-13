import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import { PEN_ERASER_BUTTON } from "@/app/input/gesture/adapter";
import { isBaseBuiltinEntityId } from "@/domain/registry/types/base-definition";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureHandleResult, GestureMappingModule } from "../types";

/**
 * 2026-11-13：手写笔橡皮擦端删除设备。
 *
 * - 橡皮擦点按：删除笔下的设备。
 * - 橡皮擦拖动：划过的设备逐个加入选择集作为预览，抬笔时一次删除，形成单条撤销记录。
 *
 * 仅在 select / marquee 工具下生效；橡皮擦按钮值由 GestureAdapter 在精确输入模式下解析为 PEN_ERASER_BUTTON。
 */
export function createHypergryphPenEraserGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-pen-eraser-gesture",
    // 高于选择模块，保证橡皮擦事件不会落入普通选择逻辑。
    priority: 200,
    handle(event, context) {
      const canvas = context.canvas;
      const editor = canvas.editor;
      if (editor === null || !canEraseFromTool(canvas.state.activeTool)) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse tap": {
          if (event.button !== PEN_ERASER_BUTTON) {
            return { status: "ignored" };
          }
          const entity = event.pointerEntity;
          if (entity === null || isBaseBuiltinEntityId(entity.id)) {
            return { status: "handled" };
          }
          editor.actions.clearCollection(EntityCollectionType.selection);
          editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: entity.id });
          return deleteErasedSelection(canvas);
        }

        case "mouse dragstart": {
          if (event.originButton !== PEN_ERASER_BUTTON) {
            return { status: "ignored" };
          }
          editor.actions.clearCollection(EntityCollectionType.selection);
          canvas.actions.hideCanvasFloatingToolbar();
          canvas.actions.hideCanvasRightDockToolbar();
          markEntityAt(canvas, event.position);
          return { status: "claimed" };
        }

        case "mouse dragmove":
          if (event.originButton !== PEN_ERASER_BUTTON) {
            return { status: "ignored" };
          }
          markEntityAt(canvas, event.position);
          return { status: "handled" };

        case "mouse dragend":
          if (event.originButton !== PEN_ERASER_BUTTON) {
            return { status: "ignored" };
          }
          if (event.reason !== "release") {
            editor.actions.clearCollection(EntityCollectionType.selection);
            return { status: "handled" };
          }
          return deleteErasedSelection(canvas);

        default:
          return { status: "ignored" };
      }
    },
  };
}

function canEraseFromTool(activeTool: CanvasInteractionController["state"]["activeTool"]): boolean {
  return activeTool === "select" || activeTool === "marquee";
}

function markEntityAt(
  canvas: CanvasInteractionController,
  position: { readonly x: number; readonly y: number },
): void {
  const editor = canvas.editor;
  if (editor === null) {
    return;
  }

  const entity = editor.queries.findEntityAtClientPixelPoint(position, canvas.view.state);
  if (
    entity === null
    || isBaseBuiltinEntityId(entity.id)
    || editor.state.collections.selection.includes(entity.id)
  ) {
    return;
  }

  editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: entity.id });
}

function deleteErasedSelection(canvas: CanvasInteractionController): GestureHandleResult {
  const editor = canvas.editor;
  if (editor === null) {
    return { status: "ignored" };
  }

  if (editor.state.collections.selection.length > 0) {
    editor.actions.deleteCollection(EntityCollectionType.selection);
  }
  canvas.actions.hideCanvasFloatingToolbar();
  canvas.actions.hideCanvasRightDockToolbar();
  return { status: "handled" };
}
