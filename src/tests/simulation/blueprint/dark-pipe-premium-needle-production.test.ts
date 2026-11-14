import { loadBlueprintFromFile } from "../blueprint-test-helpers";
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import {
  BLUEPRINT_SIMULATION_ENGINE_KINDS,
  runBlueprintSimulation,
} from "../blueprint-runner";

// ============================================================
// 暗管芽针针剂 — 完整产线产出验证
// ============================================================
// 目标产物: 优质芽针针剂 (item_bottled_rec_hp_5)
// 配方: r_packaging_bottled_rec_hp_5_from_copper_cmpt_and_copper_bottle_filled_grass_2_basic
// 配方时间: 10秒 → 6个/分钟
// 生产设备: item_port_tools_asm_mc_1 (高级制造台)
//
// 测试场景:
//   1. 加载系统蓝图「全暗管优质芽针针剂」
//   2. 补充辅助设备（供水泵、物流总线、熔炉、传送带、管道等外围设施）
//   3. 建立暗管链接（3对 inlet↔outlet）
//   4. 预热2分钟后，滑动窗口统计产出速率
//
// 系统蓝图中的暗管端点实体（legacy ID 固定）：
//   legacy_d8591492_0009 → udpipe_unloader (outlet)
//   legacy_d8591492_0057 → udpipe_loader  (inlet)
//   legacy_d8591492_0103 → udpipe_unloader (outlet)
//
// 辅助设备中补充的暗管端点（通过 loadBlueprintWithExtras 注入后变为 test-extra-N）：
//   test-extra-3  → udpipe_loader  @ (-6,-4)  inlet
//   test-extra-6  → udpipe_loader  @ (-6,-7)  inlet
//   test-extra-13 → udpipe_unloader @ (0,20)  outlet
//
// 3 对暗管链接（outlet → inlet）：
//   test-extra-13 → legacy_d8591492_0057
//   legacy_d8591492_0009 → test-extra-6
//   legacy_d8591492_0103 → test-extra-3
//
// 6 条仓库链接（unloader_buffer → warehouse）：
//   legacy_d8591492_0001..0004 → warehouse:item_copper_ore（铜矿输入）
//   legacy_d8591492_0009 → warehouse:item_liquid_water（水输入）
//   legacy_d8591492_0103 → warehouse:item_liquid_water（水输入）
// ============================================================

const TARGET_ITEM = "item_bottled_rec_hp_5";
const STORAGER_ID = "legacy_d8591492_0104";
const WARMUP_SECONDS = 120; // 2 分钟预热
const WINDOW_SECONDS = 60; // 1 分钟窗口（20 tick/s × 60s）
const OBSERVATION_SECONDS = 120; // 预热后观察 2 分钟
const WINDOW_STEP_SECONDS = 5;   // 窗口滑动步长
const TARGET_PER_WINDOW = 6;


/** 22 个辅助设备，提取自 .temp/testcase.json */

describe.each(BLUEPRINT_SIMULATION_ENGINE_KINDS)("暗管芽针针剂完整产线 [%s]", (engineKind) => {
  it(
    "预热2分钟后，1分钟滑动窗口产出 >= 6个优质芽针针剂，持续2分钟",
    { timeout: 600_000 },
    async () => {
      const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/production/dark-pipe-premium-needle-production.schema7.json");


      // 3. 运行仿真
      const report = await runBlueprintSimulation({
        blueprint,
        engineKind,
        maxDurationSeconds: WARMUP_SECONDS + OBSERVATION_SECONDS,
        registry: createRegistryContract(),
      });
      const standardTickRate = report.topology.standardTickRate;
      const warmupTicks = WARMUP_SECONDS * standardTickRate;
      const windowSize = WINDOW_SECONDS * standardTickRate;
      const observationTicks = OBSERVATION_SECONDS * standardTickRate;
      const windowStep = WINDOW_STEP_SECONDS * standardTickRate;
      const maxTick = report.execution.maxTickNumber;

      // 4. 累计最终产物交到目标存储箱的数量
      const delivered: number[] = new Array(maxTick + 1).fill(0);
      for (const tick of report.ticks) {
        const t = tick.tickNumber;
        if (t > 0) delivered[t] = delivered[t - 1]!;
        for (const transfer of tick.transfers) {
          if (transfer.itemType === TARGET_ITEM && transfer.targetSlotId.includes(`device:${STORAGER_ID}/`)) {
            delivered[t] = delivered[t]! + transfer.amount;
          }
        }
      }
      for (let i = 1; i <= maxTick; i++) {
        if (delivered[i]! === 0 && delivered[i - 1]! > 0) delivered[i] = delivered[i - 1]!;
      }

      // 5. 滑动窗口验证
      const slidingWindowStartMin = warmupTicks;
      const slidingWindowStartMax = maxTick - windowSize + 1;
      const results: { windowStart: number; produced: number }[] = [];

      for (let windowStart = slidingWindowStartMin; windowStart <= slidingWindowStartMax; windowStart += windowStep) {
        const windowEnd = windowStart + windowSize - 1;
        const beforeWindow = windowStart - 1;
        const produced = delivered[windowEnd]! - delivered[beforeWindow]!;

        results.push({ windowStart, produced });

        expect(
          produced,
          `滑动窗口 [${windowStart}, ${windowEnd}] 产出 ${produced} < ${TARGET_PER_WINDOW}`,
        ).toBeGreaterThanOrEqual(TARGET_PER_WINDOW);
      }

      const totalProduced = delivered[maxTick]! - delivered[warmupTicks - 1]!;
      const expectedMinTotal = (observationTicks / windowSize) * TARGET_PER_WINDOW;
      expect(totalProduced).toBeGreaterThanOrEqual(expectedMinTotal);

      console.log(
        `[暗管芽针针剂] ${results.length} 个滑动窗口全部通过，` +
        `总产出 ${totalProduced}，` +
        `窗口产出范围 [${Math.min(...results.map(r => r.produced))}, ${Math.max(...results.map(r => r.produced))}]`,
      );
    },
  );
});
