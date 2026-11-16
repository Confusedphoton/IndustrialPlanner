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
      new Map([["r-ore", 2], ["r-powder", 1]]),
      (recipeId) => ({ machineId: `machine-${recipeId}`, outputItemId: null }),
    );

    expect(entries.map((entry) => [entry.recipeId, entry.placed, entry.needed])).toEqual([
      ["r-powder", 1, 5],
      ["r-ore", 2, 2],
    ]);
  });
});
