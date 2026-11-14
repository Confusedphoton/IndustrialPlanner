import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { readSimulationSnapshot } from "@/simulation/testkit";
import { describe, expect, it } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createRegistryContract } from "@/registry";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createSimulationHost } from "@/simulation/simulation-host";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/contracts/tick-rate";
import type { CompiledSimulationTopology } from "@/simulation/contracts/types";
import { compileSimulationTopology } from "@/simulation/topology/compiler";
import { SimulationWorkerRuntime } from "@/simulation/legacy/worker-runtime";
import { createWorldDocumentFromBlueprint, resolveFirstTickNumberAtSimulationMilliseconds } from "./blueprint-test-helpers";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

const STANDARD_SPEED = 1;

describeSimulationEngineMatrix("pipe phase gating host contract", (engineKind) => {
  it("只在 500ms 门禁相位的第一 tick 接收运行时补入的液体", async () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createLiquidPhaseGatingBlueprint());
    const host = createSimulationHost(createHostWorkspace(document, registry), {
      engineKind,
      workerMode: "runtime",
    });

    try {
      await host.actions.start();
      host.actions.pause();
      const standardTickRate = host.topology.getSnapshot()?.standardTickRate;
      expect(standardTickRate).toBeDefined();

      const zeroMillisecondTick = resolveFirstTickNumberAtSimulationMilliseconds(
        standardTickRate!,
        0,
      );
      expect((await host.internalActions.syncToTick(zeroMillisecondTick)).status).toBe("ready");
      await host.actions.patchRuntimeSlot({
        entityId: "source",
        storageGroupId: "liquid_storage",
        slotId: "slot_1",
        itemType: "item_liquid_water",
        count: 1,
        ignoreStock: false,
      });
      expect(hasHostTransfer(host, "device:source", "device:pipe")).toBe(false);

      const halfSecondTick = resolveFirstTickNumberAtSimulationMilliseconds(
        standardTickRate!,
        500,
      );
      expect((await host.internalActions.syncToTick(halfSecondTick)).status).toBe("ready");
      expect(hasHostTransfer(host, "device:source", "device:pipe")).toBe(true);
    } finally {
      host.dispose();
    }
  });
});

/**
 * 管道相位门禁（液体版）端到端测试。
 *
 * 与传送带版（belt-phase-gating）对照：
 *   - 传送带族（BeltFamily）在 2026-07-23 重构后失去门禁（回归，测试应失败）；
 *   - 管道设备族（PipeFamily）始终有门禁 `(standardTick - 1) % transferUnitTicks === 0`，
 *     transferUnitTicks = min(round(0.5×20), 20) = 10，合法相位为 tick 1、11、21…
 *   （本测试用于证明管道门禁在端到端仍生效，作为修复传送带门禁时不回归的对照。）
 *
 * 设备差异：`liquid_storager_1` 是单槽单口（1 进 1 出），无法像协议储存箱那样
 * 用"第二槽位 + 第二条管道"复刻。因此场景改为：源槽位初始为空（管道空闲），
 * 在非门禁时刻 tick 5 注入液体，验证管道要等到 10 tick 相位点 tick 11 才接收。
 */
describe("管道相位门禁（液体版）", () => {
  it("非门禁时刻放入的液体，要等到 500ms 门禁相位才第一次接到（Legacy 内部）", () => {
    const registry = createRegistryContract();
    const runtime = new SimulationWorkerRuntime(registry);
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createLiquidPhaseGatingTopology(registry),
      simulationSpeed: STANDARD_SPEED,
    });
    const patchAtTwoHundredMillisecondsTick = resolveLegacyFirstTick(200);
    const collectFromTwoHundredFiftyMillisecondsTick = resolveLegacyFirstTick(250);
    const halfSecondTick = resolveLegacyFirstTick(500);
    const collectThroughThreeSecondsTick = resolveLegacyFirstTick(3_000);

    // 源槽位初始为空（管道空闲）；推进到 tick 5（非门禁，5-1=4 非 10 倍数）。
    runtime.advanceToTick(patchAtTwoHundredMillisecondsTick);
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 50,
      tickNumber: patchAtTwoHundredMillisecondsTick,
      simulationSpeed: STANDARD_SPEED,
    });
    // tick 5 向源槽位放入液体。
    runtime.handleRequest({
      type: "patch-runtime-slot",
      requestId: 9000,
      patch: {
        entityId: "source",
        storageGroupId: "liquid_storage",
        slotId: "slot_1",
        itemType: "item_liquid_water",
        count: 1,
        ignoreStock: false,
      },
    });

    // 管道门禁（transferUnitTicks=10）：tick 6-10 非相位不接收，tick 11 才接。
    const pipeReceives = collectReceives(
      runtime,
      collectFromTwoHundredFiftyMillisecondsTick,
      collectThroughThreeSecondsTick,
      "device:source",
      "device:pipe",
    );
    expect(pipeReceives[0]).toBe(halfSecondTick);
    expect(pipeReceives.filter((tick) => tick < halfSecondTick)).toEqual([]);
  });
});

function createLiquidPhaseGatingTopology(registry: RegistryContract): CompiledSimulationTopology {
  const document = createWorldDocumentFromBlueprint(createLiquidPhaseGatingBlueprint());
  return compileSimulationTopology({
    document,
    registry,
    simulationMode: "single-base",
    poweredEntityIds: new Set(document.entityOrder),
  });
}

function createLiquidPhaseGatingBlueprint() {
  return loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/pipe-phase-gating/scene-01-pipe-phase-gating-c9ec427f.schema7.json");
}

function resolveLegacyFirstTick(elapsedMilliseconds: number): number {
  return resolveFirstTickNumberAtSimulationMilliseconds(
    STANDARD_TICK_RATE_PER_SECOND,
    elapsedMilliseconds,
  );
}

function collectReceives(
  runtime: SimulationWorkerRuntime,
  fromTick: number,
  toTick: number,
  sourceDeviceId: string,
  targetDeviceId: string,
): number[] {
  const ticks: number[] = [];
  for (let tickNumber = fromTick; tickNumber <= toTick; tickNumber += 1) {
    runtime.advanceToTick(tickNumber);
    const response = runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: tickNumber + 10_000,
      tickNumber,
      simulationSpeed: STANDARD_SPEED,
    });
    const transfers = response.type === "tick-snapshot-result"
      ? response.result.currentTick?.transfers ?? []
      : [];
    if (transfers.some((transfer) =>
      transfer.sourceSlotId.includes(sourceDeviceId)
      && transfer.targetSlotId.includes(targetDeviceId),
    )) {
      ticks.push(tickNumber);
    }
  }
  return ticks;
}

function createHostWorkspace(
  document: ReturnType<typeof createWorldDocumentFromBlueprint>,
  registry: RegistryContract,
): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry,
    app: null,
    editor: {
      document: createSnapshotStore(document),
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
    sync: null,
    audio: null,
  };
}

function hasHostTransfer(
  host: ReturnType<typeof createSimulationHost>,
  sourceDeviceId: string,
  targetDeviceId: string,
): boolean {
  return readSimulationSnapshot(host)?.transfers.some((transfer) =>
    transfer.sourceSlotId.includes(sourceDeviceId)
    && transfer.targetSlotId.includes(targetDeviceId)
  ) ?? false;
}
