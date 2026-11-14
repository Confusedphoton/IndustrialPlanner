import { canvasToolRailState } from "./canvas-tool-rail-state";

const RAIL_CLEARANCE_PX = 8;
/** 与 .canvas-tool-rail 的 CSS clamp 保持一致：工具条上下各保留的距离。 */
const RAIL_VERTICAL_RESERVE_PX = 8;

export interface CanvasRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 由工具条状态（贴靠边、纵向比例、占用带宽度与高度）推算它在屏幕上的矩形，不读取 DOM。
 * 尚未测量（高度为 0）时返回 null。
 */
export function resolveCanvasToolRailRect(canvas: CanvasRect): CanvasRect | null {
  const { side, center, width, height } = canvasToolRailState;
  if (height <= 0 || width <= 0) {
    return null;
  }
  const half = height / 2;
  const centerY = Math.min(
    Math.max(half + RAIL_VERTICAL_RESERVE_PX, center * canvas.height),
    canvas.height - half - RAIL_VERTICAL_RESERVE_PX,
  );
  return {
    left: side === "left" ? canvas.left : canvas.left + canvas.width - width,
    top: canvas.top + centerY - half,
    width,
    height,
  };
}

/**
 * 弹出层水平位置避开画布工具条：工具条贴左缘时弹出层从工具条右侧开始，贴右缘时止于工具条左侧。
 * 弹出层与工具条在纵向不重叠时不调整。
 */
export function avoidCanvasToolRail(options: {
  readonly canvas: CanvasRect;
  readonly left: number;
  readonly width: number;
  readonly top: number;
  readonly height: number;
  readonly minLeft: number;
  readonly maxRight: number;
}): number {
  const rail = resolveCanvasToolRailRect(options.canvas);
  const clampLeft = (left: number) => Math.max(options.minLeft, Math.min(left, options.maxRight - options.width));
  if (rail === null) {
    return clampLeft(options.left);
  }
  const overlapsVertically = options.top < rail.top + rail.height && options.top + options.height > rail.top;
  const overlapsHorizontally = options.left < rail.left + rail.width && options.left + options.width > rail.left;
  if (!overlapsVertically || !overlapsHorizontally) {
    return clampLeft(options.left);
  }
  return canvasToolRailState.side === "left"
    ? clampLeft(Math.max(options.left, rail.left + rail.width + RAIL_CLEARANCE_PX))
    : clampLeft(Math.min(options.left, rail.left - RAIL_CLEARANCE_PX - options.width));
}
