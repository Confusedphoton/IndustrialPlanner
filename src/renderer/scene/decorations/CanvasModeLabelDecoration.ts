import type { TextStyleOptions } from "pixi.js";
import { Text } from "pixi.js";
import type { AppTheme } from "@/domain/app/types/theme";
import type { ScenePresentation } from "@/domain/document/scene-view-input";
import { lookupText, type UiKey } from "@/shared/i18n";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

/**
 * 模式标签只做安静的状态提示：小号字、半透明，放在画布顶部居中，
 * 避开贴边的画布工具条与左上角的模式开关，不与工具按钮争夺注意力。
 * 文字取主题正文色，描边取画布底色，浅色与深色主题下都清晰。
 */
const MODE_LABEL_TEXT_STYLE = {
  fontSize: 13,
  fontFamily: "sans-serif",
  fontWeight: "600",
  letterSpacing: 0.4,
  stroke: {
    width: 3,
    alpha: 0.8,
  },
} satisfies TextStyleOptions;

const MODE_LABEL_ALPHA = 0.78;
const MODE_LABEL_TOP_PX = 8;

/** 画布模式标签：resolveLabelKey 返回 null 时隐藏。 */
export function createCanvasModeLabelDecoration(
  resolveLabelKey: (presentation: ScenePresentation) => UiKey | null,
): DecorationLayer {
  const modeLabel = new Text({ text: "", style: MODE_LABEL_TEXT_STYLE });
  modeLabel.alpha = MODE_LABEL_ALPHA;
  let appliedTheme: AppTheme | null = null;

  return {
    container: modeLabel,

    sync(ctx: DecorationSyncContext): void {
      const presentation = ctx.renderHost.input.presentation.getSnapshot();
      const labelKey = resolveLabelKey(presentation);

      if (labelKey === null) {
        modeLabel.visible = false;
        return;
      }

      const text = lookupText(presentation.settings.locale, labelKey) ?? "";
      if (modeLabel.text !== text) {
        modeLabel.text = text;
      }
      if (appliedTheme !== ctx.theme) {
        appliedTheme = ctx.theme;
        modeLabel.style.fill = resolveAppThemeColorNumber(ctx.theme, "text-0");
        modeLabel.style.stroke = { ...MODE_LABEL_TEXT_STYLE.stroke, color: resolveAppThemeColorNumber(ctx.theme, "canvas-bg") };
      }
      modeLabel.visible = true;
      modeLabel.x = Math.round((ctx.viewportState.width - modeLabel.width) / 2);
      modeLabel.y = MODE_LABEL_TOP_PX;
    },

    destroy(): void {
      modeLabel.destroy({ children: true });
    },
  };
}
