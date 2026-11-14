import { loadBlueprintVariantFromFile, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology/compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
} from "@/simulation/regional/warehouse-arbiter";
import type {
  RegionWarehouseAckBatch,
  RegionWarehouseAuthorityState,
  RegionWarehouseDemandBatch,
} from "@/simulation/regional/types";
import { SimulationWorkerRuntime } from "@/simulation/legacy/worker-runtime";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";

describe("区域基地 Runtime 门禁", () => {
  it.each(["udpipe_loader_1", "udpipe_loader_2"] as const)(
    "区域模式下未链接的 %s 将流体写入区域仓库 journal",
    (inletDefinitionId) => {
      const registry = createRegistryContract();
      const document = createWorldDocumentFromBlueprint(loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/regional-base-runtime/index.json", "scene-01", { inletDefinitionId }));
      const topology = compileSimulationTopology({
        document,
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
      });
      const singleBaseTopology = compileSimulationTopology({
        document,
        registry,
        simulationMode: "single-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
      });
      const inletDevice = topology.devices["device:inlet"];
      expect(topology.topologyId).not.toBe(singleBaseTopology.topologyId);
      expect(singleBaseTopology.devices["device:inlet"]?.simulationBehaviors).toEqual([
        expect.objectContaining({
          strategy: "warehouse-sink-when-unlinked",
          storageSlotGroupIds: ["loader_buffer"],
        }),
      ]);
      expect(inletDevice?.simulationBehaviors).toEqual([
        expect.objectContaining({
          strategy: "warehouse-sink-when-unlinked",
          storageSlotGroupIds: ["loader_buffer"],
        }),
      ]);

      const admission = buildRegionalWarehouseOutletTable({
        registry,
        topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
      });
      expect(admission.ok).toBe(true);
      const runtime = new SimulationWorkerRuntime(registry);
      expect(runtime.loadRegionalTopology({
        topology,
        baseId: document.baseId,
        table: admission.table!,
        initialWarehouseCounts: {},
        fixedDynamicTickRate: 2,
        advanceMode: "coarse",
      }).status).toBe("started");

      runtime.prepareRegionalEpochDemand(0);
      expect(runtime.applyRegionalEpochGrant({
        epochNumber: 0,
        grantedOutletIds: [],
      }).deposits).toEqual([]);
      runtime.finalizeRegionalEpoch({
        epochNumber: 0,
        nextWarehouseCounts: {},
        includeSnapshot: false,
      });

      runtime.prepareRegionalEpochDemand(1);
      expect(runtime.applyRegionalEpochGrant({
        epochNumber: 1,
        grantedOutletIds: [],
      }).deposits).toEqual([{ itemId: "item_liquid_water", amount: 1 }]);
    },
  );

  it("区域模式下已直连的暗管入口保持本地 share-all，不重复写入仓库", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-base-runtime/scene-02-regional-linked-dark-pipe-266c8d9b.schema7.json"));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });
    expect(admission.ok).toBe(true);
    const runtime = new SimulationWorkerRuntime(registry);
    expect(runtime.loadRegionalTopology({
      topology,
      baseId: document.baseId,
      table: admission.table!,
      initialWarehouseCounts: {},
      fixedDynamicTickRate: 2,
      advanceMode: "coarse",
    }).status).toBe("started");

    runtime.prepareRegionalEpochDemand(0);
    expect(runtime.applyRegionalEpochGrant({
      epochNumber: 0,
      grantedOutletIds: [],
    }).deposits).toEqual([]);
    runtime.finalizeRegionalEpoch({
      epochNumber: 0,
      nextWarehouseCounts: {},
      includeSnapshot: false,
    });

    runtime.prepareRegionalEpochDemand(1);
    expect(runtime.applyRegionalEpochGrant({
      epochNumber: 1,
      grantedOutletIds: [],
    }).deposits).toEqual([]);
  });

  it("Epoch 0 在 tick1 提货，管道/传送带相位错误时不产生 demand", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-base-runtime/scene-03-regional-runtime-belt-0af9999d.schema7.json"));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });
    expect(admission.ok).toBe(true);
    const table = admission.table!;

    const runtime = new SimulationWorkerRuntime(registry);
    const start = runtime.loadRegionalTopology({
      topology,
      baseId: document.baseId,
      table,
      initialWarehouseCounts: { item_copper_ore: 1 },
      fixedDynamicTickRate: 2,
      advanceMode: "coarse",
    });
    expect(start.status).toBe("started");

    const epoch0 = runtime.prepareRegionalEpochDemand(0);
    expect(epoch0.tickNumber).toBe(1);
    expect(epoch0.demandedOutletIds).toHaveLength(1);

    const state0: RegionWarehouseAuthorityState = {
      warehouseVersion: 0,
      warehouseCounts: { item_copper_ore: 1 },
      cursorByItemId: { item_copper_ore: 0 },
    };
    const demand0: RegionWarehouseDemandBatch = {
      sessionId: "s",
      epochNumber: 0,
      warehouseVersion: 0,
      baseId: document.baseId,
      demandedOutletIds: [...epoch0.demandedOutletIds],
    };
    const arbitration0 = arbitrateRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 0,
      table,
      state: state0,
      demands: [demand0],
    });
    const grant0 = arbitration0.grantsByBaseId[document.baseId]!;
    const applied0 = runtime.applyRegionalEpochGrant({
      epochNumber: 0,
      grantedOutletIds: [...grant0.grantedOutletIds],
    });
    expect(applied0.deposits).toEqual([]);
    const finalized0 = runtime.finalizeRegionalEpoch({
      epochNumber: 0,
      nextWarehouseCounts: arbitration0.provisionalCounts,
      includeSnapshot: true,
    });
    expect(finalized0.snapshot!.transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemType: "item_copper_ore", amount: 1 }),
    ]));

    const epoch1 = runtime.prepareRegionalEpochDemand(1);
    expect(epoch1.tickNumber).toBe(11);
    // BeltFamily 相位为 20 tick，tick11 不产生 demand；首段已占用也不会产生 demand。
    expect(epoch1.demandedOutletIds).toEqual([]);
    const state1: RegionWarehouseAuthorityState = {
      warehouseVersion: 1,
      warehouseCounts: arbitration0.provisionalCounts,
      cursorByItemId: arbitration0.provisionalCursorByItemId,
    };
    const demand1: RegionWarehouseDemandBatch = {
      sessionId: "s",
      epochNumber: 1,
      warehouseVersion: 1,
      baseId: document.baseId,
      demandedOutletIds: [],
    };
    const arbitration1 = arbitrateRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 1,
      table,
      state: state1,
      demands: [demand1],
    });
    const ack1: RegionWarehouseAckBatch = {
      sessionId: "s",
      epochNumber: 1,
      warehouseVersion: 1,
      baseId: document.baseId,
      grantId: arbitration1.grantsByBaseId[document.baseId]!.grantId,
      appliedOutletIds: [],
      deposits: [],
    };
    const proposal1 = commitRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 1,
      table,
      state: state1,
      expectedBaseIds: [document.baseId],
      arbitration: arbitration1,
      acks: [ack1],
    });
    const applied1 = runtime.applyRegionalEpochGrant({
      epochNumber: 1,
      grantedOutletIds: [],
    });
    expect(applied1.deposits).toEqual([]);
    const finalized1 = runtime.finalizeRegionalEpoch({
      epochNumber: 1,
      nextWarehouseCounts: proposal1.warehouseCounts,
      includeSnapshot: true,
    });
    expect(finalized1.snapshot!.tickNumber).toBe(11);
  });

  it("区域前台 Runtime 取走增量快照后只保留最新 tick 锚点", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-base-runtime/scene-04-regional-snapshot-retention-78c359e0.schema7.json"));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });
    expect(admission.ok).toBe(true);

    const runtime = new SimulationWorkerRuntime(registry);
    expect(runtime.loadRegionalTopology({
      topology,
      baseId: document.baseId,
      table: admission.table!,
      initialWarehouseCounts: {},
      fixedDynamicTickRate: 20,
      advanceMode: "per-tick",
    }).status).toBe("started");

    for (let epochNumber = 0; epochNumber < 3; epochNumber += 1) {
      const prepared = runtime.prepareRegionalEpochDemand(epochNumber);
      runtime.applyRegionalEpochGrant({
        epochNumber,
        grantedOutletIds: [],
      });
      runtime.finalizeRegionalEpoch({
        epochNumber,
        nextWarehouseCounts: {},
        includeSnapshot: true,
      });

      const snapshots = runtime.takeRegionalSnapshots();
      expect(snapshots.at(-1)?.tickNumber).toBe(prepared.tickNumber);
      expect(snapshots).toHaveLength(epochNumber === 0 ? 2 : 10);
      expect(runtime.getStatus()).toMatchObject({
        retainedFromTick: prepared.tickNumber,
        latestTickNumber: prepared.tickNumber,
        bufferSize: 1,
      });
      expect(runtime.takeRegionalSnapshots()).toEqual([]);
    }
  });
});
