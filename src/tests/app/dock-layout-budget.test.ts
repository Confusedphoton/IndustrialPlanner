import { describe, expect, it } from "vitest";

import {
  MIN_CANVAS_WIDTH_PX,
  MIN_RIGHT_DOCK_WIDTH_PX,
  STACK_MIN_INSPECTOR_HEIGHT_PX,
  STACK_MIN_RECIPE_HEIGHT_PX,
  resolveDockLayoutBudget,
  resolveStackRatioForBoundary,
  resolveStackedRightColumn,
} from "@/app/shell/layout/dock-layout-budget";

const RECIPE_DOCK_MIN_WIDTH = 300;

function canvasWidth(viewportWidth: number, leftToolbarWidth: number, leftDockWidth: number, budget: ReturnType<typeof resolveDockLayoutBudget>) {
  return viewportWidth - leftToolbarWidth - leftDockWidth - budget.rightDockWidth - budget.recipeDockWidth;
}

describe("resolveDockLayoutBudget", () => {
  it.each([
    { viewportWidth: 1920, leftToolbarWidth: 68, leftDockWidth: 320 },
    { viewportWidth: 1440, leftToolbarWidth: 68, leftDockWidth: 320 },
    { viewportWidth: 1280, leftToolbarWidth: 68, leftDockWidth: 320 },
    { viewportWidth: 1180, leftToolbarWidth: 51, leftDockWidth: 180 },
  ])("keeps the canvas at its minimum width with every dock open at $viewportWidth px", ({ viewportWidth, leftToolbarWidth, leftDockWidth }) => {
    const minCanvas = Math.max(MIN_CANVAS_WIDTH_PX, Math.round(viewportWidth * 0.3));
    const budget = resolveDockLayoutBudget({
      viewportWidth,
      leftToolbarWidth,
      leftDockWidth,
      rightDockWidth: 380,
      recipeDockWidth: 960,
      recipeDockMinWidth: RECIPE_DOCK_MIN_WIDTH,
    });

    expect(canvasWidth(viewportWidth, leftToolbarWidth, leftDockWidth, budget)).toBeGreaterThanOrEqual(minCanvas);
    expect(budget.rightDockWidth).toBeGreaterThanOrEqual(MIN_RIGHT_DOCK_WIDTH_PX);
  });

  it("stacks the inspector and recipe dock only when side by side would squeeze the canvas", () => {
    const wide = resolveDockLayoutBudget({
      viewportWidth: 1920,
      leftToolbarWidth: 68,
      leftDockWidth: 320,
      rightDockWidth: 380,
      recipeDockWidth: 440,
      recipeDockMinWidth: RECIPE_DOCK_MIN_WIDTH,
    });
    const narrow = resolveDockLayoutBudget({
      viewportWidth: 1280,
      leftToolbarWidth: 68,
      leftDockWidth: 320,
      rightDockWidth: 380,
      recipeDockWidth: 440,
      recipeDockMinWidth: RECIPE_DOCK_MIN_WIDTH,
    });

    expect(wide.stackRightDocks).toBe(false);
    expect(wide.recipeDockWidth).toBe(440);
    expect(narrow.stackRightDocks).toBe(true);
    expect(narrow.recipeDockWidth).toBe(0);
  });

  it("caps recipe dock dragging so the canvas keeps its minimum", () => {
    const budget = resolveDockLayoutBudget({
      viewportWidth: 1440,
      leftToolbarWidth: 68,
      leftDockWidth: 320,
      rightDockWidth: 0,
      recipeDockWidth: 960,
      recipeDockMinWidth: RECIPE_DOCK_MIN_WIDTH,
    });

    expect(budget.recipeDockWidth).toBe(budget.recipeDockMaxWidth);
    expect(canvasWidth(1440, 68, 320, budget)).toBe(Math.round(1440 * 0.3));
  });
});

describe("resolveStackedRightColumn", () => {
  it.each([0, 0.1, 0.5, 0.95, 1])("keeps both stacked panes at their minimum heights for a persisted ratio of %s", (recipeRatio) => {
    const columnHeight = 824;
    const column = resolveStackedRightColumn({ columnHeight, recipeExtraHeight: 0, recipeRatio, inspectorEmpty: false, focus: "inspector" });

    expect(column.mode).toBe("split");
    if (column.mode === "split") {
      expect(column.recipeRatio * columnHeight).toBeGreaterThanOrEqual(STACK_MIN_RECIPE_HEIGHT_PX);
      expect((1 - column.recipeRatio) * columnHeight).toBeGreaterThanOrEqual(STACK_MIN_INSPECTOR_HEIGHT_PX);
    }
  });

  it("expands only the focused pane when the column is too short for both", () => {
    expect(resolveStackedRightColumn({ columnHeight: 464, recipeExtraHeight: 0, recipeRatio: 0.25, inspectorEmpty: false, focus: "recipe" }))
      .toEqual({ mode: "single", expanded: "recipe" });
    expect(resolveStackedRightColumn({ columnHeight: 464, recipeExtraHeight: 0, recipeRatio: 0.25, inspectorEmpty: false, focus: "inspector" }))
      .toEqual({ mode: "single", expanded: "inspector" });
  });

  it("gives the whole column to the recipe tree while nothing is selected", () => {
    expect(resolveStackedRightColumn({ columnHeight: 824, recipeExtraHeight: 0, recipeRatio: 0.3, inspectorEmpty: true, focus: "inspector" }))
      .toEqual({ mode: "single", expanded: "recipe" });
  });

  it.each([0, 0.5, 1])("keeps the inspector at its minimum when a bottom dock takes height (ratio %s)", (recipeRatio) => {
    // 1280x900 with a 260px timeline docked: 900 - 48 - 28 - 260 = 564px shared by the two fractional rows.
    const columnHeight = 564;
    const recipeExtraHeight = 260;
    const column = resolveStackedRightColumn({ columnHeight, recipeExtraHeight, recipeRatio, inspectorEmpty: false, focus: "inspector" });

    expect(column.mode).toBe("split");
    if (column.mode === "split") {
      expect((1 - column.recipeRatio) * columnHeight).toBeGreaterThanOrEqual(STACK_MIN_INSPECTOR_HEIGHT_PX);
      expect(column.recipeRatio * columnHeight + recipeExtraHeight).toBeGreaterThanOrEqual(STACK_MIN_RECIPE_HEIGHT_PX);
    }
  });

  it("maps a splitter position back to the ratio that renders the inspector at that height", () => {
    // 1280x900 with a 160px timeline: the two fractional rows share 664px.
    const columnHeight = 664;
    const inspectorHeight = 300;
    const ratio = resolveStackRatioForBoundary({ boundaryFromColumnTop: inspectorHeight, columnHeight });
    const column = resolveStackedRightColumn({ columnHeight, recipeExtraHeight: 160, recipeRatio: ratio, inspectorEmpty: false, focus: "inspector" });

    expect(column.mode).toBe("split");
    if (column.mode === "split") {
      expect((1 - column.recipeRatio) * columnHeight).toBeCloseTo(inspectorHeight);
    }
  });
});
