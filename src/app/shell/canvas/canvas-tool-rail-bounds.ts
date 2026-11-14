import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const RAIL_CLEARANCE_PX = 8;

/**
 * 弹出层水平位置避开画布工具条：工具条贴左缘时弹出层从工具条右侧开始，贴右缘时止于工具条左侧。
 * 弹出层与工具条在纵向不重叠时不调整。
 */
export function avoidCanvasToolRail(options: {
  readonly left: number;
  readonly width: number;
  readonly top: number;
  readonly height: number;
  readonly minLeft: number;
  readonly maxRight: number;
}): number {
  const rail = document.querySelector(`.${cm(styles, "canvas-tool-rail")}`)?.getBoundingClientRect();
  const clampLeft = (left: number) => Math.max(options.minLeft, Math.min(left, options.maxRight - options.width));
  if (rail === undefined || rail.width === 0) {
    return clampLeft(options.left);
  }
  const overlapsVertically = options.top < rail.bottom && options.top + options.height > rail.top;
  const overlapsHorizontally = options.left < rail.right && options.left + options.width > rail.left;
  if (!overlapsVertically || !overlapsHorizontally) {
    return clampLeft(options.left);
  }
  const railOnLeft = rail.left + rail.width / 2 < (options.minLeft + options.maxRight) / 2;
  return railOnLeft
    ? clampLeft(Math.max(options.left, rail.right + RAIL_CLEARANCE_PX))
    : clampLeft(Math.min(options.left, rail.left - RAIL_CLEARANCE_PX - options.width));
}
