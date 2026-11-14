
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { collectRangeInstances, createRangeInteractionRules, resolveRangeInteractionVisualState, resolveRangePresentation } from "@/renderer/ranges";
import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import type { SimulationEnvironmentRangeReadModel } from "@/domain/simulation/types/simulation-types";

const registry = createRegistryContract();
const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-02-variant-1.schema7.json"));
const ranges = collectRangeInstances(entities, definitions);
const active: SimulationEnvironmentRangeReadModel = {
  sourceDeviceId: "device:vaporizer-a", rangeId: "gas", rotation: 0,
  itemId: "item_gas_inert", gridRect: { x: -5, y: -5, width: 13, height: 13 },
};
function presentation(options: { active?: boolean; ready?: boolean; supportsAnimation?: boolean; batch?: boolean } = {}) {
  return resolveRangePresentation({
    ranges,
    interaction: resolveRangeInteractionVisualState({
      entities, ranges, entityDefinitionMap: definitions, rules: createRangeInteractionRules(registry.recipeDefinitions),
      activeTool: "move", moveKind: options.batch ? "batch" : "ordinary", alwaysShowPowerRange: false,
      previewEntityIds: [], ghostEntityIds: options.batch ? ["vaporizer-a"] : [],
    }),
    activeGasRanges: options.active ? [active] : [], resolveGasColor: () => 0x00d5ff,
    supportsAnimation: options.supportsAnimation ?? true, isAnimationReady: () => options.ready ?? false,
  });
}

describe("统一范围中的气体展示", () => {
  it("未运行、空闲和草稿保持范围框", () => {
    const result = presentation();
    expect(result.outlines).toHaveLength(3);
    expect(result.outlines.every((outline) => outline.fillAlpha === 0)).toBe(true);
    expect(result.animations).toEqual([]);
  });
  it("仅工作设备进入动画，停止后恢复范围框", () => {
    const result = presentation({ active: true, ready: true });
    expect(result.outlines).toHaveLength(2);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0]).toMatchObject({ gridRect: active.gridRect, color: 0x00d5ff, rotation: 0 });
    expect(presentation().outlines).toHaveLength(3);
  });
  it("加载期间填色回退，资源就绪后撤下填色", () => {
    expect(presentation({ active: true }).outlines.filter((outline) => outline.fillAlpha > 0))
      .toEqual([{ gridRect: active.gridRect, color: 0x00d5ff, fillAlpha: 0.07, strokeAlpha: 0.86, strokeScale: 1.1 }]);
    expect(presentation({ active: true, ready: true }).outlines.every((outline) => outline.fillAlpha === 0)).toBe(true);
  });
  it("蓝图外观和不支持动画时仅保留气体色矩形，切回后恢复动画", () => {
    const result = presentation({ active: true, ready: true, supportsAnimation: false });
    expect(result.animations).toEqual([]);
    expect(result.outlines.some((outline) => outline.fillAlpha === 0.07 && outline.color === 0x00d5ff)).toBe(true);
    expect(presentation({ active: true, ready: true }).animations).toHaveLength(1);
  });
  it("批量移动隐藏原件范围与动画，其他设备仍显示", () => {
    const result = presentation({ active: true, ready: true, batch: true });
    expect(result.outlines).toHaveLength(2);
    expect(result.animations).toEqual([]);
  });
  it("同值快照得到同值绘制输入", () => {
    expect(presentation({ active: true })).toEqual(presentation({ active: true }));
  });
});
