import { resolveEditorPlacementGeometry, resolveEditorSceneSpace } from "./placement-space";
import { GridRectIndex } from "@/shared/geometry/grid-rect-index";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EditorServices } from "./editor-services";
import {
  EntityCollectionType,
  type EntityPlacementValidationReason,
  type EntityPlacementValidationReasonCode,
  type EntityPlacementValidationResult,
} from "@/domain/editor/types/editor-types";
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import {
  LOGISTICS_KIND,
  type LogisticsKind,
} from "@/domain/shared/logistics";
import {
  isBaseBuiltinEntityId,
  resolveBaseBuiltinEntities,
} from "@/domain/registry/types/base-definition";
import type { GridEdge, GridRect } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import { intersectsSceneBounds, isRectInSceneBounds, resolveSceneBoundarySegments } from "@/shared/geometry/scene-space";
import { rotateGridEdge } from "@/shared/geometry/port";
import { runInAction } from "mobx";
import type { UiKey } from "@/shared/i18n";

import type { EditorStateReadWrite } from "./state-impl";
import { isDraftEntity } from "./draft-entity";
import {
  hasOuterRingEdgeSnapBehavior,
  resolveOuterRingEdgeSnap,
} from "./placement-snapping";
import { WAREHOUSE_BUS_SEGMENT_DEFINITION_ID, WAREHOUSE_BUS_SOURCE_DEFINITION_ID } from "@/shared/warehouse-bus";

const OUTER_RING_EDGE_SNAP_REASON_MESSAGE: UiKey = "placementReason.edgeSnap";
const WAREHOUSE_BUS_SEED_CONFIG_KEY = "warehouseBusSeed";

const VALID_PLACEMENT_RESULT: EntityPlacementValidationResult = {
  canPlace: true,
  reasons: [],
};

/** 原因文案以 i18n 键保存，由界面与画布按当前语言解析。 */
const PLACEMENT_REASON_MESSAGES: Record<EntityPlacementValidationReasonCode, UiKey> = {
  "outside-base": "placementReason.outsideBase",
  overlap: "placementReason.overlap",
  "warehouse-bus-disconnected": "placementReason.busDisconnected",
  "near-same-entity": "placementReason.nearSameEntity",
};

interface PlacementValidationEntry {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly gridRect: GridRect;
}

export function syncPlacementValidationState(options: {
  document: WorldDocument;
  state: EditorStateReadWrite;
  workspace: EditorServices;
}): void {
  runInAction(() => {
    const validationByEntityId = resolvePlacementValidations(options);
    const invalidEntityIds = Object.entries(validationByEntityId)
      .filter(([, validation]) => !validation.canPlace)
      .map(([entityId]) => entityId);

    const current = options.state.internalTransientState.placementValidationByEntityId;
    for (const entityId of Object.keys(current)) {
      if (!(entityId in validationByEntityId)) delete current[entityId];
    }
    for (const [entityId, next] of Object.entries(validationByEntityId)) {
      const previous = current[entityId];
      if (previous?.canPlace !== next.canPlace
        || previous.reasons.length !== next.reasons.length
        || previous.reasons.some((reason, index) => reason.code !== next.reasons[index]?.code
          || reason.message !== next.reasons[index]?.message)) {
        current[entityId] = next;
      }
    }
    const invalid = options.state.collections[EntityCollectionType.invalidPlacement];
    if (invalid.length !== invalidEntityIds.length
      || invalidEntityIds.some((id, index) => invalid[index] !== id)) {
      invalid.replace(invalidEntityIds);
    }
  });
}

export function resolveCachedPlacementValidation(options: {
  entityId: string;
  state: EditorStateReadWrite;
}): EntityPlacementValidationResult {
  return options.state.internalTransientState.placementValidationByEntityId[options.entityId]
    ?? VALID_PLACEMENT_RESULT;
}

export function hasOutsideBasePlacementReason(options: {
  document: WorldDocument;
  entityIds: readonly string[];
  state: EditorStateReadWrite;
  workspace: EditorServices;
}): boolean {
  return resolveOutsideBasePlacementEntityIds(options).size > 0;
}

