import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { findSlot, getFirstTickAtSimulationMilliseconds, getDevice } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

// =============================================================================
// 桥接器方向隔离验证
//
// 验证 item_log_connector 的 NS/EW 双通道独立运输：
//   - N↔S 方向物品只走 ns_buffer，不进入 ew_buffer
//   - W↔E 方向物品只走 ew_buffer，不进入 ns_buffer
//   - 禁止跨方向输送
//
// 布局（belt_straight_1x1 rotation=0 → W→E, rotation=270 → S→N）：
//
//   NS 通道（铁矿石，S→N 流）：
//     [Storage-N](0,3)rot0 → belt(0,2)rot270 → [Bridge](0,1)rot0
//       → belt(0,0)rot270 → [Storage-S](0,-3)rot0
//
//   EW 通道（铜矿石，W→E 流）：
//     [Storage-W](-4,1)rot90 → belt(-1,1)rot0 → [Bridge](0,1)rot0
//       → belt(1,1)rot0 → [Storage-E](2,1)rot90
//
// 传输时序（belt 2s=40tick，bridge 2s=40tick，advanceDevices Stage1 直接完成配方）：
//   Tick 1:  物品入首段传送带（source → belt stage3，belt 启动 stage5）
//   Tick 41: 物品入桥（belt Stage1 完成 → Stage3 传输）
//   Tick 81: 物品入末段传送带（bridge Stage1 完成 → Stage3 传输）
//   Tick 121: 物品达终点储存箱
// =============================================================================

function createBridgeDirectionBlueprint(): BlueprintDocument {
  return loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/bridge-direction/scene-01-bridge-direction-verify-a1e0eae4.schema7.json");
}

