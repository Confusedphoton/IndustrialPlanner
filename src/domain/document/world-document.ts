import type {
  GridFloatPoint,
  GridPoint,
  GridRotation,
} from "../shared/grid";
import { createUuid } from "../shared/uuid";
import type {
  SlotLinkDefinition,
  CacheLinkEndpointDefinition,
  LinkType,
} from "../shared/slot-link";
import type { RegionAnnotation } from "./region-annotation";
import { BLUEPRINT_SCHEMA_VERSION } from "./blueprint-document";

export type { SlotLinkDefinition, CacheLinkEndpointDefinition, LinkType };

// USER-REQUIREMENT 2026-09-18: WorldDocument 与 Blueprint 共用迁移边界；升级前必须先核查当前 schema 是否已进入生产环境。当前生产版本为 5、目标版本 6，未上线前的新增迁移统一并入 5→6，禁止新建 6→7。
export const WORLD_DOCUMENT_SCHEMA_VERSION = BLUEPRINT_SCHEMA_VERSION;

export interface WorldEntity {
  id: string;
  definitionId: string;
  position: GridPoint;
  rotation: GridRotation;
  config: Record<string, unknown>;
  tags: string[];
}

export interface WorldDocumentViewportSettings {
  readonly center: GridFloatPoint;
  readonly gridSize: number;
  readonly displayRotation: GridRotation;
}

export interface WorldDocumentSettings {
  /** 保存的视口中心、缩放与旋转；新建文档没有保存过视口，首次打开时对准基地中心。 */
  readonly viewport?: WorldDocumentViewportSettings;
  /** 电力模式：real（真实电力）或 infinite（无限电力），默认 infinite。 */
  readonly powerMode: "real" | "infinite";
  /** 手动覆盖总耗电（kW）。undefined = 按真实计算值。仅 powerMode === "real" 时生效。 */
  readonly powerConsumptionOverride?: number;
  readonly [key: string]: unknown;
}

export interface WorldDocument {
  schemaVersion: number;
  documentKey: string;
  baseId: string;
  meta: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  entities: Record<string, WorldEntity>;
  entityOrder: string[];
  slotLinks: SlotLinkDefinition[];
  regions: readonly RegionAnnotation[];
  documentSettings: WorldDocumentSettings;
}

export const DEFAULT_WORLD_BASE_ID = "wuling_protocol_core";

export const createWorldDocument = (options: {
  baseId?: string;
} = {}): WorldDocument => {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: WORLD_DOCUMENT_SCHEMA_VERSION,
    documentKey: createUuid(),
    baseId: options.baseId ?? DEFAULT_WORLD_BASE_ID,
    meta: {
      id: `world-${timestamp}`,
      name: "Untitled World",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    entities: {},
    entityOrder: [],
    slotLinks: [],
    regions: [],
    documentSettings: {
      powerMode: "infinite",
    },
  };
};
