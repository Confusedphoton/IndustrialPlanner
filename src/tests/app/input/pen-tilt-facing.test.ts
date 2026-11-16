import { describe, expect, it } from "vitest";

import { resolveTiltFacing } from "@/app/input/gesture/actions/hypergryph/hypergryph-pen-tilt-facing-module";

describe("pen tilt facing (experiment)", () => {
  it("maps a clear lean to one of four facings and ignores an upright pen", () => {
    expect(resolveTiltFacing(0, -40)).toBe(0);
    expect(resolveTiltFacing(40, 0)).toBe(90);
    expect(resolveTiltFacing(5, 45)).toBe(180);
    expect(resolveTiltFacing(-35, 10)).toBe(270);
    expect(resolveTiltFacing(8, -10)).toBeNull();
  });
});
