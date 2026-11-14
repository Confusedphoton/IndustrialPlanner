import { loadBlueprintVariantFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getFirstTickAtSimulationMilliseconds, getTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

describe.each(SIMULATION_ENGINE_MATRIX)("admission rule runtime counter [%s]", (engineKind) => {
  it("limits admission by a persistent cross-tick counter", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: 2,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 5,
    });

    const sourceToAdmissionTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:source")
          && transfer.targetSlotId.includes("device:admission"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );
    const expectedSourceToAdmissionTicks = [0, 2_000].map(
      (milliseconds) => getFirstTickAtSimulationMilliseconds(report, milliseconds).tickNumber,
    );
    expect(sourceToAdmissionTransfers.map((entry) => entry.tickNumber))
      .toEqual(expectedSourceToAdmissionTicks);
    const admissionOutputTicks = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map(() => tick.tickNumber),
    );
    const expectedAdmissionOutputTicks = [2_000, 4_000].map(
      (milliseconds) => getFirstTickAtSimulationMilliseconds(report, milliseconds).tickNumber,
    );
    expect(admissionOutputTicks).toEqual(expectedAdmissionOutputTicks);
    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    expect(admissionCounter)
      .toMatchObject({
        itemType: "item_iron_ore",
        limit: 2,
        count: 2,
        perMinuteLimit: null,
        rateWindowCount: 2,
        oneMinuteCount: 2,
      });
  });

  it("resets rate admission count at aligned ten-second boundaries", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: 12,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 13,
    });

    const admissionToBeltTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    const expectedAdmissionToBeltTicks = [2_000, 4_000, 12_000].map(
      (milliseconds) => getFirstTickAtSimulationMilliseconds(report, milliseconds).tickNumber,
    );
    expect(admissionToBeltTransfers.map((entry) => entry.tickNumber))
      .toEqual(expectedAdmissionToBeltTicks);
    const tenSecondFirstTick = getFirstTickAtSimulationMilliseconds(report, 10_000);
    expect(getTick(report, tenSecondFirstTick.tickNumber - 1)
      .devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: null,
        count: 2,
        perMinuteLimit: 12,
        rateWindowCount: 2,
      });
    expect(tenSecondFirstTick.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: null,
        count: 2,
        perMinuteLimit: 12,
        rateWindowCount: 0,
      });
    expect(tenSecondFirstTick.devices.admission?.channelRecipes.default?.recipeId)
      .toBe("log_admission:dynamic-belt-transfer");
  });

  it("applies total and ten-second rate limits independently", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: 3,
        perMinuteLimit: 12,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 13,
    });

    const admissionToBeltTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    const expectedAdmissionToBeltTicks = [2_000, 4_000, 12_000].map(
      (milliseconds) => getFirstTickAtSimulationMilliseconds(report, milliseconds).tickNumber,
    );
    expect(admissionToBeltTransfers.map((entry) => entry.tickNumber))
      .toEqual(expectedAdmissionToBeltTicks);
    expect(report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: 3,
        count: 3,
        perMinuteLimit: 12,
        rateWindowCount: 1,
      });
  });

  it("oneMinuteCount spans exactly 6 ten-second windows, not 7", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: 6,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 120,
    });

    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    // 6/min = 每窗 1 个，过去一分钟 = 6 窗，预期 = 6。
    // Bug: pastWindowCounts 最多存 6 个已完成窗口 + 当前窗口 = 7 窗 → 7 件。
    expect(admissionCounter!.oneMinuteCount).toBe(6);
  });

  it("does not admit a different item", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_copper_ore",
        admissionItemId: "item_iron_ore",
        limit: 5,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 4,
    });

    expect(report.ticks.some((tick) =>
      tick.transfers.some((transfer) =>
        transfer.sourceSlotId.includes("device:source")
        && transfer.targetSlotId.includes("device:admission"),
      ),
    )).toBe(false);
    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    expect(admissionCounter)
      .toMatchObject({
        itemType: "item_iron_ore",
        limit: 5,
        count: 0,
        perMinuteLimit: null,
        rateWindowCount: 0,
      });
  });
});

function createAdmissionBlueprint(options: {
  readonly sourceItemId: string;
  readonly admissionItemId: string;
  readonly limit: number | null;
  readonly perMinuteLimit?: number | null;
}) {
  return loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/admission-rule/index.json", "scene-01", { options });
}
