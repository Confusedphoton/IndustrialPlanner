import type { DecorationLayer } from "./DecorationLayer";
import { createCanvasModeLabelDecoration } from "./CanvasModeLabelDecoration";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

/** 框选模式时在画布顶部显示模式标签；边缘发光由 renderer DOM overlay 绘制。 */
export function createMarqueeCanvasDecoration(): DecorationLayer {
  return createCanvasModeLabelDecoration((presentation) => {
    if (presentation.activeTool !== "marquee") return null;
    return presentation.toolInfo.marqueeType === EntityCollectionType.reverseMarquee
      ? "canvas.modeLabel.reverseMarquee"
      : "canvas.modeLabel.marquee";
  });
}
