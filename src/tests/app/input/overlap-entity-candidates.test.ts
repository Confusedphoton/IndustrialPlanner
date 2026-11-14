import { describe, expect, it } from "vitest";
import { createWorldDocument } from "@/domain/document/world-document";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { resolveOverlappingEntityCandidatesAtClientPoint } from "@/app/input/gesture/actions/hypergryph/overlap-entity-candidates";

describe("overlap candidates from the owning canvas", () => {
  it("filters suppressed pipe admissions, preserves stacking order, and applies candidate predicates", () => {
    const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/overlap-entity-candidates/scene-01-variant-1.schema7.json");
    const test = createCanvasTestSession({ document: { ...createWorldDocument({ baseId: blueprint.baseId }),
      entities: blueprint.entities, entityOrder: blueprint.entityOrder, regions: blueprint.regions, slotLinks: blueprint.slotLinks } });
    try {
      const { editor, canvas, view } = test;
      view.actions.setViewportClientRect({ left: 90, top: 40, width: 800, height: 600 });
      const rect = view.queries.findClientRectForGridCell({ x: 5, y: 5 })!;
      const input = { canvas, editor, position: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        pointerEntity: editor.queries.getEntityById("pipe-admission") };
      expect(resolveOverlappingEntityCandidatesAtClientPoint(input).map(entity => entity.id)).toEqual(["pipe-admission", "belt"]);
      editor.actions.setLogisticsSuppression("pipe", true);
      expect(resolveOverlappingEntityCandidatesAtClientPoint(input).map(entity => entity.id)).toEqual(["belt"]);
      editor.actions.setLogisticsSuppression("belt", true);
      expect(resolveOverlappingEntityCandidatesAtClientPoint(input)).toEqual([]);
      editor.actions.setLogisticsSuppression("pipe", false);
      expect(resolveOverlappingEntityCandidatesAtClientPoint({ ...input, filterCandidate: entity => entity.id === "belt" })).toEqual([]);
      expect(resolveOverlappingEntityCandidatesAtClientPoint({ ...input, position: { x: NaN, y: 0 } })).toEqual([]);
    } finally { test.dispose(); }
  });
});
