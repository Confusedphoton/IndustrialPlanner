import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findSlot, getTick } from "./blueprint-test-helpers";

describe("REQ-076: config overrides", () => {
  it("runs a self-contained blueprint and applies slot plus port config overrides", async () => {
    const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/config-override/scene-01-config-overrides-a6643d0e.schema7.json");

    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxTickNumber: 60,
    });

    expect(report.blueprint).toMatchObject({
      name: "config-overrides",
      baseId: "wuling_protocol_core",
      entityCount: 3,
      slotLinkCount: 0,
    });
    expect(report.topology.topologyId.length).toBeGreaterThan(0);

    // Tick 0: source 持有 7 个铁矿石
    expect(findSlot(report, 0, "source-storage", "storage_slot_1", "slot_1"))
      .toMatchObject({
        itemType: "item_iron_ore",
        count: 7,
      });

    // Tick 1: 物品从 source 传输到 belt（belt buffer 容量为 1，仅接纳 1 个）
    const tick1 = getTick(report, 1);
    expect(tick1.transfers.some((t) =>
      t.sourceSlotId.includes("device:source-storage")
      && t.targetSlotId.includes("device:belt"),
    )).toBe(true);

    // Tick 41: belt 配方完成，物品进入 sink
    const tick41 = getTick(report, 41);
    expect(tick41.transfers.some((t) =>
      t.sourceSlotId.includes("device:belt")
      && t.targetSlotId.includes("device:sink-storage"),
    )).toBe(true);

    // 验证 slot config 覆盖后的输送结果；port count 覆盖已移至 admission-rule 测试。
    expect(findSlot(report, 41, "sink-storage", "storage_slot_1", "slot_1"))
      .toMatchObject({
        itemType: "item_iron_ore",
        count: 1,
      });
  });
});
