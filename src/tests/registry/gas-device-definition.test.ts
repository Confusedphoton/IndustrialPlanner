import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  FluidDomain,
  ItemDomainFlag,
} from "@/domain/shared/item-domain-flags";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { ITEM_DEFINITIONS } from "@/registry/item-definition";
import { RECIPE_DEFINITIONS } from "@/registry/recipe-definition";

type PortGroupDefinition = EntityDefinition["portGroups"][number];

function requireEntity(id: string): EntityDefinition {
  const definition = ENTITY_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Missing entity definition: ${id}`);
  }
  return definition;
}

function requirePortGroup(
  definition: EntityDefinition,
  portGroupId: string,
): PortGroupDefinition {
  const portGroup = definition.portGroups.find((candidate) => candidate.id === portGroupId);
  if (portGroup === undefined) {
    throw new Error(`Missing port group ${portGroupId} on ${definition.id}`);
  }
  return portGroup;
}

function expectPortLayout(
  portGroup: PortGroupDefinition,
  expected: Array<{
    readonly id: string;
    readonly localCellX: number;
    readonly localCellY: number;
    readonly edge: string;
  }>,
): void {
  expect(portGroup.ports.map((port) => ({
    id: port.id,
    localCellX: port.localCellX,
    localCellY: port.localCellY,
    edge: port.edge,
  }))).toEqual(expected);
}

function expectGasOnlyPorts(portGroup: PortGroupDefinition): void {
  expect(portGroup.kind).toBe(FluidDomain);
  expect(portGroup.isPipe).toBe(true);
  expect(portGroup.ports.map((port) => port.acceptRule)).toEqual(
    portGroup.ports.map(() => ({
      base: { kind: "domain", flags: ItemDomainFlag.Gas },
      exclude: [],
    })),
  );
}

function expectLiquidOnlyPorts(portGroup: PortGroupDefinition): void {
  expect(portGroup.kind).toBe(FluidDomain);
  expect(portGroup.isPipe).toBe(true);
  expect(portGroup.ports.map((port) => port.acceptRule)).toEqual(
    portGroup.ports.map(() => ({
      base: { kind: "domain", flags: ItemDomainFlag.Liquid },
      exclude: [],
    })),
  );
}

function expectFluidBasePorts(portGroup: PortGroupDefinition): void {
  expect(portGroup.kind).toBe(FluidDomain);
  expect(portGroup.isPipe).toBe(true);
  expect(portGroup.ports.map((port) => port.acceptRule.base)).toEqual(
    portGroup.ports.map(() => ({ kind: "domain", flags: FluidDomain })),
  );
}

describe("gas item and device definitions", () => {
  it("registers the gas shaper recipe only under its AKEData ID", () => {
    const gasShaperRecipes = RECIPE_DEFINITIONS.filter((recipe) =>
      recipe.machineId === "shaper_1_gas"
      && recipe.outputs.some((output) => output.itemId === "item_copper_jar"),
    );

    expect(gasShaperRecipes.map((recipe) => recipe.id)).toEqual([
      "shaper_gas_copper_jar_1",
    ]);
  });

  it("marks registered gas resources as natural resources", () => {
    for (const itemId of ["item_gas_inert", "item_gas_xiranite"]) {
      const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === itemId);
      expect(item?.tags).toContain("gas");
      expect(item?.tags).toContain("自然资源");
    }
  });

  it("defines gas collection pump as a placeable 3x3 manual-recipe gathering machine", () => {
    const definition = requireEntity("gas_pump_1");

    expect(definition.footprint).toEqual({ width: 3, height: 3 });
    expect(definition.uiGroup).toBe("resourcePower");
    expect(definition.tags).not.toContain("不可摆放");
    expect(definition.tags).toContain("OuterRingAllowed");
    expect(definition.tags).toContain("InnerRingNotAllowed");
    expect(definition.requiresPower).toBe(false);
    expect(definition.powerDemand).toBe(0);
    expect(definition.placementBehaviors).toEqual([
      { type: "default-placement" },
      { type: "snap-to-outer-ring-edge" },
      { type: "no-near-same-entity", range: 2 },
    ]);
    expect(definition.recipeChannels.some((channel) => channel.type === "consumption-channel"))
      .toBe(false);
    expect(definition.recipeChannels).toEqual([
      expect.objectContaining({
        id: "default",
        ingredientStorageGroupIds: [],
        productStorageGroupIds: ["gas_output_buffer"],
        manualRecipeOnly: true,
      }),
    ]);
    expect(definition.inspectors.some(
      (inspector) => inspector.type === "recipe-status",
    )).toBe(true);
    expect(definition.inspectors.some(
      (inspector) => inspector.type === "warehouse-item-link",
    )).toBe(false);
    expect(definition.placementDefaults).toBeUndefined();


  });

  it("defines solid-gas converter modes as independent devices", () => {
    const gasMode = requireEntity("transmuter_2_gastrans");
    const solidMode = requireEntity("transmuter_2_solidtrans");

    expect(gasMode.footprint).toEqual({ width: 5, height: 5 });
    expect(solidMode.footprint).toEqual({ width: 5, height: 5 });
    expectPortLayout(requirePortGroup(gasMode, "item_input"), [
      { id: "in_s_1", localCellX: 3, localCellY: 0, edge: "NORTH" },
      { id: "in_s_3", localCellX: 1, localCellY: 0, edge: "NORTH" },
    ]);
    const gasOutput = requirePortGroup(gasMode, "gas_output");
    expectPortLayout(gasOutput, [
      { id: "out_w_1", localCellX: 4, localCellY: 3, edge: "EAST" },
      { id: "out_w_3", localCellX: 4, localCellY: 1, edge: "EAST" },
    ]);
    expectGasOnlyPorts(gasOutput);
    expect(gasMode.recipeChannels.find((channel) => channel.type === "normal-channel")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["gas_output_buffer"],
    });

    const gasInput = requirePortGroup(solidMode, "gas_input");
    expectPortLayout(gasInput, [
      { id: "in_e_1", localCellX: 0, localCellY: 3, edge: "WEST" },
      { id: "in_e_3", localCellX: 0, localCellY: 1, edge: "WEST" },
    ]);
    expectGasOnlyPorts(gasInput);
    expectPortLayout(requirePortGroup(solidMode, "item_output"), [
      { id: "out_n_1", localCellX: 3, localCellY: 4, edge: "SOUTH" },
      { id: "out_n_3", localCellX: 1, localCellY: 4, edge: "SOUTH" },
    ]);
    expect(solidMode.recipeChannels.find((channel) => channel.type === "normal-channel")).toMatchObject({
      ingredientStorageGroupIds: ["gas_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("defines liquid-gas converter modes as independent devices", () => {
    const gasMode = requireEntity("transmuter_1_gastrans");
    const liquidMode = requireEntity("transmuter_1_liquidtrans");
    const liquidInput = requirePortGroup(gasMode, "liquid_input");
    const gasOutput = requirePortGroup(gasMode, "gas_output");
    const gasInput = requirePortGroup(liquidMode, "gas_input");
    const liquidOutput = requirePortGroup(liquidMode, "liquid_output");

    expect(gasMode.footprint).toEqual({ width: 5, height: 5 });
    expect(liquidMode.footprint).toEqual({ width: 5, height: 5 });
    expectPortLayout(liquidInput, [
      { id: "in_e_1", localCellX: 0, localCellY: 3, edge: "WEST" },
      { id: "in_e_3", localCellX: 0, localCellY: 1, edge: "WEST" },
    ]);
    expectLiquidOnlyPorts(liquidInput);
    expectPortLayout(gasOutput, [
      { id: "out_w_1", localCellX: 4, localCellY: 3, edge: "EAST" },
      { id: "out_w_3", localCellX: 4, localCellY: 1, edge: "EAST" },
    ]);
    expectGasOnlyPorts(gasOutput);
    expectPortLayout(gasInput, [
      { id: "in_e_1", localCellX: 0, localCellY: 3, edge: "WEST" },
      { id: "in_e_3", localCellX: 0, localCellY: 1, edge: "WEST" },
    ]);
    expectGasOnlyPorts(gasInput);
    expectPortLayout(liquidOutput, [
      { id: "out_w_1", localCellX: 4, localCellY: 3, edge: "EAST" },
      { id: "out_w_3", localCellX: 4, localCellY: 1, edge: "EAST" },
    ]);
    expectLiquidOnlyPorts(liquidOutput);
  });

  it("defines gas reactor as gas-only west input and east output", () => {
    const definition = requireEntity("gas_reactor_1");
    const gasInput = requirePortGroup(definition, "gas_input");
    const gasOutput = requirePortGroup(definition, "gas_output");

    expect(definition.footprint).toEqual({ width: 5, height: 5 });
    expectPortLayout(gasInput, [
      { id: "in_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "in_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    ]);
    expectPortLayout(gasOutput, [
      { id: "out_e_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "out_e_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectGasOnlyPorts(gasInput);
    expectGasOnlyPorts(gasOutput);
    expect(definition.storageSlotGroups.map((slotGroup) => ({
      id: slotGroup.id,
      kind: slotGroup.kind,
      itemFilterType: slotGroup.slots[0]?.itemFilterType,
      capacity: slotGroup.slots[0]?.capacity,
    }))).toEqual([
      {
        id: "gas_input_buffer",
        kind: FluidDomain,
        itemFilterType: ItemDomainFlag.Gas,
        capacity: 50,
      },
      {
        id: "gas_output_buffer",
        kind: FluidDomain,
        itemFilterType: ItemDomainFlag.Gas,
        capacity: 50,
      },
    ]);
  });

  it("makes liquid purifier pipe ports and buffers accept fluid", () => {
    const definition = requireEntity("liquid_purifier_1");
    const fluidInput = requirePortGroup(definition, "fluid_input");
    const fluidOutput = requirePortGroup(definition, "fluid_output");

    expectPortLayout(fluidInput, [
      { id: "in_s_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "in_s_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    ]);
    expectPortLayout(fluidOutput, [
      { id: "out_n_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "out_n_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectFluidBasePorts(fluidInput);
    expectFluidBasePorts(fluidOutput);
    expect(fluidOutput.ports.flatMap((port) => port.acceptRule.exclude)).not.toContain("item_gas_inert");
    expect(fluidOutput.ports.flatMap((port) => port.acceptRule.exclude)).not.toContain("item_gas_xiranite");
    expect(definition.storageSlotGroups[0]).toMatchObject({
      id: "fluid_input_buffer",
      kind: FluidDomain,
      slots: [{ capacity: 50, itemFilterType: FluidDomain }],
    });
    expect(definition.storageSlotGroups[1]).toMatchObject({
      id: "fluid_output_buffer",
      kind: FluidDomain,
      slots: [
        { capacity: 50, itemFilterType: FluidDomain },
        { capacity: 50, itemFilterType: FluidDomain },
      ],
    });
  });

  it("makes liquid filling machine pipe input and buffer accept fluid", () => {
    const definition = requireEntity("filling_pd_mc_1_liquid");
    const fluidInput = requirePortGroup(definition, "fluid_input");
    const fluidInputBuffer = definition.storageSlotGroups.find(
      (slotGroup) => slotGroup.id === "fluid_input_buffer",
    );

    expectFluidBasePorts(fluidInput);
    expect(fluidInputBuffer).toMatchObject({
      kind: FluidDomain,
      slots: [{ capacity: 50, itemFilterType: FluidDomain }],
    });
  });

  it("makes dismantler pipe output and buffer accept fluid", () => {
    const definition = requireEntity("dismantler_1");
    const fluidOutput = requirePortGroup(definition, "fluid_output");
    const fluidOutputBuffer = definition.storageSlotGroups.find(
      (slotGroup) => slotGroup.id === "fluid_output_buffer",
    );

    expectFluidBasePorts(fluidOutput);
    expect(fluidOutputBuffer).toMatchObject({
      kind: FluidDomain,
      slots: [{ capacity: 50, itemFilterType: FluidDomain }],
    });
  });

  it("assigns gas filling recipes to the liquid filling machine", () => {
    const gasItemIds = new Set(
      ITEM_DEFINITIONS
        .filter((item) => item.tags.includes("gas"))
        .map((item) => item.id),
    );
    const gasFillingRecipes = RECIPE_DEFINITIONS.filter((recipe) =>
      recipe.tags.includes("bottle_filling")
      && recipe.inputs.some((input) => gasItemIds.has(input.itemId)),
    );

    expect(gasFillingRecipes).toHaveLength(8);
    expect(gasFillingRecipes.every(
      (recipe) => recipe.machineId === "filling_pd_mc_1_liquid",
    )).toBe(true);
  });
});
