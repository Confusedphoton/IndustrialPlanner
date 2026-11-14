import { loadBlueprintVariantFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findSlotWithItem, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

type LiquidPurifierRecipeCase = {
  readonly name: string;
  readonly recipeId: string;
  readonly inputItemId: string;
  readonly leftOutputItemId: string;
  readonly rightOutputItemId: string;
};

const LIQUID_PURIFIER_ENTITY_ID = "liquid_purifier_1";
const FINAL_DURATION_SECONDS = 8;

const RECIPE_CASES: readonly LiquidPurifierRecipeCase[] = [
  {
    name: "惰性壤晶废液提纯",
    recipeId: "r_liquid_purifier_water_and_xiranite_poly_from_xiranite_lowpoly_basic",
    inputItemId: "item_liquid_xiranite_lowpoly",
    leftOutputItemId: "item_liquid_water",
    rightOutputItemId: "item_liquid_xiranite_poly",
  },
  {
    name: "赤铜溶液提纯",
    recipeId: "r_liquid_purifier_acid_and_copper_enr_from_copper_basic",
    inputItemId: "item_liquid_copper",
    leftOutputItemId: "item_liquid_acid",
    rightOutputItemId: "item_liquid_copper_enr",
  },
];

const RECIPE_ENGINE_CASES = SIMULATION_ENGINE_MATRIX.flatMap((engineKind) =>
  RECIPE_CASES.map((recipeCase) => ({ engineKind, recipeCase }))
);

describe("提纯机输出端口物品级过滤", () => {
  // TODO: demo 配方引入后 RECIPE_CASES 未同步更新，临时 skip，正式更新时恢复
  it("覆盖 registry 中当前全部提纯机配方", () => {
    const registry = createRegistryContract();

    expect(registry.recipeDefinitions
      .filter((recipe) => recipe.machineId === LIQUID_PURIFIER_ENTITY_ID)
      .map((recipe) => recipe.id)
      .sort()).toEqual(RECIPE_CASES.map((recipeCase) => recipeCase.recipeId).sort());
  });

  it.each(RECIPE_ENGINE_CASES)(
    "$engineKind: $recipeCase.name 的两个输出端口只输出各自允许的液体",
    async ({ engineKind, recipeCase }) => {
    const registry = createRegistryContract();
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/liquid-purifier-output-filter/index.json", "scene-01", { engineKind, recipeCase }),
      maxDurationSeconds: FINAL_DURATION_SECONDS,
      engineKind,
      registry,
    });
    const finalTick = getLastTick(report).tickNumber;
    const leftTransferredItems = collectTransferredItemsFromDevice(report, "left-only-purifier");
    const rightTransferredItems = collectTransferredItemsFromDevice(report, "right-only-purifier");

    expect(report.topology.diagnostics).toEqual([]);
    expect(leftTransferredItems).toContain(recipeCase.leftOutputItemId);
    expect(leftTransferredItems).not.toContain(recipeCase.rightOutputItemId);
    expect(findSlotWithItem(report, finalTick, "left-only-purifier", recipeCase.rightOutputItemId))
      .toMatchObject({ count: 1 });

    expect(rightTransferredItems).toContain(recipeCase.rightOutputItemId);
    expect(rightTransferredItems).not.toContain(recipeCase.leftOutputItemId);
    expect(findSlotWithItem(report, finalTick, "right-only-purifier", recipeCase.leftOutputItemId))
      .toMatchObject({ count: 1 });
    },
  );
});


function collectTransferredItemsFromDevice(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  deviceId: string,
): string[] {
  return report.ticks.flatMap((tick) =>
    tick.transfers
      .filter((transfer) => transfer.sourceSlotId.includes(`device:${deviceId}/`))
      .map((transfer) => transfer.itemType),
  );
}
