import { describe, expect, it } from "vitest";

import { resolveTiltFacing } from "@/app/input/gesture/actions/hypergryph/hypergryph-pen-tilt-facing-module";

describe("pen tilt facing (experiment)", () => {
  it("maps a clear lean to one of four facings and ignores an upright pen", () => {
    expect(resolveTiltFacing(0, -40, 0)).toBe(0);
    expect(resolveTiltFacing(40, 0, 0)).toBe(90);
    expect(resolveTiltFacing(5, 45, 0)).toBe(180);
    expect(resolveTiltFacing(-35, 10, 0)).toBe(270);
    expect(resolveTiltFacing(8, -10, 0)).toBeNull();
  });

  it("faces the device the way the pen leans on screen when the view is rotated", () => {
    // 视图顺时针转 90° 后，网格朝上的设备在屏幕上朝右。
    expect(resolveTiltFacing(40, 0, 90)).toBe(0);
    expect(resolveTiltFacing(0, -40, 90)).toBe(270);
  });
});