export function resolveOutsideBasePlacementEntityIds(options: {
  document: WorldDocument;
  entityIds: readonly string[];
  state: EditorStateReadWrite;
  workspace: EditorServices;
}): ReadonlySet<string> {
  const validationByEntityId = resolvePlacementValidations({
    document: options.document,
    state: options.state,
    workspace: options.workspace,
  });

  return new Set(
    options.entityIds.filter((entityId) =>
      validationByEntityId[entityId]?.reasons.some((reason) => reason.code === "outside-base")
      ?? false,
    ),
  );
}

export function resolvePlacementValidations(options: {
  document: WorldDocument;
  state?: EditorStateReadWrite;
  workspace: EditorServices;
  drafts?: readonly WorldEntity[];
  ignoredEntityIds?: ReadonlySet<string>;
}): Record<string, EntityPlacementValidationResult> {
  const definitionMap = new Map(
    options.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const entries = resolveValidationEntries({
    document: options.document,
    state: options.state,
    drafts: options.drafts ?? options.state?.drafts ?? [],
    ignoredEntityIds: options.ignoredEntityIds,
    definitionMap,
    registry: options.workspace.registry,
    includeBaseBuiltins: options.workspace.includeBaseBuiltins,
  });
  const mutableReasonsByEntityId = new Map<string, EntityPlacementValidationReason[]>(
    entries.map((entry) => [entry.entity.id, []]),
  );

  applyScenePlacementReasons({ ...options, entries, reasonsByEntityId: mutableReasonsByEntityId });

  if (options.state !== undefined) {
    applyCachedOverlapReasons({ ...options, state: options.state, entries, reasonsByEntityId: mutableReasonsByEntityId });
  } else {
    applyOverlapReasons({ entries, registry: options.workspace.registry, reasonsByEntityId: mutableReasonsByEntityId });
  }
  applyWarehouseConnectionReasons({
    entries,
    reasonsByEntityId: mutableReasonsByEntityId,
  });
  applyNearSameEntityReasons({
    entries,
    reasonsByEntityId: mutableReasonsByEntityId,
  });

  return Object.fromEntries(
    entries.map((entry) => {
      const reasons = mutableReasonsByEntityId.get(entry.entity.id) ?? [];

      return [
        entry.entity.id,
        {
          canPlace: reasons.length === 0,
          reasons,
        } satisfies EntityPlacementValidationResult,
      ];
    }),
  );
}

function resolveValidationEntries(options: {
  document: WorldDocument;
  state?: EditorStateReadWrite;
  drafts: readonly WorldEntity[];
  definitionMap: ReadonlyMap<string, EntityDefinition>;
  registry: EditorServices["registry"];
  includeBaseBuiltins?: boolean;
  ignoredEntityIds?: ReadonlySet<string>;
}): PlacementValidationEntry[] {
  const ghostEntityIds = options.ignoredEntityIds
    ?? new Set(options.state?.collections[EntityCollectionType.ghost] ?? []);
  const entities = [
    ...resolveOrderedDocumentEntities(options.document),
    ...resolveBaseBuiltinEntities({
      baseDefinitions: options.includeBaseBuiltins === false ? [] : options.registry.baseDefinitions,
      baseId: options.document.baseId,
    }),
    ...options.drafts,
  ];
  const seenEntityIds = new Set<string>();
  const entries: PlacementValidationEntry[] = [];

  for (const entity of entities) {
    if (seenEntityIds.has(entity.id) || ghostEntityIds.has(entity.id)) {
      continue;
    }

    seenEntityIds.add(entity.id);

    const definition = options.definitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    entries.push({
      entity,
      definition,
      gridRect: resolveEntityGridRect({ entity, definition }),
    });
  }

  return entries;
}

function resolveOrderedDocumentEntities(document: WorldDocument): WorldEntity[] {
  const orderedEntityIds = [...document.entityOrder];
  const knownEntityIds = new Set(orderedEntityIds);

  for (const entityId of Object.keys(document.entities)) {
    if (knownEntityIds.has(entityId)) {
      continue;
    }

    orderedEntityIds.push(entityId);
  }

  return orderedEntityIds.flatMap((entityId) => {
    const entity = document.entities[entityId];

    return entity === undefined ? [] : [entity];
  });
}













function applyOverlapReasons(options: {
  entries: readonly PlacementValidationEntry[];
  registry: EditorServices["registry"];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): void {
  // 沿 x 轴扫描候选，跳过不可能相交的设备；所有碰撞与替换规则保持原样。
  const entries = [...options.entries].sort((left, right) => left.gridRect.x - right.gridRect.x);
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    if (left === undefined) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      if (right !== undefined && right.gridRect.x >= left.gridRect.x + left.gridRect.width) break;
      if (right === undefined || !areGridRectsIntersecting(left.gridRect, right.gridRect)) {
        continue;
      }

      const leftIsBaseBuiltin = isBaseBuiltinEntityId(left.entity.id);
      const rightIsBaseBuiltin = isBaseBuiltinEntityId(right.entity.id);
      if (leftIsBaseBuiltin || rightIsBaseBuiltin) {
        if (!leftIsBaseBuiltin) {
          appendReason(options.reasonsByEntityId, left.entity.id, "overlap");
        }
        if (!rightIsBaseBuiltin) {
          appendReason(options.reasonsByEntityId, right.entity.id, "overlap");
        }
        continue;
      }

      if (isAllowedPipeOverlapPair({
        left,
        right,
      })) {
        continue;
      }

      if (isAllowedLogisticsPlacementReplacement({
        left,
        right,
        registryQueries: options.registry.queries,
      })) {
        continue;
      }

      // 拖拽中 draft 与文档实体 overlap 时，仅标记 draft 为 invalid，
      // 文档中正式 entity 不显示 invalid。draft 放下后（变为普通 entity）
      // 再触发 validation 时双方都会正常标记。
      const leftIsDraft = isDraftEntity(left.entity);
      const rightIsDraft = isDraftEntity(right.entity);
      if (leftIsDraft && !rightIsDraft) {
        appendReason(options.reasonsByEntityId, left.entity.id, "overlap");
        continue;
      }
      if (!leftIsDraft && rightIsDraft) {
        appendReason(options.reasonsByEntityId, right.entity.id, "overlap");
        continue;
      }

      appendReason(options.reasonsByEntityId, left.entity.id, "overlap");
      appendReason(options.reasonsByEntityId, right.entity.id, "overlap");
    }
  }
}

