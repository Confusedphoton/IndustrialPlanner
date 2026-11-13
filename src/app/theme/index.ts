import type { AppTheme, AppThemeId } from "@/domain/app/types/theme";

import { AYU_DARK_THEME } from "./ayu-dark";
import { AYU_LIGHT_THEME } from "./ayu-light";
import { GRAPHITE_DARK_THEME } from "./graphite-dark";

export { AYU_DARK_THEME } from "./ayu-dark";
export { AYU_LIGHT_THEME } from "./ayu-light";
export { GRAPHITE_DARK_THEME } from "./graphite-dark";
export { applyAppThemeToDocument } from "./theme-applicator";

export const DEFAULT_APP_THEME_ID: AppThemeId = "ayu-light";

// AI-CORRECTION 2026-11-13: 可选主题为 Ayu Light 与 Graphite Dark；Ayu Dark 退出可选列表，
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
  // AI-REMOVED 2026-11-13:
  // Reason: 主题 ID 判断改为查表，新增主题只需登记到 APP_THEMES_BY_ID。
  // Trigger: 新增 graphite-dark 主题。
  // Evidence: 原判断硬编码两个主题 ID。
  // Replacement: 下方 Object.hasOwn 查表。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // return value === "ayu-dark" || value === "ayu-light";
  return typeof value === "string" && Object.hasOwn(APP_THEMES_BY_ID, value);
}

export function resolveAppTheme(themeId: AppThemeId): AppTheme {
  return APP_THEMES_BY_ID[themeId];
}

export function resolveNextAppThemeId(themeId: AppThemeId): AppThemeId {
  // AI-REMOVED 2026-11-13:
  // Reason: 可选主题列表变更，改为按 SUPPORTED_APP_THEMES 顺序循环切换。
  // Trigger: 新增 graphite-dark 主题并替换 Ayu Dark。
  // Evidence: 原实现只在两个 Ayu 主题间切换。
  // Replacement: 下方按索引循环；不在可选列表中的旧主题（ayu-dark）切换到列表首项。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // return themeId === "ayu-dark" ? "ayu-light" : "ayu-dark";
  const currentIndex = SUPPORTED_APP_THEMES.findIndex((theme) => theme.id === themeId);
  const nextTheme = SUPPORTED_APP_THEMES[(currentIndex + 1) % SUPPORTED_APP_THEMES.length];
  return nextTheme?.id ?? DEFAULT_APP_THEME_ID;
}
