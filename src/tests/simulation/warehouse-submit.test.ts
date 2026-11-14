import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/contracts/tick-rate";
import { getDevice, type DeviceSlotItem } from "./blueprint-test-helpers";

const MAX_TICK = 120 * STANDARD_TICK_RATE_PER_SECOND;

describe("协议储存箱仓库提交", () => {
  it("选配方后每 10 秒提交到仓库", { timeout: 300_000 }, async () => {
    const bp = loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/warehouse-submit/scene-01-wh-submit-9ea2b8b7.schema7.json");
    const report = await runBlueprintSimulation({ blueprint: bp, maxTickNumber: MAX_TICK, registry: createRegistryContract() });

    const perSecond: number[] = [];
    for (let t = 0; t <= MAX_TICK; t += STANDARD_TICK_RATE_PER_SECOND) {
      perSecond.push(sumSlot(getDevice(report, t, "storager").slotItems));
    }

    // 提交后物品回升不超过 10
    let above10 = false;
    for (let i = 12; i < perSecond.length; i++) {
      if (perSecond[i]! > 10) above10 = true;
    }
    expect(above10, "提交后物品数不应超过 10").toBe(false);
    // 物品确实有在流动
    expect(perSecond[perSecond.length - 1]!, "最后物品数应 > 0").toBeGreaterThan(0);
  });

  it("未选配方时物品留在箱内", { timeout: 300_000 }, async () => {
    const bp = loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/warehouse-submit/scene-02-wh-off-1f553461.schema7.json");
    const report = await runBlueprintSimulation({ blueprint: bp, maxTickNumber: MAX_TICK, registry: createRegistryContract() });
    const items = sumSlot(getDevice(report, MAX_TICK, "storager").slotItems);
    console.log(`[wh-off] 未选配，120s 后物品数: ${items}`);
    expect(items, "未选配时物品应积累 > 10").toBeGreaterThan(10);
  });
});

function sumSlot(slots: readonly DeviceSlotItem[]) { return slots.reduce((s, sl) => s + sl.count, 0); }
