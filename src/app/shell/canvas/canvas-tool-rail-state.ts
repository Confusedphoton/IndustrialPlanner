import { makeAutoObservable, reaction } from "mobx";

/**
 * 画布工具条的位置：贴靠画布左缘或右缘，沿边缘的纵向位置以画布高度的比例保存。
 * 用笔在画布一侧连续作业时可把工具条拖到同侧，减少来回移动；仅存于本浏览器。
 */
export type CanvasToolRailSide = "left" | "right";

const STORAGE_KEY = "industrial-planner-canvas-tool-rail";
const DEFAULT_CENTER = 0.5;
const DEFAULT_WIDTH = 66;

export class CanvasToolRailState {
  public side: CanvasToolRailSide = "left";
  /** 工具条中心在画布高度中的比例（0–1）。 */
  public center = DEFAULT_CENTER;
  /** 工具条占据的画布边缘带宽（px，含与画布边缘的间距与贴附的上下文按钮组）；矮窗口下分列后变宽，供画布内其他浮层避让。 */
  public width = DEFAULT_WIDTH;
  /** 工具条本体的渲染高度（px）；其纵向中心按 center 定位，并夹紧在画布内。 */
  public height = 0;
  /**
   * 不含贴附上下文按钮组的常驻带宽（px）。停靠栏布局按它预留画布宽度：放置等模式临时出现的按钮组
   * 若也计入，进出放置时停靠栏与画布都会跟着变宽变窄，画面在笔下跳动。
   */
  public baseWidth = DEFAULT_WIDTH;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public setPosition(side: CanvasToolRailSide, center: number): void {
    this.side = side;
    this.center = Math.min(1, Math.max(0, center));
  }

  public setSize(width: number, height: number, baseWidth = width): void {
    if (Number.isFinite(width) && width > 0 && Math.round(width) !== this.width) {
      this.width = Math.round(width);
    }
    if (Number.isFinite(baseWidth) && baseWidth > 0 && Math.round(baseWidth) !== this.baseWidth) {
      this.baseWidth = Math.round(baseWidth);
    }
    if (Number.isFinite(height) && height >= 0 && Math.round(height) !== this.height) {
      this.height = Math.round(height);
    }
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
