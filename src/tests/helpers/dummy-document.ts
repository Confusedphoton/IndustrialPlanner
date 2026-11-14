import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import {
  DEFAULT_WORLD_BASE_ID,
  WORLD_DOCUMENT_SCHEMA_VERSION,
  type WorldDocument,
} from "@/domain/document/world-document";

export function createDummyWorldDocument(): WorldDocument {
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/common/dummy-world.schema7.json");
  return {
    schemaVersion: WORLD_DOCUMENT_SCHEMA_VERSION,
    documentKey: "11111111-1111-4111-8111-111111111111",
    baseId: DEFAULT_WORLD_BASE_ID,
    meta: {
      id: "dummy-world",
      name: "Dummy World",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    entities: blueprint.entities,
    entityOrder: blueprint.entityOrder,
    slotLinks: blueprint.slotLinks,
    regions: blueprint.regions,
    documentSettings: {
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
        displayRotation: 0,
      },
      gridSize: 1,
      showDiagnostics: false,
      powerMode: "infinite",
    },
  };
}
