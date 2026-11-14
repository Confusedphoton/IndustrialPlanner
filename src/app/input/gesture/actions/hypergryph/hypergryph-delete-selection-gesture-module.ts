import type { CanvasInteractionController } from "@/app/canvas";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { showMarqueeRightDockToolbar } from "./hypergryph-marquee-gesture-module";

const FLOATING_DELETE_BUTTON_ID = "canvas-floating-toolbar-button-delete";
const FLOATING_DELETE_MANY_BUTTON_ID = "canvas-floating-toolbar-button-delete-many";
const FLOATING_DELETE_UPSTREAM_BUTTON_ID = "canvas-floating-toolbar-button-delete-upstream-segment";
const FLOATING_DELETE_DOWNSTREAM_BUTTON_ID = "canvas-floating-toolbar-button-delete-downstream-segment";
const RIGHT_DOCK_DELETE_BUTTON_ID = "canvas-right-dock-toolbar-button-delete";

export function createHypergryphDeleteSelectionGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-delete-selection-gesture",
    shortcutRoutes: [{
      id: "delete-selection.selection",
      operation: "delete",
      actionId: SHORTCUT_KEY.DELETE_DEVICE,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.DELETE_DEVICE },
      scope: {
        inputLayers: ["canvas", "inspector-dialog"],
        activeTools: ["select", "marquee"],
      },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        const editor = context.canvas.editor;
        if (editor === null) {
          return { status: "ignored" };
        }

        return deleteSelection(context.canvas, editor, context.canvas.state.activeTool);
      },
    }],
    handle(event, context) {
      const editor = context.canvas.editor;
      const activeTool = context.canvas.state.activeTool;

      if (editor === null || !canDeleteSelectionFromTool(activeTool)) {
        return { status: "ignored" };
      }

      switch (event.type) {

        case "ui-button-touch-tap":
          if (event.uiButtonId === FLOATING_DELETE_UPSTREAM_BUTTON_ID) {
            return directionalDeleteStrictLogistics(editor, activeTool, context.canvas, "upstream");
          }
          if (event.uiButtonId === FLOATING_DELETE_DOWNSTREAM_BUTTON_ID) {
            return directionalDeleteStrictLogistics(editor, activeTool, context.canvas, "downstream");
          }
          if (event.uiButtonId === FLOATING_DELETE_MANY_BUTTON_ID) {
            return batchDeleteStrictLogistics(editor, activeTool, context.canvas);
          }
          return isDeleteSelectionButton(event.uiButtonId)
            ? deleteSelection(context.canvas, editor, activeTool)
            : { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }
          if (event.uiButtonId === FLOATING_DELETE_UPSTREAM_BUTTON_ID) {
            return directionalDeleteStrictLogistics(editor, activeTool, context.canvas, "upstream");
          }
          if (event.uiButtonId === FLOATING_DELETE_DOWNSTREAM_BUTTON_ID) {
            return directionalDeleteStrictLogistics(editor, activeTool, context.canvas, "downstream");
          }
          if (event.uiButtonId === FLOATING_DELETE_MANY_BUTTON_ID) {
            return batchDeleteStrictLogistics(editor, activeTool, context.canvas);
          }
          if (!isDeleteSelectionButton(event.uiButtonId)) {
            return { status: "ignored" };
          }

          return deleteSelection(context.canvas, editor, activeTool);

        default:
          return { status: "ignored" };
      }
    },
  };
}

function canDeleteSelectionFromTool(activeTool: CanvasInteractionController["state"]["activeTool"]): boolean {
  return activeTool === "select" || activeTool === "marquee";
}

function isDeleteSelectionButton(uiButtonId: string): boolean {
  return uiButtonId === FLOATING_DELETE_BUTTON_ID || uiButtonId === RIGHT_DOCK_DELETE_BUTTON_ID;
}

function deleteSelection(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  activeTool: CanvasInteractionController["state"]["activeTool"],
): GestureHandleResult {
  if (editor.state.collections.selection.length === 0) {
    return { status: "ignored" };
  }

  editor.actions.deleteCollection(EntityCollectionType.selection);

  if (activeTool === "select") {
    canvas.actions.hideCanvasFloatingToolbar();
    canvas.actions.hideCanvasRightDockToolbar();
  } else {
    showMarqueeRightDockToolbar(canvas, editor);
  }

  return { status: "handled" };
}

function batchDeleteStrictLogistics(
  editor: EditorContract,
  activeTool: CanvasInteractionController["state"]["activeTool"],
  canvas: CanvasInteractionController,
): GestureHandleResult {
  const selectionIds = [...editor.state.collections.selection];

  if (selectionIds.length === 0) {
    return { status: "ignored" };
  }

  for (const entityId of selectionIds) {
    editor.actions.removeTransportComponent(entityId);
  }

  if (activeTool === "select") {
    canvas.actions.hideCanvasFloatingToolbar();
    canvas.actions.hideCanvasRightDockToolbar();
  }

  return { status: "handled" };
}

function directionalDeleteStrictLogistics(
  editor: EditorContract,
  activeTool: CanvasInteractionController["state"]["activeTool"],
  canvas: CanvasInteractionController,
  direction: "upstream" | "downstream",
): GestureHandleResult {
  const selectionIds = [...editor.state.collections.selection];

  if (selectionIds.length === 0) {
    return { status: "ignored" };
  }

  for (const entityId of selectionIds) {
    if (direction === "upstream") {
      editor.actions.removeTransportComponentUpstream(entityId);
    } else {
      editor.actions.removeTransportComponentDownstream(entityId);
    }
  }

  if (activeTool === "select") {
    canvas.actions.hideCanvasFloatingToolbar();
    canvas.actions.hideCanvasRightDockToolbar();
  }

  return { status: "handled" };
}
