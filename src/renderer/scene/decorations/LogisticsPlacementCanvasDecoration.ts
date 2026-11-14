import type { TextStyleOptions } from "pixi.js";
import { Text } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { lookupText } from "@/shared/i18n";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

const LOGISTICS_PLACEMENT_GLOW_COLOR = 0xFFD54A;

/** 左上角模式标签样式（不含 dropShadow.color，由 sync 动态设置） */
const MODE_LABEL_TEXT_STYLE = {
  fontSize: 28,
  fontFamily: "sans-serif",
  fontWeight: "bold",
  fill: LOGISTICS_PLACEMENT_GLOW_COLOR,
  stroke: {
    color: 0x20242a,
    width: 4,
    alpha: 0.42,
  },
  dropShadow: {
    angle: Math.PI / 4,
    alpha: 0.6,
    blur: 4,
    distance: 1,
  },
} satisfies TextStyleOptions;

/**
 * 放置设备时在视口左上角渲染模式标签。
 * 场景呈现快照不携带物流布设种类，物流布设的提示由 DOM 画布提示负责。
 */
export function createLogisticsPlacementCanvasDecoration(): DecorationLayer {
  const modeLabel = new Text({ text: "", style: MODE_LABEL_TEXT_STYLE as TextStyleOptions });

  return {
    container: modeLabel,

    sync(ctx: DecorationSyncContext): void {
      const presentation = ctx.renderHost.input.presentation.getSnapshot();

      if (presentation.activeTool !== "single-placement") {
        modeLabel.visible = false;
        return;
      }

      modeLabel.visible = true;
      ctx.profiler?.count("logisticsPlacement.singlePlacementFrames");
      modeLabel.text = lookupText(presentation.settings.locale, "canvas.modeLabel.devicePlacement") ?? "";
      modeLabel.x = 14;
      modeLabel.y = 8;

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
