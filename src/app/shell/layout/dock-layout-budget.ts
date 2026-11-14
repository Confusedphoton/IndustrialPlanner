export const MIN_CANVAS_WIDTH_PX = 360;
const MIN_CANVAS_VIEWPORT_RATIO = 0.3;
export const MIN_RIGHT_DOCK_WIDTH_PX = 320;

export interface DockLayoutBudgetInput {
  readonly viewportWidth: number;
  readonly leftToolbarWidth: number;
  /** 0 when the left dock is closed. */
  readonly leftDockWidth: number;
  /** 0 when the inspector dock is closed. */
  readonly rightDockWidth: number;
  /** 0 when the recipe tree is not docked. */
  readonly recipeDockWidth: number;
  readonly recipeDockMinWidth: number;
}

export interface DockLayoutBudget {
  readonly rightDockWidth: number;
  readonly recipeDockWidth: number;
  /** The widest the recipe dock may be dragged before it would squeeze the canvas below its minimum. */
  readonly recipeDockMaxWidth: number;
  /** Inspector and recipe tree share one right column, stacked top and bottom. */
  readonly stackRightDocks: boolean;
}

/**
 * 侧栏同时打开时为画布保留最小可用宽度：先把配方树停靠栏收窄到下限，再收窄属性面板；
 * 两者的下限之和仍放不下时，二者上下叠放在同一右栏。左侧放置面板是用户主动打开的主要入口，不自动收起。
 */
export function resolveDockLayoutBudget(input: DockLayoutBudgetInput): DockLayoutBudget {
  const minCanvasWidth = Math.max(MIN_CANVAS_WIDTH_PX, Math.round(input.viewportWidth * MIN_CANVAS_VIEWPORT_RATIO));
  const sideBudget = input.viewportWidth - input.leftToolbarWidth - input.leftDockWidth - minCanvasWidth;

  if (
    input.rightDockWidth > 0
    && input.recipeDockWidth > 0
    && sideBudget < MIN_RIGHT_DOCK_WIDTH_PX + input.recipeDockMinWidth
  ) {
    const columnWidth = Math.min(
      Math.max(input.rightDockWidth, input.recipeDockWidth),
      Math.max(MIN_RIGHT_DOCK_WIDTH_PX, sideBudget),
    );
    return {
      rightDockWidth: columnWidth,
      recipeDockWidth: 0,
      recipeDockMaxWidth: Math.max(input.recipeDockMinWidth, sideBudget),
      stackRightDocks: true,
    };
  }

  const recipeDockMaxWidth = Math.max(input.recipeDockMinWidth, sideBudget - input.rightDockWidth);
  const recipeDockWidth = input.recipeDockWidth === 0 ? 0 : Math.min(input.recipeDockWidth, recipeDockMaxWidth);

  const rightDockWidth = input.rightDockWidth === 0
    ? 0
    : Math.min(input.rightDockWidth, Math.max(MIN_RIGHT_DOCK_WIDTH_PX, sideBudget - recipeDockWidth));

  return { rightDockWidth, recipeDockWidth, recipeDockMaxWidth, stackRightDocks: false };
}

/** 叠放时配方树至少需要的高度：标题栏、搜索/工具栏行、合计与可用的流程图区域。 */
export const STACK_MIN_RECIPE_HEIGHT_PX = 340;
/** 叠放时属性面板至少需要的高度：标题栏与设备操作卡片。 */
export const STACK_MIN_INSPECTOR_HEIGHT_PX = 180;

export type StackedPane = "inspector" | "recipe";

export type StackedRightColumn =
  | { readonly mode: "split"; readonly recipeRatio: number }
  | { readonly mode: "single"; readonly expanded: StackedPane };

/**
 * 叠放右栏的高度分配：两栏都能达到最小高度时按用户比例分割（比例被夹紧到两侧最小高度之内）；
 * 放不下时只展开一栏，另一栏收起为标题栏，点按标题栏切换。属性面板为空时总是让给配方树。
 */
export function resolveStackedRightColumn(input: {
  readonly columnHeight: number;
  readonly recipeRatio: number;
  readonly inspectorEmpty: boolean;
  readonly focus: StackedPane;
}): StackedRightColumn {
  if (input.inspectorEmpty) {
    return { mode: "single", expanded: "recipe" };
  }
  if (input.columnHeight < STACK_MIN_RECIPE_HEIGHT_PX + STACK_MIN_INSPECTOR_HEIGHT_PX) {
    return { mode: "single", expanded: input.focus };
  }
  const minRatio = STACK_MIN_RECIPE_HEIGHT_PX / input.columnHeight;
  const maxRatio = 1 - STACK_MIN_INSPECTOR_HEIGHT_PX / input.columnHeight;
  return { mode: "split", recipeRatio: Math.min(maxRatio, Math.max(minRatio, input.recipeRatio)) };
}
