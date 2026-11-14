import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { collectRangeInstances, createRangeInteractionRules, resolveRangeInteractionVisualState } from "@/renderer/ranges";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);

describe("resolvePowerInteractionVisualState", () => {
  it("shows every range without power-specific highlights when the setting is enabled", () => {
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/scene-01-variant-1.schema7.json"));

    const state = resolveState({
      alwaysShowPowerRange: true,
      activeTool: "single-placement",
      moveKind: null,
      entities,
      previewEntityIds: ["storage-preview"],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set(["power"]));
    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every power pole covering a protocol storage footprint during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/scene-02-variant-1.schema7.json"));

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["storage-preview"],
      ghostEntityIds: activeTool === "move" ? ["storage"] : [],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set(["power-a", "power-b"]));
    expect(state.highlightedEntityIds).toEqual(new Set(["power-a", "power-b"]));
  });

  it("does not activate the interaction during a batch move", () => {
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/scene-03-variant-1.schema7.json"));

    const state = resolveState({
      activeTool: "move",
      moveKind: "batch",
      entities,
      previewEntityIds: ["storage-preview"],
      ghostEntityIds: ["storage"],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set());
    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every consuming device in a preview power pole range during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/scene-04-variant-1.schema7.json"));

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["power-preview"],
      ghostEntityIds: activeTool === "move" ? ["power-original"] : [],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set(["power-preview"]));
    expect(state.highlightedEntityIds).toEqual(new Set(["protocol-storage"]));
  });
});

function resolveState(options: {
  alwaysShowPowerRange?: boolean;
  activeTool: "single-placement" | "move";
  moveKind: "ordinary" | "batch" | null;
  entities: readonly WorldEntity[];
  previewEntityIds: readonly string[];
  ghostEntityIds?: readonly string[];
}) {
  const ranges = collectRangeInstances(options.entities, entityDefinitionMap);
  const state = resolveRangeInteractionVisualState({
    ...options, alwaysShowPowerRange: options.alwaysShowPowerRange ?? false,
    ghostEntityIds: options.ghostEntityIds ?? [], entityDefinitionMap, ranges,
    rules: createRangeInteractionRules(registry.recipeDefinitions),
  });
  return { ...state, visiblePowerRangeEntityIds: new Set(ranges.filter((range) =>
    state.visibleRangeKeys.has(range.key)).map((range) => range.entityId)) };
}


