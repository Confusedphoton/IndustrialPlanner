import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import {
  resolveBaseBoundaryGridRect, resolveBaseBoundaryGridRects, resolveBaseBoundaryStrokeWidth,
  resolveBaseNameplateAnchor, resolveBaseOuterGridRect, resolveBaseOuterGridRects, resolveExpandedGridRect,
} from "@/renderer/scene/decorations/BaseBoundaryDecoration";
import {
  resolveSceneBoundaryLines, resolveSceneOuterRects, resolveSceneViewportGridRect, resolveSceneWarningRects,
} from "@/renderer/scene/decorations/scene-space-layout";
import type { GridRotation } from "@/domain/shared/grid";

const registry = createRegistryContract();
const base = (id: string) => registry.baseDefinitions.find((value) => value.id === id)!;
const noRing = { top: 0, right: 0, bottom: 0, left: 0 };
const view = {
  viewportBounds: { left: 0, top: 0, width: 1000, height: 600 },
  viewportState: { width: 1000, height: 600, resolution: 1, centerX: 35, centerY: 10, gridCellPixelSize: 10, displayRotation: 0 as GridRotation },
};

describe("scene boundary and ground geometry", () => {
  it("preserves both agricultural nameplate anchors through pan and rotation", () => {
    const areas = resolveBaseAreas(base("wuling_agricultural_land"));
    expect(areas.map((area) => area.nameplate)).toEqual(["武陵农用地", "缘缘庄"]);
    const anchors = areas.map((area) => resolveBaseNameplateAnchor(area, view)!);
    expect(anchors.map((anchor) => anchor.x)).toEqual([-50, 990]);
    expect(anchors.every((anchor) => anchor.y < 80)).toBe(true);
    const moved = { ...view, viewportState: { ...view.viewportState, centerX: 37 } };
    expect(areas.map((area) => resolveBaseNameplateAnchor(area, moved)!.x)).toEqual([-70, 970]);
    const rotated = { ...moved, viewportState: { ...moved.viewportState, displayRotation: 90 as const } };
    const rotatedAnchors = areas.map((area) => resolveBaseNameplateAnchor(area, rotated)!);
    expect(rotatedAnchors.map((anchor) => anchor.x)).toEqual([-40, 20]);
    expect(rotatedAnchors[1]!.y - rotatedAnchors[0]!.y).toBe(1040);
    expect(resolveBaseNameplateAnchor(resolveBaseAreas(base("wuling_protocol_core"))[0]!, view)).toBeNull();
  });

  it.each([
    ["wuling_protocol_core", 80, 10], ["valley4_refugee_shelter", 40, 5], ["draft_box", 320, 20],
  ] as const)("keeps finite base dimensions and outer rings: %s", (id, size, ring) => {
    expect(resolveBaseBoundaryGridRect(base(id))).toEqual({ x: 0, y: 0, width: size, height: size });
    expect(resolveBaseBoundaryGridRects(base(id))).toEqual([{ x: 0, y: 0, width: size, height: size }]);
    const outer = { x: -ring, y: -ring, width: size + ring * 2, height: size + ring * 2 };
    expect(resolveBaseOuterGridRect(base(id))).toEqual(outer);
    expect(resolveBaseOuterGridRects(base(id))).toEqual([outer]);
    expect(resolveExpandedGridRect(outer, 2)).toEqual({ x: -ring - 2, y: -ring - 2, width: size + ring * 2 + 4, height: size + ring * 2 + 4 });
    expect(resolveBaseBoundaryStrokeWidth(10)).toBe(1.4375);
  });

  it.each([0, 90, 180, 270] as const)("clips rays without creating viewport borders at rotation %i", (rotation) => {
    const ctx = { ...view, viewportState: { ...view.viewportState, centerX: 0, centerY: 0, displayRotation: rotation } };
    const space = { areas: [{ id: "half-plane", bounds: { minX: null, maxX: null, minY: 0, maxY: null }, outerRing: noRing }] };
    const lines = resolveSceneBoundaryLines(space, ctx);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(Object.values(line.from).every(Number.isFinite)).toBe(true);
    expect(Object.values(line.to).every(Number.isFinite)).toBe(true);
    if (rotation === 0 || rotation === 180) {
      expect(line.from.y).toBe(300); expect(line.to.y).toBe(300);
    } else {
      expect(line.from.x).toBe(500); expect(line.to.x).toBe(500);
    }
    const viewport = resolveSceneViewportGridRect(ctx, 16, 16);
    const outer = resolveSceneOuterRects(space, viewport);
    expect(outer.every((rect) => Object.values(rect).every(Number.isFinite))).toBe(true);
    const warnings = resolveSceneWarningRects(space, viewport, 2);
    expect(warnings.every((rect) => rect.y === -2 && rect.height === 2)).toBe(true);
  });

  it("draws no boundary or warning for fully unbounded space, and keeps empty space empty", () => {
    const space = { areas: [{ id: "all", bounds: { minX: null, maxX: null, minY: null, maxY: null }, outerRing: noRing }] };
    const viewport = resolveSceneViewportGridRect(view, 16, 16);
    expect(resolveSceneBoundaryLines(space, view)).toEqual([]);
    expect(resolveSceneOuterRects(space, viewport)).toEqual([viewport]);
    expect(resolveSceneWarningRects(space, viewport, 2)).toEqual([]);
    expect(resolveSceneOuterRects({ areas: [] }, viewport)).toEqual([]);
    expect(resolveSceneBoundaryLines({ areas: [] }, view)).toEqual([]);
  });

  it("does not warn inside touching or overlapping regions", () => {
    const space = { areas: [
      { id: "a", bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 }, outerRing: noRing },
      { id: "b", bounds: { minX: 8, maxX: 20, minY: 0, maxY: 10 }, outerRing: noRing },
    ] };
    const warnings = resolveSceneWarningRects(space, { x: -5, y: -5, width: 30, height: 20 }, 2);
    expect(warnings.reduce((area, rect) => area + rect.width * rect.height, 0)).toBe(24 * 14 - 20 * 10);
    expect(warnings.some((rect) => rect.x <= 9 && rect.x + rect.width > 9 && rect.y <= 5 && rect.y + rect.height > 5)).toBe(false);
    const separated = { areas: [{ ...space.areas[0]!, bounds: { minX: 0, maxX: 5, minY: 0, maxY: 5 } }, { ...space.areas[1]!, bounds: { minX: 10, maxX: 15, minY: 0, maxY: 5 } }] };
    expect(resolveSceneOuterRects(separated, { x: -5, y: -5, width: 30, height: 20 })).toEqual([
      { x: 0, y: 0, width: 5, height: 5 }, { x: 10, y: 0, width: 5, height: 5 },
    ]);
  });
});