describe.each(SIMULATION_ENGINE_MATRIX)("bridge-direction [%s]", (engineKind) => {
  it("NS 和 EW 通道独立运输，互不干扰", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBridgeDirectionBlueprint(),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 7.5,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const twoSecondTick = getFirstTickAtSimulationMilliseconds(report, 2_000);
    const twoAndHalfSecondTick = getFirstTickAtSimulationMilliseconds(report, 2_500);
    const fourSecondTick = getFirstTickAtSimulationMilliseconds(report, 4_000);
    const sixSecondTick = getFirstTickAtSimulationMilliseconds(report, 6_000);
    const sevenSecondTick = getFirstTickAtSimulationMilliseconds(report, 7_000);

    // === Tick 1: 两路物品同时进入首段传送带 ===
    expect(zeroMillisecondTick.transfers.some((t) =>
      t.sourceSlotId.includes("device:source-ns")
      && t.targetSlotId.includes("device:belt_ns_in"),
    )).toBe(true);
    expect(zeroMillisecondTick.transfers.some((t) =>
      t.sourceSlotId.includes("device:source-ew")
      && t.targetSlotId.includes("device:belt_ew_in"),
    )).toBe(true);

    // === Tick 41: 物品进入桥接器，验证方向隔离 ===
    expect(twoSecondTick.transfers.some((t) =>
      t.sourceSlotId.includes("belt_ns_in")
      && t.targetSlotId.includes("bridge")
      && t.itemType === "item_iron_ore",
    )).toBe(true);
    expect(twoSecondTick.transfers.some((t) =>
      t.sourceSlotId.includes("belt_ew_in")
      && t.targetSlotId.includes("bridge")
      && t.itemType === "item_copper_ore",
    )).toBe(true);

    // Tick 42: 桥接器槽位状态应体现方向隔离
    const nsInSlot = findSlot(
      report,
      twoAndHalfSecondTick.tickNumber,
      "bridge",
      "ns_buffer",
      "ns_slot_1",
      "input-view",
    );
    expect(nsInSlot.itemType).toBe("item_iron_ore");
    expect(nsInSlot.count).toBeGreaterThan(0);

    const ewInSlot = findSlot(
      report,
      twoAndHalfSecondTick.tickNumber,
      "bridge",
      "ew_buffer",
      "ew_slot_1",
      "input-view",
    );
    expect(ewInSlot.itemType).toBe("item_copper_ore");
    expect(ewInSlot.count).toBeGreaterThan(0);

    // 方向隔离：ns_buffer 不含铜矿石，ew_buffer 不含铁矿石
    expect(nsInSlot.itemType).not.toBe("item_copper_ore");
    expect(ewInSlot.itemType).not.toBe("item_iron_ore");

    // === Tick 81: 物品离开桥接器进入末段传送带 ===
    expect(fourSecondTick.transfers.some((t) =>
      t.sourceSlotId.includes("device:bridge")
      && t.targetSlotId.includes("device:belt_ns_out")
      && t.itemType === "item_iron_ore",
    )).toBe(true);
    expect(fourSecondTick.transfers.some((t) =>
      t.sourceSlotId.includes("device:bridge")
      && t.targetSlotId.includes("device:belt_ew_out")
      && t.itemType === "item_copper_ore",
    )).toBe(true);

    // === Tick 121: 两路物品到达终点储存箱 ===
    expect(sixSecondTick.transfers.some((t) =>
      t.targetSlotId.includes("device:sink-ns")
      && t.itemType === "item_iron_ore",
    )).toBe(true);
    expect(sixSecondTick.transfers.some((t) =>
      t.targetSlotId.includes("device:sink-ew")
      && t.itemType === "item_copper_ore",
    )).toBe(true);

    // === Tick 130: 最终验证 sink 内容纯净 ===
    const sinkNs = getDevice(report, sevenSecondTick.tickNumber, "sink-ns");
    const sinkEw = getDevice(report, sevenSecondTick.tickNumber, "sink-ew");

    for (const slot of sinkNs.slotItems) {
      if (slot.count > 0) {
        expect(slot.itemType).toBe("item_iron_ore");
      }
    }
    for (const slot of sinkEw.slotItems) {
      if (slot.count > 0) {
        expect(slot.itemType).toBe("item_copper_ore");
      }
    }
  });

  it("桥接器编译后应有独立的双通道槽位结构", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBridgeDirectionBlueprint(),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 3.5,
    });

    // Tick 43: bridge 的 slotItems 应包含 4 个条目：ns_buffer(input+output) + ew_buffer(input+output)
    const threeSecondTick = getFirstTickAtSimulationMilliseconds(report, 3_000);
    const bridge = getDevice(report, threeSecondTick.tickNumber, "bridge");
    const slotKeys = bridge.slotItems.map((s) => `${s.storageGroupId}:${s.slotId}:${s.viewRole}`).sort();
    expect(slotKeys).toEqual(expect.arrayContaining([
      "ns_buffer:ns_slot_1:input-view",
      "ns_buffer:ns_slot_1:output-view",
      "ew_buffer:ew_slot_1:input-view",
      "ew_buffer:ew_slot_1:output-view",
    ]));
    expect(slotKeys).toHaveLength(4);
  });
});

// =============================================================================
// 管道桥接器方向隔离验证
//
// 验证 item_pipe_connector 的 EW 通道独立运输：
//   物品通过 in_w/out_e 只走 ew_buffer，不泄漏到 ns_buffer。
//   （NS 通道隔离由 belt bridge 测试覆盖，pipe bridge 代码结构相同。）
//
// 布局：
//   [LiquidSrc](-4,0)rot0 → pipe(-1,1)rot0 → [PipeBridge](0,1)rot0 → pipe(1,1)rot0 → [LiquidSink](2,0)rot0
//
// 时序（pipe 0.5s=10tick，bridge anchor 0.5s=10tick）：
//   Tick 1: 入管 → Tick 11: 入桥 → Tick 21: 出桥入末段管 → Tick 31: 达宿第1件 → Tick 41: 达宿第2件
// =============================================================================

