import type { TextStyleOptions } from "pixi.js";
import { Text } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { lookupText } from "@/shared/i18n";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

/** 框选模式标签固定蓝色 */
const MARQUEE_LABEL_COLOR = 0xF8FBFF;

/** 左上角模式标签样式（不含 dropShadow.color，由 sync 动态设置） */
const MODE_LABEL_TEXT_STYLE = {
  fontSize: 31,
  fontFamily: "sans-serif",
  fontWeight: "900",
  stroke: {
    color: 0x111827,
    width: 5,
    alpha: 0.62,
  },
  dropShadow: {
    angle: Math.PI / 4,
    alpha: 0.72,
    blur: 3,
    distance: 2,
  },
} satisfies TextStyleOptions;

/**
 * MarqueeCanvasDecoration
 *
 * 当 activeTool 为 "marquee" 时在视口左上角渲染模式标签；边缘发光由 renderer DOM overlay 绘制。
 */
export function createMarqueeCanvasDecoration(): DecorationLayer {
  const modeLabel = new Text({ text: "", style: MODE_LABEL_TEXT_STYLE });

  return {
    container: modeLabel,

    sync(ctx: DecorationSyncContext): void {
      const activeTool = ctx.renderHost.input.presentation.getSnapshot().activeTool;

      if (activeTool !== "marquee") {
        modeLabel.visible = false;
        return;
      }

      modeLabel.visible = true;

      const presentation = ctx.renderHost.input.presentation.getSnapshot();
      const isReverse = presentation.toolInfo.marqueeType === EntityCollectionType.reverseMarquee;
      modeLabel.text = lookupText(
        presentation.settings.locale,
        isReverse ? "canvas.modeLabel.reverseMarquee" : "canvas.modeLabel.marquee",
      ) ?? "";
      modeLabel.x = 14;
      modeLabel.y = 8;

      modeLabel.style.fill = MARQUEE_LABEL_COLOR;
      if (modeLabel.style.dropShadow) {
        modeLabel.style.dropShadow.color = resolveAppThemeColorNumber(
          ctx.theme,
          "renderer-mode-label-shadow",
        );
      }
    },

    destroy(): void {
      modeLabel.destroy({ children: true });
    },
  };
}
