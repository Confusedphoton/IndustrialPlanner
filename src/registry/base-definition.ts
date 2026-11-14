import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { BaseBuiltinEntityDefinition } from "@/domain/registry/types/base-definition";
import { WULING_FENCE_BUILTIN_ENTITIES, YUANYUAN_FENCE_BUILTIN_ENTITIES } from "./wuling-fence-definition";
import { DRAFT_BOX_BASE_TAG } from "@/shared/base-tags";

const VALLEY4_BUILTIN_BUS_SOURCE_ID = "valley4_bus_source";
const WAREHOUSE_BUS_SEED_CONFIG_KEY = "warehouseBusSeed";

/** 四号谷地小基地（难民前哨处、基建前站、重建指挥部）共用：X 方向 5 个基段，从 (0,-4) 向右排布。 */
function createValley4SmallBaseBuiltinEntities(): readonly BaseBuiltinEntityDefinition[] {
  const entities: BaseBuiltinEntityDefinition[] = [];

  for (let index = 0; index < 5; index += 1) {
    entities.push({
      id: `valley4_bus_seg_x_${index}`,
      definitionId: "log_hongs_bus",
      position: { x: index * 8, y: -4 },
      rotation: 90,
      config: index === 0 ? { [WAREHOUSE_BUS_SEED_CONFIG_KEY]: true } : undefined,
    });
  }

  return entities;
}

/**
 * 四号谷地协议核心区专用内置设备：源桩 + X/Y 各 9 个基段。
 *
 * 源桩 4×4 位于 (-4,-4)。
 * X 方向 9 个基段（4×8）从 (0,-4) 向右排布到 (32,-4)。
 * Y 方向 9 个基段（4×8）从 (-4,0) 向下排布到 (-4,64)。
 */
function createValley4ProtocolCoreBuiltinEntities(): readonly BaseBuiltinEntityDefinition[] {
  const entities: BaseBuiltinEntityDefinition[] = [
    {
      id: VALLEY4_BUILTIN_BUS_SOURCE_ID,
      definitionId: "log_hongs_bus_source",
      position: { x: -4, y: -4 },
      rotation: 0,
    },
  ];

  for (let index = 0; index < 9; index += 1) {
    entities.push({
      id: `valley4_bus_seg_x_${index}`,
      definitionId: "log_hongs_bus",
      position: { x: index * 8, y: -4 },
      rotation: 90,
    });
  }

  for (let index = 0; index < 9; index += 1) {
    entities.push({
      id: `valley4_bus_seg_y_${index}`,
      definitionId: "log_hongs_bus",
      position: { x: -4, y: index * 8 },
      rotation: 0,
    });
  }

  return entities;
}

export const BASE_DEFINITIONS: BaseDefinition[] = [
  {
    id: "wuling_protocol_core",
    name: "协议核心区",
    areas: [{
      id: "wuling_protocol_core",
      bounds: { minX: 0, maxX: 80, minY: 0, maxY: 80 },
      outerRing: {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    },
    }],
    tag: "武陵",
    tags: ["maxPipeLogistics=128"],
  },
  {
    id: "wuling_tianwangping_aid",
    name: "天王坪援建点",
    areas: [{
      id: "wuling_tianwangping_aid",
      bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50 },
      outerRing: {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    },
    }],
    tag: "武陵",
    tags: ["maxPipeLogistics=64"],
  },
  {
    id: "wuling_heart_repair_station",
    name: "心脏修缮站",
    areas: [{
      id: "wuling_heart_repair_station",
      bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50 },
      outerRing: {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    },
    }],
    tag: "武陵",
    tags: ["maxPipeLogistics=64"],
  },
  {
    id: "stm_hongs_3",
    name: "盈天台建设站",
    areas: [{
      id: "stm_hongs_3",
      bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50 },
      outerRing: {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    },
    }],
    tag: "武陵",
    tags: ["maxPipeLogistics=64"],
  },
  {
    id: "wuling_agricultural_land",
    name: "农牧用地",
    areas: [{
      id: "wuling_agricultural_land",
      nameplate: "武陵农用地",
      bounds: { minX: 0, maxX: 44, minY: 0, maxY: 44 },
      outerRing: { top: 20, right: 20, bottom: 20, left: 20 },
    }, {
      id: "wuling_yuanyuan_zhuang",
      nameplate: "缘缘庄",
      // 两块外围区域各宽 40 格，外围之间再留 10 格。
      bounds: { minX: 104, maxX: 142, minY: 0, maxY: 38 },
      outerRing: { top: 20, right: 20, bottom: 20, left: 20 },
    }],
    builtinEntities: [
      ...WULING_FENCE_BUILTIN_ENTITIES,
      ...YUANYUAN_FENCE_BUILTIN_ENTITIES,
      // 来源：网站 int_system_farm_terminal/top/spatial.json 的 agriculturalPlacement。
      // 2026-10-28 用户确认将视觉中心吸附至整格设备坐标，朝向取最近的 90° 倍数。
      { id: "wuling_farm_terminal", definitionId: "int_system_farm_terminal", position: { x: 5, y: 47 }, rotation: 90 },
      { id: "yuanyuan_farm_terminal", definitionId: "int_system_farm_terminal", position: { x: 142, y: 19 }, rotation: 180 },
    ],
    tag: "武陵",
    tags: [],
  },
  {
    id: "valley4_protocol_core",
    name: "协议核心区",
    areas: [{
      id: "valley4_protocol_core",
      bounds: { minX: 0, maxX: 70, minY: 0, maxY: 70 },
      outerRing: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    }],
    tag: "四号谷地",
    tags: [],
    builtinEntities: createValley4ProtocolCoreBuiltinEntities(),
  },
  {
    id: "valley4_refugee_shelter",
    name: "难民暂居处",
    areas: [{
      id: "valley4_refugee_shelter",
      bounds: { minX: 0, maxX: 40, minY: 0, maxY: 40 },
      outerRing: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    }],
    tag: "四号谷地",
    tags: [],
    builtinEntities: createValley4SmallBaseBuiltinEntities(),
  },
  {
    id: "valley4_infra_outpost",
    name: "基建前站",
    areas: [{
      id: "valley4_infra_outpost",
      bounds: { minX: 0, maxX: 40, minY: 0, maxY: 40 },
      outerRing: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    }],
    tag: "四号谷地",
    tags: [],
    builtinEntities: createValley4SmallBaseBuiltinEntities(),
  },
  {
    id: "valley4_rebuilt_command",
    name: "重建指挥部",
    areas: [{
      id: "valley4_rebuilt_command",
      bounds: { minX: 0, maxX: 40, minY: 0, maxY: 40 },
      outerRing: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    }],
    tag: "四号谷地",
    tags: [],
    builtinEntities: createValley4SmallBaseBuiltinEntities(),
  },
  {
    id: "draft_box",
    name: "草稿箱",
    areas: [{
      id: "draft_box",
      bounds: { minX: 0, maxX: 320, minY: 0, maxY: 320 },
      outerRing: { top: 20, right: 20, bottom: 20, left: 20 },
    }],
    tag: "草稿箱",
    tags: [DRAFT_BOX_BASE_TAG],
  },
];
