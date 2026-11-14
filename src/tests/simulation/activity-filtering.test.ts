import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import {
  createWorldDocument,
  type WorldDocument,
} from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { createRegistryContract } from "@/registry";
import {
  ACTIVITY_LIMITED_FORMULA_1_ID,
} from "@/shared/registry/activity-availability";
import { compileSimulationTopology } from "@/simulation/topology/compiler";

const ACTIVITY_ITEM_ID = "item_activity_xiranite_cmpt";
const ACTIVITY_RECIPE_ID = "r_component_activity_xiranite_cmpt_from_xiranite_powder_basic";

function createActivityTestEntityDefinition(): EntityDefinition {
  return {
    id: "test_activity_machine",
    nameKey: "test.activityMachine",
    spriteId: "test_activity_machine",
    iconPath: "device-icons/test_activity_machine.webp",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    displayOrder: 10000,
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [
      {
        id: "item_port",
        kind: ItemDomainFlag.Solid,
        isPipe: false,
        direction: "input",
        ports: [
          {
            id: "port_1",
            localCellX: 0,
            localCellY: 0,
            edge: "NORTH",
            acceptRule: { base: { kind: "item", itemId: ACTIVITY_ITEM_ID }, exclude: [] },
            priorityGroup: 5,
            roundRobinSeed: 0,
          },
        ],
      },
    ],
    storageSlotGroups: [
      {
        id: "buffer",
        kind: ItemDomainFlag.Solid,
        slots: [
          {
            id: "slot_1",
            capacity: 10,
            itemFilter: "type",
            itemFilterType: ItemDomainFlag.Solid,
            lock: ACTIVITY_ITEM_ID,
            initialItemType: ACTIVITY_ITEM_ID,
            initialCount: 5,
            ignoreStock: true,
          },
        ],
      },
    ],
    recipeChannels: [
      {
        id: "default",
        ingredientStorageGroupIds: ["buffer"],
        productStorageGroupIds: ["buffer"],
        manualRecipeOnly: true,
      },
    ],
    portStorageBindings: [
      {
        id: "bind_item_port",
        portGroupId: "item_port",
        storageSlotGroupId: "buffer",
      },
    ],
  };
}

function createActivityTestDocument(): WorldDocument {
  return {
    ...createWorldDocument(),
    entities: loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/simulation/activity-filtering/scene-01-variant-1.schema7.json").entities,
    entityOrder: ["machine"],
  };
}

function compileWithActivities(activeActivityIds: readonly string[]) {
  const registry = createRegistryContract();
  registry.entityDefinitions = [...registry.entityDefinitions, createActivityTestEntityDefinition()];

  return compileSimulationTopology({
    document: createActivityTestDocument(),
    registry,
    simulationMode: "single-base",
    poweredEntityIds: new Set(["machine"]),
    activeActivityIds,
  });
}

describe("simulation activity filtering", () => {
  it("records the activity set instead of compiling registry catalogs into topology", () => {
    const inactiveTopology = compileWithActivities([]);
    const activeTopology = compileWithActivities([ACTIVITY_LIMITED_FORMULA_1_ID]);

    expect(inactiveTopology.activeActivityIds).toEqual([]);
    expect(activeTopology.activeActivityIds).toEqual([ACTIVITY_LIMITED_FORMULA_1_ID]);
  });

  it("treats inactive activity slot configuration and links as empty", () => {
    const inactiveTopology = compileWithActivities([]);
    const slot = inactiveTopology.slots["device:machine/node:buffer/slot:slot_1"];
    const port = inactiveTopology.ports["device:machine/port:item_port.port_1.input"];
    const channel = inactiveTopology.devices["device:machine"]?.recipeChannels[0];

    expect(slot).toMatchObject({
      lock: null,
      initialItemType: null,
      initialCount: 0,
      ignoreStock: false,
    });
    expect(port?.acceptRule.base).toEqual({ kind: "none" });
    expect(channel?.defaultRecipeId).toBeNull();
  });

  it("keeps activity slot configuration and manual recipe when the activity is active", () => {
    const activeTopology = compileWithActivities([ACTIVITY_LIMITED_FORMULA_1_ID]);
    const slot = activeTopology.slots["device:machine/node:buffer/slot:slot_1"];
    const port = activeTopology.ports["device:machine/port:item_port.port_1.input"];
    const channel = activeTopology.devices["device:machine"]?.recipeChannels[0];

    expect(slot).toMatchObject({
      lock: ACTIVITY_ITEM_ID,
      initialItemType: ACTIVITY_ITEM_ID,
      initialCount: 5,
      ignoreStock: true,
    });
    expect(port?.acceptRule.base).toEqual({ kind: "item", itemId: ACTIVITY_ITEM_ID });
    expect(channel?.defaultRecipeId).toBe(ACTIVITY_RECIPE_ID);
  });
});