function applyWarehouseConnectionReasons(options: {
  entries: readonly PlacementValidationEntry[];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): void {
  const sourceEntries = options.entries.filter((entry) =>
    isWarehouseBusSeedEntry(entry)
    && hasNoBasePlacementReason(options.reasonsByEntityId, entry.entity.id),
  );
  const segmentEntries = options.entries.filter((entry) =>
    entry.definition.id === WAREHOUSE_BUS_SEGMENT_DEFINITION_ID,
  );
  const validSegmentIds = resolveValidWarehouseBusSegmentIds({
    sourceEntries,
    segmentEntries,
    reasonsByEntityId: options.reasonsByEntityId,
  });

  for (const entry of options.entries) {
    if (isBaseBuiltinEntityId(entry.entity.id)) {
      continue;
    }

    if (!hasPlacementBehavior(entry.definition, PLACEMENT_BEHAVIOR_TYPE.mustConnectToHub)) {
      continue;
    }

    if (isConnectedToWarehouseHub({
      entry,
      sourceEntries,
      segmentEntries,
      validSegmentIds,
    })) {
      continue;
    }

    appendReason(
      options.reasonsByEntityId,
      entry.entity.id,
      "warehouse-bus-disconnected",
    );
  }

  for (const entry of options.entries) {
    if (isBaseBuiltinEntityId(entry.entity.id)) {
      continue;
    }

    if (!hasPlacementBehavior(entry.definition, PLACEMENT_BEHAVIOR_TYPE.mustConnectToHubViaOppositePortEdge)) {
      continue;
    }

    const requiredEdge = resolvePortOppositeWorldEdge(entry);
    if (requiredEdge === null) {
      appendReason(options.reasonsByEntityId, entry.entity.id, "warehouse-bus-disconnected");
      continue;
    }

    if (isEntryAdjacentToHubOnEdge({
      entry,
      edge: requiredEdge,
      sourceEntries,
      segmentEntries,
      validSegmentIds,
    })) {
      continue;
    }

    appendReason(
      options.reasonsByEntityId,
      entry.entity.id,
      "warehouse-bus-disconnected",
    );
  }
}

function applyNearSameEntityReasons(options: {
  entries: readonly PlacementValidationEntry[];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): void {
  const groups = new Map<string, PlacementValidationEntry[]>();
  for (const entry of options.entries) {
    if (!entry.definition.placementBehaviors.some((b) => b.type === PLACEMENT_BEHAVIOR_TYPE.noNearSameEntity)) continue;
    const group = groups.get(entry.definition.id) ?? [];
    group.push(entry); groups.set(entry.definition.id, group);
  }
  const indexes = new Map([...groups].map(([id, entries]) => [id, new GridRectIndex(entries, (entry) => entry.gridRect)]));
  const order = new Map(options.entries.map((entry, index) => [entry, index]));
  for (let leftIndex = 0; leftIndex < options.entries.length; leftIndex += 1) {
    const left = options.entries[leftIndex];
    if (left === undefined) {
      continue;
    }

    const behavior = left.definition.placementBehaviors.find(
      (b) => b.type === PLACEMENT_BEHAVIOR_TYPE.noNearSameEntity,
    );
    if (behavior === undefined || behavior.type !== PLACEMENT_BEHAVIOR_TYPE.noNearSameEntity) {
      continue;
    }

    const range = behavior.range;

    const candidates = indexes.get(left.definition.id)!.intersecting({
      x: left.gridRect.x - range, y: left.gridRect.y - range,
      width: left.gridRect.width + 2 * range, height: left.gridRect.height + 2 * range,
    });
    for (const right of candidates) {
      if (order.get(right)! <= leftIndex) continue;
      if (right === undefined || right.definition.id !== left.definition.id) {
        continue;
      }

      if (areGridRectsWithinRange(left.gridRect, right.gridRect, range)) {
        appendReason(options.reasonsByEntityId, left.entity.id, "near-same-entity");
        appendReason(options.reasonsByEntityId, right.entity.id, "near-same-entity");
      }
    }
  }
}

function areGridRectsWithinRange(a: GridRect, b: GridRect, range: number): boolean {
  // 将 a 的足印向外扩展 range 格，检查 b 是否与之相交
  const expanded: GridRect = {
    x: a.x - range,
    y: a.y - range,
    width: a.width + range * 2,
    height: a.height + range * 2,
  };
  return areGridRectsIntersecting(expanded, b);
}

function isWarehouseBusSeedEntry(entry: PlacementValidationEntry): boolean {
  if (entry.definition.id === WAREHOUSE_BUS_SOURCE_DEFINITION_ID) {
    return true;
  }

  return (
    isBaseBuiltinEntityId(entry.entity.id)
    && entry.definition.id === WAREHOUSE_BUS_SEGMENT_DEFINITION_ID
    && entry.entity.config[WAREHOUSE_BUS_SEED_CONFIG_KEY] === true
  );
}

function resolvePortOppositeWorldEdge(
  entry: PlacementValidationEntry,
): GridEdge | null {
  const firstPortGroup = entry.definition.portGroups[0];
  if (firstPortGroup === undefined) {
    return null;
  }

  const firstPort = firstPortGroup.ports[0];
  if (firstPort === undefined) {
    return null;
  }

  // rotation=0 时端口边的对边
  const oppositeAtZero = oppositeGridEdge(firstPort.edge);
  // 按 entity rotation 旋转得到世界坐标中的边
  return rotateGridEdge(oppositeAtZero, entry.entity.rotation);
}

function isEntryAdjacentToHubOnEdge(options: {
  entry: PlacementValidationEntry;
  edge: GridEdge;
  sourceEntries: readonly PlacementValidationEntry[];
  segmentEntries: readonly PlacementValidationEntry[];
  validSegmentIds: ReadonlySet<string>;
}): boolean {
  const candidates = [
    ...options.sourceEntries,
    ...options.segmentEntries.filter(
      (seg) =>
        seg.entity.id !== options.entry.entity.id
        && options.validSegmentIds.has(seg.entity.id),
    ),
  ];

  return candidates.some((candidate) =>
    isEntryAdjacentOnEdge(options.entry, candidate, options.edge),
  );
}

function isEntryAdjacentOnEdge(
  entry: PlacementValidationEntry,
  candidate: PlacementValidationEntry,
  edge: GridEdge,
): boolean {
  const a = entry.gridRect;
  const b = candidate.gridRect;

  switch (edge) {
    case "NORTH":
      return a.y === b.y + b.height && overlapsX(a, b);
    case "SOUTH":
      return a.y + a.height === b.y && overlapsX(a, b);
    case "EAST":
      return a.x + a.width === b.x && overlapsY(a, b);
    case "WEST":
      return a.x === b.x + b.width && overlapsY(a, b);
  }
}

function overlapsX(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

function overlapsY(a: GridRect, b: GridRect): boolean {
  return a.y < b.y + b.height && a.y + a.height > b.y;
}

function oppositeGridEdge(edge: GridEdge): GridEdge {
  switch (edge) {
    case "NORTH":
      return "SOUTH";
    case "EAST":
      return "WEST";
    case "SOUTH":
      return "NORTH";
    case "WEST":
      return "EAST";
  }
}

function resolveValidWarehouseBusSegmentIds(options: {
  sourceEntries: readonly PlacementValidationEntry[];
  segmentEntries: readonly PlacementValidationEntry[];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): Set<string> {
  const validSegmentIds = new Set<string>();
  let didChange = true;

  while (didChange) {
    didChange = false;

    for (const segment of options.segmentEntries) {
      if (
        validSegmentIds.has(segment.entity.id)
        || !hasNoBasePlacementReason(options.reasonsByEntityId, segment.entity.id)
      ) {
        continue;
      }

      if (
        isEntryAdjacentToAny(segment, options.sourceEntries)
        || isEntryAdjacentToAny(
          segment,
          options.segmentEntries.filter((entry) => validSegmentIds.has(entry.entity.id)),
        )
      ) {
        validSegmentIds.add(segment.entity.id);
        didChange = true;
      }
    }
  }

  return validSegmentIds;
}

function isConnectedToWarehouseHub(options: {
  entry: PlacementValidationEntry;
  sourceEntries: readonly PlacementValidationEntry[];
  segmentEntries: readonly PlacementValidationEntry[];
  validSegmentIds: ReadonlySet<string>;
}): boolean {
  if (isEntryAdjacentToAny(options.entry, options.sourceEntries)) {
    return true;
  }

  return isEntryAdjacentToAny(
    options.entry,
    options.segmentEntries.filter((entry) =>
      entry.entity.id !== options.entry.entity.id
      && options.validSegmentIds.has(entry.entity.id),
    ),
  );
}

function hasNoBasePlacementReason(
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>,
  entityId: string,
): boolean {
  return !(reasonsByEntityId.get(entityId) ?? []).some((reason) =>
    reason.code === "outside-base" || reason.code === "overlap",
  );
}

function isEntryAdjacentToAny(
  entry: PlacementValidationEntry,
  candidates: readonly PlacementValidationEntry[],
): boolean {
  return candidates.some((candidate) =>
    candidate.entity.id !== entry.entity.id
    && areGridRectsEdgeAdjacent(entry.gridRect, candidate.gridRect),
  );
}

function appendReason(
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>,
  entityId: string,
  code: EntityPlacementValidationReasonCode,
  message: UiKey = PLACEMENT_REASON_MESSAGES[code],
): void {
  const reasons = reasonsByEntityId.get(entityId);
  if (reasons === undefined || reasons.some((reason) => reason.code === code)) {
    return;
  }

  reasons.push({
    code,
    message,
  });
}

function hasPlacementBehavior(
  definition: EntityDefinition,
  behaviorType: string,
): boolean {
  return definition.placementBehaviors?.some((behavior) => behavior.type === behaviorType) ?? false;
}

function isAllowedPipeOverlapPair(options: {
  left: PlacementValidationEntry;
  right: PlacementValidationEntry;
}): boolean {
  return (
    hasPlacementBehavior(options.left.definition, PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap)
    && hasPlacementBehavior(options.right.definition, PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap)
  ) || (
    hasPlacementBehavior(options.right.definition, PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap)
    && hasPlacementBehavior(options.left.definition, PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap)
  );
}


function resolveEntityGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
}): GridRect {
  const footprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.entity.rotation,
  );

  return {
    x: options.entity.position.x,
    y: options.entity.position.y,
    width: footprint.width,
    height: footprint.height,
  };
}


function areGridRectsIntersecting(left: GridRect, right: GridRect): boolean {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  );
}

