import type { MountSceneViewOptions, RenderViewHandle, SceneViewUpdate, SceneTimePolicy } from "./types/scene-render-types";

export interface RenderAction {
  mountView(options: MountSceneViewOptions): Promise<RenderViewHandle>;
  updateViews(updates: readonly SceneViewUpdate[]): void;
  invalidateView(handle: RenderViewHandle): void;
  setViewTimePolicy(handle: RenderViewHandle, policy: SceneTimePolicy): void;
  suspendView(handle: RenderViewHandle): () => void;
  disposeView(handle: RenderViewHandle): void;
}

