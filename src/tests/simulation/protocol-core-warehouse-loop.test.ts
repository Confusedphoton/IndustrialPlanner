import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import type { RuntimeTransferSnapshot } from "@/simulation/contracts/types";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findSlot, getDevice, getTick } from "./blueprint-test-helpers";

const CORE_ID = "core";

const PROTOCOL_CORE_OUTPUTS = [
  {
    storageGroupId: "unbuffer_w2",
    storageGroupIndex: 0,
    receiverId: "recv_w2",
    receiverX: -1,
    receiverY: 1,
    receiverRotation: 180,
    itemId: "item_copper_ore",
  },
  {
    storageGroupId: "unbuffer_w5",
    storageGroupIndex: 1,
    receiverId: "recv_w5",
    receiverX: -1,
    receiverY: 4,
    receiverRotation: 180,
    itemId: "item_iron_ore",
  },
  {
    storageGroupId: "unbuffer_w8",
    storageGroupIndex: 2,
    receiverId: "recv_w8",
    receiverX: -1,
    receiverY: 7,
    receiverRotation: 180,
    itemId: "item_originium_ore",
  },
  {
    storageGroupId: "unbuffer_e2",
    storageGroupIndex: 3,
    receiverId: "recv_e2",
    receiverX: 9,
    receiverY: 1,
    receiverRotation: 0,
    itemId: "item_plant_moss_3",
  },
  {
    storageGroupId: "unbuffer_e5",
    storageGroupIndex: 4,
    receiverId: "recv_e5",
    receiverX: 9,
    receiverY: 4,
    receiverRotation: 0,
    itemId: "item_crystal_powder",
  },
  {
    storageGroupId: "unbuffer_e8",
    storageGroupIndex: 5,
    receiverId: "recv_e8",
    receiverX: 9,
    receiverY: 7,
    receiverRotation: 0,
    itemId: "item_proc_battery_4",
  },
] as const;


describe("protocol core warehouse links", () => {
  it("ships independently from every configured output", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/protocol-core-warehouse-loop/scene-01-protocol-core-all-outputs-b5fb41b2.schema7.json"),
      registry: createRegistryContract(),
      maxTickNumber: 1,
    });

    const tick1 = getTick(report, 1);
    for (const output of PROTOCOL_CORE_OUTPUTS) {
      expect(tick1.transfers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          itemType: output.itemId,
          amount: 1,
          sourceSlotId: expect.stringContaining(`device:${CORE_ID}/node:${output.storageGroupId}/slot:slot_1`),
          targetSlotId: expect.stringContaining(`device:${output.receiverId}`)
        }),
      ]));
    }
  });

  it("submits looped input cargo so the output keeps flowing", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/protocol-core-warehouse-loop/scene-02-protocol-core-e8-loop-to-s8-345041b5.schema7.json"),
      registry: createRegistryContract(),
      maxTickNumber: 320,
    });

    const warehouseTransfers = allTransfers(report).filter((transfer) =>
      transfer.itemType === "item_copper_ore"
      && transfer.targetSlotId.includes("/node:warehouse/slot:item_copper_ore"),
    );
    expect(warehouseTransfers.length).toBeGreaterThan(1);

    const finalInputSlot = findSlot(report, 320, CORE_ID, "inbuffer_s8", "slot_1");
    expect(finalInputSlot).toMatchObject({
      itemType: null,
      count: 0,
    });
  });

  it("sinks ordinary warehouse loader input directly into the warehouse", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/protocol-core-warehouse-loop/scene-03-warehouse-loader-sink-6fadc0f9.schema7.json"),
      registry: createRegistryContract(),
      maxTickNumber: 80,
    });

    const warehouseTransfers = allTransfers(report).filter((transfer) =>
      transfer.itemType === "item_plant_moss_3"
      && transfer.targetSlotId.includes("/node:warehouse/slot:item_plant_moss_3"),
    );
    expect(warehouseTransfers.length).toBeGreaterThan(0);

    const loaderSlots = getDevice(report, 80, "loader").slotItems;
    expect(loaderSlots.every((slot) => slot.itemType === null && slot.count === 0)).toBe(true);
  });
});


function allTransfers(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
): RuntimeTransferSnapshot[] {
  return report.ticks.flatMap((tick) => [...tick.transfers]);
}
