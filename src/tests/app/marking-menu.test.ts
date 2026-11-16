import { describe, expect, it } from "vitest";

import {
  openMarkingMenuState,
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

function openAt(pressPoint = { x: 500, y: 500 }, bounds = WIDE_CANVAS): MarkingMenuState {
  return openMarkingMenuState({ pressPoint, bounds, pointer: "mouse", groups });
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

  it("selects what is drawn under the pen when the ring has been moved in from the edge", () => {
    const bounds = { left: 0, top: 0, width: 1180, height: 540 };
    const press = { x: 4, y: 530 };
    const menu = openAt(press, bounds);

    // 按下后的小幅移动不会展开任何分类。
    const nudged = flick(menu, [{ x: 13, y: 530 }, { x: 40, y: 524 }]);
    expect(nudged.level).toBe(1);
    expect(resolveMarkingMenuDeviceId(nudged)).toBeNull();

    // 滑到画出来的正下方分类图标上，选中的正是它；再向外越过即展开它。
    const south = resolveMarkingMenuGroupPosition(menu.origin, 4, groups.length);
    const onSouth = flick(menu, [{ x: 60, y: 520 }, south]);
    expect(onSouth).toMatchObject({ level: 1, groupIndex: 4 });
    expect(flick(onSouth, [{ x: south.x, y: south.y + 28 }])).toMatchObject({ level: 2, groupIndex: 4 });
  });

  it("can reach every group from a corner", () => {
    const bounds = { left: 0, top: 0, width: 1180, height: 540 };
    const menu = openAt({ x: 4, y: 530 }, bounds);
    groups.forEach((_, groupIndex) => {
      const icon = resolveMarkingMenuGroupPosition(menu.origin, groupIndex, groups.length);
      const beyond = {
        x: menu.origin.x + (icon.x - menu.origin.x) * 120 / 92,
        y: menu.origin.y + (icon.y - menu.origin.y) * 120 / 92,
      };
      expect(beyond.x).toBeGreaterThanOrEqual(bounds.left);
      expect(beyond.y).toBeLessThanOrEqual(bounds.top + bounds.height);
      expect(flick(menu, [menu.origin, icon, beyond])).toMatchObject({ level: 2, groupIndex });
    });
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
