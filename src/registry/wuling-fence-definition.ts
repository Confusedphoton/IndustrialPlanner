import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { BaseBuiltinEntityDefinition } from "@/domain/registry/types/base-definition";
import fenceLayouts from "./agricultural-fence-layouts.json";

/** 场景围栏只有静态外观与占地；长度规格沿用现有固定 footprint 模型。 */
export const WULING_FENCE_DEFINITIONS: EntityDefinition[] = [
  { id: "wuling_fence_rail_5", width: 5 },
  { id: "wuling_fence_rail_2", width: 2 },
  { id: "wuling_fence_rail_3", width: 3 },
  { id: "wuling_fence_post", width: 1 },
].map(({ id, width }): EntityDefinition => ({
  id,
  nameKey: `registry.entity.${id}.name`,
  spriteId: id,
  iconPath: `3d-top-view/sprites/${id}.webp`,
  footprint: { width, height: 1 },
  spriteOffset: {
    topView: { x: -1, y: -1, width: width + 2, height: 3 },
    blueprint: { x: -1, y: -1, width: width + 2, height: 3 },
  },
  uiGroup: "hidden",
  displayOrder: 100,
  tags: ["AvatarHidden"],
  placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  requiresPower: false,
  powerDemand: 0,
  inspectors: [],
  placementBehaviors: [],
  portGroups: [],
  storageSlotGroups: [],
  recipeChannels: [],
  portStorageBindings: [],
}));

/**
 * 来源：素材网站 wuling-agricultural-fields/layout.json；v1.5-20261014-irrigation。
 * 布局 SHA-256：2f0348cdf51ade9e4988aca1b6aa57e22aac9ceafcade6686d24cc29bab036f7。
 * 原布局 X 向东、Z 向北；转换为屏幕 Y 向下，并让内部净空对齐现有 (0,0)–(44,44)。
 * 2026-10-15 用户要求先按占地试摆，暂不应用 renderCenterGridXZ 的半格视觉偏移。
 */

export const WULING_FENCE_BUILTIN_ENTITIES =
  fenceLayouts.layouts.wuling.entities as readonly BaseBuiltinEntityDefinition[];

/** 缘缘庄与主地块共用围栏规格；位置已转换到农牧用地的统一世界坐标。 */
export const YUANYUAN_FENCE_BUILTIN_ENTITIES =
  fenceLayouts.layouts.yuanyuan.entities as readonly BaseBuiltinEntityDefinition[];