function areGridRectsEdgeAdjacent(left: GridRect, right: GridRect): boolean {
  const touchesVerticalEdge =
    left.x + left.width === right.x || right.x + right.width === left.x;
  const overlapsY = left.y < right.y + right.height && left.y + left.height > right.y;
  if (touchesVerticalEdge && overlapsY) {
    return true;
  }

  const touchesHorizontalEdge =
    left.y + left.height === right.y || right.y + right.height === left.y;
  const overlapsX = left.x < right.x + right.width && left.x + left.width > right.x;
  return touchesHorizontalEdge && overlapsX;
}

/**
 * 返回设备定义所属的物流族标签，不存在则返回 null。
 * 用于判定两个设备是否为同一物流族（BeltFamily / PipeFamily），决定是否允许放置替换。
 */
function resolveLogisticsKind(
  definition: EntityDefinition,
  registryQueries: RegistryQuery,
): LogisticsKind | null {
  if (registryQueries.isBeltFamily(definition.id)) {
    return LOGISTICS_KIND.belt;
  }

  if (registryQueries.isPipeFamily(definition.id)) {
    return LOGISTICS_KIND.pipe;
  }

  return null;
}

/**
 * 判定一对重叠实体是否为合法的物流放置替换。
 * 条件：
 *   1. 一方是 placement-draft 预览实体，另一方是 document 正式实体
 *   2. 双方属于同一物流族（BeltFamily / PipeFamily）
 * 满足以上条件时不报重叠错误，放置提交时由 applyPlacementDraft 执行实际替换。
 * 移动草稿（move-draft:）不满足条件 1，因此移动时仍然会报重叠。
 */
