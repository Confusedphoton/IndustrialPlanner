import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveMenuPlacement } from "@/app/shell/recipe-tree/recipe-action-menu";

function anchorAt(top: number, height = 54, left = 900): DOMRect {
  return { top, bottom: top + height, left, right: left + 150, width: 150, height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

describe("resolveMenuPlacement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { label: "below a card near the top", anchorTop: 40 },
    { label: "above a card near the bottom", anchorTop: 450 },
    { label: "clamped when neither side has room", anchorTop: 230 },
  ])("keeps a 326px menu inside a 1180x540 viewport when opened $label", ({ anchorTop }) => {
    vi.stubGlobal("innerWidth", 1180);
    vi.stubGlobal("innerHeight", 540);

    const placement = resolveMenuPlacement(anchorAt(anchorTop), 280, 326);

    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.top + Math.min(326, placement.maxHeight)).toBeLessThanOrEqual(532);
    expect(placement.left + 280).toBeLessThanOrEqual(1172);
  });

  it("limits the menu height to the viewport so it scrolls instead of clipping", () => {
    vi.stubGlobal("innerWidth", 1180);
    vi.stubGlobal("innerHeight", 300);

    const placement = resolveMenuPlacement(anchorAt(120), 280, 420);

    expect(placement.maxHeight).toBe(284);
    expect(placement.top).toBe(8);
  });
});
