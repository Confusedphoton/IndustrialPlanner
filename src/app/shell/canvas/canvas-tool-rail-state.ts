import { makeAutoObservable, reaction } from "mobx";

/**
 * 画布工具条的位置：贴靠画布左缘或右缘，沿边缘的纵向位置以画布高度的比例保存。
 * 用笔在画布一侧连续作业时可把工具条拖到同侧，减少来回移动；仅存于本浏览器。
 */
export type CanvasToolRailSide = "left" | "right";

const STORAGE_KEY = "industrial-planner-canvas-tool-rail";
const DEFAULT_CENTER = 0.5;

export class CanvasToolRailState {
  public side: CanvasToolRailSide = "left";
  /** 工具条中心在画布高度中的比例（0–1）。 */
  public center = DEFAULT_CENTER;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public setPosition(side: CanvasToolRailSide, center: number): void {
    this.side = side;
    this.center = Math.min(1, Math.max(0, center));
  }

  public hydrate(raw: unknown): void {
    if (typeof raw !== "object" || raw === null) {
      return;
    }
    const candidate = raw as { side?: unknown; center?: unknown };
    this.setPosition(
      candidate.side === "right" ? "right" : "left",
      typeof candidate.center === "number" && Number.isFinite(candidate.center) ? candidate.center : DEFAULT_CENTER,
    );
  }
}

export const canvasToolRailState = new CanvasToolRailState();

let persistenceDisposer: (() => void) | null = null;

export function hookCanvasToolRailPersistence(): () => void {
  if (persistenceDisposer !== null) {
    return persistenceDisposer;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    canvasToolRailState.hydrate(stored === null ? null : JSON.parse(stored));
  } catch {
    // Unavailable or malformed storage keeps the default position.
  }
  const dispose = reaction(
    () => JSON.stringify({ side: canvasToolRailState.side, center: canvasToolRailState.center }),
    (serialized) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        // localStorage may be unavailable in private contexts.
      }
    },
  );
  persistenceDisposer = () => {
    dispose();
    persistenceDisposer = null;
  };
  return persistenceDisposer;
}