function isAllowedLogisticsPlacementReplacement(options: {
  left: PlacementValidationEntry;
  right: PlacementValidationEntry;
  registryQueries: RegistryQuery;
}): boolean {
  const leftIsPlacementDraft = options.left.entity.id.startsWith("placement-draft:");
  const rightIsPlacementDraft = options.right.entity.id.startsWith("placement-draft:");

  // 必须恰好一方是 placement draft
  if (leftIsPlacementDraft === rightIsPlacementDraft) {
    return false;
  }

  const leftFamily = resolveLogisticsKind(
    options.left.definition,
    options.registryQueries,
  );
  const rightFamily = resolveLogisticsKind(
    options.right.definition,
    options.registryQueries,
  );

  // 双方必须同族
  if (leftFamily === null || leftFamily !== rightFamily) {
    return false;
  }

  // grid rect 必须完全相同
  return areGridRectsEqual(options.left.gridRect, options.right.gridRect);
}

function areGridRectsEqual(left: GridRect, right: GridRect): boolean {
  return (
    left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
  );
}

interface PlacementOverlapCache {
  entities: WorldDocument["entities"];
  entityOrder: WorldDocument["entityOrder"];
  baseId: string;
  definitions: EditorServices["registry"]["entityDefinitions"];
  bases: EditorServices["registry"]["baseDefinitions"];
  ghostKey: string;
  ids: ReadonlySet<string>;
  index: GridRectIndex<PlacementValidationEntry>;
  reasons: Map<string, EntityPlacementValidationReason[]>;
}

