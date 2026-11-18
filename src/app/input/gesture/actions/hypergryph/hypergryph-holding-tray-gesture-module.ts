import type { CanvasInteractionController } from "@/app/canvas";
import type { HoldingTrayItem } from "@/app/shell/canvas/holding-tray-state";

import { enterBlueprintPlacement } from "./hypergryph-blueprint-placement-gesture-module";

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
