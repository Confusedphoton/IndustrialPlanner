import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { collectRangeInstances, createRangeInteractionRules, resolveRangeInteractionVisualState } from "@/renderer/ranges";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);
const rules = createRangeInteractionRules(
  registry.recipeDefinitions,
);

describe("resolveGasInteractionVisualState", () => {
  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights only fully contained gas-dependent devices during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-01-variant-1.schema7.json"));

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["vaporizer-preview"],
      ghostEntityIds: activeTool === "move" ? ["vaporizer-original"] : [],
    });

    expect(state.highlightedEntityIds).toEqual(new Set([
      "fully-contained-oven",
      "fully-contained-reactor",
    ]));
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every gas diffuser fully covering a gas-dependent preview during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-02-variant-1.schema7.json"));

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["oven-preview"],
      ghostEntityIds: activeTool === "move" ? ["oven-original"] : [],
    });

    expect(state.highlightedEntityIds).toEqual(new Set([
      "vaporizer-a",
      "vaporizer-b",
    ]));
  });

  it("does not activate the interaction during a batch move", () => {
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-03-variant-1.schema7.json"));

    const state = resolveState({
      activeTool: "move",
      moveKind: "batch",
      entities,
      previewEntityIds: ["oven-preview"],
      ghostEntityIds: ["oven-original"],
    });

    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it("does not activate the interaction for multiple preview entities", () => {
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-04-variant-1.schema7.json"));

    const state = resolveState({
      activeTool: "single-placement",
      moveKind: null,
      entities,
      previewEntityIds: ["oven-preview-a", "oven-preview-b"],
    });

    expect(state.highlightedEntityIds).toEqual(new Set());
  });
});

function resolveState(options: {
  activeTool: "single-placement" | "move";
  moveKind: "ordinary" | "batch" | null;
  entities: readonly WorldEntity[];
  previewEntityIds: readonly string[];
  ghostEntityIds?: readonly string[];
}) {
  return resolveRangeInteractionVisualState({
    alwaysShowPowerRange: false,
    ranges: collectRangeInstances(options.entities, entityDefinitionMap),
    activeTool: options.activeTool,
    moveKind: options.moveKind,
    entities: options.entities,
    previewEntityIds: options.previewEntityIds,
    ghostEntityIds: options.ghostEntityIds ?? [],
    entityDefinitionMap,
    rules,
  });
}


