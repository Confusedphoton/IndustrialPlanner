import { loadBlueprintVariantFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { resolveSimulationMillisecondsAtFirstTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const OUTPUT_ITEM_ID = "item_liquid_xiranite";

describe.each(SIMULATION_ENGINE_MATRIX)("反应池双液体出口轮询 [%s]", (engineKind) => {
  it.each([
    {
      definitionId: "mix_pool_1",
      recipeId: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic",
      powerX: 16,
    },
    {
      definitionId: "mix_pool_2",
      recipeId: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
      powerX: 17,
    },
  ])(
    "$definitionId alternates isolated products across two independently configured pipes",
    async ({ definitionId, recipeId, powerX }) => {
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/reactor-dual-fluid-output-routing/index.json", "scene-01", { definitionId, powerX, recipeId }),
        registry: createRegistryContract(),
        engineKind,
        maxDurationSeconds: 12.5,
      });
      const outputTransfers = report.ticks.flatMap((tick) => tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:pool/")
          && transfer.itemType === OUTPUT_ITEM_ID,
        )
        .map((transfer) => ({
          elapsedMilliseconds: resolveSimulationMillisecondsAtFirstTick(
            report.topology.standardTickRate,
            tick.tickNumber,
          ),
          portId: transfer.edgeId.includes("fluid_output_a.out_w_1")
            ? "out_w_1"
            : "out_w_3",
        })));

      expect(report.topology.diagnostics).toEqual([]);
      expect(outputTransfers).toEqual([
        { elapsedMilliseconds: 2_000, portId: "out_w_1" },
        { elapsedMilliseconds: 4_000, portId: "out_w_3" },
        { elapsedMilliseconds: 6_000, portId: "out_w_1" },
        { elapsedMilliseconds: 8_000, portId: "out_w_3" },
        { elapsedMilliseconds: 10_000, portId: "out_w_1" },
        { elapsedMilliseconds: 12_000, portId: "out_w_3" },
      ]);
    },
  );

  it.each([
    { definitionId: "mix_pool_1", powerX: 16 },
    { definitionId: "mix_pool_2", powerX: 17 },
  ])(
    "$definitionId sends buffered products through both pipes in the same tick",
    async ({ definitionId, powerX }) => {
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/reactor-dual-fluid-output-routing/index.json", "scene-02", { definitionId, powerX }),
        registry: createRegistryContract(),
        engineKind,
        maxDurationSeconds: 1,
      });
      const firstOutputTick = report.ticks.find((tick) => tick.transfers.some((transfer) =>
        transfer.sourceSlotId.includes("device:pool/")
        && transfer.itemType === OUTPUT_ITEM_ID,
      ));
      const movedPortIds = [...new Set(firstOutputTick?.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:pool/")
          && transfer.itemType === OUTPUT_ITEM_ID,
        )
        .map((transfer) => transfer.edgeId.includes("fluid_output_a.out_w_1")
          ? "out_w_1"
          : "out_w_3") ?? [])].sort();

      expect(report.topology.diagnostics).toEqual([]);
      expect(firstOutputTick).toBeDefined();
      expect(movedPortIds).toEqual(["out_w_1", "out_w_3"]);
    },
  );
});
