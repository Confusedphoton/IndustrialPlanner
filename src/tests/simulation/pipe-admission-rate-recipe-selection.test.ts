import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getFirstTickAtSimulationMilliseconds, getDevice } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

describe.each(SIMULATION_ENGINE_MATRIX)(
  "pipe admission rate-aware recipe selection [%s]",
  (engineKind) => {
  // 准入计数在物品离开准入口时递增，而非进入时。
  // 时序：tick 1 入 → tick 11 出（第一个配方完成）→ tick 21 出（第二个）...
  it("counts only released items and does not prefetch beyond a one-item window allowance", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/pipe-admission-rate-recipe-selection/scene-01-pipe-admission-one-item-window-e8225a8a.schema7.json"),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 1.5,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    const oneSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_000);

    // tick 1: 1 件入准入（容量 1）
    expect(zeroMillisecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 0,
        perMinuteLimit: 6,
        rateWindowCount: 0,
      });
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "admission").channelRecipes.default?.recipeId)
      .toBe("pipe_admission:dynamic-pipe-transfer");
    // tick 11: 1 件出准入口（配方 0.5s 完成），准入计数递增，速率额度耗尽
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    // tick 21: 无出无入（速率额度已用尽）
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(0);
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    expect(getDevice(report, oneSecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 1,
        perMinuteLimit: 6,
        rateWindowCount: 1,
      });
    expect(getDevice(report, oneSecondTick.tickNumber, "admission").slotItems.reduce(
      (total, slot) => total + slot.count,
      0,
    )).toBe(0);
  });

  // 每 10 tick（0.5s）出 1 件，同时入 1 件。18/min → 每窗口 3 件额度。
  it("transfers exactly one item per 0.5s tick within the rate allowance", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/pipe-admission-rate-recipe-selection/scene-02-pipe-admission-rate-recipe-selection-e63e1fd2.schema7.json"),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 2.5,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    const oneSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_000);
    const oneAndHalfSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_500);
    const twoSecondTick = getFirstTickAtSimulationMilliseconds(report, 2_000);

    expect(zeroMillisecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 0,
        perMinuteLimit: 18,
        rateWindowCount: 0,
      });
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "admission").channelRecipes.default?.recipeId)
      .toBe("pipe_admission:dynamic-pipe-transfer");
    // tick 11: 第 1 件出准入 + 补入 1 件（buffer 恢复满）
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, halfSecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 1,
        perMinuteLimit: 18,
        rateWindowCount: 1,
      });
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, oneSecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 2,
        perMinuteLimit: 18,
        rateWindowCount: 2,
      });
    // tick 31: 第 3 件出准入，速率额度用尽，不再入
    expect(oneAndHalfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(oneAndHalfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    // tick 41: 无剩余物品
    expect(twoSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(0);
    expect(getDevice(report, twoSecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 3,
        perMinuteLimit: 18,
        rateWindowCount: 3,
      });
  });
});
