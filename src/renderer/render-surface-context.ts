import type { SceneViewInput } from "@/domain/document/scene-view-input"
import type { Application } from "pixi.js"

import type { createTextureActions } from "./texture/texture-manager"
import type { RenderResourceScope } from "./texture"

export interface RenderSurfaceContext {
  readonly input: SceneViewInput
  readonly resources: RenderResourceScope
  readonly invalidate: () => void
  readonly app: Application
  readonly container: HTMLDivElement
  readonly dom: {
    readonly placementGlowOverlay: HTMLDivElement
    readonly blueprintGlowOverlay: HTMLDivElement
    readonly marqueeGlowOverlay: HTMLDivElement
  }
  readonly textureManager: ReturnType<typeof createTextureActions>
  readonly internalState: {
    textureConfig: unknown | null
  }
}
