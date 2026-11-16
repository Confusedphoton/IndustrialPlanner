import type { GridEdge, GridPoint, GridRect } from "@/domain/shared/grid";
import { oppositeGridEdge, resolveGridEdgeDelta } from "@/shared/geometry/port";

import { gridPointKey } from "./logistics-utils";

/**
 * 物流线自动寻路：在格子上找一条从起点格到终点格、绕开障碍的传送带/管道路线（A*，按方向区分状态）。
 * 只决定走哪些格；能否真正铺设仍由物流草稿的校验决定，调用方对结果再做一次完整校验。
 */
export type AutoRouteCell =
  | { readonly type: "free" }
  /** 已有的同族直线段：只能垂直穿过（铺设时自动生成桥接），不能在这一格转弯。 */
  | { readonly type: "crossing"; readonly travelAxis: "horizontal" | "vertical" }
  | { readonly type: "blocked" };

export interface AutoRouteOptions {
  readonly start: GridPoint;
  /** 物品进入起点格的方向（从设备端口出来时即端口朝外的方向）；起点为任意线端时为 null。 */
  readonly startHeading: GridEdge | null;
  readonly goal: GridPoint;
  /** 物品离开终点格的方向（流进目标端口的方向）。 */
  readonly goalExit: GridEdge;
  readonly cellAt: (point: GridPoint) => AutoRouteCell;
  /** 搜索范围（含）；超出的格视为不可走。 */
  readonly bounds: GridRect;
  /** 笔画经过的格：路线尽量贴着用户划过的走向。 */
  readonly corridor?: ReadonlySet<string>;
  readonly maxExpansions?: number;
}

const EDGES: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];
const STEP_COST = 1;
/** 转弯多一点代价，路线更直、更像手铺的样子。 */
const TURN_COST = 0.5;
/** 穿过已有线（自动生成桥接）比绕开贵，但比绕一大圈便宜。 */
const CROSSING_COST = 2;
/** 离开笔画走廊的额外代价。 */
const OFF_CORRIDOR_COST = 0.6;
const DEFAULT_MAX_EXPANSIONS = 60_000;

interface SearchNode {
  readonly point: GridPoint;
  /** 物品进入这一格的方向；起点未定向时为 null。 */
  readonly heading: GridEdge | null;
  readonly cost: number;
  readonly estimate: number;
  readonly parent: SearchNode | null;
}

/** 返回起点到终点的逐格路线（含两端）；找不到时为 null。 */
export function findAutoRoute(options: AutoRouteOptions): GridPoint[] | null {
  const goalCell = options.cellAt(options.goal);
  if (goalCell.type !== "free" || !isInside(options.bounds, options.goal) || !isInside(options.bounds, options.start)) {
    return null;
  }
  const heuristic = (point: GridPoint) => Math.abs(point.x - options.goal.x) + Math.abs(point.y - options.goal.y);
  const open = new MinHeap<SearchNode>((node) => node.cost + node.estimate);
  const best = new Map<string, number>();
  open.push({ point: options.start, heading: options.startHeading, cost: 0, estimate: heuristic(options.start), parent: null });
  const maxExpansions = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS;

  for (let expanded = 0; expanded < maxExpansions; expanded += 1) {
    const node = open.pop();
    if (node === undefined) {
      return null;
    }
    const stateKey = `${gridPointKey(node.point)}|${node.heading ?? "-"}`;
    if ((best.get(stateKey) ?? Infinity) < node.cost) {
      continue;
    }
    if (
      node.point.x === options.goal.x && node.point.y === options.goal.y
      && (node.heading === null || node.heading !== oppositeGridEdge(options.goalExit))
    ) {
      return unwind(node);
    }
    const here = node.parent === null ? { type: "free" as const } : options.cellAt(node.point);
    for (const edge of EDGES) {
      if (node.heading !== null && edge === oppositeGridEdge(node.heading)) continue;
      if (here.type === "crossing" && edge !== node.heading) continue;
      const delta = resolveGridEdgeDelta(edge);
      const next = { x: node.point.x + delta.x, y: node.point.y + delta.y };
      if (!isInside(options.bounds, next)) continue;
      const cell = options.cellAt(next);
      if (cell.type === "blocked") continue;
      if (cell.type === "crossing" && cell.travelAxis !== axisOf(edge)) continue;
      const cost = node.cost
        + STEP_COST
        + (node.heading !== null && edge !== node.heading ? TURN_COST : 0)
        + (cell.type === "crossing" ? CROSSING_COST : 0)
        + (options.corridor !== undefined && options.corridor.size > 0 && !options.corridor.has(gridPointKey(next)) ? OFF_CORRIDOR_COST : 0);
      const nextKey = `${gridPointKey(next)}|${edge}`;
      if ((best.get(nextKey) ?? Infinity) <= cost) continue;
      best.set(nextKey, cost);
      open.push({ point: next, heading: edge, cost, estimate: heuristic(next), parent: node });
    }
  }
  return null;
}

function unwind(node: SearchNode): GridPoint[] {
  const points: GridPoint[] = [];
  for (let current: SearchNode | null = node; current !== null; current = current.parent) {
    points.push({ ...current.point });
  }
  return points.reverse();
}

function axisOf(edge: GridEdge): "horizontal" | "vertical" {
  return edge === "EAST" || edge === "WEST" ? "horizontal" : "vertical";
}

function isInside(rect: GridRect, point: GridPoint): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

class MinHeap<T> {
  private readonly items: T[] = [];

  public constructor(private readonly score: (item: T) => number) {}

  public push(item: T): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.score(this.items[parent]!) <= this.score(item)) break;
      this.items[index] = this.items[parent]!;
      index = parent;
    }
    this.items[index] = item;
  }

  public pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top === undefined || last === undefined || this.items.length === 0) {
      return top;
    }
    let index = 0;
    const length = this.items.length;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= length) break;
      const right = left + 1;
      const child = right < length && this.score(this.items[right]!) < this.score(this.items[left]!) ? right : left;
      if (this.score(this.items[child]!) >= this.score(last)) break;
      this.items[index] = this.items[child]!;
      index = child;
    }
    this.items[index] = last;
    return top;
  }
}
