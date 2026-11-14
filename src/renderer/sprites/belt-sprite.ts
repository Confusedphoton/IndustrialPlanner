import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RenderSurfaceContext } from "@/renderer/render-surface-context"
import { DedicatedLogisticSprite } from "./dedicated-logistic-sprite"

export class BeltSprite extends DedicatedLogisticSprite {
  public constructor(
    entityId: string,
    definition: EntityDefinition,
    renderHost: RenderSurfaceContext,
  ) {
    super(entityId, definition, renderHost)
  }
}

