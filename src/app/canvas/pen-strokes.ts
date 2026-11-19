import type { ClientPixelPoint } from "@/domain/shared/client-pixel";

export function isPointInsideStroke(point: ClientPixelPoint, stroke: readonly ClientPixelPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = stroke.length - 1; index < stroke.length; previous = index, index += 1) {
    const a = stroke[index]!;
    const b = stroke[previous]!;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) {
      inside = !inside;
    }
  }
  return inside;
}

export function isClosedStroke(stroke: readonly ClientPixelPoint[]): boolean {
  const first = stroke[0];
  const last = stroke.at(-1);
  if (first === undefined || last === undefined) return false;
  const xs = stroke.map((point) => point.x);
  const ys = stroke.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.min(width, height) >= 24
    && Math.hypot(first.x - last.x, first.y - last.y) <= Math.min(width, height) * 0.3
    && isPointInsideStroke({ x: Math.min(...xs) + width / 2, y: Math.min(...ys) + height / 2 }, stroke);
}
