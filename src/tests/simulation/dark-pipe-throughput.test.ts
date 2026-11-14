import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getDevice, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const ADMISSION_COUNTER_ID = "fluid_input:in_w";
const FINAL_DURATION_SECONDS = 70;

describe.each(SIMULATION_ENGINE_MATRIX)("dark pipe linked throughput [%s]", (engineKind) => {
  it("keeps a linked single-port dark pipe at 120 fluid per minute in both directions", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-throughput/scene-01-single-dark-pipe-linked-throughput-c7499722.schema7.json"),
      maxDurationSeconds: FINAL_DURATION_SECONDS,
      engineKind,
      registry: createRegistryContract(),
    });

    expect(readOneMinuteCount(report, "input-meter")).toBe(120);
    expect(countRecentOutputTransfers(report, "outlet")).toBe(120);
  });

  it("keeps both ports of a linked multi-port dark pipe at 120 fluid per minute", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-throughput/scene-02-multi-dark-pipe-linked-throughput-31358255.schema7.json"),
      maxDurationSeconds: FINAL_DURATION_SECONDS,
      engineKind,
      registry: createRegistryContract(),
    });

    expect([
      readOneMinuteCount(report, "input-meter-1"),
      readOneMinuteCount(report, "input-meter-2"),
    ]).toEqual([120, 120]);
    expect(countRecentOutputTransfers(report, "outlet")).toBe(240);
  });
});



function readOneMinuteCount(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  deviceId: string,
): number | undefined {
  return getDevice(report, getLastTick(report).tickNumber, deviceId)
    .admissionCounters?.[ADMISSION_COUNTER_ID]?.oneMinuteCount;
}

function countRecentOutputTransfers(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  outletEntityId: string,
): number {
  const windowStartSeconds = getLastTick(report).elapsedSimulationSeconds - 60;
  return report.ticks.reduce((total, tick) => {
    if (tick.elapsedSimulationSeconds <= windowStartSeconds) {
      return total;
    }
    return total + tick.transfers.reduce((tickTotal, transfer) =>
      transfer.sourceSlotId.includes(`device:${outletEntityId}/`)
        ? tickTotal + transfer.amount
        : tickTotal,
    0);
  }, 0);
}
