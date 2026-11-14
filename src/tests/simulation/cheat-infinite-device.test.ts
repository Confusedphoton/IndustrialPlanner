import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findFirstTick, findSlot, getDevice, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const DEVICE_CASES = [
  {
    entityId: "solid",
    definitionId: "cheat_infinite_solid",
    itemId: "item_iron_ore",
    recipeId: "r_cheat_infinite_solid_void_any_internal",
  },
  {
    entityId: "liquid",
    definitionId: "cheat_infinite_liquid",
    itemId: "item_liquid_water",
    recipeId: "r_cheat_infinite_liquid_void_any_internal",
  },
  {
    entityId: "gas",
    definitionId: "cheat_infinite_gas",
    itemId: "item_gas_inert",
    recipeId: "r_cheat_infinite_gas_void_any_internal",
  },
] as const;

const DESTROY_BUFFER_IDS = [
  "destroy_buffer",
  "destroy_buffer_e",
  "destroy_buffer_s",
  "destroy_buffer_w",
] as const;

describe.each(SIMULATION_ENGINE_MATRIX)("cheat infinite device simulation [%s]", (engineKind) => {
  it("destroys four isolated strict-domain inputs in parallel while retaining a 50-item infinite output slot", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/cheat-infinite-device/scene-01-cheat-infinite-device-34fe6490.schema7.json"),
      maxDurationSeconds: 3,
      engineKind,
      registry: createRegistryContract(),
    });

    const finalTick = getLastTick(report).tickNumber;
    for (const deviceCase of DEVICE_CASES) {
      const started = findFirstTick(report, (tick) =>
        Object.values(tick.devices[deviceCase.entityId]?.channelRecipes ?? {})
          .some((recipe) => recipe?.recipeId === deviceCase.recipeId)
      );
      for (const channelId of ["void_1", "void_2", "void_3", "void_4"]) {
        expect(getDevice(report, started.tickNumber, deviceCase.entityId).channelRecipes[channelId]?.recipeId)
          .toBe(deviceCase.recipeId);
      }
      for (const bufferId of DESTROY_BUFFER_IDS) {
        expect(findSlot(
          report,
          finalTick,
          deviceCase.entityId,
          bufferId,
          "destroy_slot_1",
        ).count).toBe(0);
      }
      expect(findSlot(
        report,
        finalTick,
        deviceCase.entityId,
        "infinite_output_buffer",
        "infinite_output_slot_1",
      )).toMatchObject({
        itemType: deviceCase.itemId,
        count: 50,
        ignoreStock: true,
      });
    }
  });
});
