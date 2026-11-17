import type { CanvasInteractionController } from "@/app/canvas";
import { createSelectionBlueprintDocument } from "@/app/blueprint/save-blueprint";
import type { AppHost } from "@/app/host/app-host";
import { holdingTrayState, type HoldingTrayItem } from "@/app/shell/canvas/holding-tray-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureMappingModule } from "../types";
import { enterBlueprintPlacement } from "./hypergryph-blueprint-placement-gesture-module";

export const HOLD_SELECTION_BUTTON_ID = "canvas-floating-toolbar-button-hold";

/**
 * 暂存托盘：选中的设备（单台或一整组）点「暂存」后收进托盘并从画布移除（一条撤销记录）；
 * 托盘里的一组以蓝图保存，保留相对位置、配方以及组内的传送带/管道与槽位连接。
 */
export function createHypergryphHoldingTrayGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-holding-tray-gesture",
    handle(event, context) {
      if (
        (event.type !== "ui-button-touch-tap" && event.type !== "ui-button-mouse-tap")
        || event.uiButtonId !== HOLD_SELECTION_BUTTON_ID
        || context.canvas.state.activeTool !== "select"
      ) {
        return { status: "ignored" };
      }
      return holdSelection(context.canvas) ? { status: "handled" } : { status: "ignored" };
    },
  };
}

function holdSelection(canvas: CanvasInteractionController): boolean {
  const editor = canvas.editor;
  if (editor === null || editor.state.collections.selection.length === 0) {
    return false;
  }
  const blueprint = createSelectionBlueprintDocument({ workspace: canvas.workbench.workspace, name: "Holding tray" });
  if (blueprint === null) {
    return false;
  }
  if (!holdingTrayState.push(blueprint)) {
    canvas.actions.showCanvasToast("canvasHotbar.trayFull");
    return true;
  }
  editor.actions.deleteCollection(EntityCollectionType.selection);
  canvas.actions.hideCanvasFloatingToolbar();
  return true;
}

/** 从托盘拿起一组放回画布；放下前仍留在托盘里，放下一次即离开托盘。 */
export function pullFromHoldingTray(
  canvas: CanvasInteractionController,
  item: HoldingTrayItem,
  source: "mouse" | "touch",
): boolean {
  const editor = canvas.editor;
  if (editor === null) {
    return false;
  }
  const result = enterBlueprintPlacement({
    canvas,
    editor,
    record: { ...item.blueprint, parentFolderId: null },
    source,
    initialMousePosition: null,
  });
  if (result.status !== "handled") {
    return false;
  }
  canvas.state.runtime.blueprintPlacementContinuous = false;
  return true;
}
