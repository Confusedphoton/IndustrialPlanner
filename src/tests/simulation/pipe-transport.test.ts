import { loadBlueprintVariantFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getFirstTickAtSimulationMilliseconds, getDevice } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

function createLiquidPipeTransportBlueprint(initialCount = 2): BlueprintDocument {
  return loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/pipe-transport/index.json", "scene-01", { initialCount });
}

describe.each(SIMULATION_ENGINE_MATRIX)("REQ-076: pipe transport [%s]", (engineKind) => {
  // 时序：tick 1 入管 1 件 → tick 11 出管 1 件 + 入管第 2 件 → tick 21 出管第 2 件。
  it("covers pipe transport components and pipe dynamic recipes through a liquid blueprint", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createLiquidPipeTransportBlueprint(),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 1.5,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    const oneSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_000);
    const pipe = getDevice(report, zeroMillisecondTick.tickNumber, "pipe");

    // tick 1: 第 1 件进入管道
    expect(zeroMillisecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toHaveLength(1);
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toHaveLength(1);
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toHaveLength(1);
    // tick 21: 第 2 件出管到 sink
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toHaveLength(1);
    expect(pipe.slotItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storageGroupId: "synthetic-input",
        slotId: "slot_1",
        viewRole: "single-view",
        count: 1,
        reserved: 1,
      }),
      expect.objectContaining({
        storageGroupId: "synthetic-output",
        slotId: "slot_1",
        viewRole: "single-view",
      }),
    ]));
    expect(report.summary.transportComponentThroughput).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transportClass: "strict-pipe",
        sourceEntityIds: ["pipe"],
        itemAmounts: {
          item_liquid_water: expect.any(Number),
        },
      }),
    ]));
    expect(pipe.channelRecipes["default"]?.recipeId).toBe("pipe_straight_1x1:dynamic-pipe-transfer");
  });

  it("transports a single fluid item through the pipe in 0.5s ticks", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createLiquidPipeTransportBlueprint(1),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 1,
    });

    // tick 1: 入管
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    expect(zeroMillisecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toHaveLength(1);
    // tick 11: 出管到 sink
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toHaveLength(1);
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "pipe").channelRecipes["default"]?.recipeId)
      .toBe("pipe_straight_1x1:dynamic-pipe-transfer");
  });
});

