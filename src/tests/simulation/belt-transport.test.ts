import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getFirstTickAtSimulationMilliseconds, getDevice } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

function createBeltTransportBlueprint(): BlueprintDocument {
  return loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/belt-transport/scene-01-belt-transport-56e0e3f4.schema7.json");
}

describe.each(SIMULATION_ENGINE_MATRIX)("REQ-076: belt transport [%s]", (engineKind) => {
  it("covers layered reverse solving, split belt buffers, and belt dynamic recipes through a transport blueprint", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBeltTransportBlueprint(),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 2.5,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const twoSecondTick = getFirstTickAtSimulationMilliseconds(report, 2_000);
    const belt = getDevice(report, twoSecondTick.tickNumber, "belt");

    expect(zeroMillisecondTick.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:source-storage")
      && transfer.targetSlotId.includes("device:belt"),
    )).toBe(true);
    expect(twoSecondTick.transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: "item_iron_ore",
        amount: 1,
      }),
    ]));
    expect(twoSecondTick.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:source-storage")
      && transfer.targetSlotId.includes("device:belt"),
    )).toBe(true);
    expect(twoSecondTick.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:belt")
      && transfer.targetSlotId.includes("device:sink-storage"),
    )).toBe(true);
    expect(getDevice(report, twoSecondTick.tickNumber, "source-storage").slotItems).toHaveLength(6);
    expect(belt.slotItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storageGroupId: "item_buffer",
        slotId: "slot_1",
        viewRole: "input-view",
      }),
      expect.objectContaining({
        storageGroupId: "item_buffer",
        slotId: "slot_1",
        viewRole: "output-view",
      }),
    ]));
    expect(report.summary.transportComponentThroughput).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transportClass: "strict-belt",
        sourceEntityIds: ["belt"],
        itemAmounts: {
          item_iron_ore: expect.any(Number),
        },
      }),
    ]));
    expect(belt.channelRecipes["default"]?.recipeId).toBe("belt_straight_1x1:dynamic-belt-transfer");
  });
});
