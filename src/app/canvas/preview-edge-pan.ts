import type { EditorContract } from "@/domain/editor/editor-contract";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { ClientPixelPoint, ClientPixelRect } from "@/domain/shared/client-pixel";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";

/** 预览与画布可见边缘之间保留的间距（px）。 */
const EDGE_MARGIN_PX = 12;
/** 刚越界时的平移速度与越界加深后的上限（px/s）。 */
const MIN_PAN_SPEED_PX_PER_S = 280;
const MAX_PAN_SPEED_PX_PER_S = 1400;
/** 越界达到该深度（px）时速度到达上限。 */
const FULL_SPEED_OVERFLOW_PX = 96;
/** 单帧最长计入的时长，避免切回标签页后一次跳得太远。 */
const MAX_FRAME_MS = 50;

type Side = "left" | "right" | "top" | "bottom";
type SideOverflow = Record<Side, number>;

export interface ViewportObstruction {
  readonly left: number;
  readonly right: number;
}

/**
 * 按什么判断越界：preview 为放置/移动中的设备预览外框；pointer 为指针所在的一格（画传送带/管道时只看线头）。
 */
export type EdgePanTarget = "preview" | "pointer";

interface EdgePanDrag {
  readonly target: EdgePanTarget;
  position: ClientPixelPoint;
  redrive: (position: ClientPixelPoint) => void;
  /** 起拖时就已越界的一侧先不平移，等预览完全回到可见区后再生效。 */
  readonly disarmed: Set<Side>;
}

/**
 * 拖动设备预览（放置、移动、从面板拖出）时，预览越出画布可见区就按越界深度持续平移地图，
 * 每帧把预览重新对到指针下，使正在拖的设备始终留在视野内。只在按下拖动期间生效，悬停不触发。
 */
export class PreviewEdgePan {
  private drag: EdgePanDrag | null = null;
  private lastTimeMs: number | null = null;

  public constructor(private readonly options: {
    readonly view: EditorViewContract;
    readonly readEditor: () => EditorContract | null;
    readonly readObstruction: () => ViewportObstruction;
    readonly wake: () => void;
  }) {}

  public get active(): boolean { return this.drag !== null; }

  public track(
    position: ClientPixelPoint,
    redrive: (position: ClientPixelPoint) => void,
    target: EdgePanTarget = "preview",
  ): void {
    if (this.drag === null || this.drag.target !== target) {
      const overflow = this.resolveOverflow(target, position);
      this.drag = {
        target,
        position,
        redrive,
        disarmed: new Set((Object.keys(overflow) as Side[]).filter((side) => overflow[side] > 0)),
      };
    } else {
      this.drag.position = position;
      this.drag.redrive = redrive;
    }
    this.options.wake();
  }

  /** 停止平移；给出 target 时只停止按该方式跟踪的拖动，不打断别的模块正在跟踪的拖动。 */
  public stop(target?: EdgePanTarget): void {
    if (target !== undefined && this.drag !== null && this.drag.target !== target) return;
    this.drag = null;
    this.lastTimeMs = null;
  }

  public needsFrame(): boolean {
    if (this.drag === null) return false;
    const velocity = this.resolveVelocity();
    if (velocity.x === 0 && velocity.y === 0) {
      this.lastTimeMs = null;
      return false;
    }
    return true;
  }

  public advanceFrame(timeMs: number): void {
    const drag = this.drag;
    if (drag === null || !Number.isFinite(timeMs)) return;
    const velocity = this.resolveVelocity();
    if (velocity.x === 0 && velocity.y === 0) {
      this.lastTimeMs = null;
      return;
    }
    const elapsedMs = this.lastTimeMs === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, timeMs - this.lastTimeMs));
    this.lastTimeMs = timeMs;
    if (elapsedMs === 0) return;
    this.options.view.actions.moveViewportByClientPixelVector({
      startClientPixel: { x: 0, y: 0 },
      endClientPixel: { x: velocity.x * elapsedMs / 1000, y: velocity.y * elapsedMs / 1000 },
    });
    drag.redrive(drag.position);
  }

  /** 内容的平移速度（px/s）：预览越过右缘时内容向左移，其余方向同理。 */
  private resolveVelocity(): ClientPixelPoint {
    const drag = this.drag;
    if (drag === null) return { x: 0, y: 0 };
    const overflow = this.resolveOverflow(drag.target, drag.position);
    for (const side of [...drag.disarmed]) {
      if (overflow[side] <= 0) drag.disarmed.delete(side);
    }
    const speed = (side: Side): number => (
      drag.disarmed.has(side) || overflow[side] <= 0
        ? 0
        : MIN_PAN_SPEED_PX_PER_S + (MAX_PAN_SPEED_PX_PER_S - MIN_PAN_SPEED_PX_PER_S)
          * Math.min(1, overflow[side] / FULL_SPEED_OVERFLOW_PX)
    );
    // 预览比可见区还大时两侧同时越界，此时不平移。
    const axis = (start: Side, end: Side): number => (
      overflow[start] > 0 && overflow[end] > 0 ? 0 : speed(start) - speed(end)
    );
    return { x: axis("left", "right"), y: axis("top", "bottom") };
  }

  private resolveOverflow(target: EdgePanTarget, position: ClientPixelPoint): SideOverflow {
    const none: SideOverflow = { left: 0, right: 0, top: 0, bottom: 0 };
    const viewport = this.options.view.state;
    const rect = target === "pointer" ? resolvePointerCellRect(position, viewport.gridCellPixelSize) : this.resolvePreviewRect();
    if (rect === null || viewport.clientRect.width <= 0 || viewport.clientRect.height <= 0) return none;
    const obstruction = this.options.readObstruction();
    const safeLeft = viewport.clientRect.left + Math.max(0, obstruction.left) + EDGE_MARGIN_PX;
    const safeRight = viewport.clientRect.left + viewport.clientRect.width - Math.max(0, obstruction.right) - EDGE_MARGIN_PX;
    const safeTop = viewport.clientRect.top + EDGE_MARGIN_PX;
    const safeBottom = viewport.clientRect.top + viewport.clientRect.height - EDGE_MARGIN_PX;
    return {
      left: Math.max(0, safeLeft - rect.left),
      right: Math.max(0, rect.left + rect.width - safeRight),
      top: Math.max(0, safeTop - rect.top),
      bottom: Math.max(0, rect.top + rect.height - safeBottom),
    };
  }

  private resolvePreviewRect(): ClientPixelRect | null {
    const gridRect = this.options.readEditor()?.queries.findEntityCollectionGridRect(EntityCollectionType.preview) ?? null;
    if (gridRect === null) return null;
    const viewport = this.options.view.state;
    return resolveViewportRectFromWorldGridRect({
      gridRect,
      viewportBounds: viewport.clientRect,
      viewportCenter: viewport.center,
      gridCellPixelSize: viewport.gridCellPixelSize,
      displayRotation: viewport.displayRotation,
    });
  }
}

/** 指针所在的一格（以指针为中心），画线时线头就在这里。 */
function resolvePointerCellRect(position: ClientPixelPoint, cellPixelSize: number): ClientPixelRect {
  return { left: position.x - cellPixelSize / 2, top: position.y - cellPixelSize / 2, width: cellPixelSize, height: cellPixelSize };
}
