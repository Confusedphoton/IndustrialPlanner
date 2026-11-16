import { describe, expect, it } from "vitest";

import {
  fitMarkingMenuOrigin,
  resolveMarkingMenuDeviceId,
  resolveMarkingMenuGroupPosition,
  resolveMarkingMenuItemPosition,
  trackMarkingMenuPointer,
  type MarkingMenuState,
} from "@/app/canvas/marking-menu";

const groups = Array.from({ length: 8 }, (_, groupIndex) => ({
  titleKey: `group-${groupIndex}`,
  deviceIds: Array.from({ length: groupIndex === 6 ? 20 : 4 }, (_, deviceIndex) => `g${groupIndex}-d${deviceIndex}`),
}));

const WIDE_CANVAS = { left: 0, top: 0, width: 2000, height: 2000 };

function openAt(origin = { x: 500, y: 500 }, bounds = WIDE_CANVAS): MarkingMenuState {
  return { origin: fitMarkingMenuOrigin(origin, bounds), bounds, pointer: "mouse", mode: "drag", groups, level: 1, groupIndex: null, itemIndex: null };
}

function flick(state: MarkingMenuState, path: ReadonlyArray<{ x: number; y: number }>): MarkingMenuState {
  return path.reduce(trackMarkingMenuPointer, state);
}

describe("marking menu", () => {
  it("keeps every group and device on the canvas when opened in a corner", () => {
    const bounds = { left: 0, top: 0, width: 1180, height: 540 };
    const menu = openAt({ x: 4, y: 530 }, bounds);
    const inside = (point: { x: number; y: number }) => (
      point.x >= bounds.left && point.x <= bounds.left + bounds.width && point.y >= bounds.top && point.y <= bounds.top + bounds.height
    );

    groups.forEach((group, groupIndex) => {
      expect(inside(resolveMarkingMenuGroupPosition(menu.origin, groupIndex, groups.length))).toBe(true);
      group.deviceIds.forEach((_, itemIndex) => {
        expect(inside(resolveMarkingMenuItemPosition(menu, groupIndex, itemIndex))).toBe(true);
      });
    });
  });

  it("selects the device drawn under the pointer after the ring has been moved in from the edge", () => {
    const menu = openAt({ x: 4, y: 530 }, { left: 0, top: 0, width: 1180, height: 540 });
    const target = resolveMarkingMenuItemPosition(menu, 2, 1);

    const chosen = flick(menu, [resolveMarkingMenuGroupPosition(menu.origin, 2, groups.length), { x: menu.origin.x + 130, y: menu.origin.y }, target]);

    expect(resolveMarkingMenuDeviceId(chosen)).toBe("g2-d1");
  });

  it("picks a group's first device with two strokes in the group's direction, without looking", () => {
    // 第 2 组（右方）：先向右划进分类，再沿同一方向划一段。
    const menu = flick(openAt(), [{ x: 560, y: 500 }, { x: 640, y: 500 }, { x: 700, y: 500 }]);

    expect(menu.level).toBe(2);
    expect(menu.groupIndex).toBe(2);
    expect(resolveMarkingMenuDeviceId(menu)).toBe("g2-d0");
  });

  it("highlights only the group until the stroke passes the group ring", () => {
    const menu = flick(openAt(), [{ x: 500, y: 430 }]);

    expect(menu.level).toBe(1);
    expect(menu.groupIndex).toBe(0);
    expect(resolveMarkingMenuDeviceId(menu)).toBeNull();
  });

  it("returns to the group ring when the stroke comes back to the centre", () => {
    const menu = flick(openAt(), [{ x: 640, y: 500 }, { x: 503, y: 502 }]);

    expect(menu.level).toBe(1);
    expect(menu.groupIndex).toBeNull();
  });

  it("reaches devices on the outer ring of a large group by going further out", () => {
    // 第 6 组（左方）有 20 个设备：内圈 8 个，其余在外圈。
    const entered = flick(openAt(), [{ x: 360, y: 500 }]);
    const center = { x: 500 - 92, y: 500 };
    const inner = trackMarkingMenuPointer(entered, { x: center.x - 70, y: center.y });
    const outer = trackMarkingMenuPointer(entered, { x: center.x - 150, y: center.y + 10 });

    expect(Number(resolveMarkingMenuDeviceId(inner)!.split("-d")[1])).toBeLessThan(8);
    expect(Number(resolveMarkingMenuDeviceId(outer)!.split("-d")[1])).toBeGreaterThanOrEqual(8);
  });
});
