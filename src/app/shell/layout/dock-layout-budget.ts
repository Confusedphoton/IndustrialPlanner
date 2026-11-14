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
}

/**
 * 侧栏同时打开时为画布保留最小可用宽度：先把配方树停靠栏收窄到下限，再收窄属性面板。
 * 左侧放置面板是用户主动打开的主要入口，不自动收起。
 */
export function resolveDockLayoutBudget(input: DockLayoutBudgetInput): DockLayoutBudget {
  const minCanvasWidth = Math.max(MIN_CANVAS_WIDTH_PX, Math.round(input.viewportWidth * MIN_CANVAS_VIEWPORT_RATIO));
  const sideBudget = input.viewportWidth - input.leftToolbarWidth - input.leftDockWidth - minCanvasWidth;

  const recipeDockMaxWidth = Math.max(input.recipeDockMinWidth, sideBudget - input.rightDockWidth);
  const recipeDockWidth = input.recipeDockWidth === 0 ? 0 : Math.min(input.recipeDockWidth, recipeDockMaxWidth);

  const rightDockWidth = input.rightDockWidth === 0
    ? 0
    : Math.min(input.rightDockWidth, Math.max(MIN_RIGHT_DOCK_WIDTH_PX, sideBudget - recipeDockWidth));

  return { rightDockWidth, recipeDockWidth, recipeDockMaxWidth };
}
