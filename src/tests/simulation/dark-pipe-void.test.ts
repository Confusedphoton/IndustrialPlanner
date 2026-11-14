import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/contracts/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";
import { findSlot, getDevice } from "./blueprint-test-helpers";

describe("dark pipe warehouse ingress", () => {
  it("submits fluid from an unlinked single-port dark pipe inlet to the single-base warehouse", async () => {
    const finalTick = STANDARD_TICK_RATE_PER_SECOND;
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-01-single-dark-pipe-inlet-warehouse-e12525bf.schema7.json"),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, finalTick, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1")).toMatchObject({
      itemType: null,
      count: 0,
    });
    expect(listWarehouseIngressTransfers(report)).toEqual([
      expect.objectContaining({ itemType: "item_liquid_water", amount: 1 }),
    ]);
  });

  it("submits fluid from an unlinked multi-port dark pipe inlet to the single-base warehouse", async () => {
    const finalTick = STANDARD_TICK_RATE_PER_SECOND;
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-02-multi-dark-pipe-inlet-warehouse-60217eb6.schema7.json"),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, finalTick, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1")).toMatchObject({
      itemType: null,
      count: 0,
    });
    expect(listWarehouseIngressTransfers(report)).toEqual([
      expect.objectContaining({ itemType: "item_liquid_water", amount: 1 }),
    ]);
  });

  it("keeps dark pipe outlets empty by default when no warehouse item is selected", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-03-dark-pipe-outlet-default-empty-faa7ebc1.schema7.json"),
      maxTickNumber: STANDARD_TICK_RATE_PER_SECOND,
      registry: createRegistryContract(),
    });

    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "single-outlet", "unloader_buffer", "slot_1"))
      .toMatchObject({ itemType: null, count: 0 });
    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "multi-outlet", "unloader_buffer", "slot_1"))
      .toMatchObject({ itemType: null, count: 0 });
  });

  it("moves linked inlet fluid into the outlet through the transport channels", async () => {
    const finalTick = (2 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-04-linked-dark-pipe-inlet-manual-void-cc6d9123.schema7.json"),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, 1, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1").count).toBe(0);
    expect(findSlot(report, finalTick, "outlet", "unloader_buffer", "slot_1").count).toBe(4);
    expect(listWarehouseIngressTransfers(report)).toEqual([]);
  });

  it.each(SIMULATION_ENGINE_MATRIX)(
    "outputs liquid through a linked outlet when the inlet is chained to warehouse stock [%s]",
    async (engineKind) => {
      const finalTick = (3 * STANDARD_TICK_RATE_PER_SECOND) + 5;
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-05-linked-dark-pipe-inlet-warehouse-source-853d73d7.schema7.json"),
        maxTickNumber: finalTick,
        engineKind,
        registry: createRegistryContract(),
      });

      expect(findSlot(report, finalTick, "sink", "loader_buffer", "slot_1")).toMatchObject({
        itemType: null,
        count: 0,
      });
      expect(listWarehouseIngressTransfers(report).some((transfer) =>
        transfer.itemType === "item_liquid_sewage",
      )).toBe(true);
    },
  );
});

function listWarehouseIngressTransfers(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
) {
  return report.ticks.flatMap((tick) => tick.transfers).filter((transfer) =>
    transfer.targetSlotId.includes("/node:warehouse/slot:"),
  );
}