function createPipeBridgeDirectionBlueprint(): BlueprintDocument {
  return loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/bridge-direction/scene-02-pipe-bridge-direction-verify-72c18fbb.schema7.json");
}

describe.each(SIMULATION_ENGINE_MATRIX)("pipe-bridge-direction [%s]", (engineKind) => {
  it("管道桥接器 EW 通道运输且不泄漏到 NS 通道", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createPipeBridgeDirectionBlueprint(),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 2.5,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    const oneSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_000);
    const oneAndHalfSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_500);
    const twoSecondTick = getFirstTickAtSimulationMilliseconds(report, 2_000);

    // === Tick 1: 第 1 件水进入首段管道 ===
    expect(zeroMillisecondTick.transfers.filter((t) =>
      t.sourceSlotId.includes("device:liquid-source-ew")
      && t.targetSlotId.includes("device:pipe_ew_in"),
    )).toHaveLength(1);

    // === Tick 11: 第 1 件入桥 + 第 2 件入首段管 ===
    expect(halfSecondTick.transfers.filter((t) =>
      t.sourceSlotId.includes("device:pipe_ew_in")
      && t.targetSlotId.includes("device:pipe-bridge"),
    )).toHaveLength(1);
    expect(halfSecondTick.transfers.filter((t) =>
      t.sourceSlotId.includes("device:liquid-source-ew")
      && t.targetSlotId.includes("device:pipe_ew_in"),
    )).toHaveLength(1);

    // === Tick 12: 桥接器槽位隔离验证 ===
    const ewInSlot = findSlot(
      report,
      halfSecondTick.tickNumber,
      "pipe-bridge",
      "ew_buffer",
      "ew_slot_1",
      "input-view",
    );
    expect(ewInSlot.itemType).toBe("item_liquid_water");
    expect(ewInSlot.count).toBe(1);
    expect(ewInSlot.reserved).toBe(1);

    // ns_buffer 应无物品（方向隔离）
    const nsInSlot = findSlot(
      report,
      halfSecondTick.tickNumber,
      "pipe-bridge",
      "ns_buffer",
      "ns_slot_1",
      "input-view",
    );
    expect(nsInSlot.itemType).toBeNull();
    expect(nsInSlot.count).toBe(0);

    // === Tick 21: 第 1 件出桥入末段管 + 第 2 件入桥 ===
    expect(oneSecondTick.transfers.filter((t) =>
      t.sourceSlotId.includes("device:pipe-bridge")
      && t.targetSlotId.includes("device:pipe_ew_out"),
    )).toHaveLength(1);
    expect(oneSecondTick.transfers.filter((t) =>
      t.sourceSlotId.includes("device:pipe_ew_in")
      && t.targetSlotId.includes("device:pipe-bridge"),
    )).toHaveLength(1);

    // === Tick 31: 第 1 件达宿 + 第 2 件出桥入末段管 ===
    expect(oneAndHalfSecondTick.transfers.filter((t) =>
      t.targetSlotId.includes("device:liquid-sink-ew")
      && t.itemType === "item_liquid_water",
    )).toHaveLength(1);
    expect(oneAndHalfSecondTick.transfers.filter((t) =>
      t.sourceSlotId.includes("device:pipe-bridge")
      && t.targetSlotId.includes("device:pipe_ew_out"),
    )).toHaveLength(1);

    // === Tick 41: 第 2 件达宿 ===
    expect(twoSecondTick.transfers.filter((t) =>
      t.targetSlotId.includes("device:liquid-sink-ew")
      && t.itemType === "item_liquid_water",
    )).toHaveLength(1);

    // === 最终：宿只有水，桥 ns_buffer 全程空 ===
    const sinkEw = getDevice(report, twoSecondTick.tickNumber, "liquid-sink-ew");
    for (const slot of sinkEw.slotItems) {
      if (slot.count > 0) expect(slot.itemType).toBe("item_liquid_water");
    }
  });
});

