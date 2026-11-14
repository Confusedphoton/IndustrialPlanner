import { loadBlueprintVariantFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findFirstTick, findSlot, getDevice, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const RESOURCE_PUMP_CASES = [
  {
    definitionId: "water_pump_1",
    recipeId: "r_pump_water_basic",
    itemId: "item_liquid_water",
    storageGroupId: "fluid_output_buffer",
    slotId: "output_fluid_slot_1",
    durationSeconds: 1,
    requiresPower: true,
  },
  {
    definitionId: "water_pump_1",
    recipeId: "r_pump_acid_basic",
    itemId: "item_liquid_acid",
    storageGroupId: "fluid_output_buffer",
    slotId: "output_fluid_slot_1",
    durationSeconds: 1,
    requiresPower: true,
  },
  {
    definitionId: "gas_pump_1",
    recipeId: "r_gas_collector_inert_basic",
    itemId: "item_gas_inert",
    storageGroupId: "gas_output_buffer",
    slotId: "output_gas_slot_1",
    durationSeconds: 3,
    requiresPower: false,
  },
  {
    definitionId: "gas_pump_1",
    recipeId: "r_gas_collector_xiranite_basic",
    itemId: "item_gas_xiranite",
    storageGroupId: "gas_output_buffer",
    slotId: "output_gas_slot_1",
    durationSeconds: 3,
    requiresPower: false,
  },
] as const;

describe.each(SIMULATION_ENGINE_MATRIX)("resource pump production [%s]", (engineKind) => {
  it.each(RESOURCE_PUMP_CASES)(
    "$definitionId produces $itemId through $recipeId every $durationSeconds seconds",
    async (deviceCase) => {
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/resource-pump-production/index.json", "scene-01", { deviceCase }),
        maxDurationSeconds: deviceCase.durationSeconds * 2 + 1,
        engineKind,
        registry: createRegistryContract(),
      });

      expect(report.blueprint.slotLinkCount).toBe(0);
      expect(report.topology.diagnostics).toEqual([]);
      const started = findFirstTick(report, (tick) =>
        tick.devices.pump?.channelRecipes.default?.recipeId === deviceCase.recipeId
      );
      const completed = findFirstTick(report, (tick) =>
        tick.devices.pump?.slotItems.some((slot) =>
          slot.storageGroupId === deviceCase.storageGroupId
          && slot.slotId === deviceCase.slotId
          && slot.itemType === deviceCase.itemId
          && slot.count === 2
        ) === true
      );
      expect(getDevice(report, started.tickNumber, "pump").channelRecipes.default?.recipeId)
        .toBe(deviceCase.recipeId);
      expect(findSlot(
        report,
        completed.tickNumber,
        "pump",
        deviceCase.storageGroupId,
        deviceCase.slotId,
      )).toMatchObject({
        itemType: deviceCase.itemId,
        count: 2,
        ignoreStock: false,
      });
      expect(completed.elapsedSimulationSeconds - started.elapsedSimulationSeconds)
        .toBeCloseTo(deviceCase.durationSeconds * 2);
    },
  );

  it.each([
    ["water_pump_1", "fluid_output_buffer", "output_fluid_slot_1", true],
    ["gas_pump_1", "gas_output_buffer", "output_gas_slot_1", false],
  ] as const)(
    "%s remains idle until a recipe is selected",
    async (definitionId, storageGroupId, slotId, requiresPower) => {
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/resource-pump-production/index.json", "scene-02", { definitionId, requiresPower, slotId, storageGroupId }),
        maxDurationSeconds: 4,
        engineKind,
        registry: createRegistryContract(),
      });

      const finalTick = getLastTick(report).tickNumber;
      expect(getDevice(report, finalTick, "pump").channelRecipes.default ?? null)
        .toBeNull();
      expect(findSlot(
        report,
        finalTick,
        "pump",
        storageGroupId,
        slotId,
      )).toMatchObject({
        itemType: null,
        count: 0,
        ignoreStock: false,
      });
    },
  );
});
