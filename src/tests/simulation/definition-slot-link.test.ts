import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest"

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner"

import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix"

describe.each(SIMULATION_ENGINE_MATRIX)("definition slot links [%s]", (engineKind) => {
  it("ignores cleared definition links materialized as null config entries", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/definition-slot-link/scene-01-cleared-definition-slot-link-d0afa449.schema7.json"),
      registry: createRegistryContract(),
      maxTickNumber: 0,
      engineKind,
    })

    expect(report.topology.diagnostics).toEqual([])
    expect(report.blueprint.entityCount).toBe(1)
  })
})
