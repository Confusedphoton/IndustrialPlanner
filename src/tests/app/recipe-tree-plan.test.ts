import { afterEach, describe, expect, it } from "vitest";

import { buildProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import { computeCombinedRecipeTreePlan } from "@/app/shell/recipe-tree/recipe-tree-plan";
import { recipeTreeOverlayState } from "@/app/shell/recipe-tree/recipe-tree-state";
import { createRegistryContract } from "@/registry";

afterEach(() => {
  recipeTreeOverlayState.hydrate({});
});

function totalDeviceCount(recipeTotals: readonly { readonly deviceCount: number }[]): number {
  return recipeTotals.reduce((sum, total) => sum + total.deviceCount, 0);
}

describe("recipe tree plan settings", () => {
  it("covers part of the demand from an external supply before planning production", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    recipeTreeOverlayState.hydrate({});
    recipeTreeOverlayState.addPin("item_iron_nugget");
    const withoutSupply = computeCombinedRecipeTreePlan(index)!;

    recipeTreeOverlayState.addSupply("item_iron_nugget", recipeTreeOverlayState.pins[0]!.perMinute / 2);
    const withSupply = computeCombinedRecipeTreePlan(index)!;

    const before = withoutSupply.itemTotals.find((total) => total.itemId === "item_iron_nugget");
    const after = withSupply.itemTotals.find((total) => total.itemId === "item_iron_nugget");
    expect(after?.producedPerMinute).toBeCloseTo((before?.producedPerMinute ?? 0) / 2);
    expect(totalDeviceCount(withSupply.recipeTotals)).toBeLessThan(totalDeviceCount(withoutSupply.recipeTotals));
  });

  it("restores supplies and source policy from storage and drops malformed values", () => {
    recipeTreeOverlayState.hydrate({
      supplies: [{ id: "s1", itemId: "item_iron_ore", perMinute: 60 }, { itemId: 3 }],
      sourceConfig: { waterPolicy: "dump-byproduct", sewagePolicy: "nonsense" },
      useModules: true,
    });

    expect(recipeTreeOverlayState.supplies).toEqual([{ id: "s1", itemId: "item_iron_ore", perMinute: 60 }]);
    expect(recipeTreeOverlayState.sourceConfig.waterPolicy).toBe("dump-byproduct");
    expect(recipeTreeOverlayState.sourceConfig.sewagePolicy).toBe("external-supply");
    expect(recipeTreeOverlayState.useModules).toBe(true);
  });
});
