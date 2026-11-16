import type { ClientPixelPoint, ClientPixelRect } from "@/domain/shared/client-pixel";

/**
 * 笔尖处的环形标记菜单：在画布空白处（放置中则任意处）按住，周围出现设备分类的一圈；
 * 滑进一个分类继续向外越过这一圈，以越过的位置为中心展开该分类的设备；滑到设备上松开，设备即在手上。
 * 分类与设备的方向固定，熟练后可以不看菜单直接两段划出。
 */
export interface MarkingMenuGroup {
  readonly titleKey: string;
  readonly deviceIds: readonly string[];
}

export interface MarkingMenuState {
  /** 分类圈的中心：按下的位置，靠近画布边缘时向内挪到整圈都看得见、够得着。 */
  readonly origin: ClientPixelPoint;
  /** 菜单可用的画布区域；展开的设备圈同样收在其中。 */
  readonly bounds: ClientPixelRect;
  readonly pointer: "mouse" | "touch";
  /** 按住后滑动选择（drag）；按住后原地松开则菜单留着，改为点按选择（tap）。 */
  readonly mode: "drag" | "tap";
  readonly groups: readonly MarkingMenuGroup[];
  readonly level: 1 | 2;
  readonly groupIndex: number | null;
  readonly itemIndex: number | null;
}

/** 中心不选择任何项的半径。 */
export const MARKING_MENU_DEAD_ZONE_PX = 26;
/** 分类图标所在的圆半径；越过 MARKING_MENU_ENTER_RADIUS_PX 进入该分类。 */
export const MARKING_MENU_GROUP_RADIUS_PX = 92;
export const MARKING_MENU_ENTER_RADIUS_PX = 118;
/** 设备圈：内圈最多 8 个，其余放外圈。 */
export const MARKING_MENU_ITEM_INNER_RADIUS_PX = 82;
export const MARKING_MENU_ITEM_OUTER_RADIUS_PX = 146;
const INNER_RING_CAPACITY = 8;
/** 圈上按钮的半径加留白：整圈距画布边缘至少这么远。 */
const RING_EDGE_CLEARANCE_PX = 30;

/** 把圈心挪进画布，使半径为 radius 的整圈留在画布内；画布不够大时居中。 */
function fitRingCenter(point: ClientPixelPoint, bounds: ClientPixelRect, radius: number): ClientPixelPoint {
  const inset = radius + RING_EDGE_CLEARANCE_PX;
  const fit = (value: number, start: number, size: number) => (
    size <= inset * 2 ? start + size / 2 : Math.min(Math.max(value, start + inset), start + size - inset)
  );
  return { x: fit(point.x, bounds.left, bounds.width), y: fit(point.y, bounds.top, bounds.height) };
}

/** 打开菜单时的圈心：按下的位置挪进画布，使分类圈完整可见。 */
export function fitMarkingMenuOrigin(point: ClientPixelPoint, bounds: ClientPixelRect): ClientPixelPoint {
  return fitRingCenter(point, bounds, MARKING_MENU_GROUP_RADIUS_PX);
}

export function resolveMarkingMenuGroupAngle(index: number, count: number): number {
  return -90 + index * 360 / count;
}

export function resolveMarkingMenuGroupPosition(origin: ClientPixelPoint, index: number, count: number): ClientPixelPoint {
  return pointAt(origin, resolveMarkingMenuGroupAngle(index, count), MARKING_MENU_GROUP_RADIUS_PX);
}

/** 分类展开后设备圈的中心：该分类图标的位置，靠近画布边缘时向内挪到整圈可见。 */
export function resolveMarkingMenuItemCenter(
  state: Pick<MarkingMenuState, "origin" | "groups" | "bounds">,
  groupIndex: number,
): ClientPixelPoint {
  const count = state.groups[groupIndex]?.deviceIds.length ?? 0;
  const radius = count > INNER_RING_CAPACITY ? MARKING_MENU_ITEM_OUTER_RADIUS_PX : MARKING_MENU_ITEM_INNER_RADIUS_PX;
  return fitRingCenter(resolveMarkingMenuGroupPosition(state.origin, groupIndex, state.groups.length), state.bounds, radius);
}

