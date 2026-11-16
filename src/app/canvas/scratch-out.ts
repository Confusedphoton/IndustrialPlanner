/**
 * 涂抹删除的笔画识别：笔尖在画布上来回快速划动（像在纸上把东西划掉），沿同一轴折返至少三次即视为涂抹。
 * 只看屏幕上的笔迹；平移视图的拖动很少在开头一秒内来回折返这么多次。
 */
export interface ScratchPoint {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
}

/** 折返需要反向走出的距离，过滤手抖。 */
const SCRATCH_LEG_PX = 14;
const SCRATCH_REVERSALS = 3;
/** 从落笔到识别出涂抹的最长时间。 */
const SCRATCH_WINDOW_MS = 1200;

export function isScratchOutStroke(points: readonly ScratchPoint[]): boolean {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined || last.timeMs - first.timeMs > SCRATCH_WINDOW_MS) {
    return false;
  }
  return countReversals(points, (point) => point.x) >= SCRATCH_REVERSALS
    || countReversals(points, (point) => point.y) >= SCRATCH_REVERSALS;
}

/** 沿一个轴数折返：从上一个极值反向走出一段距离才算一次，之后以反向为当前方向继续找极值。 */
function countReversals(points: readonly ScratchPoint[], axis: (point: ScratchPoint) => number): number {
  let reversals = 0;
  let direction = 0;
  let extreme = axis(points[0]!);
  for (const point of points) {
    const value = axis(point);
    if (direction === 0) {
      if (Math.abs(value - extreme) >= SCRATCH_LEG_PX) {
        direction = Math.sign(value - extreme);
        extreme = value;
      }
      continue;
    }
    if ((value - extreme) * direction > 0) {
      extreme = value;
    } else if (Math.abs(value - extreme) >= SCRATCH_LEG_PX) {
      reversals += 1;
      direction = -direction;
      extreme = value;
    }
  }
  return reversals;
}
