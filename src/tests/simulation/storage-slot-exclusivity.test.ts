import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getDevice } from "./blueprint-test-helpers";

/**
 * 回归测试：槽位组内互斥规则（§3.4）
 *
 * 规则：同一存储槽组内不同槽不可容纳相同物品。
 * Bug 背景：findInputSlotForItem 曾因"先判容量、后判类型"的顺序错误，
 * 导致满容槽位被跳过、配方产物流入另一空槽，违反互斥规则。
 *
 * 修复：类型匹配优先 → 匹配成功但满容 → 立即返回 null（不另找空槽）。
 */
describe("存储槽位组内互斥规则", () => {
  // 扩容反应池配方 2s = 40 ticks，需要至少 80 ticks 跑两轮验证行为
  const TICK_COUNT = 100;

  it("扩容反应池 — 同一液体满容时配方产出不会溢出到其他空槽", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/storage-slot-exclusivity/scene-01-slot-exclusivity-overflow-7fbac9a2.schema7.json"),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    const reactorTick = getDevice(report, TICK_COUNT, "reactor");
    expect(reactorTick).toBeDefined();

    // 关键断言：只应有一个槽位持有 item_liquid_xiranite
    const liquidXiraniteSlots = reactorTick.slotItems.filter(
      (s) => s.itemType === "item_liquid_xiranite",
    );
    expect(
      liquidXiraniteSlots.length,
      "同一液体不应出现在多个槽位中（组内互斥规则）",
    ).toBeLessThanOrEqual(1);

    // 满容槽位不应被新产出"追加"
    const liquidXiraniteSlot = liquidXiraniteSlots[0];
    if (liquidXiraniteSlot) {
      expect(
        liquidXiraniteSlot.count,
        "满容槽位数量不应超过初始值 50",
      ).toBeLessThanOrEqual(50);
    }
  });

  it("扩容反应池 — 配方输入完成、产物满容阻塞", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/storage-slot-exclusivity/scene-02-slot-exclusivity-block-74fbe269.schema7.json"),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    // 满容后配方应阻塞 — 阻塞清理可能已触发，验证相同液体没有溢出到空槽
    const reactorTick = getDevice(report, TICK_COUNT, "reactor");
    const liquidXiraniteSlots = reactorTick.slotItems.filter(
      (s) => s.itemType === "item_liquid_xiranite",
    );
    expect(
      liquidXiraniteSlots.length,
      "满容阻塞不应导致同一液体溢出到其他空槽",
    ).toBeLessThanOrEqual(1);
  });

  it("扩容反应池 — 有空余容量时正常追加到已有槽位（不退化为空槽）", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/storage-slot-exclusivity/scene-03-slot-exclusivity-normal-96579b85.schema7.json"),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    const reactorTick = getDevice(report, TICK_COUNT, "reactor");

    // 不应出现两个 liquid_xiranite 槽位
    const liquidXiraniteSlots = reactorTick.slotItems.filter(
      (s) => s.itemType === "item_liquid_xiranite",
    );
    expect(
      liquidXiraniteSlots.length,
      "同一液体不应出现在多个槽位中",
    ).toBeLessThanOrEqual(1);

    // 应有产出增加
    const liquidXiraniteSlot = liquidXiraniteSlots[0];
    if (liquidXiraniteSlot) {
      expect(
        liquidXiraniteSlot.count,
        "液化息壤数量应在 10 基础上增加",
      ).toBeGreaterThan(10);
    }
  });

  it("普通反应池 — 同一液体满容时不会溢出到其他空槽", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/storage-slot-exclusivity/scene-04-slot-exclusivity-mix-pool-1-d293e525.schema7.json"),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    const poolTick = getDevice(report, TICK_COUNT, "pool");

    const liquidXiraniteSlots = poolTick.slotItems.filter(
      (s) => s.itemType === "item_liquid_xiranite",
    );
    expect(
      liquidXiraniteSlots.length,
      "普通反应池：同一液体不应出现在多个槽位中",
    ).toBeLessThanOrEqual(1);
  });
});
