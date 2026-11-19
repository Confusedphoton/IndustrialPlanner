import type { ClientPixelPoint, ClientPixelRect } from "@/domain/shared/client-pixel";

export function trackPlacementEdgeFlick(start: ClientPixelPoint, time: number) {
  let last = { position: start, time };
  let previous = last;

  const track = (position: ClientPixelPoint, time: number) => {
    if (Math.hypot(position.x - last.position.x, position.y - last.position.y) < 2) return;
    previous = last;
    last = { position, time };
  };

  return {
    track,
    releasedAtEdge(position: ClientPixelPoint, time: number, bounds: ClientPixelRect): boolean {
      track(position, time);
      const dx = last.position.x - previous.position.x;
      const elapsed = Math.max(8, last.time - previous.time);
      return time - last.time < 100 && Math.abs(dx) >= 8 && Math.abs(dx) / elapsed >= 0.55
        && Math.abs(position.x - start.x) >= 40
        && ((dx < 0 && position.x < bounds.left + 28) || (dx > 0 && position.x > bounds.left + bounds.width - 28));
    },
  };
}
