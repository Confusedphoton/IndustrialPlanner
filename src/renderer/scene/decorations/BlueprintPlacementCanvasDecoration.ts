import type { DecorationLayer } from "./DecorationLayer";
import { createCanvasModeLabelDecoration } from "./CanvasModeLabelDecoration";

/** 蓝图放置模式时在画布顶部显示模式标签。 */
export function createBlueprintPlacementCanvasDecoration(): DecorationLayer {
  return createCanvasModeLabelDecoration((presentation) =>
    presentation.activeTool === "blueprint-placement" ? "canvas.modeLabel.blueprintPlacement" : null);
}
