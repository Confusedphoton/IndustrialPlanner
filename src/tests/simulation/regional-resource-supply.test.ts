import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import { compileSimulationTopology } from "@/simulation/topology/compiler";
import type { RegionalResourceSupplySetting } from "@/simulation/contracts/types";
import { runBlueprintSimulation } from "./blueprint-runner";
import { createWorldDocumentFromBlueprint, getFirstTickAtSimulationMilliseconds, getTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";


const FINITE_SOURCE_ORE: readonly RegionalResourceSupplySetting[] = [{
  itemId: "item_originium_ore",
  mode: "rate",
  perMinute: 540,
}];

describe("地区资源供给", () => {
  describe.each(SIMULATION_ENGINE_MATRIX)("单基地运行行为 [%s]", (engineKind) => {
    it("每 10000ms 提交有限资源，并为固定及可配置无限资源投影独立状态", async () => {
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-resource-supply/scene-01-regional-resource-single-7396c6c1.schema7.json"),
        maxDurationSeconds: 10.5,
        registry: createRegistryContract(),
        engineKind,
        regionalResources: [
          ...FINITE_SOURCE_ORE,
          { itemId: "item_iron_ore", mode: "infinite", perMinute: 10 },
        ],
      });
      const beforeBoundary = getFirstTickAtSimulationMilliseconds(report, 9_500);
      const boundary = getFirstTickAtSimulationMilliseconds(report, 10_000);

      const initialStats = getTick(report, 0).warehouseStats;
      expect(initialStats?.items["item_iron_ore"]).toMatchObject({
        infinite: true,
        warehouseCount: 0,
        producedPerMinute: 0,
      });
      expect(initialStats?.items["item_liquid_water"]?.infinite).toBe(true);
      expect(initialStats?.items["item_liquid_acid"]?.infinite).toBe(true);
      expect(beforeBoundary.warehouseStats?.items["item_originium_ore"]).toBeUndefined();
      expect(boundary.warehouseStats?.items["item_originium_ore"]).toMatchObject({
        infinite: false,
        warehouseCount: 90,
      });

    });
  });

  it("有限地区 Profile 覆盖设备文档中的旧自然资源 ignoreStock", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-resource-supply/scene-02-regional-resource-policy-precedence-234650c4.schema7.json"));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
      regionalResources: FINITE_SOURCE_ORE,
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });

    expect(admission.ok).toBe(true);
    expect(Object.values(admission.table!.outletById)).toEqual([
      expect.objectContaining({ itemId: "item_originium_ore", ignoreStock: false }),
    ]);
  });


  /*
  it("多基地在同一 10 秒区域提交边界注入有限资源", async () => {
    const registry = createRegistryContract();
    const documents = ["regional-a", "regional-b"].map((baseId) => {
      const document = createWorldDocumentFromBlueprint(createBlueprint(baseId, []));
      document.baseId = baseId;
      return document;
    });
    const topologies: RegionalBaseTopologyInput[] = documents.map((document, index) => ({
      baseId: document.baseId,
      regionBaseOrderIndex: index,
      topology: compileSimulationTopology({
        document,
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
        regionalResources: [{
          itemId: "item_originium_ore",
          mode: "rate",
          perMinute: 10,
        }],
      }),
    }));
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);
    const ports = topologies.map((input, index) => new LocalRegionalBasePort({
      registry,
      baseId: input.baseId,
      regionBaseOrderIndex: index,
      topology: input.topology,
      table: admission.table!,
      initialWarehouseCounts: {},
      isCurrentBase: index === 0,
      simulationSpeed: 1,
      fixedDynamicTickRate: index === 0 ? 20 : 2,
      advanceMode: index === 0 ? "per-tick" : "coarse",
    }));
    const session = new RegionalSimulationSession({
      sessionId: "regional-resource-supply",
      registry,
      topologies,
      table: admission.table!,
      currentBaseId: topologies[0]!.baseId,
      expectedBaseIds: topologies.map((input) => input.baseId),
      initialWarehouseCounts: {},
      simulationSpeed: 1,
      currentBaseDynamicTickRate: 20,
      backgroundDynamicTickRate: 2,
    }, ports, null);

    try {
      let committed = await session.runEpoch(0);
      for (let epoch = 1; epoch <= 120; epoch += 1) {
        committed = await session.runEpoch(epoch);
      }
      expect(committed.gateTickNumber).toBe(1201);
      expect(committed.warehouseCounts["item_originium_ore"]).toBe(10);
      const baseSnapshots = Object.values(committed.snapshotsByBaseId)
        .filter((snapshot): snapshot is RuntimeTickSnapshot => snapshot !== null);
      const warehouseStats = aggregateRegionalWarehouseStats({
        baseSnapshots,
        authorityCounts: committed.warehouseCounts,
        supply: topologies[0]!.topology.regionalResourceSupply,
      });
      expect(warehouseStats.items["item_originium_ore"]).toMatchObject({
        producedPerMinute: 10,
        warehouseCount: 10,
        infinite: false,
      });
      expect(warehouseStats.items["item_liquid_water"]?.infinite).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it("Dense 按基地实际门禁 tick 提交进度与有限资源窗口", async () => {
    const registry = createRegistryContract();
    const documents = ["dense-regional-a", "dense-regional-b"].map((baseId) => {
      const document = createWorldDocumentFromBlueprint(createBlueprint(baseId, []));
      document.baseId = baseId;
      return document;
    });
    const topologies: RegionalBaseTopologyInput[] = documents.map((document, index) => ({
      baseId: document.baseId,
      regionBaseOrderIndex: index,
      topology: compileSimulationTopology({
        document,
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
        regionalResources: [{
          itemId: "item_originium_ore",
          mode: "rate",
          perMinute: 60,
        }],
        standardTickRate: DENSE_STANDARD_TICK_RATE_PER_SECOND,
      }),
    }));
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);
    const initialWarehouseCounts: Record<string, number> = {};
    const session = new RegionalSimulationSession({
      sessionId: "dense-regional-resource-supply",
      registry,
      topologies,
      table: admission.table!,
      currentBaseId: topologies[0]!.baseId,
      expectedBaseIds: topologies.map((input) => input.baseId),
      initialWarehouseCounts,
      simulationSpeed: 1,
      currentBaseDynamicTickRate: DENSE_STANDARD_TICK_RATE_PER_SECOND,
      backgroundDynamicTickRate: DENSE_STANDARD_TICK_RATE_PER_SECOND,
    }, topologies.map((input, index) => new DenseLocalRegionalBasePort({
      registry,
      baseId: input.baseId,
      topology: input.topology,
      table: admission.table!,
      initialWarehouseCounts,
      isCurrentBase: index === 0,
      advanceMode: "coarse",
    })), null);

    try {
      let committed = await session.runEpoch(0);
      expect(committed.gateTickNumber).toBe(1);
      for (let epoch = 1; epoch <= 2; epoch += 1) {
        committed = await session.runEpoch(epoch);
      }
      expect(committed.gateTickNumber).toBe(3);
      expect(committed.warehouseCounts["item_originium_ore"]).toBeUndefined();

      for (let epoch = 3; epoch <= 20; epoch += 1) {
        committed = await session.runEpoch(epoch);
      }
      expect(committed.gateTickNumber).toBe(21);
      expect(committed.warehouseCounts["item_originium_ore"]).toBe(10);
      for (const snapshot of Object.values(committed.snapshotsByBaseId)) {
        expect(snapshot?.tickNumber).toBe(committed.gateTickNumber);
      }
    } finally {
      session.dispose();
    }
  });
  */
});
