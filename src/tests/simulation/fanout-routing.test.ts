import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findSlotWithItem, getTick } from "./blueprint-test-helpers";

describe("REQ-076: fanout routing", () => {
  it("routes around blocked fan-out inputs instead of starving open downstream capacity", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/fanout-routing/scene-01-blocked-fanout-652e2252.schema7.json"),
      registry: createRegistryContract(),
      maxTickNumber: 150,
    });

    // 验证 topology 编译成功
    expect(report.topology.topologyId.length).toBeGreaterThan(0);

    // 物品经过 3 段物流 (belt→splitter→belt-open) 各 40 tick，在 tick 121 到达 open-storage。
    // open-storage 在 (0,-4), belt-open 在 (0,-2)，belt-open→open-storage 还需经过 (0,-3) 的空隙。
    // 验证 blocked-storage 全程未收到物品。
    const allTransfers = report.ticks.flatMap((tick) => tick.transfers);
    const hasBlockedTransfer = allTransfers.some((transfer) =>
      transfer.targetSlotId.includes("device:blocked-storage"),
    );
    expect(hasBlockedTransfer).toBe(false);

    // 物品应最终在 open-storage 中（splitter→belt-open 在 tick 81，belt-open→open-storage 在 tick 121）
    const tick121 = getTick(report, 121);
    expect(tick121.transfers.some((transfer) =>
      transfer.targetSlotId.includes("device:open-storage"),
    )).toBe(true);

    expect(findSlotWithItem(report, 121, "open-storage", "item_iron_ore"))
      .toMatchObject({
        storageGroupId: "storage_slot_1",
        itemType: "item_iron_ore",
        count: 1,
      });
  });
});
