import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findFirstTick, getDevice } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const CHRONO_RECIPE_ID =
  "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic_large";
const LIQUID_XIRANITE_RECIPE_ID =
  "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large";

describe.each(SIMULATION_ENGINE_MATRIX)("反应池 Recipe Channel 模式 [%s]", (engineKind) => {
  it("keeps old entities and blueprints manual when the mode config is absent", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/scene-01-legacy-reactor-manual-mode-82b00369.schema7.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry: createRegistryContract(),
    });

    const runningTick = findFirstTick(report, (tick) =>
      readRunningRecipeIds(tick.devices.reactor?.channelRecipes ?? {}).length > 0
    );
    const runningRecipes = readRunningRecipeIds(
      getDevice(report, runningTick.tickNumber, "reactor").channelRecipes,
    );
    expect(runningRecipes).toEqual([LIQUID_XIRANITE_RECIPE_ID]);
  });

  it("starts every satisfiable distinct recipe in automatic mode", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/scene-02-reactor-automatic-distinct-recipes-980d786d.schema7.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry: createRegistryContract(),
    });

    const runningTick = findFirstTick(report, (tick) =>
      readRunningRecipeIds(tick.devices.reactor?.channelRecipes ?? {}).length > 0
    );
    const runningRecipes = readRunningRecipeIds(
      getDevice(report, runningTick.tickNumber, "reactor").channelRecipes,
    );
    expect(new Set(runningRecipes)).toEqual(new Set([
      CHRONO_RECIPE_ID,
      LIQUID_XIRANITE_RECIPE_ID,
    ]));
    expect(runningRecipes).toHaveLength(2);
  });

  it("does not run one automatic recipe on multiple channels", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/scene-03-reactor-automatic-no-duplicate-recipe-95b28f14.schema7.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry: createRegistryContract(),
    });

    const runningTick = findFirstTick(report, (tick) =>
      readRunningRecipeIds(tick.devices.reactor?.channelRecipes ?? {}).length > 0
    );
    expect(readRunningRecipeIds(getDevice(report, runningTick.tickNumber, "reactor").channelRecipes))
      .toEqual([LIQUID_XIRANITE_RECIPE_ID]);
  });
});


function readRunningRecipeIds(
  channelRecipes: ReturnType<typeof getDevice>["channelRecipes"],
): string[] {
  return Object.values(channelRecipes)
    .flatMap((recipe) => recipe?.recipeId === null || recipe?.recipeId === undefined
      ? []
      : [recipe.recipeId])
    .sort();
}
