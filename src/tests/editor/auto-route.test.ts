import { describe, expect, it } from "vitest";

import type { GridPoint } from "@/domain/shared/grid";
import { findAutoRoute, type AutoRouteCell } from "@/editor/logistics/auto-route";

const BOUNDS = { x: 0, y: 0, width: 20, height: 20 };

function grid(rows: readonly string[]): (point: GridPoint) => AutoRouteCell {
  return (point) => {
    const char = rows[point.y]?.[point.x] ?? "#";
    if (char === "#") return { type: "blocked" };
    if (char === "|") return { type: "crossing", travelAxis: "horizontal" };
    if (char === "-") return { type: "crossing", travelAxis: "vertical" };
    return { type: "free" };
  };
}

function isConnected(points: readonly GridPoint[]): boolean {
  return points.every((point, index) => index === 0
    || Math.abs(point.x - points[index - 1]!.x) + Math.abs(point.y - points[index - 1]!.y) === 1);
}

describe("logistics auto-route", () => {
  it("goes around a wall instead of through it", () => {
    const cellAt = grid([
      ".......",
      ".......",
      "..###..",
      ".......",
      ".......",
    ]);
    const route = findAutoRoute({
      start: { x: 3, y: 0 }, startHeading: "SOUTH", goal: { x: 3, y: 4 }, goalExit: "SOUTH",
      cellAt, bounds: { x: 0, y: 0, width: 7, height: 5 },
    })!;

    expect(route[0]).toEqual({ x: 3, y: 0 });
    expect(route.at(-1)).toEqual({ x: 3, y: 4 });
    expect(isConnected(route)).toBe(true);
    expect(route.every((point) => cellAt(point).type === "free")).toBe(true);
  });

  it("crosses an existing line straight through, never turning on it", () => {
    const cellAt = grid([
      "...",
      "|||",
      "...",
    ]);
    const route = findAutoRoute({
      start: { x: 1, y: 0 }, startHeading: "SOUTH", goal: { x: 1, y: 2 }, goalExit: "SOUTH",
      cellAt, bounds: { x: 0, y: 0, width: 3, height: 3 },
    });

    // “|” 是一排已有的竖线，只能横着穿过；这里要竖着走，过不去。
    expect(route).toBeNull();

    const across = findAutoRoute({
      start: { x: 1, y: 0 }, startHeading: "SOUTH", goal: { x: 1, y: 2 }, goalExit: "SOUTH",
      cellAt: grid(["...", "---", "..."]), bounds: { x: 0, y: 0, width: 3, height: 3 },
    });
    expect(across).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }]);
  });

  it("follows the corridor the stroke passed through when two detours are equally short", () => {
    const cellAt = grid([
      ".....",
      ".###.",
      ".###.",
      ".....",
    ]);
    const corridor = new Set(["0:0", "0:1", "0:2", "0:3"]);
    const route = findAutoRoute({
      start: { x: 2, y: 0 }, startHeading: null, goal: { x: 2, y: 3 }, goalExit: "SOUTH",
      cellAt, bounds: { x: 0, y: 0, width: 5, height: 4 }, corridor,
    })!;

    expect(route.some((point) => point.x === 0)).toBe(true);
    expect(route.some((point) => point.x === 4)).toBe(false);
  });

  it("gives up when the goal is walled in", () => {
    const route = findAutoRoute({
      start: { x: 0, y: 0 }, startHeading: null, goal: { x: 2, y: 2 }, goalExit: "SOUTH",
      cellAt: grid([".....", ".###.", ".#.#.", ".###.", "....."]), bounds: BOUNDS,
    });

    expect(route).toBeNull();
  });
});
