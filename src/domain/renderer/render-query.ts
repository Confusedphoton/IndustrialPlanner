import type { RenderViewHandle, RenderViewStatus } from "./types/scene-render-types";

export interface RenderQuery {
  getViewContainer(handle: RenderViewHandle): HTMLDivElement | null;
  getViewCanvas(handle: RenderViewHandle): HTMLCanvasElement | null;
  getViewStatus(handle: RenderViewHandle): RenderViewStatus | null;
  subscribeFrameDemand(listener: () => void): () => void;
}

