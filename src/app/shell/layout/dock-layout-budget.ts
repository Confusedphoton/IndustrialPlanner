export const MIN_CANVAS_WIDTH_PX = 360;
const MIN_CANVAS_VIEWPORT_RATIO = 0.3;
export const MIN_RIGHT_DOCK_WIDTH_PX = 320;
/** 右侧面板挤占画布时，左侧放置面板最多收窄到这里；磁贴网格按列宽自适应，仍可用。 */
export const MIN_SQUEEZED_LEFT_DOCK_WIDTH_PX = 220;
/** 左侧面板收到下限后画布仍不够时，右侧停靠栏（配方树、属性面板或二者叠放的右栏）最多再收窄到这里。 */
export const MIN_SQUEEZED_RIGHT_DOCK_WIDTH_PX = 260;

export interface DockLayoutBudgetInput {
  readonly viewportWidth: number;
  /** 0 when the left dock is closed. */
  readonly leftDockWidth: number;
  /** 0 when the inspector dock is closed. */
  readonly rightDockWidth: number;
  /** 0 when the recipe tree is not docked. */
  readonly recipeDockWidth: number;
  readonly recipeDockMinWidth: number;
  /** 贴在画布边缘的工具条所占的宽度；画布最小宽度指去掉它之后仍可作业的部分。 */
  readonly canvasReservedWidth?: number;
}

export interface DockLayoutBudget {
  /** 0 when the left dock is closed. */
  readonly leftDockWidth: number;
  /** 拖宽左侧面板的上限：只占用画布富余的宽度，不挤窄已打开的右侧停靠栏。 */
  readonly leftDockMaxWidth: number;
  readonly rightDockWidth: number;
  readonly recipeDockWidth: number;
  /** The widest the recipe dock may be dragged before it would squeeze the canvas below its minimum. */
  readonly recipeDockMaxWidth: number;
  /** Inspector and recipe tree share one right column, stacked top and bottom. */
  readonly stackRightDocks: boolean;
}

/**
 * 侧栏同时打开时为画布保留最小可用宽度：先把配方树停靠栏收窄到下限，再收窄属性面板；
 * 两者的下限之和仍放不下时，二者上下叠放在同一右栏。右栏取最小宽度后画布仍不够时，左侧放置面板收窄
 * （不低于 MIN_SQUEEZED_LEFT_DOCK_WIDTH_PX），仍不够时右侧停靠栏再低于其常规下限收窄（不低于 MIN_SQUEEZED_RIGHT_DOCK_WIDTH_PX）。
 * 左侧面板是用户主动打开的主要入口，不自动收起。
 */
export function resolveDockLayoutBudget(input: DockLayoutBudgetInput): DockLayoutBudget {
  const minCanvasWidth = Math.max(
    MIN_CANVAS_WIDTH_PX + (input.canvasReservedWidth ?? 0),
    Math.round(input.viewportWidth * MIN_CANVAS_VIEWPORT_RATIO),
  );
  const rightMinimum = input.rightDockWidth > 0 && input.recipeDockWidth > 0
    ? Math.max(MIN_RIGHT_DOCK_WIDTH_PX, input.recipeDockMinWidth)
    : input.rightDockWidth > 0
      ? MIN_RIGHT_DOCK_WIDTH_PX
      : input.recipeDockWidth > 0 ? input.recipeDockMinWidth : 0;
  const leftDockWidth = input.leftDockWidth === 0 ? 0 : Math.min(input.leftDockWidth, Math.max(
    MIN_SQUEEZED_LEFT_DOCK_WIDTH_PX,
    input.viewportWidth - minCanvasWidth - rightMinimum,
  ));
  const sideBudget = input.viewportWidth - leftDockWidth - minCanvasWidth;
  const resolveLeftDockMaxWidth = (rightColumnsWidth: number) => Math.max(
    leftDockWidth,
    input.viewportWidth - minCanvasWidth - rightColumnsWidth,
  );

  if (
    input.rightDockWidth > 0
    && input.recipeDockWidth > 0
    && sideBudget < MIN_RIGHT_DOCK_WIDTH_PX + input.recipeDockMinWidth
  ) {
    const columnWidth = Math.min(
      Math.max(input.rightDockWidth, input.recipeDockWidth),
      Math.max(MIN_SQUEEZED_RIGHT_DOCK_WIDTH_PX, sideBudget),
    );
    return {
      leftDockWidth,
      leftDockMaxWidth: resolveLeftDockMaxWidth(columnWidth),
      rightDockWidth: columnWidth,
      recipeDockWidth: 0,
      recipeDockMaxWidth: Math.max(input.recipeDockMinWidth, sideBudget),
      stackRightDocks: true,
    };
  }

  const recipeDockMaxWidth = Math.max(Math.min(input.recipeDockMinWidth, MIN_SQUEEZED_RIGHT_DOCK_WIDTH_PX), sideBudget - input.rightDockWidth);
  const recipeDockWidth = input.recipeDockWidth === 0 ? 0 : Math.min(input.recipeDockWidth, recipeDockMaxWidth);

  const rightDockWidth = input.rightDockWidth === 0
    ? 0
    : Math.min(input.rightDockWidth, Math.max(MIN_SQUEEZED_RIGHT_DOCK_WIDTH_PX, sideBudget - recipeDockWidth));

  return {
    leftDockWidth,
    leftDockMaxWidth: resolveLeftDockMaxWidth(rightDockWidth + recipeDockWidth),
    rightDockWidth,
    recipeDockWidth,
    recipeDockMaxWidth,
    stackRightDocks: false,
  };
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
  /** 两栏按比例分配的高度（不含底部停靠栏那一行）。 */
  readonly columnHeight: number;
  /** 配方树额外跨越的底部停靠栏行高度；属性面板不跨这一行。 */
  readonly recipeExtraHeight: number;
  readonly recipeRatio: number;
  readonly inspectorEmpty: boolean;
  readonly focus: StackedPane;
}): StackedRightColumn {
  if (input.inspectorEmpty) {
    return { mode: "single", expanded: "recipe" };
  }
  const recipeShare = Math.max(0, STACK_MIN_RECIPE_HEIGHT_PX - input.recipeExtraHeight);
  if (input.columnHeight < recipeShare + STACK_MIN_INSPECTOR_HEIGHT_PX) {
    return { mode: "single", expanded: input.focus };
  }
  const minRatio = recipeShare / input.columnHeight;
  const maxRatio = 1 - STACK_MIN_INSPECTOR_HEIGHT_PX / input.columnHeight;
  return { mode: "split", recipeRatio: Math.min(maxRatio, Math.max(minRatio, input.recipeRatio)) };
}

/**
 * 分隔条拖动的反向映射：分隔线到右栏顶边的距离就是属性面板的高度，
 * 比例只作用于两栏的按比例行（不含配方树额外跨越的底部停靠栏行），与 resolveStackedRightColumn 一致。
 */
export function resolveStackRatioForBoundary(input: {
  readonly boundaryFromColumnTop: number;
  readonly columnHeight: number;
}): number {
  return 1 - input.boundaryFromColumnTop / Math.max(1, input.columnHeight);
}