/** 设备在设备圈上的角度与半径；内圈第一个设备沿分类方向，顺着同一方向再划一次即选中。 */
export function resolveMarkingMenuItemPolar(
  index: number,
  count: number,
  baseAngle: number,
): { readonly angle: number; readonly radius: number } {
  const innerCount = Math.min(count, INNER_RING_CAPACITY);
  if (index < innerCount) {
    return { angle: baseAngle + index * 360 / innerCount, radius: MARKING_MENU_ITEM_INNER_RADIUS_PX };
  }
  const outerCount = count - innerCount;
  return {
    angle: baseAngle + (index - innerCount + 0.5) * 360 / outerCount,
    radius: MARKING_MENU_ITEM_OUTER_RADIUS_PX,
  };
}

export function resolveMarkingMenuItemPosition(
  state: Pick<MarkingMenuState, "origin" | "groups" | "bounds">,
  groupIndex: number,
  itemIndex: number,
): ClientPixelPoint {
  const group = state.groups[groupIndex]!;
  const polar = resolveMarkingMenuItemPolar(
    itemIndex,
    group.deviceIds.length,
    resolveMarkingMenuGroupAngle(groupIndex, state.groups.length),
  );
  return pointAt(resolveMarkingMenuItemCenter(state, groupIndex), polar.angle, polar.radius);
}

/** 按指针位置更新高亮：第一层选分类，越过分类圈进入第二层选设备，回到中心退回第一层。 */
export function trackMarkingMenuPointer(state: MarkingMenuState, point: ClientPixelPoint): MarkingMenuState {
  const groupCount = state.groups.length;
  if (groupCount === 0) {
    return state;
  }
  const fromOrigin = distance(state.origin, point);
  if (fromOrigin < MARKING_MENU_DEAD_ZONE_PX) {
    return { ...state, level: 1, groupIndex: null, itemIndex: null };
  }

  if (state.level === 1 || state.groupIndex === null) {
    const groupIndex = nearestIndex(angleOf(state.origin, point), groupCount, (index) => resolveMarkingMenuGroupAngle(index, groupCount));
    if (fromOrigin < MARKING_MENU_ENTER_RADIUS_PX) {
      return { ...state, level: 1, groupIndex, itemIndex: null };
    }
    return trackMarkingMenuPointer({ ...state, level: 2, groupIndex, itemIndex: null }, point);
  }

  const group = state.groups[state.groupIndex]!;
  const center = resolveMarkingMenuItemCenter(state, state.groupIndex);
  const fromCenter = distance(center, point);
  if (fromCenter < MARKING_MENU_DEAD_ZONE_PX || group.deviceIds.length === 0) {
    return { ...state, itemIndex: null };
  }
  const count = group.deviceIds.length;
  const baseAngle = resolveMarkingMenuGroupAngle(state.groupIndex, groupCount);
  const innerCount = Math.min(count, INNER_RING_CAPACITY);
  const outer = count > innerCount
    && fromCenter > (MARKING_MENU_ITEM_INNER_RADIUS_PX + MARKING_MENU_ITEM_OUTER_RADIUS_PX) / 2;
  const angle = angleOf(center, point);
  const itemIndex = outer
    ? innerCount + nearestIndex(angle, count - innerCount, (index) => resolveMarkingMenuItemPolar(innerCount + index, count, baseAngle).angle)
    : nearestIndex(angle, innerCount, (index) => resolveMarkingMenuItemPolar(index, count, baseAngle).angle);
  return { ...state, itemIndex };
}

/** 当前高亮的设备（第二层且指向某个设备时）。 */
export function resolveMarkingMenuDeviceId(state: MarkingMenuState): string | null {
  if (state.level !== 2 || state.groupIndex === null || state.itemIndex === null) {
    return null;
  }
  return state.groups[state.groupIndex]?.deviceIds[state.itemIndex] ?? null;
}

function pointAt(origin: ClientPixelPoint, angleDegrees: number, radius: number): ClientPixelPoint {
  const radians = angleDegrees * Math.PI / 180;
  return { x: origin.x + Math.cos(radians) * radius, y: origin.y + Math.sin(radians) * radius };
}

function angleOf(from: ClientPixelPoint, to: ClientPixelPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

function distance(left: ClientPixelPoint, right: ClientPixelPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function nearestIndex(angle: number, count: number, angleAt: (index: number) => number): number {
  let best = 0;
  let bestGap = Infinity;
  for (let index = 0; index < count; index += 1) {
    const gap = Math.abs((((angle - angleAt(index)) % 360) + 540) % 360 - 180);
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  }
  return best;
}
