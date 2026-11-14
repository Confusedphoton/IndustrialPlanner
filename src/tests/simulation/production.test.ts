import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findFirstTick, findSlot, getDevice } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

describe.each(SIMULATION_ENGINE_MATRIX)("REQ-076: production [%s]", (engineKind) => {
  it("projects production runtime status and final inventory from recipe blueprints", async () => {
    const registry = createRegistryContract();
    const grinderReport = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/production/scene-01-grinder-production-435fad2a.schema7.json"),
      maxDurationSeconds: 3,
      engineKind,
      registry,
    });
    const furnaceReport = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/production/scene-02-furnace-production-8321f8a2.schema7.json"),
      maxDurationSeconds: 3,
      engineKind,
      registry,
    });

    const grinderStarted = findFirstTick(grinderReport, (tick) =>
      tick.devices.grinder?.channelRecipes.default?.recipeId
        === "r_crusher_iron_powder_from_iron_nugget_basic"
    );
    const grinderCompleted = findFirstTick(grinderReport, (tick) =>
      tick.devices.grinder?.slotItems.some((slot) =>
        slot.storageGroupId === "item_output_buffer"
        && slot.slotId === "output_slot_1"
        && slot.itemType === "item_iron_powder"
        && slot.count === 1
      ) === true
    );
    expect(getDevice(grinderReport, grinderStarted.tickNumber, "grinder").channelRecipes["default"]).toMatchObject({
      recipeId: "r_crusher_iron_powder_from_iron_nugget_basic",
      progressSeconds: 0,
      desiredSeconds: 2,
    });
    expect(findSlot(grinderReport, grinderCompleted.tickNumber, "grinder", "item_output_buffer", "output_slot_1"))
      .toMatchObject({
        itemType: "item_iron_powder",
        count: 1,
      });
    expect(grinderCompleted.elapsedSimulationSeconds - grinderStarted.elapsedSimulationSeconds)
      .toBeCloseTo(2);

    const furnaceStarted = findFirstTick(furnaceReport, (tick) =>
      tick.devices.furnace?.channelRecipes.default?.recipeId
        === "r_furnace_iron_nugget_from_iron_ore_basic"
    );
    const furnaceCompleted = findFirstTick(furnaceReport, (tick) =>
      tick.devices.furnace?.slotItems.some((slot) =>
        slot.storageGroupId === "item_output_buffer"
        && slot.slotId === "output_item_slot_1"
        && slot.itemType === "item_iron_nugget"
        && slot.count === 1
      ) === true
    );
    expect(getDevice(furnaceReport, furnaceStarted.tickNumber, "furnace").channelRecipes["default"]).toMatchObject({
      recipeId: "r_furnace_iron_nugget_from_iron_ore_basic",
      progressSeconds: 0,
      desiredSeconds: 2,
    });
    expect(findSlot(furnaceReport, furnaceCompleted.tickNumber, "furnace", "item_output_buffer", "output_item_slot_1"))
      .toMatchObject({
        itemType: "item_iron_nugget",
        count: 1,
      });
    expect(furnaceCompleted.elapsedSimulationSeconds - furnaceStarted.elapsedSimulationSeconds)
      .toBeCloseTo(2);
  });

  it("treats ignoreStock recipe inputs as infinite even when their actual count is zero", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/production/scene-03-infinite-gas-purifier-inputs-afaf693e.schema7.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry: createRegistryContract(),
    });

    const runningTick = findFirstTick(report, (tick) =>
      tick.devices.purifier?.channelRecipes.default?.recipeId
        === "liquid_purifier_gas_copper_enr_1"
    );
    expect(getDevice(report, runningTick.tickNumber, "purifier").channelRecipes["default"]).toMatchObject({
      recipeId: "liquid_purifier_gas_copper_enr_1",
      state: "running",
    });
    expect(findSlot(report, runningTick.tickNumber, "purifier", "gas_input_buffer", "input_gas_slot_1"))
      .toMatchObject({
        itemType: "item_gas_copper",
        count: 0,
        ignoreStock: true,
      });
    expect(findSlot(report, runningTick.tickNumber, "purifier", "item_input_buffer", "input_item_slot_1"))
      .toMatchObject({
        itemType: "item_filter_core",
        count: 0,
        ignoreStock: true,
      });
  });
});
