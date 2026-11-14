import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";

function getDefaultChannel(entityId: string) {
  const registry = createRegistryContract();
  const entity = registry.entityDefinitions.find((candidate) => candidate.id === entityId);
  const channel = entity?.recipeChannels.find((candidate) => candidate.id === "default");

  if (entity === undefined || channel === undefined) {
    throw new Error(`Missing default channel for ${entityId}`);
  }

  return channel;
}

describe("recipe channel definitions", () => {
  it("declares grinder input and output buffers explicitly", () => {
    expect(getDefaultChannel("grinder_1")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("declares filling machine input and output buffers explicitly", () => {
    expect(getDefaultChannel("filling_pd_mc_1")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("declares liquid filling machine input and output buffers explicitly", () => {
    expect(getDefaultChannel("filling_pd_mc_1_liquid")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer", "fluid_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("declares water pump fluid buffer as the product of one manual channel", () => {
    expect(getDefaultChannel("water_pump_1")).toMatchObject({
      ingredientStorageGroupIds: [],
      productStorageGroupIds: ["fluid_output_buffer"],
      manualRecipeOnly: true,
    });
  });

  it("declares gas pump buffer as the product of one manual channel", () => {
    expect(getDefaultChannel("gas_pump_1")).toMatchObject({
      ingredientStorageGroupIds: [],
      productStorageGroupIds: ["gas_output_buffer"],
      manualRecipeOnly: true,
    });
  });

  it.each(["gas_pump_1", "water_pump_1"])(
    "%s does not expose or place warehouse item links",
    (definitionId) => {
      const registry = createRegistryContract();
      const definition = registry.entityDefinitions.find((candidate) =>
        candidate.id === definitionId,
      );

      expect(definition?.inspectors.some(
        (inspector) => inspector.type === "warehouse-item-link",
      )).toBe(false);
      expect(definition?.inspectors.some(
        (inspector) => inspector.type === "recipe-status",
      )).toBe(true);
      expect(definition?.placementDefaults).toBeUndefined();
    },
  );
});
