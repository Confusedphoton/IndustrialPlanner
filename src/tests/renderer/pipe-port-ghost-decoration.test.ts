import { loadBlueprintVariantFromFile, getBlueprintEntityArray, loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import {
  resolvePipePortGhostZoomAlpha,
  shouldShowPipePortGhostDecoration,
} from "@/renderer/scene/decorations/PipePortGhostDecoration";
import { resolveProductionPipePortGhostEntries } from "@/renderer/scene/decorations/PortOverlayDecoration";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);

describe("生产设备管口虚影语义", () => {
  it.each([
    "transmuter_1_gastrans",
    "transmuter_1_liquidtrans",
  ])("%s 显示四个普通管口和一个运行消耗管口", (definitionId) => {

    const entries = resolveProductionPipePortGhostEntries({
      entities: getBlueprintEntityArray(loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/pipe-port-ghost-decoration/index.json", "scene-01", { definitionId })),
      entityDefinitionMap,
      queries: registry.queries,
    });

    expect(entries).toHaveLength(5);
    expect(entries.filter((entry) => entry.variant === "ordinary")).toHaveLength(4);
    expect(entries.filter((entry) => entry.variant === "consumption")).toEqual([
      expect.objectContaining({
        portGroupId: "consume_input",
        portId: "in_s_2",
        outsideGridPoint: { x: 12, y: 15 },
      }),
    ]);
  });

  it("管道物流设备不显示管口虚影", () => {

    const entries = resolveProductionPipePortGhostEntries({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/pipe-port-ghost-decoration/scene-02-variant-1.schema7.json")),
      entityDefinitionMap,
      queries: registry.queries,
    });

    expect(entries).toEqual([]);
  });

  it("方向正确的真实管道连接后隐藏对应生产设备管口", () => {

    const entries = resolveProductionPipePortGhostEntries({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/pipe-port-ghost-decoration/scene-03-variant-1.schema7.json")),
      entityDefinitionMap,
      queries: registry.queries,
    });

    expect(entries).toHaveLength(4);
    expect(entries).not.toContainEqual(expect.objectContaining({
      portGroupId: "liquid_input",
      portId: "in_e_1",
    }));
  });

  it("外侧格与传送带族重叠时保留生产设备管口虚影", () => {

    const entries = resolveProductionPipePortGhostEntries({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/pipe-port-ghost-decoration/scene-04-variant-1.schema7.json")),
      entityDefinitionMap,
      queries: registry.queries,
    });

    expect(entries).toContainEqual(expect.objectContaining({
      portGroupId: "liquid_input",
      portId: "in_e_1",
      outsideGridPoint: { x: 15, y: 11 },
    }));
  });

  it("外侧格被普通设备足印阻挡时隐藏生产设备管口虚影", () => {

    const entries = resolveProductionPipePortGhostEntries({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/pipe-port-ghost-decoration/scene-05-variant-1.schema7.json")),
      entityDefinitionMap,
      queries: registry.queries,
    });

    expect(entries).not.toContainEqual(expect.objectContaining({
      portGroupId: "liquid_input",
      portId: "in_e_1",
    }));
  });

  it("强端口提示对应的生产设备可从虚影结果中排除", () => {
    const device = createEntity("device", "transmuter_1_gastrans", 10, 10, 180);

    const entries = resolveProductionPipePortGhostEntries({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/pipe-port-ghost-decoration/scene-06-variant-1.schema7.json")),
      entityDefinitionMap,
      queries: registry.queries,
      hiddenEntityIds: new Set([device.id]),
    });

    expect(entries).toEqual([]);
  });
});

describe("管口虚影展示策略", () => {
  it("仅在非蓝图、非物流铺设、未抑制管道时展示", () => {
    expect(shouldShowPipePortGhostDecoration({
      activeTool: "select",
      useBlueprintStyle: false,
      suppressPipes: false,
    })).toBe(true);
    expect(shouldShowPipePortGhostDecoration({
      activeTool: "logistics-placement",
      useBlueprintStyle: false,
      suppressPipes: false,
    })).toBe(false);
    expect(shouldShowPipePortGhostDecoration({
      activeTool: "select",
      useBlueprintStyle: true,
      suppressPipes: false,
    })).toBe(false);
    expect(shouldShowPipePortGhostDecoration({
      activeTool: "select",
      useBlueprintStyle: false,
      suppressPipes: true,
    })).toBe(false);
  });

  it("远景淡出且正常缩放保持完整透明度", () => {
    expect(resolvePipePortGhostZoomAlpha(8)).toBe(0);
    expect(resolvePipePortGhostZoomAlpha(14)).toBe(0.5);
    expect(resolvePipePortGhostZoomAlpha(20)).toBe(1);
  });
});

function createEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"],
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}
