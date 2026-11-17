import type { GridPoint } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";

/**
 * 一笔多线（梳线）：从设备的一个输出口起笔，先沿设备边划过相邻的几个空闲输出口，再离开设备，
 * 划过的每个口都铺一条线，与主线平行、转弯时内外圈嵌套，好像一把梳子划出来的。
 */

/** 铺线过程中其余各条平行线的预览路径。 */
export interface PortCombLanesState {
  readonly kind: LogisticsKind;
  readonly lanes: readonly (readonly GridPoint[])[];
}

/**
 * 把主线的逐格路径平移成旁边的一条平行线。laneStart 是这条线的起点格（另一个输出口的外侧格），
 * 与主线起点的差须垂直于起步方向 startHeading（物品从端口流出的方向）。
 * 走不通（内圈的短段被挤没、方向反了）时为 null。
 */
export function offsetLanePath(path: readonly GridPoint[], laneStart: GridPoint, startHeading: GridPoint): GridPoint[] | null {
  const first = path[0];
  if (first === undefined) {
    return null;
  }
  // 从端口内侧格算起，起点格本身是转角时也按普通拐点处理。
  const full = [{ x: first.x - startHeading.x, y: first.y - startHeading.y }, ...path];
  const corners: GridPoint[] = [full[0]!];
  const headings: GridPoint[] = [];
  for (let index = 1; index < full.length; index += 1) {
    const heading = { x: full[index]!.x - full[index - 1]!.x, y: full[index]!.y - full[index - 1]!.y };
    const last = headings.at(-1);
    if (last !== undefined && last.x === heading.x && last.y === heading.y) {
      corners[corners.length - 1] = full[index]!;
    } else {
      corners.push(full[index]!);
      headings.push(heading);
    }
  }
  const startLeft = leftOf(headings[0]!);
  const shift = (laneStart.x - first.x) * startLeft.x + (laneStart.y - first.y) * startLeft.y;
  if (shift === 0 || laneStart.x - first.x !== shift * startLeft.x || laneStart.y - first.y !== shift * startLeft.y) {
    return null;
  }
  // 拐点外移 shift ×（入段左法向 + 出段左法向），两端只按所在段的左法向外移。
  const laneCorners = corners.map((corner, index) => {
    const incoming = index === 0 ? null : leftOf(headings[index - 1]!);
    const outgoing = index === headings.length ? null : leftOf(headings[index]!);
    const normal = {
      x: (incoming?.x ?? 0) + (outgoing?.x ?? 0),
      y: (incoming?.y ?? 0) + (outgoing?.y ?? 0),
    };
    return { x: corner.x + shift * normal.x, y: corner.y + shift * normal.y };
  });
  const cells: GridPoint[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const from = laneCorners[index]!;
    const to = laneCorners[index + 1]!;
    const heading = headings[index]!;
    const length = (to.x - from.x) * heading.x + (to.y - from.y) * heading.y;
    // 每段平移后仍须与主线同向且至少一格；内圈的短段被挤没时这条平行线走不通。
    if (length < 1 || to.x - from.x !== length * heading.x || to.y - from.y !== length * heading.y) {
      return null;
    }
    for (let step = 1; step <= length; step += 1) {
      cells.push({ x: from.x + heading.x * step, y: from.y + heading.y * step });
    }
  }
  return cells;
}

/** 屏幕坐标（y 向下）里行进方向的左手方向。 */
function leftOf(heading: GridPoint): GridPoint {
  return { x: heading.y, y: -heading.x };
}
