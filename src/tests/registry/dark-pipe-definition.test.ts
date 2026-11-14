import { describe, expect, it } from "vitest";

import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import {
  ENTITY_INPUT_ROUTING_STRATEGY,
  ENTITY_SIMULATION_BEHAVIOR_TYPE,
} from "@/domain/registry/types/entity-simulation-behavior";
import {
  FluidDomain,
  RecipeItemDomainId,
} from "@/domain/shared/item-domain-flags";
import { createRegistryContract } from "@/registry";

function getEntity(id: string) {
  const registry = createRegistryContract();
  const entity = registry.entityDefinitions.find((candidate) => candidate.id === id);

  if (entity === undefined) {
    throw new Error(`Missing entity ${id}`);
  }

  return entity;
}

describe("dark pipe definitions", () => {
  it.each(["udpipe_loader_1", "udpipe_loader_2"])(
    "declares mode-independent warehouse ingress for %s",
    (definitionId) => {
      const registry = createRegistryContract();
      const definition = getEntity(definitionId);

      expect(definition.simulationBehaviors).toEqual([{
        type: ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting,
        strategy: ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked,
        storageSlotGroupIds: ["loader_buffer"],
      }]);
      expect(registry.queries.findEntityDefinition(definitionId)).toBe(definition);
    },
  );

  it("configures the single-port inlet as a channel-free warehouse ingress", () => {
    const inlet = getEntity("udpipe_loader_1");

    expect(inlet.tags).not.toContain("WarehouseSink");
    expect(inlet.storageSlotGroups).toHaveLength(1);
    expect(inlet.storageSlotGroups[0]).toMatchObject({
      id: "loader_buffer",
      kind: FluidDomain,
      slots: [
        expect.objectContaining({
          id: "slot_1",
          capacity: 500,
          itemFilterType: FluidDomain,
        }),
      ],
    });
    expect(inlet.portStorageBindings).toEqual([
      { id: "bind_fluid_input", portGroupId: "fluid_input", storageSlotGroupId: "loader_buffer" },
    ]);
    expect(inlet.recipeChannels).toEqual([]);
    expect(inlet.inspectors).toEqual(expect.arrayContaining([
      { type: INSPECTOR_TYPE.darkPipeLink },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["loader_buffer"] },
    ]));
  });

  it("configures the multi-port inlet as a channel-free warehouse ingress sharing one slot", () => {
    const inlet = getEntity("udpipe_loader_2");

    expect(inlet.storageSlotGroups).toHaveLength(1);
    expect(inlet.storageSlotGroups[0]?.id).toBe("loader_buffer");
    expect(inlet.storageSlotGroups[0]?.slots[0]?.capacity).toBe(500);
    expect(inlet.portGroups[0]?.ports).toHaveLength(2);
    expect(inlet.portStorageBindings).toEqual([
      { id: "bind_fluid_input", portGroupId: "fluid_input", storageSlotGroupId: "loader_buffer" },
    ]);
    expect(inlet.recipeChannels).toEqual([]);
    expect(inlet.recipeChannelBehavior).toBeUndefined();
    expect(inlet.inspectors).toEqual(expect.arrayContaining([
      { type: INSPECTOR_TYPE.darkPipeLink },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["loader_buffer"] },
    ]));
  });

  it("configures dark pipe outlets with a stable warehouse buffer and rate-limited transport channels", () => {
    for (const id of ["udpipe_unloader_1", "udpipe_unloader_2"]) {
      const outlet = getEntity(id);
      const channelCount = id === "udpipe_unloader_1" ? 2 : 4;

      expect(outlet.tags).not.toContain("WarehouseSink");
      expect(outlet.storageSlotGroups).toHaveLength(2);
      expect(outlet.storageSlotGroups[0]).toMatchObject({
        id: "unloader_buffer",
        kind: FluidDomain,
        slots: [
          expect.objectContaining({
            id: "slot_1",
            capacity: 500,
            initialItemType: null,
            initialCount: 0,
            itemFilterType: FluidDomain,
          }),
        ],
      });
      expect(outlet.storageSlotGroups[1]).toMatchObject({
        id: "transport_input",
        kind: FluidDomain,
        slots: [
          expect.objectContaining({
            id: "slot_1",
            capacity: 500,
            initialItemType: null,
            initialCount: 0,
            itemFilterType: FluidDomain,
          }),
        ],
      });
      expect(outlet.recipeChannels).toEqual(
        Array.from({ length: channelCount }, (_, index) => ({
          id: `transport_${index + 1}`,
          type: "normal-channel",
          ingredientStorageGroupIds: ["transport_input"],
          productStorageGroupIds: ["unloader_buffer"],
          manualRecipeOnly: undefined,
        })),
      );
      expect(outlet.recipeChannelBehavior).toEqual({
        allowDuplicateRecipesAcrossChannels: true,
      });
      expect(outlet.portStorageBindings).toEqual([
        { id: "bind_fluid_output", portGroupId: "fluid_output", storageSlotGroupId: "unloader_buffer" },
      ]);
      expect(outlet.inspectors).toEqual(expect.arrayContaining([
        { type: INSPECTOR_TYPE.darkPipeLink },
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unloader_buffer"] },
        { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["unloader_buffer"] },
      ]));
    }
  });

  it.each([
    ["r_udpipe_unloader_transport_fluid_any_internal", "udpipe_unloader_1"],
    ["r_udpipe_unloader_multi_transport_fluid_any_internal", "udpipe_unloader_2"],
  ])("registers one-second single-item transport recipe %s", (recipeId, machineId) => {
    const recipe = createRegistryContract().queries.findRecipeDefinition(recipeId);

    expect(recipe).toMatchObject({
      id: recipeId,
      durationSeconds: 1,
      inputs: [{ itemId: RecipeItemDomainId.Fluid, amount: 1 }],
      outputs: [{ itemId: "same-as-input", amount: 1 }],
      primaryOutputs: [],
      machineId,
      recipeType: "reserved-item",
    });
  });
});
