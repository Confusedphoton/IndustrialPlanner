import type { DecorationLayer } from "./DecorationLayer";
import { createCanvasModeLabelDecoration } from "./CanvasModeLabelDecoration";

/**
 * 放置设备时在画布顶部显示模式标签。
 * 场景呈现快照不携带物流布设种类，物流布设的提示由 DOM 画布提示负责。
 */
export function createLogisticsPlacementCanvasDecoration(): DecorationLayer {
  return createCanvasModeLabelDecoration((presentation) =>
    presentation.activeTool === "single-placement" ? "canvas.modeLabel.devicePlacement" : null);
}
