import type { AppTheme, AppThemeId } from "@/domain/app/types/theme";

import { AYU_DARK_THEME } from "./ayu-dark";
import { AYU_LIGHT_THEME } from "./ayu-light";
import { GRAPHITE_DARK_THEME } from "./graphite-dark";

export { AYU_DARK_THEME } from "./ayu-dark";
export { AYU_LIGHT_THEME } from "./ayu-light";
export { GRAPHITE_DARK_THEME } from "./graphite-dark";
export { applyAppThemeToDocument } from "./theme-applicator";

export const DEFAULT_APP_THEME_ID: AppThemeId = "ayu-light";

// 仅保留在 APP_THEMES_BY_ID 中供旧设置解析与测试夹具使用（旧设置在 storage-hook 中迁移到 graphite-dark）。
// 原列表为 [AYU_DARK_THEME, AYU_LIGHT_THEME]。
export const SUPPORTED_APP_THEMES = [
  AYU_LIGHT_THEME,
  GRAPHITE_DARK_THEME,
] as const satisfies readonly AppTheme[];

const APP_THEMES_BY_ID: Record<AppThemeId, AppTheme> = {
  "ayu-dark": AYU_DARK_THEME,
  "ayu-light": AYU_LIGHT_THEME,
  "graphite-dark": GRAPHITE_DARK_THEME,
};

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === "string" && Object.hasOwn(APP_THEMES_BY_ID, value);
}

export function resolveAppTheme(themeId: AppThemeId): AppTheme {
  return APP_THEMES_BY_ID[themeId];
}

export function resolveNextAppThemeId(themeId: AppThemeId): AppThemeId {
  const currentIndex = SUPPORTED_APP_THEMES.findIndex((theme) => theme.id === themeId);
  const nextTheme = SUPPORTED_APP_THEMES[(currentIndex + 1) % SUPPORTED_APP_THEMES.length];
  return nextTheme?.id ?? DEFAULT_APP_THEME_ID;
}
