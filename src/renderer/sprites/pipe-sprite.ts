import { Sprite, Texture } from "pixi.js"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RenderSurfaceContext } from "@/renderer/render-surface-context"
import { fluidColorToNumber, resolveFluidColor } from "@/shared/fluid-color"
import { DedicatedLogisticSprite } from "./dedicated-logistic-sprite"
import type { RenderSpriteLayout, RenderSpriteSyncContext } from "./render-sprite"

/** 三维素材由基类完整绘制；蓝图样式保留简化的内腔填充。 */
export class PipeSprite extends DedicatedLogisticSprite {
  private blueprintFluid: Sprite | null = null
  private blueprintFluidLoaded = false
  private readonly fluidKey: string

  public constructor(entityId: string, definition: EntityDefinition, renderHost: RenderSurfaceContext) {
    super(entityId, definition, renderHost)
    this.fluidKey = `texture-${definition.spriteId}_liquid`
  }

  protected syncSpriteLayout(layout: RenderSpriteLayout, context: RenderSpriteSyncContext): void {
    super.syncSpriteLayout(layout, context)
    const fluidItemId = context.logisticsMaterials?.entities.get(this.entityId)?.fluidItemId ?? null
    const show = context.input.presentation.getSnapshot().settings.gameUseBlueprintStyleDeviceImages === true
      && !this.isLogisticsSuppressed(context) && fluidItemId !== null
    if (!show) {
      if (this.blueprintFluid) this.blueprintFluid.visible = false
      return
    }
    if (!this.blueprintFluid) {
      const sprite = new Sprite(Texture.EMPTY)
      sprite.anchor.set(.5)
      this.blueprintFluid = sprite
      this.getRootOfLayer("entity").addChild(sprite)
      void this.renderHost.textureManager.getTexture(this.fluidKey).then((texture) => {
        if (this.disposed) return
        sprite.texture = texture
        this.blueprintFluidLoaded = true
        this.invalidateVisualSync()
      })
    }
    const sprite = this.blueprintFluid
    sprite.position.set(layout.x + layout.width / 2, layout.y + layout.height / 2)
    const quarterTurn = layout.rotation === 90 || layout.rotation === 270
    sprite.width = quarterTurn ? layout.height : layout.width
    sprite.height = quarterTurn ? layout.width : layout.height
    sprite.rotation = layout.rotation * Math.PI / 180
    const colors = fluidItemId === null
      ? null
      : context.input.source.registry.queries.findItemDefinition(fluidItemId)?.fluidColors
    sprite.tint = fluidColorToNumber(resolveFluidColor(colors))
    sprite.visible = this.blueprintFluidLoaded && this.isDeviceTextureReady()
  }
}


