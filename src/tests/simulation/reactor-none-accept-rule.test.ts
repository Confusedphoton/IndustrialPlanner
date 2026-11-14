import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getDevice, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

describe.each(SIMULATION_ENGINE_MATRIX)(
  "reactor output port acceptRule: none blocks output [%s]",
  (engineKind) => {

  it("blocks all transfer when no output port config is set", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/reactor-none-accept-rule/scene-01-reactor-none-blocks-output-3a071dc4.schema7.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry,
    });

    // 没有任何物流传输 — 输出端口 acceptRule=none，边未建立
    expect(report.summary.totalTransferCount).toBe(0);
    expect(report.summary.transportComponentThroughput.length).toBe(0);

    const reactorTick = getDevice(report, getLastTick(report).tickNumber, "reactor");
    expect(reactorTick).toBeDefined();
  });
  },
);
