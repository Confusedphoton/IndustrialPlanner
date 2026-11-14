// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { ITEM_FLUID_COLOR_SOURCE_URL } from "@/registry/item-definition";


describe("Registry 流体配色档案", () => {
  it("记录网站来源，并为每种流体相态保留完整运行时颜色层", () => {
    expect(ITEM_FLUID_COLOR_SOURCE_URL).toBe(
      "https://hsyhhssyy.github.io/Endfield-Building-TopView-Assets/buildings/logistics/fluid-profiles.json",
    );
    const registry = createRegistryContract();
    const registryFluids = registry.itemDefinitions.filter((item) =>
      item.tags.includes("liquid") || item.tags.includes("gas")
    );
    expect(registryFluids.length).toBeGreaterThan(0);

    for (const item of registryFluids) {
      const roles = item.tags.includes("gas") ? ["body", "skin"] : ["body", "skin", "skin2", "splash"];
      expect(Object.keys(item.fluidColors ?? {}).sort(), item.id).toEqual([...roles].sort());
      expect(Object.values(item.fluidColors ?? {}).every((color) => /^#[0-9a-f]{6}$/.test(color)), item.id).toBe(true);
      expect(item.tags.some((tag) => /^(?:gas_color|fluid_color|liquid_color):/.test(tag)), item.id)
        .toBe(false);
    }
  });
});
