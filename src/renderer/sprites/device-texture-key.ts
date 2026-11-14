import type { ScenePresentation } from "@/domain/document/scene-view-input"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { SceneViewInput } from "@/domain/document/scene-view-input"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"

const DEVICE_SPRITE_PREFIX = "device-sprite-"
const DEVICE_MASK_PREFIX = "device-masks-"
const BLUEPRINT_SPRITE_PREFIX = "blueprint-sprite-"
const BLUEPRINT_MASK_PREFIX = "blueprint-masks-"
const TOP_VIEW_AVATAR_PREFIX = "top-view-avatar-"

export function readSimplifiedDeviceIconPreference(app: ScenePresentation | null): boolean {
  return app?.settings.gameUseBlueprintStyleDeviceImages ?? false
}

export function isDeviceLogisticsEndpoint(entityId: string, input: Pick<SceneViewInput, "source">): boolean {
  const draft = input.source?.queries?.resolveLogisticsDraftState?.()
  return (draft?.source?.type === "device-port" && draft.source.entityId === entityId)
    || (draft?.target?.type === "device-port" && draft.target.entityId === entityId)
}

/** 物流设备的预览及连线端点统一使用蓝图素材，不包含传送带节和管道节。 */
export function shouldForceBlueprintDeviceTexture(
  entityId: string,
  definitionId: string,
  queries: SceneViewInput["source"]["registry"]["queries"],
  input: Pick<SceneViewInput, "source">,
): boolean {
  if (!queries.isBeltLogistics(definitionId) && !queries.isPipeLogistics(definitionId)) {
    return false
  }
  return (input.source.snapshot.getSnapshot().interaction?.collections[EntityCollectionType.preview]?.contains(entityId) ?? false)
    || isDeviceLogisticsEndpoint(entityId, input)
}

export function resolveDeviceBodyTextureKey(
  spriteId: string,
  app: ScenePresentation | null,
): string {
  return `${readSimplifiedDeviceIconPreference(app)
    ? BLUEPRINT_SPRITE_PREFIX
    : DEVICE_SPRITE_PREFIX}${spriteId}`
}

export function resolveDeviceMaskTextureKey(
  spriteId: string,
  app: ScenePresentation | null,
): string {
  return `${readSimplifiedDeviceIconPreference(app)
    ? BLUEPRINT_MASK_PREFIX
    : DEVICE_MASK_PREFIX}${spriteId}`
}

export function resolveDeviceLabelIconTextureKey(
  spriteId: string,
  _app: ScenePresentation | null,
): string {
  return `${TOP_VIEW_AVATAR_PREFIX}${spriteId}`
}

/** 本体素材与动画资格由同一入口决定，蓝图图片始终优先。 */
export function resolveDeviceBodyPresentation(
  definition: EntityDefinition,
  app: ScenePresentation | null,
  options: { forceBlueprint: boolean; allowAnimation: boolean; visualKey?: string | null },
) {
  const blueprint = options.forceBlueprint || readSimplifiedDeviceIconPreference(app)
  const stateSpriteId = options.visualKey ? `${definition.spriteId}--${options.visualKey}` : definition.spriteId
  return {
    blueprint,
    spriteOffset: blueprint ? definition.spriteOffset?.blueprint : definition.spriteOffset?.topView,
    bodyTextureKey: blueprint
      ? `${BLUEPRINT_SPRITE_PREFIX}${definition.spriteId}`
      : `${DEVICE_SPRITE_PREFIX}${stateSpriteId}`,
    maskTextureKey: blueprint
      ? `${BLUEPRINT_MASK_PREFIX}${definition.spriteId}`
      : `${DEVICE_MASK_PREFIX}${stateSpriteId}`,
    animation: !blueprint && options.allowAnimation && app?.settings.gamePlayDeviceAnimations
      ? definition.spriteAnimation ?? null
      : null,
  }
}
