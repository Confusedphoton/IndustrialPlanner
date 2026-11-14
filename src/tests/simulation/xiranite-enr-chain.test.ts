import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getDevice, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

// 重息壤产线验证：水泵 + 暗管(水/污水) → 混合池B(息壤+水→液化息壤)
// → 混合池C(液化息壤+污水→废液) → 希壤炉(息壤+废液→重息壤)
// 本测试通过 initialItemType 预种流体，跳过管道布线，聚焦配方链正确性。

describe.each(SIMULATION_ENGINE_MATRIX)("重息壤产线配方链验证 [%s]", (engineKind) => {
  const MAX_DURATION_SECONDS = 30;

  it("步骤1: 混合池 — 息壤+水→液化息壤", { timeout: 300_000 }, async () => {
    const registry = createRegistryContract();
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/xiranite-enr-chain/scene-01-step1-xiranite-liquid-b9e91d12.schema7.json"),
      maxDurationSeconds: MAX_DURATION_SECONDS,
      engineKind,
      registry,
    });

    // 30秒后验证：息壤+水→液化息壤 (immediate-consume, 2s/次)
    // immediate-consume 配方在 progress=0% 立即消耗原料，产物写入同一 buffer 的空槽
    const slotItems = getDevice(report, getLastTick(report).tickNumber, "pool").slotItems;
    console.log("[step1] 30s 槽位:", JSON.stringify(slotItems));

    const liquidXiraniteSlot = slotItems.find(s => s.itemType === "item_liquid_xiranite");

    expect(liquidXiraniteSlot, "应有液化息壤产出").toBeDefined();
    expect(liquidXiraniteSlot!.count, "液化息壤数量应>0").toBeGreaterThan(0);
    // 10 息壤 + 10 水 → 应产出 10 液化息壤
    expect(liquidXiraniteSlot!.count, "2s/次 × 30s = ~15次，但原料各10 ≈ 10个产出").toBe(10);
  });

  it("步骤2: 混合池 — 液化息壤+污水→废液+低聚废液", { timeout: 300_000 }, async () => {
    const registry = createRegistryContract();
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/xiranite-enr-chain/scene-02-step2-waste-liquid-dfe9142a.schema7.json"),
      maxDurationSeconds: MAX_DURATION_SECONDS,
      engineKind,
      registry,
    });

    // immediate-consume: 原料立即消耗，产物写入空槽
    const slotItems = getDevice(report, getLastTick(report).tickNumber, "pool").slotItems;
    console.log("[step2] 30s 槽位:", JSON.stringify(slotItems));

    const polySlot = slotItems.find(s => s.itemType === "item_liquid_xiranite_poly");
    const lowpolySlot = slotItems.find(s => s.itemType === "item_liquid_xiranite_lowpoly");

    expect(polySlot, "应有废液(liquid_xiranite_poly)产出").toBeDefined();
    expect(polySlot!.count, "废液数量应>0").toBeGreaterThan(0);
    expect(polySlot!.count, "10液化息壤+10污水 → 10废液").toBe(10);
    expect(lowpolySlot, "应有低聚废液产出").toBeDefined();
    expect(lowpolySlot!.count, "低聚废液数量应>0").toBeGreaterThan(0);
    expect(lowpolySlot!.count, "联产也是10").toBe(10);
  });

  it("步骤3: 希壤炉 — 息壤+废液→重息壤", { timeout: 300_000 }, async () => {
    const registry = createRegistryContract();
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/xiranite-enr-chain/scene-03-step3-xiranite-enr-149d8711.schema7.json"),
      maxDurationSeconds: MAX_DURATION_SECONDS,
      engineKind,
      registry,
    });

    const slotItems = getDevice(report, getLastTick(report).tickNumber, "oven").slotItems;
    console.log("[step3] 30s 槽位:", JSON.stringify(slotItems));

    const enrSlot = slotItems.find(s => s.itemType === "item_xiranite_enr_powder");

    expect(enrSlot, "应有重息壤(xiranite_enr_powder)产出").toBeDefined();
    expect(enrSlot!.count, "重息壤数量应>0").toBeGreaterThan(0);
  });
});
