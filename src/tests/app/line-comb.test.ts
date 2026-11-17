import { describe, expect, it } from "vitest";

import { offsetLanePath } from "@/app/canvas/line-comb";
import type { GridPoint } from "@/domain/shared/grid";

const SOUTH = { x: 0, y: 1 };

function line(...points: [number, number][]): GridPoint[] {
  return points.map(([x, y]) => ({ x, y }));
}

describe("parallel lanes of one stroke", () => {
  it("runs beside a straight line", () => {
    expect(offsetLanePath(line([5, 1], [5, 2], [5, 3]), { x: 6, y: 1 }, SOUTH)).toEqual(line([6, 1], [6, 2], [6, 3]));
  });

  it("goes round the outside of a turn away from it, and the inside of a turn toward it", () => {
    // 主线向南两格后向西：东侧的线在外圈，多走一格再转。
    const main = line([5, 1], [5, 2], [4, 2], [3, 2]);
    expect(offsetLanePath(main, { x: 6, y: 1 }, SOUTH)).toEqual(line([6, 1], [6, 2], [6, 3], [5, 3], [4, 3], [3, 3]));
    // 主线向南三格后向东：东侧的线在内圈，少走一格就转。
    const turnEast = line([5, 1], [5, 2], [5, 3], [6, 3], [7, 3]);
    expect(offsetLanePath(turnEast, { x: 6, y: 1 }, SOUTH)).toEqual(line([6, 1], [6, 2], [7, 2]));
  });

  it("gives up when the inside of a turn is too tight for the lane", () => {
    expect(offsetLanePath(line([5, 1], [6, 1], [7, 1]), { x: 6, y: 1 }, SOUTH)).toBeNull();
  });
});