const placementOverlapCaches = new WeakMap<EditorStateReadWrite, PlacementOverlapCache>();

/** 正式基地的碰撞结果复用；虚影仍使用同一套碰撞/替换规则，连接类全局规则继续正常运行。 */
function applyCachedOverlapReasons(options: {
  document: WorldDocument; state: EditorStateReadWrite; workspace: EditorServices;
  entries: readonly PlacementValidationEntry[];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
  ignoredEntityIds?: ReadonlySet<string>;
}): void {
  const { document, state, workspace } = options;
  const registry = workspace.registry;
  const ignoredEntityIds = options.ignoredEntityIds
    ?? new Set(state.collections[EntityCollectionType.ghost]);
  const ghostKey = JSON.stringify([...ignoredEntityIds].sort());
  let cached = placementOverlapCaches.get(state);
  if (!cached || cached.entities !== document.entities || cached.entityOrder !== document.entityOrder
    || cached.baseId !== document.baseId || cached.definitions !== registry.entityDefinitions
    || cached.bases !== registry.baseDefinitions || cached.ghostKey !== ghostKey) {
    const entries = resolveValidationEntries({ document, state, registry, drafts: [], ignoredEntityIds,
      includeBaseBuiltins: workspace.includeBaseBuiltins,
      definitionMap: new Map(registry.entityDefinitions.map((definition) => [definition.id, definition])) });
    const reasons = new Map<string, EntityPlacementValidationReason[]>(entries.map((entry) => [entry.entity.id, []]));
    applyOverlapReasons({ entries, registry, reasonsByEntityId: reasons });
    cached = { entities: document.entities, entityOrder: document.entityOrder, baseId: document.baseId,
      definitions: registry.entityDefinitions, bases: registry.baseDefinitions, ghostKey,
      ids: new Set(entries.map((entry) => entry.entity.id)), index: new GridRectIndex(entries, (entry) => entry.gridRect), reasons };
    placementOverlapCaches.set(state, cached);
  }
  for (const [id, reasons] of cached.reasons) {
    for (const reason of reasons) appendReason(options.reasonsByEntityId, id, reason.code);
  }
  const drafts = options.entries.filter((entry) => !cached.ids.has(entry.entity.id));
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i]!;
    const candidates = cached.index.intersecting(draft.gridRect);
    for (let j = 0; j < i; j++) {
      if (areGridRectsIntersecting(drafts[j]!.gridRect, draft.gridRect)) candidates.push(drafts[j]!);
    }
    for (const other of candidates) {
      applyOverlapReasons({ entries: [other, draft], registry, reasonsByEntityId: options.reasonsByEntityId });
    }
  }
}

