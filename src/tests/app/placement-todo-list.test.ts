import { describe, expect, it } from "vitest";

import { resolvePlacementTodoEntries } from "@/app/shell/panels/placement-todo-list";
import type { ProductionPlanningResult } from "@/app/shell/production-planning/production-planning-model";

function planWith(totals: ReadonlyArray<{ recipeId: string; deviceCount: number }>): ProductionPlanningResult {
  return { recipeTotals: totals } as unknown as ProductionPlanningResult;
}

describe("placement to-do list", () => {
  it("counts placed machines per recipe against whole machines needed and moves finished entries last", () => {
    const entries = resolvePlacementTodoEntries(
      planWith([
        { recipeId: "r-ore", deviceCount: 2 },
        { recipeId: "r-powder", deviceCount: 4.3 },
        { recipeId: "r-unused", deviceCount: 0 },
      ]),
      { byRecipe: { "r-ore": 2, "r-powder": 1 }, unsetByMachine: {} },
      (recipeId) => ({ machineId: `machine-${recipeId}`, outputItemId: null }),
    );

    expect(entries.map((entry) => [entry.recipeId, entry.placed, entry.needed])).toEqual([
      ["r-powder", 1, 5],
      ["r-ore", 2, 2],
    ]);
  });

  it("counts machines with no recipe set toward the plan's entries for that machine, in plan order", () => {
    const machineOf = (recipeId: string) => ({ machineId: recipeId.startsWith("r-water") ? "pump" : "forge", outputItemId: null });
    const entries = resolvePlacementTodoEntries(
      planWith([
        { recipeId: "r-water-a", deviceCount: 2 },
        { recipeId: "r-water-b", deviceCount: 1 },
        { recipeId: "r-forge", deviceCount: 4 },
      ]),
      { byRecipe: { "r-water-a": 1 }, unsetByMachine: { pump: 3, forge: 4 } },
      machineOf,
    );

    expect(Object.fromEntries(entries.map((entry) => [entry.recipeId, entry.placed]))).toEqual({
      "r-water-a": 2,
      "r-water-b": 1,
      "r-forge": 4,
    });
  });
});
