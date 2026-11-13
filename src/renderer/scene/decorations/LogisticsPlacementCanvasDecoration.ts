import type { TextStyleOptions } from "pixi.js";
import { Text } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
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

const LOGISTICS_PLACEMENT_LABELS = {
  belt: "//布设传送带",
  pipe: "//布设管道",
} as const;

const LOGISTICS_PLACEMENT_LABELS_EN: Record<keyof typeof LOGISTICS_PLACEMENT_LABELS, string> = {
  belt: "//Draw belt",
  pipe: "//Draw pipe",
};

interface AppWithLogisticsPlacementRuntime {
  internalState: {
    runtime: {
      logisticsPlacement: {
        kind: keyof typeof LOGISTICS_PLACEMENT_LABELS | null;
      };
    };
  };
}

function resolveLogisticsPlacementKind(
  ctx: DecorationSyncContext,
): keyof typeof LOGISTICS_PLACEMENT_LABELS | null {
  const app = ctx.renderHost.input.presentation.getSnapshot();

  if (app === null || !("internalState" in app)) {
    return null;
  }

  return (app as AppWithLogisticsPlacementRuntime)
    .internalState.runtime.logisticsPlacement.kind;
}

// AI-MODIFIED 2026-05-21:
// 移除所有 BlurFilter 和 glow 绘制代码（nearGlow/farGlow/coreEdge/glowMask），
// 改为仅保留 modeLabel。发光效果迁移至 DOM overlay（CSS box-shadow + animation），
// 以消除 BlurFilter 引起的全视口离屏渲染开销。
export function createLogisticsPlacementCanvasDecoration(): DecorationLayer {
  const modeLabel = new Text({ text: "", style: MODE_LABEL_TEXT_STYLE as TextStyleOptions });

  return {
    container: modeLabel,

    sync(ctx: DecorationSyncContext): void {
      const appState = ctx.renderHost.input.presentation.getSnapshot();
      const logisticsKind = resolveLogisticsPlacementKind(ctx);
      const isLogisticsPlacement = appState.activeTool === "logistics-placement" && logisticsKind !== null;
      const isSinglePlacement = appState.activeTool === "single-placement";

      if (!isLogisticsPlacement && !isSinglePlacement) {
        modeLabel.visible = false;
        return;
      }

      modeLabel.visible = true;
      ctx.profiler?.count("logisticsPlacement.activeFrames");
      ctx.profiler?.count(isSinglePlacement
        ? "logisticsPlacement.singlePlacementFrames"
        : "logisticsPlacement.logisticsPlacementFrames");

      // AI-CORRECTION 2026-11-13：画布模式标签按界面语言显示，沿用 MarqueeRectDecoration 的 locale 判断方式。
      const english = ctx.renderHost.input.presentation.getSnapshot()?.settings?.locale === "en-US";
      modeLabel.text = isSinglePlacement
        ? (english ? "//Place device" : "放置设备")
        : logisticsKind === null
          ? ""
          : (english ? LOGISTICS_PLACEMENT_LABELS_EN : LOGISTICS_PLACEMENT_LABELS)[logisticsKind];
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
