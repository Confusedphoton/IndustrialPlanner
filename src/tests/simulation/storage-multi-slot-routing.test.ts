import { loadBlueprintVariantFromFile, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findSlot } from "./blueprint-test-helpers";

const FINAL_TICK = 260;
const SINK_STORAGE_ID = "sink-storage";
const STORAGE_FILL_OBSERVE_TICK = 2000;
const OBSERVE_STORAGE_ID = "observe-storage";
const OTHER_STORAGE_ID = "other-storage";

describe("协议存储箱多槽入库路由", () => {
  it("直连严格传送带时应从 1、2 槽接收两种物品", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createTwoItemSinkBlueprint({
        finalHopDefinitionId: "belt_straight_1x1",
        finalHopRotation: 270
      }),
      registry: createRegistryContract(),
      maxTickNumber: FINAL_TICK,
    });

    expectFirstTwoSlotsToContainBothItems(report);
  });

  it("相邻分流器时应从 1、2 槽接收两种物品", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createTwoItemSinkBlueprint({
        finalHopDefinitionId: "log_splitter",
        finalHopRotation: 180
      }),
      registry: createRegistryContract(),
      maxTickNumber: FINAL_TICK,
    });

    expectFirstTwoSlotsToContainBothItems(report);
  });
});

describe("存储箱满槽观察测试", () => {
  it("当任意其他存储箱至少 2 个槽位有物品时，观察对象存储箱应至少 1 个槽位有物品", async () => {
    const blueprint = createStorageFillObserveBlueprint();
    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxTickNumber: STORAGE_FILL_OBSERVE_TICK,
    });

    const storagerIds = [OBSERVE_STORAGE_ID, OTHER_STORAGE_ID];
    const violations: string[] = [];
    let maxOtherFilledSlots = 0;

    for (const tick of report.ticks) {
      const observeFilled = countFilledSlots(report, tick.tickNumber, OBSERVE_STORAGE_ID);
      const otherFilled = Math.max(
        0,
        ...storagerIds
          .filter((id) => id !== OBSERVE_STORAGE_ID)
          .map((id) => countFilledSlots(report, tick.tickNumber, id)),
      );

      maxOtherFilledSlots = Math.max(maxOtherFilledSlots, otherFilled);
      if (otherFilled >= 2 && observeFilled < 1) {
        violations.push(
          `tick ${tick.tickNumber}: ${OTHER_STORAGE_ID} 有 ${otherFilled} 个槽位有物品，但 ${OBSERVE_STORAGE_ID} 只有 ${observeFilled} 个`,
        );
      }
    }

    expect(maxOtherFilledSlots).toBeGreaterThanOrEqual(2);
    expect(violations).toHaveLength(0);
  });
});

function createTwoItemSinkBlueprint(options: {
  readonly finalHopDefinitionId: "belt_straight_1x1" | "log_splitter";
  readonly finalHopRotation: WorldEntity["rotation"];
}): BlueprintDocument {
  return loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/storage-multi-slot-routing/index.json", "scene-01", { options });
}

function createStorageFillObserveBlueprint(): BlueprintDocument {
  return loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/storage-multi-slot-routing/scene-02-storage-fill-observe-6fec1489.schema7.json");
}



function expectFirstTwoSlotsToContainBothItems(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
): void {
  const firstSlot = findSlot(report, FINAL_TICK, SINK_STORAGE_ID, "storage_slot_1", "slot_1");
  const secondSlot = findSlot(report, FINAL_TICK, SINK_STORAGE_ID, "storage_slot_2", "slot_1");

  expect(firstSlot.count).toBeGreaterThan(0);
  expect(secondSlot.count).toBeGreaterThan(0);
  expect([firstSlot.itemType, secondSlot.itemType].sort()).toEqual([
    "item_iron_ore",
    "item_originium_ore",
  ]);
}

function countFilledSlots(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  tickNumber: number,
  deviceId: string,
): number {
  return report.ticks
    .find((tick) => tick.tickNumber === tickNumber)
    ?.devices[deviceId]
    ?.slotItems
    .filter((slot) => slot.count > 0)
    .length ?? 0;
}
