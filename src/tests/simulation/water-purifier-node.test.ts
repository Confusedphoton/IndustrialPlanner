import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { WATER_PURIFIER_OUTPUT_ITEM_ID, WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID, WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID } from "@/shared/water-purifier-node";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findFirstTick, findSlot, getDevice, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";


describe.each(SIMULATION_ENGINE_MATRIX)("净水节点 runtime [%s]", (engineKind) => {
  it("input-derived mode immediately frees all three 2-drop input slots and later stores sewage in the 500 buffer", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/water-purifier-node/scene-01-water-purifier-node-input-derived-2dfe453b.schema7.json"),
      maxDurationSeconds: 2,
      engineKind,
      registry: createRegistryContract(),
    });

    const intakeStarted = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.channelRecipes.intake_1?.recipeId
        === "r_water_purifier_node_collect_sewage_basic"
    );
    const sewageCollected = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.slotItems.some((slot) =>
        slot.storageGroupId === WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID
        && slot.slotId === "slot_1"
        && slot.itemType === "item_liquid_sewage"
        && slot.count === 6
      ) === true
    );
    expect(getDevice(report, intakeStarted.tickNumber, "water-node").channelRecipes).toMatchObject({
      intake_1: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
      intake_2: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
      intake_3: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
    });
    expect(findSlot(report, intakeStarted.tickNumber, "water-node", "input_buffer_1", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, intakeStarted.tickNumber, "water-node", "input_buffer_2", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, intakeStarted.tickNumber, "water-node", "input_buffer_3", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, sewageCollected.tickNumber, "water-node", WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: "item_liquid_sewage",
        count: 6,
      });
    expect(sewageCollected.elapsedSimulationSeconds - intakeStarted.elapsedSimulationSeconds)
      .toBeCloseTo(1);
  });

  it("converts 30 sewage in the internal buffer to 1 xiranite waste liquid", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/water-purifier-node/scene-02-water-purifier-node-byproduct-9df3881d.schema7.json"),
      maxDurationSeconds: 2,
      engineKind,
      registry: createRegistryContract(),
    });

    const outputProduced = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.slotItems.some((slot) =>
        slot.storageGroupId === WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID
        && slot.slotId === "slot_1"
        && slot.itemType === WATER_PURIFIER_OUTPUT_ITEM_ID
        && slot.count === 1
      ) === true
    );
    expect(findSlot(report, outputProduced.tickNumber, "water-node", WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: WATER_PURIFIER_OUTPUT_ITEM_ID,
        count: 1,
      });
  });

  it("manual mode produces the configured per-minute output without sewage input", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/water-purifier-node/scene-03-water-purifier-node-manual-output-c36647a8.schema7.json"),
      maxDurationSeconds: 2,
      engineKind,
      registry: createRegistryContract(),
    });

    const outputProduced = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.slotItems.some((slot) =>
        slot.storageGroupId === WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID
        && slot.slotId === "slot_1"
        && slot.itemType === WATER_PURIFIER_OUTPUT_ITEM_ID
        && slot.count === 1
      ) === true
    );
    expect(findSlot(report, outputProduced.tickNumber, "water-node", WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: WATER_PURIFIER_OUTPUT_ITEM_ID,
        count: 1,
      });
  });

  it("manual mode keeps sewage intake running but disables automatic byproduct output", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/water-purifier-node/scene-04-water-purifier-node-manual-disables-input-293b656a.schema7.json"),
      maxDurationSeconds: 1,
      engineKind,
      registry: createRegistryContract(),
    });

    const intakeStarted = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.channelRecipes.intake_1?.recipeId
        === "r_water_purifier_node_collect_sewage_basic"
    );
    const finalTick = getLastTick(report).tickNumber;
    expect(getDevice(report, intakeStarted.tickNumber, "water-node").channelRecipes).toMatchObject({
      intake_1: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
    });
    expect(getDevice(report, finalTick, "water-node").channelRecipes).not.toHaveProperty("byproduct");
    expect(findSlot(report, intakeStarted.tickNumber, "water-node", "input_buffer_1", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, finalTick, "water-node", WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID, "slot_1")).toMatchObject({
      itemType: "item_liquid_sewage",
      count: 30,
    });
  });
});

