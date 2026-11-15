import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";

import type { GestureMappingModule } from "../types";
import { driveMovePreview } from "./hypergryph-move-gesture-module";
import { driveMousePlacementPreview, drivePlacementPreview } from "./hypergryph-single-placement-gesture-module";

type DragPointer = "mouse" | "touch";

/**
 * 只观察不消费：放置、蓝图放置与移动工具中按住拖动设备预览时，把指针交给画布的边缘平移，
 * 预览贴到可见区边缘就持续平移地图。触控拖动只在拖住预览本身时才算（拖空白处是平移视图）。
 */
export function createHypergryphPreviewEdgePanModule(): GestureMappingModule<AppHost> {
  let trackedCanvas: CanvasInteractionController | null = null;
  const stop = () => {
    trackedCanvas?.edgePan.stop();
    trackedCanvas = null;
  };

  return {
    id: "hypergryph-preview-edge-pan",
    // 先于各工具模块看到拖动事件；始终返回 ignored，不影响其后的处理。
    priority: 1000,
    cancel: stop,
    handle(event, context) {
      const canvas = context.canvas;
      switch (event.type) {
        case "mouse dragmove":
          if (event.originButton === 0) {
            track(canvas, "mouse", event.position);
            trackedCanvas = canvas;
          }
          return { status: "ignored" };

        case "touch dragmove":
          track(canvas, "touch", event.position);
          trackedCanvas = canvas;
          return { status: "ignored" };

        case "mouse dragend":
        case "touch dragend":
        case "on-exit-active-tool":
        case "pinch in":
        case "pinch out":
        case "two finger move":
          stop();
          return { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function track(canvas: CanvasInteractionController, pointer: DragPointer, position: GesturePosition): void {
  const editor = canvas.editor;
  const redrive = editor === null ? null : resolvePreviewRedrive(canvas, editor, pointer);
  if (redrive === null) {
    canvas.edgePan.stop();
    return;
  }
  canvas.edgePan.track(position, redrive);
}

function resolvePreviewRedrive(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  pointer: DragPointer,
): ((position: GesturePosition) => void) | null {
  const runtime = canvas.state.runtime;
  switch (canvas.state.activeTool) {
    case "single-placement":
    case "blueprint-placement":
      if (pointer === "mouse") {
        return (position) => { driveMousePlacementPreview({ canvas, editor, position }); };
      }
      return runtime.placementAnchor === null
        ? null
        : (position) => { drivePlacementPreview({ canvas, editor, position }); };

    case "move":
      return runtime.movePointerMode !== "mouse" && runtime.moveAnchor === null
        ? null
        : (position) => { driveMovePreview({ canvas, editor, position, allowMouseEntryAnchorInit: false }); };

    default:
      return null;
  }
}