/** 每项资格限制与完整占地在同一区域内成立；缺失边界不产生虚构内外圈。 */
function applyScenePlacementReasons(options: {
  entries: readonly PlacementValidationEntry[];
  document: WorldDocument;
  workspace: EditorServices;
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): void {
  const space = resolveEditorSceneSpace(options.workspace, options.document);
  const areas = resolveBaseAreas(space);
  const hasBoundary = resolveSceneBoundarySegments(space.areas).length > 0;
  for (const entry of options.entries) {
    if (isBaseBuiltinEntityId(entry.entity.id)) continue;
    const geometry = resolveEditorPlacementGeometry(options.workspace, options.document, entry.entity);
    if (hasBoundary && hasOuterRingEdgeSnapBehavior(entry.definition)
      && resolveOuterRingEdgeSnap({ definition: entry.definition, ...geometry,
        position: entry.entity.position, rotation: entry.entity.rotation }) === null) {
      appendReason(options.reasonsByEntityId, entry.entity.id, "outside-base", OUTER_RING_EDGE_SNAP_REASON_MESSAGE);
    }
    const coreOnly = hasPlacementBehavior(entry.definition, PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase);
    const allowed = new Set(geometry.allowedAreaIds);
    if (!areas.some((area) => allowed.has(area.id)
      && isRectInSceneBounds(coreOnly ? area.placeableBounds : area.outerBounds, entry.gridRect))) {
      appendReason(options.reasonsByEntityId, entry.entity.id, "outside-base");
    }
    if (hasBoundary && entry.definition.tags.includes("InnerRingNotAllowed")
      && areas.some((area) => intersectsSceneBounds(area.placeableBounds, entry.gridRect))) {
      appendReason(options.reasonsByEntityId, entry.entity.id, "outside-base");
    }

  }
}
