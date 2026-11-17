import { describe, expect, it } from "vitest";

import { layoutPlanInRect, orderPlanStages, type PlanMachine } from "@/app/canvas/plan-layout";

function machine(recipeId: string, inputs: string[], outputs: string[], count = 1): PlanMachine {
  return { recipeId, machineId: `m-${recipeId}`, count, width: 3, height: 3, inputItemIds: inputs, outputItemIds: outputs };
}

describe("laying a plan out in an area", () => {
  it("puts each recipe in a stage after the recipes that feed it", () => {
    const stages = orderPlanStages([
      machine("powder", ["nugget"], ["powder"]),
      machine("nugget", ["ore"], ["nugget"]),
      machine("part", ["powder", "nugget"], ["part"]),
    ]);

    expect(stages.map((stage) => stage.map((entry) => entry.recipeId))).toEqual([["nugget"], ["powder"], ["part"]]);
  });

  it("stacks a stage's machines, wraps into another column when tall, and says when it does not fit", () => {
    const stages = [[machine("a", [], ["x"], 3)], [machine("b", ["x"], [])]];
    const roomy = layoutPlanInRect(stages, { x: 0, y: 0, width: 20, height: 20 });
    expect(roomy.fits).toBe(true);
    expect(roomy.placements.filter((placement) => placement.recipeId === "a").map((placement) => placement.position.x))
      .toEqual([roomy.placements[0]!.position.x, roomy.placements[0]!.position.x, roomy.placements[0]!.position.x]);

    const short = layoutPlanInRect(stages, { x: 0, y: 0, width: 20, height: 7 });
    expect(new Set(short.placements.filter((placement) => placement.recipeId === "a").map((placement) => placement.position.x)).size).toBe(2);
    expect(layoutPlanInRect(stages, { x: 0, y: 0, width: 2, height: 20 }).fits).toBe(false);
  });

  it("moves stages that do not fit across onto another row", () => {
    const stages = [0, 1, 2, 3].map((index) => [machine(`s${index}`, index === 0 ? [] : [`i${index - 1}`], [`i${index}`])]);
    const layout = layoutPlanInRect(stages, { x: 0, y: 0, width: 13, height: 20 });

    expect(layout.fits).toBe(true);
    expect(new Set(layout.placements.map((placement) => placement.position.y)).size).toBeGreaterThan(1);
  });
});
