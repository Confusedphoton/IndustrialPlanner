import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveBaseBuiltinEntities, type BaseDefinition } from "@/domain/registry/types/base-definition";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import type {
  CreateLogisticsDraftStartOptions,
  LogisticsDraftActionResult,
  LogisticsDraftEndpoint,
  LogisticsDraftInvalidReason,
  LogisticsDraftReadonlyState,
  LogisticsKind,
  LogisticsPathCell,
  LogisticsRouteOrder,
  MoveLogisticsDraftEndOptions,
} from "@/domain/shared/logistics";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { isGridPointInBaseAreas, resolveBaseAreas } from "@/shared/geometry/base-areas";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { DraftEntity } from "../draft-entity";
import { cloneEntityConfig } from "../entity-config-clone";
import { canDefinitionsOverlap, resolvePlacementValidations, syncPlacementValidationState } from "../placement-validation";
import { findAutoRoute, type AutoRouteCell } from "../logistics/auto-route";
import { action } from "mobx";
import type { EditorActionsContext } from "./types";
import {
  appendFreehandPathPoints,
  areGridPointsEqual,
  createEntityDefinitionMap,
  doesFirstStepMoveTowardFixedSourceInput,
  findEntityById,
  findTopEntityAtGridPoint,
  generateSingleBendPathPoints,
  gridPointKey,
  isAnyOrdinaryLogisticsDefinitionId,
  isGridPointInsideRect,
  isOrdinaryLogisticsDefinitionId,
  oppositeEdge,
  resolveEntityGridRect,
  resolveDevicePortEndpoints,
  resolveDirectionEdge,
  resolveInputEndpointAtPointer,
  resolveInputEndpointOnPath,
  resolveCellFromEdges,
  resolveLogisticsPathCells,
  resolveNearestDevicePortEndpoint,
  resolveSourceStartGridPoint,
} from "../logistics/logistics-utils";

type EditorLogisticsActions = Pick<
  EditorAction,
  | "applyLogisticDraft"
  | "cancelLogisticsDraft"
  | "createLogisticsDraftStart"
  | "moveLogisticEnd"
  | "setLogisticsSuppression"
>;

type DevicePortEndpoint = Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>;

type AutoDeviceKind = "splitter" | "converger" | "connector";
type LogisticsPathAxis = "horizontal" | "vertical";

interface AutoDraftCellOverride {
  readonly definitionId: string;
  readonly rotation: GridRotation;
}

interface AutoDraftPlan {
  readonly cellOverridesByGridKey: ReadonlyMap<string, AutoDraftCellOverride>;
  readonly replacingEntityIds: readonly string[];
  readonly invalidReason: LogisticsDraftInvalidReason | null;
}

interface DraftEntityBuildResult {
  readonly draftEntities: readonly DraftEntity[];
  readonly draftIds: readonly string[];
  readonly draftIdByGridKey: ReadonlyMap<string, string>;
}

interface OrdinaryLogisticsConnectionInfo {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly inputEdge: GridEdge;
  readonly outputEdge: GridEdge;
  readonly inputConnected: boolean;
  readonly outputConnected: boolean;
}

/** 自动寻路在起终点外接矩形之外再搜索的格数，给绕行留空间。 */
const AUTO_ROUTE_SEARCH_MARGIN = 16;
const AUTO_ROUTE_FREE: AutoRouteCell = { type: "free" };
const AUTO_ROUTE_BLOCKED: AutoRouteCell = { type: "blocked" };

interface DeviceRouteCandidate {
  readonly source: LogisticsDraftEndpoint;
  readonly target: DevicePortEndpoint;
  readonly routeOrder: LogisticsRouteOrder;
  readonly points: readonly GridPoint[];
  readonly lengthScore: number;
  readonly bendScore: number;
  readonly targetDistanceScore: number;
  readonly routeOrderPriority: number;
  readonly signature: string;
}

interface LogisticsActionContext extends EditorActionsContext {
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  nextDraftCounter(): number;
}

export function createEditorLogisticsActions(
  context: EditorActionsContext,
): EditorLogisticsActions {
  let logisticsDraftCounter = 0;
  let reverseDrawSource: LogisticsDraftEndpoint | null = null;
  const logisticsContext: LogisticsActionContext = {
    ...context,
    entityDefinitionMap: createEntityDefinitionMap(
      context.workspace.registry.entityDefinitions,
    ),
    nextDraftCounter: () => {
      logisticsDraftCounter += 1;
      return logisticsDraftCounter;
    },
  };

  return {
    createLogisticsDraftStart: action((options) => {
      // TODO: 实现物流草稿起点创建逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 source 解析、初始 preview 和 collection 接线。
      reverseDrawSource = null;
      clearLogisticsDraftState(logisticsContext);

      const source = resolveCreateSourceEndpoint(logisticsContext, options);
      if (source === null) {
        return createIgnoredLogisticsActionResult();
      }

      const routeOrder = options.routeOrder ?? "vertical-first";

      // 设备源起笔时不生成路径 cell，
      // 避免在鼠标悬浮阶段暴露多余的 1 格传送带/管道草稿。
      // moveLogisticEnd 首次调用时从 source 和 pointer 重新生成实际路径。
      if (source.type === "device-port") {
        const replacingEntityId = source.fixedSource === true
          ? resolveFixedSourceReplacingEntityId({
              context: logisticsContext,
              kind: options.kind,
              source,
            })
          : null;
        logisticsContext.state.internalTransientState.logisticsDraft = {
          kind: options.kind,
          source,
          target: null,
          routeOrder,
          cells: [],
          headDraftEntityId: null,
          replacingEntityId,
          canApply: false,
          invalidReason: null,
        };
        syncPlacementValidationState({
          document: logisticsContext.document.getSnapshot(),
          state: logisticsContext.state,
          workspace: logisticsContext.workspace,
        });
        return {
          status: "created",
          canApply: false,
          invalidReason: null,
          headGridPoint: null,
          headDraftEntityId: null,
          sourceEntityId: source.entityId,
          targetEntityId: null,
        };
      }

      const replacingEntityId = source.type === "logistics-entity"
        ? source.entityId
        : null;
      const start = resolveSourceStartGridPoint(source);

      return rebuildLogisticsDraft({
        context: logisticsContext,
        kind: options.kind,
        source,
        target: null,
        routeOrder,
        points: [start],
        replacingEntityId,
        allowEmptyTarget: options.allowEmptySource !== false,
        autoCreateSplittersAndConvergers: true,
        status: "created",
      });
    }),

    moveLogisticEnd: action((options) => {
      // TODO: 实现物流终点移动逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 touch freehand 与 mouse single-bend 路径更新。
      // 2026-04-30 修正：已吸附设备端口时，指针在设备内保持吸附，不深入设备内部。
      const activeDraft = logisticsContext.state.internalTransientState.logisticsDraft;
      const draft = activeDraft === null || reverseDrawSource === null ? activeDraft : {
        ...activeDraft,
        source: reverseDrawSource,
        cells: [...activeDraft.cells].reverse(),
      };
      reverseDrawSource = null;
      if (draft === null || draft.source === null) {
        return createIgnoredLogisticsActionResult();
      }

      const currentDocument = logisticsContext.document.getSnapshot();

      if (draft.target?.type === "device-port" && options.routeMode.type === "freehand") {
        const targetEntity = findEntityById({
          entityId: draft.target.entityId,
          document: currentDocument,
          drafts: [],
          baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
        });
        if (targetEntity !== null) {
          const targetDefinition = logisticsContext.entityDefinitionMap.get(
            targetEntity.definitionId,
          );
          if (
            targetDefinition !== undefined
            && isGridPointInsideRect(
              options.pointerGridPoint,
              resolveEntityGridRect({
                entity: targetEntity,
                definition: targetDefinition,
              }),
            )
          ) {
            return createLogisticsActionResultFromDraft(draft);
          }
        }
      }

      if (draft.source.type === "empty-cell") {
        const reverseRoute = resolveReverseOutputRoute(logisticsContext, draft, options);
        if (reverseRoute !== null) {
          reverseDrawSource = draft.source;
          return rebuildLogisticsDraft({
            context: logisticsContext,
            kind: draft.kind,
            source: reverseRoute.source,
            target: null,
            points: reverseRoute.points,
            routeOrder: draft.routeOrder,
            replacingEntityId: null,
            allowEmptyTarget: options.allowEmptyTarget ?? true,
            autoCreateSplittersAndConvergers: options.autoCreateSplittersAndConvergers ?? true,
            status: "updated",
          });
        }
      }

      const cursorTarget = resolveInputEndpointAtPointer({
        pointerGridPoint: options.pointerGridPoint,
        kind: draft.kind,
        document: currentDocument,
        drafts: [],
        entityDefinitionMap: logisticsContext.entityDefinitionMap,
        registryQueries: logisticsContext.workspace.registry.queries,
        baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
      });

      if (options.routeMode.type === "single-bend") {
        const targetEntity = findTopEntityAtGridPoint({
          gridPoint: options.pointerGridPoint,
          document: currentDocument,
          drafts: [],
          entityDefinitionMap: logisticsContext.entityDefinitionMap,
          registryQueries: logisticsContext.workspace.registry.queries,
          baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
          skipLogisticsKind: draft.kind === LOGISTICS_KIND.belt
            ? LOGISTICS_KIND.pipe
            : LOGISTICS_KIND.belt,
        });
        const deviceRoute = resolveRouteToDevice({
          context: logisticsContext,
          draft,
          sourceEndpoint: draft.source,
          targetEntityId: targetEntity?.id ?? null,
          pointerGridPoint: options.pointerGridPoint,
          strategy: { type: "single-bend", preferredRouteOrder: options.routeMode.routeOrder },
          autoCreateSplittersAndConvergers:
            options.autoCreateSplittersAndConvergers ?? true,
        });

        if (deviceRoute !== null) {
          return rebuildLogisticsDraft({
            context: logisticsContext,
            kind: draft.kind,
            source: deviceRoute.source,
            target: deviceRoute.target,
            routeOrder: deviceRoute.routeOrder,
            points: deviceRoute.points,
            replacingEntityId: draft.replacingEntityId,
            allowEmptyTarget: options.allowEmptyTarget ?? true,
            autoCreateSplittersAndConvergers:
              options.autoCreateSplittersAndConvergers ?? true,
            status: "updated",
          });
        }
      }

      const source = resolveMoveSourceEndpoint({
        context: logisticsContext,
        draft,
        options,
      });
      if (source === null) {
        return createIgnoredLogisticsActionResult();
      }

      logisticsContext.state.internalTransientState.logisticsDeviceRouteCycleSignature = null;
      logisticsContext.state.internalTransientState.logisticsDeviceRouteCycleIndex = 0;

      if (options.routeMode.type === "freehand") {
        // 笔画到达目标设备：不再照着笔迹铺，而是贴着笔画走过的走廊自动绕开障碍接进它的输入口。
        const autoRoute = resolveFreehandAutoRoute({
          context: logisticsContext,
          draft,
          source,
          pointerGridPoint: options.pointerGridPoint,
          autoCreateSplittersAndConvergers: options.autoCreateSplittersAndConvergers ?? true,
        });
        if (autoRoute !== null) {
          return rebuildLogisticsDraft({
            context: logisticsContext,
            kind: draft.kind,
            source: autoRoute.source,
            target: autoRoute.target,
            routeOrder: draft.routeOrder,
            points: autoRoute.points,
            replacingEntityId: draft.replacingEntityId,
            allowEmptyTarget: options.allowEmptyTarget ?? true,
            autoCreateSplittersAndConvergers: options.autoCreateSplittersAndConvergers ?? true,
            status: "updated",
          });
        }

        const currentPoints = draft.cells.length === 0
          ? [resolveSourceStartGridPoint(source)]
          : draft.cells.map((cell) => cell.gridPoint);

        const tentativePoints = appendFreehandPathPoints({
          points: currentPoints,
          pointerGridPoint: options.pointerGridPoint,
        });

        const onPathPort = resolveInputEndpointOnPath({
          pathPoints: tentativePoints,
          kind: draft.kind,
          document: currentDocument,
          entityDefinitionMap: logisticsContext.entityDefinitionMap,
          registryQueries: logisticsContext.workspace.registry.queries,
          baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
        });

        const target: DevicePortEndpoint | null = onPathPort
          ?? cursorTarget;
        let points: GridPoint[] = tentativePoints;

        if (target !== null) {
          const outsideIndex = tentativePoints.findIndex(
            (p) => areGridPointsEqual(p, target.outsideGridPoint),
          );
          if (outsideIndex >= 0) {
            points = tentativePoints.slice(0, outsideIndex + 1);
          } else {
            points = appendFreehandPathPoints({
              points: currentPoints,
              pointerGridPoint: target.outsideGridPoint,
            });
          }
        }

        if (
          shouldKeepDraftWhenFirstStepMovesTowardFixedSourceInput({
            context: logisticsContext,
            draft,
            source,
            points,
          })
        ) {
          return createLogisticsActionResultFromDraft(draft);
        }

        return rebuildLogisticsDraft({
          context: logisticsContext,
          kind: draft.kind,
          source,
          target,
          routeOrder: draft.routeOrder,
          points,
          replacingEntityId: draft.replacingEntityId,
          allowEmptyTarget: options.allowEmptyTarget ?? true,
          autoCreateSplittersAndConvergers:
            options.autoCreateSplittersAndConvergers ?? true,
          status: "updated",
        });
      }

      const routeOrder = resolveEffectiveSingleBendRouteOrder({
        context: logisticsContext,
        kind: draft.kind,
        source,
        targetPoint: options.pointerGridPoint,
        replacingEntityId: draft.replacingEntityId,
        routeOrder: options.routeMode.routeOrder,
        allowTemporaryOrderFlip: options.routeMode.allowTemporaryOrderFlip,
      });

      let points = generateSingleBendPathPoints({
        start: resolveSourceStartGridPoint(source),
        target: options.pointerGridPoint,
        routeOrder,
      });

      const onPathPort = resolveInputEndpointOnPath({
        pathPoints: points,
        kind: draft.kind,
        document: currentDocument,
        entityDefinitionMap: logisticsContext.entityDefinitionMap,
        registryQueries: logisticsContext.workspace.registry.queries,
        baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
      });

      const target = onPathPort ?? cursorTarget;

      if (target !== null) {
        points = generateSingleBendPathPoints({
          start: resolveSourceStartGridPoint(source),
          target: target.outsideGridPoint,
          routeOrder,
        });
      }

      if (
        shouldKeepDraftWhenFirstStepMovesTowardFixedSourceInput({
          context: logisticsContext,
          draft,
          source,
          points,
        })
      ) {
        return createLogisticsActionResultFromDraft(draft);
      }

      return rebuildLogisticsDraft({
        context: logisticsContext,
        kind: draft.kind,
        source,
        target,
        routeOrder,
        points,
        replacingEntityId: draft.replacingEntityId,
        allowEmptyTarget: options.allowEmptyTarget ?? true,
        autoCreateSplittersAndConvergers:
          options.autoCreateSplittersAndConvergers ?? true,
        status: "updated",
      });
    }),

    applyLogisticDraft: action(() => {
      // TODO: 实现物流草稿应用逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 canApply 校验、起点替换和 preview 写入 document。
      const draft = logisticsContext.state.internalTransientState.logisticsDraft;
      if (draft === null || !draft.canApply) {
        return false;
      }

      const preview = logisticsContext.state.collections[EntityCollectionType.preview];
      if (preview.length === 0) {
        return false;
      }
      const invalidPlacement = new Set(
        logisticsContext.state.collections[EntityCollectionType.invalidPlacement],
      );
      if (preview.some((entityId) => invalidPlacement.has(entityId))) {
        return false;
      }

      const previewDrafts = resolvePreviewDrafts({
        previewDraftIds: preview,
        drafts: logisticsContext.state.drafts,
      });
      if (previewDrafts.length === 0) {
        return false;
      }

      const currentDocument = logisticsContext.document.getSnapshot();
      const nextEntities = { ...currentDocument.entities };
      let nextEntityOrder = [...currentDocument.entityOrder];

      const replacingEntityIds = new Set([
        ...logisticsContext.state.collections[EntityCollectionType.ghost],
        ...(draft.replacingEntityId === null ? [] : [draft.replacingEntityId]),
      ]);

      for (const replacingEntityId of replacingEntityIds) {
        delete nextEntities[replacingEntityId];
      }

      if (replacingEntityIds.size > 0) {
        nextEntityOrder = nextEntityOrder.filter((entityId) =>
          !replacingEntityIds.has(entityId),
        );
      }

      // 对历史累积的 entityOrder 重复条目做去重。
      nextEntityOrder = Array.from(new Set(nextEntityOrder));

      for (const previewDraft of previewDrafts) {
        nextEntities[previewDraft.id] = {
          id: previewDraft.id,
          definitionId: previewDraft.definitionId,
          position: { ...previewDraft.position },
          rotation: previewDraft.rotation,
          config: cloneEntityConfig(previewDraft.config),
          tags: [...previewDraft.tags],
        };
        // 防御 entityOrder 重复——若已存在则跳过。
        if (!nextEntityOrder.includes(previewDraft.id)) {
          nextEntityOrder.push(previewDraft.id);
        }
      }

      logisticsContext.documentWriter.commit({
        action: {
          type: "logistics.place",
          label: "铺设物流",
          entityIds: previewDrafts.map((draft) => draft.id),
          definitionIds: resolveUniqueStrings(
            previewDrafts.map((draft) => draft.definitionId),
          ),
          count: previewDrafts.length,
        },
        update: (documentSnapshot) => ({
          ...documentSnapshot,
          entities: nextEntities,
          entityOrder: nextEntityOrder,
        }),
      });

      clearLogisticsDraftState(logisticsContext);
      return true;
    }),

    cancelLogisticsDraft: action(() => {
      // TODO: 实现物流草稿取消逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 logistics draft / collection 的清理。
      clearLogisticsDraftState(logisticsContext);
    }),

    setLogisticsSuppression: action((family, value) => {
      if (family === LOGISTICS_KIND.belt) {
        logisticsContext.state.suppressBelts = value;
      } else {
        logisticsContext.state.suppressPipes = value;
      }
    }),
  };
}

function resolveUniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function resolveCreateSourceEndpoint(
  context: LogisticsActionContext,
  options: CreateLogisticsDraftStartOptions,
): LogisticsDraftEndpoint | null {
  const currentDocument = context.document.getSnapshot();

  switch (options.source.type) {
    case "device": {
      const entity = findEntityById({
        entityId: options.source.entityId,
        document: currentDocument,
        drafts: [],
        baseDefinitions: context.workspace.registry.baseDefinitions,
      });
      if (entity === null) {
        return null;
      }

      const definition = context.entityDefinitionMap.get(entity.definitionId);
      if (definition === undefined) {
        return null;
      }

      return resolveNearestDevicePortEndpoint({
        entity,
        definition,
        kind: options.kind,
        direction: "output",
        pointerGridPoint: options.source.pointerGridPoint,
      });
    }

    case "fixed-device-port": {
      const source = options.source;
      const entity = findEntityById({
        entityId: source.entityId,
        document: currentDocument,
        drafts: [],
        baseDefinitions: context.workspace.registry.baseDefinitions,
      });
      if (entity === null) {
        return null;
      }

      const definition = context.entityDefinitionMap.get(entity.definitionId);
      if (definition === undefined) {
        return null;
      }

      const endpoint = resolveDevicePortEndpoints({
        entity,
        definition,
        kind: options.kind,
        direction: "output",
        pointerGridPoint: source.outsideGridPoint,
      }).find((candidate) =>
        candidate.portGroupId === source.portGroupId
        && candidate.portId === source.portId
        && areGridPointsEqual(candidate.outsideGridPoint, source.outsideGridPoint)
      );

      return endpoint === undefined
        ? null
        : {
            ...endpoint,
            fixedSource: true,
          };
    }

    case "logistics-entity": {
      const entity = currentDocument.entities[options.source.entityId];
      if (
        entity === undefined
        || !isOrdinaryLogisticsDefinitionId(
          entity.definitionId,
          options.kind,
          context.workspace.registry.queries,
        )
      ) {
        return null;
      }

      return {
        type: "logistics-entity",
        entityId: entity.id,
        gridPoint: { ...options.source.gridPoint },
      };
    }

    case "empty-cell":
      if (options.allowEmptySource === false) {
        return null;
      }

      return {
        type: "empty-cell",
        gridPoint: { ...options.source.gridPoint },
      };
  }
}

function resolveReverseOutputRoute(
  context: LogisticsActionContext,
  draft: LogisticsDraftReadonlyState,
  options: MoveLogisticsDraftEndOptions,
): { source: DevicePortEndpoint; points: GridPoint[] } | null {
  if (draft.source?.type !== "empty-cell") return null;
  const document = context.document.getSnapshot();
  const gridPoint = options.pointerGridPoint;
  const entity = findTopEntityAtGridPoint({
    gridPoint,
    document,
    drafts: [],
    entityDefinitionMap: context.entityDefinitionMap,
    registryQueries: context.workspace.registry.queries,
    baseDefinitions: context.workspace.registry.baseDefinitions,
    skipLogisticsKind: draft.kind === LOGISTICS_KIND.belt ? LOGISTICS_KIND.pipe : LOGISTICS_KIND.belt,
  });
  if (entity === null || isOrdinaryLogisticsDefinitionId(entity.definitionId, draft.kind, context.workspace.registry.queries)) {
    return null;
  }
  const definition = context.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) return null;

  const points = options.routeMode.type === "freehand"
    ? appendFreehandPathPoints({ points: draft.cells.map((cell) => cell.gridPoint), pointerGridPoint: gridPoint })
    : generateSingleBendPathPoints({ start: draft.source.gridPoint, target: gridPoint, routeOrder: options.routeMode.routeOrder });
  const approach = points.at(-2);
  if (approach === undefined) return null;

  const port = resolveDevicePortEndpoints({
    entity,
    definition,
    kind: draft.kind,
    direction: "output",
    pointerGridPoint: gridPoint,
  }).find((endpoint) => areGridPointsEqual(endpoint.insideGridPoint, gridPoint)
    && areGridPointsEqual(endpoint.outsideGridPoint, approach));
  return port === undefined ? null : {
    source: { ...port, fixedSource: true },
    points: points.slice(0, -1).reverse(),
  };
}

function resolveMoveSourceEndpoint(options: {
  context: LogisticsActionContext;
  draft: LogisticsDraftReadonlyState;
  options: MoveLogisticsDraftEndOptions;
}): LogisticsDraftEndpoint | null {
  const source = options.draft.source;
  if (
    source?.type !== "device-port"
    || source.fixedSource === true
    || options.options.routeMode.type !== "single-bend"
  ) {
    return source;
  }

  const currentDocument = options.context.document.getSnapshot();
  const entity = findEntityById({
    entityId: source.entityId,
    document: currentDocument,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (entity === null) {
    return null;
  }

  const definition = options.context.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return null;
  }

  return resolveNearestDevicePortEndpoint({
    entity,
    definition,
    kind: options.draft.kind,
    direction: "output",
    pointerGridPoint: options.options.pointerGridPoint,
  });
}

function resolveFixedSourceReplacingEntityId(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  source: DevicePortEndpoint;
}): string | null {
  // 跳过对端物流族被压制的设备，穿透到下层同族物流段。
  const skipLogisticsKind: LogisticsKind = options.kind === LOGISTICS_KIND.belt
    ? LOGISTICS_KIND.pipe
    : LOGISTICS_KIND.belt;
  const entity = findTopEntityAtGridPoint({
    gridPoint: options.source.outsideGridPoint,
    document: options.context.document.getSnapshot(),
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    registryQueries: options.context.workspace.registry.queries,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
    skipLogisticsKind,
  });

  return entity !== null && isOrdinaryLogisticsDefinitionId(
    entity.definitionId,
    options.kind,
    options.context.workspace.registry.queries,
  )
    ? entity.id
    : null;
}

function resolveEffectiveSingleBendRouteOrder(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  source: LogisticsDraftEndpoint;
  targetPoint: GridPoint;
  replacingEntityId: string | null;
  routeOrder: LogisticsRouteOrder;
  allowTemporaryOrderFlip: boolean;
}): LogisticsRouteOrder {
  if (!options.allowTemporaryOrderFlip) {
    return options.routeOrder;
  }

  // 从已有物流续接时，检查首步是否与现有物流重叠。
  if (options.replacingEntityId !== null) {
    const start = resolveSourceStartGridPoint(options.source);
    const currentPoints = generateSingleBendPathPoints({
      start,
      target: options.targetPoint,
      routeOrder: options.routeOrder,
    });
    if (
      !doesFirstStepOverlapExistingLogistics({
        context: options.context,
        kind: options.kind,
        points: currentPoints,
        replacingEntityId: options.replacingEntityId,
      })
    ) {
      return options.routeOrder;
    }

    const flippedOrder = flipRouteOrder(options.routeOrder);
    const flippedPoints = generateSingleBendPathPoints({
      start,
      target: options.targetPoint,
      routeOrder: flippedOrder,
    });

    return doesFirstStepOverlapExistingLogistics({
      context: options.context,
      kind: options.kind,
      points: flippedPoints,
      replacingEntityId: options.replacingEntityId,
    })
      ? options.routeOrder
      : flippedOrder;
  }

  // 从设备端口全新起笔时，当前线序可能使路径穿入源设备内部，
  // 此时尝试翻转为另一线序。
  if (options.source.type === "device-port") {
    const start = resolveSourceStartGridPoint(options.source);
    const currentPoints = generateSingleBendPathPoints({
      start,
      target: options.targetPoint,
      routeOrder: options.routeOrder,
    });
    if (doesSingleBendPathCrossSourceDevice({
      context: options.context,
      source: options.source,
      points: currentPoints,
    })) {
      const flippedOrder = flipRouteOrder(options.routeOrder);
      const flippedPoints = generateSingleBendPathPoints({
        start,
        target: options.targetPoint,
        routeOrder: flippedOrder,
      });
      if (!doesSingleBendPathCrossSourceDevice({
        context: options.context,
        source: options.source,
        points: flippedPoints,
      })) {
        return flippedOrder;
      }
    }
  }

  return options.routeOrder;
}

/**
 * 检查单拐路径是否穿入源设备内部。
 * 路径起点是 outsideGridPoint（已在设备外），因此从 index=1 开始检查。
 */
function doesSingleBendPathCrossSourceDevice(options: {
  context: LogisticsActionContext;
  source: DevicePortEndpoint;
  points: readonly GridPoint[];
}): boolean {
  const currentDocument = options.context.document.getSnapshot();
  const entity = findEntityById({
    entityId: options.source.entityId,
    document: currentDocument,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (entity === null) {
    return false;
  }

  const definition = options.context.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return false;
  }

  const deviceRect = resolveEntityGridRect({ entity, definition });

  // 跳过起点（outsideGridPoint 已在设备外），从 index=1 开始检查。
  for (let index = 1; index < options.points.length; index += 1) {
    const point = options.points[index];
    if (point !== undefined && isGridPointInsideRect(point, deviceRect)) {
      return true;
    }
  }

  return false;
}

function rebuildLogisticsDraft(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  source: LogisticsDraftEndpoint;
  target: LogisticsDraftEndpoint | null;
  routeOrder: LogisticsRouteOrder;
  points: readonly GridPoint[];
  replacingEntityId: string | null;
  allowEmptyTarget: boolean;
  autoCreateSplittersAndConvergers: boolean;
  status: "created" | "updated";
}): LogisticsDraftActionResult {
  const currentDocument = options.context.document.getSnapshot();
  const preview = options.context.state.collections[EntityCollectionType.preview];
  const logisticsHead = options.context.state.collections[EntityCollectionType.logisticsHead];
  const ghost = options.context.state.collections[EntityCollectionType.ghost];
  const previousPreviewDrafts = resolvePreviewDrafts({
    previewDraftIds: preview,
    drafts: options.context.state.drafts,
  });
  const previousPreviewDraftIds = new Set(previousPreviewDrafts.map((entity) => entity.id));
  const replacingEntity = options.replacingEntityId === null
    ? null
    : findEntityById({
        entityId: options.replacingEntityId,
        document: currentDocument,
        drafts: [],
        baseDefinitions: options.context.workspace.registry.baseDefinitions,
      });
  const replacingDefinition = replacingEntity === null
    ? null
    : options.context.entityDefinitionMap.get(replacingEntity.definitionId) ?? null;
  const cells = resolveLogisticsPathCells({
    kind: options.kind,
    points: options.points,
    source: options.source,
    target: options.target,
    document: currentDocument,
    entityDefinitionMap: options.context.entityDefinitionMap,
    registryQueries: options.context.workspace.registry.queries,
    replacingEntity,
    replacingDefinition,
  });
  const autoDraftPlan = resolveAutoDraftPlan({
    context: options.context,
    kind: options.kind,
    source: options.source,
    target: options.target,
    cells,
    replacingEntityId: options.replacingEntityId,
    autoCreateSplittersAndConvergers: options.autoCreateSplittersAndConvergers,
  });

  let effectiveInvalidReason = resolveInvalidReason({
    context: options.context,
    kind: options.kind,
    cells,
    replacingEntityIds: autoDraftPlan.replacingEntityIds,
    target: options.target,
    allowEmptyTarget: options.allowEmptyTarget,
  }) ?? autoDraftPlan.invalidReason;


  let canApply = effectiveInvalidReason === null;
  const draftBuildResult = createDraftEntities({
    context: options.context,
    kind: options.kind,
    cells,
    cellOverridesByGridKey: autoDraftPlan.cellOverridesByGridKey,
    currentDocument,
    previousPreviewDrafts,
    previousPreviewDraftIds,
  });
  const draftIds = draftBuildResult.draftIds;

  const placementValidationByEntityId = resolvePlacementValidations({
    document: currentDocument,
    state: options.context.state,
    workspace: options.context.workspace,
    drafts: draftBuildResult.draftEntities,
    ignoredEntityIds: new Set([
      ...autoDraftPlan.replacingEntityIds,
      ...(options.replacingEntityId === null ? [] : [options.replacingEntityId]),
    ]),
  });
  if (draftBuildResult.draftEntities.some((entity) =>
    placementValidationByEntityId[entity.id]?.canPlace !== true
  )) {
    canApply = false;
    effectiveInvalidReason ??= "unknown";
  }

  options.context.state.drafts = [
    ...options.context.state.drafts.filter((entity) =>
      !previousPreviewDraftIds.has(entity.id),
    ),
    ...draftBuildResult.draftEntities,
  ];
  preview.replace([...draftIds]);
  const headCell = cells[cells.length - 1] ?? null;
  const headDraftEntityId = headCell === null
    ? null
    : draftBuildResult.draftIdByGridKey.get(gridPointKey(headCell.gridPoint)) ?? null;
  logisticsHead.replace(headDraftEntityId === null ? [] : [headDraftEntityId]);
  ghost.replace([...new Set([
    ...autoDraftPlan.replacingEntityIds,
    ...(options.replacingEntityId === null ? [] : [options.replacingEntityId]),
  ])]);

  options.context.state.internalTransientState.logisticsDraft = {
    kind: options.kind,
    source: options.source,
    target: options.target,
    routeOrder: options.routeOrder,
    cells,
    headDraftEntityId,
    replacingEntityId: options.replacingEntityId,
    canApply,
    invalidReason: effectiveInvalidReason,
  };
  syncPlacementValidationState({
    document: currentDocument,
    state: options.context.state,
    workspace: options.context.workspace,
  });

  return {
    status: options.status,
    canApply,
    invalidReason: effectiveInvalidReason,
    headGridPoint: headCell?.gridPoint ?? null,
    headDraftEntityId,
    sourceEntityId: options.source.type === "device-port" ? options.source.entityId : null,
    targetEntityId: options.target?.type === "device-port" ? options.target.entityId : null,
  };
}

function shouldKeepDraftWhenFirstStepMovesTowardFixedSourceInput(options: {
  context: LogisticsActionContext;
  draft: LogisticsDraftReadonlyState;
  source: LogisticsDraftEndpoint;
  points: readonly GridPoint[];
}): boolean {
  const currentDocument = options.context.document.getSnapshot();
  const replacingEntity = options.draft.replacingEntityId === null
    ? null
    : findEntityById({
        entityId: options.draft.replacingEntityId,
        document: currentDocument,
        drafts: [],
        baseDefinitions: options.context.workspace.registry.baseDefinitions,
      });
  const replacingDefinition = replacingEntity === null
    ? null
    : options.context.entityDefinitionMap.get(replacingEntity.definitionId) ?? null;

  return doesFirstStepMoveTowardFixedSourceInput({
    kind: options.draft.kind,
    points: options.points,
    source: options.source,
    document: currentDocument,
    entityDefinitionMap: options.context.entityDefinitionMap,
    registryQueries: options.context.workspace.registry.queries,
    replacingEntity,
    replacingDefinition,
  });
}

function createLogisticsActionResultFromDraft(
  draft: LogisticsDraftReadonlyState,
): LogisticsDraftActionResult {
  const headCell = draft.cells[draft.cells.length - 1] ?? null;

  return {
    status: "ignored",
    canApply: draft.canApply,
    invalidReason: draft.invalidReason,
    headGridPoint: headCell?.gridPoint ?? null,
    headDraftEntityId: draft.headDraftEntityId,
    sourceEntityId: draft.source?.type === "device-port" ? draft.source.entityId : null,
    targetEntityId: draft.target?.type === "device-port" ? draft.target.entityId : null,
  };
}

function createDraftEntities(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  cells: readonly LogisticsPathCell[];
  cellOverridesByGridKey: ReadonlyMap<string, AutoDraftCellOverride>;
  currentDocument: WorldDocument;
  previousPreviewDrafts: readonly DraftEntity[];
  previousPreviewDraftIds: ReadonlySet<string>;
  draftBatchCounter?: number;
}): DraftEntityBuildResult {
  const reservedIds = new Set<string>([
    ...Object.keys(options.currentDocument.entities),
    ...resolveBaseBuiltinEntities({
      baseDefinitions: options.context.workspace.registry.baseDefinitions,
      baseId: options.currentDocument.baseId,
    }).map((entity) => entity.id),
    ...options.context.state.drafts
      .filter((entity) => !options.previousPreviewDraftIds.has(entity.id))
      .map((entity) => entity.id),
  ]);
  const batchCounter = options.draftBatchCounter ?? options.context.nextDraftCounter();
  const draftEntities: DraftEntity[] = [];
  const draftIdByGridKey = new Map<string, string>();

  for (const cell of options.cells) {
    const key = gridPointKey(cell.gridPoint);
    if (draftIdByGridKey.has(key)) {
      continue;
    }

    const override = options.cellOverridesByGridKey.get(key) ?? null;
    const definitionId = override?.definitionId
      ?? options.context.workspace.registry.queries.resolveLogisticsDefinitionId(
        options.kind,
        cell.shape,
      );
    const reusableDraft = options.previousPreviewDrafts[draftEntities.length];
    const id = reusableDraft?.definitionId === definitionId
      ? reusableDraft.id
      : generateLogisticsDraftId({
          kind: options.kind,
          batchCounter,
          index: draftEntities.length,
          reservedIds,
        });

    reservedIds.add(id);
    draftIdByGridKey.set(key, id);

    draftEntities.push({
      id,
      originalEntityId: id,
      definitionId,
      position: { ...cell.gridPoint },
      rotation: override?.rotation ?? cell.rotation,
      config: {},
      tags: [],
    });
  }

  return {
    draftEntities,
    draftIds: draftEntities.map((entity) => entity.id),
    draftIdByGridKey,
  };
}

function resolveInvalidReason(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  cells: readonly LogisticsPathCell[];
  replacingEntityIds: readonly string[];
  target: LogisticsDraftEndpoint | null;
  allowEmptyTarget: boolean;
}): LogisticsDraftInvalidReason | null {
  if (options.cells.length === 0) {
    return "empty-path";
  }

  const seen = new Set<string>();
  for (const cell of options.cells) {
    const key = gridPointKey(cell.gridPoint);
    if (seen.has(key)) {
      return "overlap-own-preview";
    }
    seen.add(key);
  }

  if (
    options.target?.type === "device-port"
    && doesRouteCrossTargetDevice({
      context: options.context,
      target: options.target,
      cells: options.cells,
    })
  ) {
    return "target-route-crosses-target-device";
  }

  const currentDocument = options.context.document.getSnapshot();
  const replacingEntityIds = new Set(options.replacingEntityIds);
  for (const cell of options.cells) {
    for (const entityId of currentDocument.entityOrder) {
      const entity = currentDocument.entities[entityId];
      if (entity === undefined) {
        continue;
      }

      const registryQueries = options.context.workspace.registry.queries;
      const isSameKindLogistics = options.kind === LOGISTICS_KIND.belt
        ? registryQueries.isBeltFamily(entity.definitionId)
        : registryQueries.isPipeFamily(entity.definitionId);
      if (!isSameKindLogistics) {
        continue;
      }

      if (
        replacingEntityIds.has(entity.id)
        && areGridPointsEqual(entity.position, cell.gridPoint)
      ) {
        continue;
      }

      if (areGridPointsEqual(entity.position, cell.gridPoint)) {
        return "overlap-existing-logistics";
      }
    }
  }

  if (!options.allowEmptyTarget && options.target === null) {
    const lastCell = options.cells[options.cells.length - 1] ?? null;
    const targetEntity = lastCell === null
      ? null
      : findTopEntityAtGridPoint({
          gridPoint: lastCell.gridPoint,
          document: currentDocument,
          drafts: [],
          entityDefinitionMap: options.context.entityDefinitionMap,
          registryQueries: options.context.workspace.registry.queries,
          baseDefinitions: options.context.workspace.registry.baseDefinitions,
        });
    if (targetEntity === null) {
      return "empty-endpoint-disallowed";
    }
  }

  // 基地边界检测。
  // 传送带不可出 placeableArea，管道可出 placeableArea。
  // 任何物流类型都不可出 outerRing。
  const baseDefinition = resolveCurrentBaseDefinition({
    context: options.context,
  });
  if (baseDefinition !== null) {
    const baseAreas = resolveBaseAreas(baseDefinition);

    for (const cell of options.cells) {
      const p = cell.gridPoint;

      // 传送带：检查 placeableArea 边界
      if (
        options.kind === LOGISTICS_KIND.belt
        && !isGridPointInBaseAreas(baseAreas, p, "placeable")
      ) {
        return "outside-base";
      }

      // 任何类型：检查 outerRing 边界
      if (!isGridPointInBaseAreas(baseAreas, p, "outer")) {
        return "outside-base";
      }
    }
  }

  return null;
}

function resolveCurrentBaseDefinition(options: {
  context: LogisticsActionContext;
}): BaseDefinition | null {
  const baseId = options.context.document.getSnapshot().baseId;
  return options.context.workspace.registry.baseDefinitions.find(
    (def) => def.id === baseId,
  ) ?? null;
}

function doesRouteCrossTargetDevice(options: {
  context: LogisticsActionContext;
  target: DevicePortEndpoint;
  cells: readonly LogisticsPathCell[];
}): boolean {
  const currentDocument = options.context.document.getSnapshot();
  const targetEntity = findEntityById({
    entityId: options.target.entityId,
    document: currentDocument,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (targetEntity === null) {
    return false;
  }

  const targetDefinition = options.context.entityDefinitionMap.get(targetEntity.definitionId);
  if (targetDefinition === undefined) {
    return false;
  }

  const targetRect = resolveEntityGridRect({
    entity: targetEntity,
    definition: targetDefinition,
  });

  return options.cells.some((cell) => isGridPointInsideRect(cell.gridPoint, targetRect));
}

function doesFirstStepOverlapExistingLogistics(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  points: readonly GridPoint[];
  replacingEntityId: string;
}): boolean {
  const start = options.points[0];
  const firstStep = options.points[1];
  if (start === undefined || firstStep === undefined) {
    return false;
  }

  const currentDocument = options.context.document.getSnapshot();
  const overlappingEntity = currentDocument.entityOrder
    .map((entityId) => currentDocument.entities[entityId])
    .find((entity) => (
      entity !== undefined
      && entity.id !== options.replacingEntityId
      && isOrdinaryLogisticsDefinitionId(
        entity.definitionId,
        options.kind,
        options.context.workspace.registry.queries,
      )
      && areGridPointsEqual(entity.position, firstStep)
    )) ?? null;
  if (overlappingEntity === null) {
    return false;
  }

  // 首步与旧传送带同入口重叠属于合法沿线覆盖，不应为了避让而翻转单拐路径顺序。
  // 只有入口不兼容的首步重叠才需要尝试另一种 routeOrder。
  if (options.kind === LOGISTICS_KIND.belt) {
    const stepDirection = resolveDirectionEdge(start, firstStep);
    const overlapInfo = resolveOrdinaryLogisticsConnectionInfo({
      context: options.context,
      kind: options.kind,
      document: currentDocument,
      entityId: overlappingEntity.id,
    });
    if (
      stepDirection !== null
      && overlapInfo !== null
      && oppositeEdge(stepDirection) === overlapInfo.inputEdge
    ) {
      return false;
    }
  }

  return true;
}

function resolvePreviewDrafts(options: {
  previewDraftIds: readonly string[];
  drafts: readonly DraftEntity[];
}): DraftEntity[] {
  const draftMap = new Map(options.drafts.map((entity) => [entity.id, entity]));
  const previewDrafts: DraftEntity[] = [];

  for (const draftId of options.previewDraftIds) {
    const draft = draftMap.get(draftId);
    if (draft !== undefined) {
      previewDrafts.push(draft);
    }
  }

  return previewDrafts;
}

function clearLogisticsDraftState(context: LogisticsActionContext | EditorActionsContext): void {
  const preview = context.state.collections[EntityCollectionType.preview];
  const logisticsHead = context.state.collections[EntityCollectionType.logisticsHead];
  const ghost = context.state.collections[EntityCollectionType.ghost];
  const previewDraftIds = new Set(preview);

  context.state.drafts = context.state.drafts.filter((entity) => !previewDraftIds.has(entity.id));
  preview.replace([]);
  logisticsHead.replace([]);
  ghost.replace([]);
  context.state.internalTransientState.logisticsDraft = null;
  context.state.internalTransientState.logisticsDeviceRouteCycleSignature = null;
  context.state.internalTransientState.logisticsDeviceRouteCycleIndex = 0;
  syncPlacementValidationState({
    document: context.document.getSnapshot(),
    state: context.state,
    workspace: context.workspace,
  });
}

function createIgnoredLogisticsActionResult(): LogisticsDraftActionResult {
  return {
    status: "ignored",
    canApply: false,
    invalidReason: null,
    headGridPoint: null,
    headDraftEntityId: null,
    sourceEntityId: null,
    targetEntityId: null,
  };
}

function generateLogisticsDraftId(options: {
  kind: LogisticsKind;
  batchCounter: number;
  index: number;
  reservedIds: Set<string>;
}): string {
  const baseId = `logistics-draft:${options.kind}:${options.batchCounter}:${options.index}`;
  let candidate = baseId;
  let suffix = 1;

  while (options.reservedIds.has(candidate)) {
    candidate = `${baseId}:${suffix}`;
    suffix += 1;
  }

  options.reservedIds.add(candidate);
  return candidate;
}

function flipRouteOrder(routeOrder: LogisticsRouteOrder): LogisticsRouteOrder {
  return routeOrder === "vertical-first" ? "horizontal-first" : "vertical-first";
}

/**
 * 到目标设备的路线：single-bend 只试一次转弯的两种走法，都铺不下时改用自动寻路；
 * auto 直接自动寻路，贴着 corridor（笔画经过的格）绕开障碍。
 */
type DeviceRouteStrategy =
  | { readonly type: "single-bend"; readonly preferredRouteOrder: LogisticsRouteOrder }
  | { readonly type: "auto"; readonly corridor: ReadonlySet<string>; readonly routeOrder: LogisticsRouteOrder };

function resolveRouteToDevice(options: {
  context: LogisticsActionContext;
  draft: LogisticsDraftReadonlyState;
  sourceEndpoint: LogisticsDraftEndpoint;
  targetEntityId: string | null;
  pointerGridPoint: GridPoint;
  strategy: DeviceRouteStrategy;
  autoCreateSplittersAndConvergers: boolean;
}): DeviceRouteCandidate | null {
  if (options.targetEntityId === null) {
    return null;
  }
  const currentDocument = options.context.document.getSnapshot();
  const targetEntity = findEntityById({
    entityId: options.targetEntityId,
    document: currentDocument,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (targetEntity === null) {
    return null;
  }
  if (isOrdinaryLogisticsDefinitionId(
    targetEntity.definitionId,
    options.draft.kind,
    options.context.workspace.registry.queries,
  )) {
    return null;
  }

  const targetDefinition = options.context.entityDefinitionMap.get(targetEntity.definitionId);
  if (targetDefinition === undefined) {
    return null;
  }

  const sourceEntity = options.sourceEndpoint.type === "device-port"
    ? findEntityById({
        entityId: options.sourceEndpoint.entityId,
        document: currentDocument,
        drafts: [],
        baseDefinitions: options.context.workspace.registry.baseDefinitions,
      })
    : null;
  const sourceDefinition = sourceEntity === null
    ? null
    : options.context.entityDefinitionMap.get(sourceEntity.definitionId) ?? null;
  if (options.sourceEndpoint.type === "device-port" && sourceDefinition === null) {
    return null;
  }
  const availableSourceEndpoints = sourceEntity !== null && sourceDefinition !== null
    ? resolveDevicePortEndpoints({
        entity: sourceEntity,
        definition: sourceDefinition,
        kind: options.draft.kind,
        direction: "output",
        pointerGridPoint: targetEntity.position,
      })
    : [];
  const fixedSourceEndpoint = options.sourceEndpoint.type === "device-port"
    && options.sourceEndpoint.fixedSource === true
    ? options.sourceEndpoint
    : null;
  const sourceEndpoints: readonly LogisticsDraftEndpoint[] = options.sourceEndpoint.type !== "device-port"
    ? [options.sourceEndpoint]
    : fixedSourceEndpoint !== null
      ? availableSourceEndpoints.filter((endpoint) =>
        endpoint.portGroupId === fixedSourceEndpoint.portGroupId
        && endpoint.portId === fixedSourceEndpoint.portId
      ).map((endpoint) => ({ ...endpoint, fixedSource: true as const }))
      : availableSourceEndpoints;
  const targetEndpoints = resolveDevicePortEndpoints({
    entity: targetEntity,
    definition: targetDefinition,
    kind: options.draft.kind,
    direction: "input",
    pointerGridPoint: options.pointerGridPoint,
  });
  const strategy = options.strategy;
  const preferredRouteOrder = strategy.type === "single-bend" ? strategy.preferredRouteOrder : strategy.routeOrder;
  const autoRouteCells = strategy.type === "auto"
    ? createAutoRouteCellResolver({ context: options.context, kind: options.draft.kind, document: currentDocument,
        ignoredEntityIds: new Set(options.draft.replacingEntityId === null ? [] : [options.draft.replacingEntityId]) })
    : null;
  const candidates: DeviceRouteCandidate[] = [];
  let fallbackCandidate: DeviceRouteCandidate | null = null;

  for (const sourceEndpoint of sourceEndpoints) {
    for (const targetEndpoint of targetEndpoints) {
      const routes = autoRouteCells === null
        ? [preferredRouteOrder, flipRouteOrder(preferredRouteOrder)].map((routeOrder) => ({
            routeOrder,
            points: generateSingleBendPathPoints({
              start: resolveSourceStartGridPoint(sourceEndpoint),
              target: targetEndpoint.outsideGridPoint,
              routeOrder,
            }),
          }))
        : resolveAutoRoutePoints({
            source: sourceEndpoint,
            target: targetEndpoint,
            cellAt: autoRouteCells,
            corridor: strategy.type === "auto" ? strategy.corridor : new Set(),
          }).map((points) => ({ routeOrder: preferredRouteOrder, points }));
      for (const { routeOrder, points } of routes) {
        const cells = resolveLogisticsPathCells({
          kind: options.draft.kind,
          points,
          source: sourceEndpoint,
          target: targetEndpoint,
          document: currentDocument,
          entityDefinitionMap: options.context.entityDefinitionMap,
          registryQueries: options.context.workspace.registry.queries,
          replacingEntity: null,
          replacingDefinition: null,
        });
        const autoDraftPlan = resolveAutoDraftPlan({
          context: options.context,
          kind: options.draft.kind,
          source: sourceEndpoint,
          target: targetEndpoint,
          cells,
          replacingEntityId: options.draft.replacingEntityId,
          autoCreateSplittersAndConvergers: options.autoCreateSplittersAndConvergers,
        });
        const candidateInvalidReason = resolveInvalidReason({
          context: options.context,
          kind: options.draft.kind,
          cells,
          replacingEntityIds: autoDraftPlan.replacingEntityIds,
          target: targetEndpoint,
          allowEmptyTarget: true,
        }) ?? autoDraftPlan.invalidReason;
        const candidate: DeviceRouteCandidate = {
          source: sourceEndpoint,
          target: targetEndpoint,
          routeOrder,
          points,
          lengthScore: points.length,
          bendScore: countPathBends(points),
          targetDistanceScore: Math.abs(targetEndpoint.insideGridPoint.x - options.pointerGridPoint.x)
            + Math.abs(targetEndpoint.insideGridPoint.y - options.pointerGridPoint.y),
          routeOrderPriority: routeOrder === preferredRouteOrder ? 0 : 1,
          signature: [
            resolveEndpointSignature(sourceEndpoint),
            targetEndpoint.entityId,
            targetEndpoint.portGroupId,
            targetEndpoint.portId,
            routeOrder,
          ].join("|"),
        };
        if (fallbackCandidate === null || compareDeviceRouteCandidates(candidate, fallbackCandidate) < 0) {
          fallbackCandidate = candidate;
        }
        if (candidateInvalidReason !== null || !areCandidateLogisticsCellsPlaceable({
          context: options.context,
          kind: options.draft.kind,
          cells,
          cellOverridesByGridKey: autoDraftPlan.cellOverridesByGridKey,
          replacingEntityIds: [
            ...autoDraftPlan.replacingEntityIds,
            ...(options.draft.replacingEntityId === null ? [] : [options.draft.replacingEntityId]),
          ],
          document: currentDocument,
        })) {
          continue;
        }

        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) {
    // 一次转弯铺不下（被设备或线挡住）时，改为绕开障碍的自动路线。
    return strategy.type === "single-bend"
      ? resolveRouteToDevice({ ...options, strategy: { type: "auto", corridor: new Set(), routeOrder: preferredRouteOrder } })
        ?? fallbackCandidate
      : null;
  }

  candidates.sort(compareDeviceRouteCandidates);
  return candidates[0] ?? fallbackCandidate;
}

/** 笔画进入一台可接收本族物流的设备（不是起点设备）时，按笔迹走廊自动寻路接到它的输入口；铺不下时为 null。 */
function resolveFreehandAutoRoute(options: {
  context: LogisticsActionContext;
  draft: LogisticsDraftReadonlyState;
  source: LogisticsDraftEndpoint;
  pointerGridPoint: GridPoint;
  autoCreateSplittersAndConvergers: boolean;
}): DeviceRouteCandidate | null {
  const document = options.context.document.getSnapshot();
  const registryQueries = options.context.workspace.registry.queries;
  const targetEntity = findTopEntityAtGridPoint({
    gridPoint: options.pointerGridPoint,
    document,
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    registryQueries,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
    skipLogisticsKind: options.draft.kind === LOGISTICS_KIND.belt ? LOGISTICS_KIND.pipe : LOGISTICS_KIND.belt,
  });
  if (
    targetEntity === null
    || isAnyOrdinaryLogisticsDefinitionId(targetEntity.definitionId, registryQueries)
    || (options.source.type === "device-port" && options.source.entityId === targetEntity.id)
  ) {
    return null;
  }
  // 能否接上与笔迹无关（走廊只影响代价），同一文档里同一起点到同一设备找不到就不再每次移动都重找。
  const failureKey = `${resolveEndpointSignature(options.source)}>${targetEntity.id}`;
  const failures = autoRouteFailures.get(document) ?? new Set<string>();
  autoRouteFailures.set(document, failures);
  if (failures.has(failureKey)) {
    return null;
  }
  const corridor = new Set(options.draft.cells.map((cell) => gridPointKey(cell.gridPoint)));
  corridor.add(gridPointKey(options.pointerGridPoint));
  const route = resolveRouteToDevice({
    context: options.context,
    draft: options.draft,
    sourceEndpoint: options.source.type === "device-port" ? { ...options.source, fixedSource: true } : options.source,
    targetEntityId: targetEntity.id,
    pointerGridPoint: options.pointerGridPoint,
    strategy: { type: "auto", corridor, routeOrder: options.draft.routeOrder },
    autoCreateSplittersAndConvergers: options.autoCreateSplittersAndConvergers,
  });
  if (route === null) failures.add(failureKey);
  return route;
}

const autoRouteFailures = new WeakMap<WorldDocument, Set<string>>();

function resolveEndpointSignature(endpoint: LogisticsDraftEndpoint): string {
  if (endpoint.type === "device-port") {
    return [endpoint.entityId, endpoint.portGroupId, endpoint.portId].join(":");
  }
  const start = resolveSourceStartGridPoint(endpoint);
  return [endpoint.type, start.x, start.y].join(":");
}

/** 自动寻路：起点格接在源端口外侧（或续画的线端），终点格是目标端口外侧，走进端口。 */
function resolveAutoRoutePoints(options: {
  source: LogisticsDraftEndpoint;
  target: DevicePortEndpoint;
  cellAt: (point: GridPoint) => AutoRouteCell;
  corridor: ReadonlySet<string>;
}): GridPoint[][] {
  const start = resolveSourceStartGridPoint(options.source);
  const goal = options.target.outsideGridPoint;
  const margin = AUTO_ROUTE_SEARCH_MARGIN;
  const bounds = {
    x: Math.min(start.x, goal.x) - margin,
    y: Math.min(start.y, goal.y) - margin,
    width: Math.abs(start.x - goal.x) + margin * 2 + 1,
    height: Math.abs(start.y - goal.y) + margin * 2 + 1,
  };
  const points = findAutoRoute({
    start,
    startHeading: options.source.type === "device-port" ? options.source.edge : null,
    goal,
    goalExit: oppositeEdge(options.target.edge),
    cellAt: options.cellAt,
    bounds,
    corridor: options.corridor,
  });
  return points === null ? [] : [points];
}

/**
 * 自动寻路用的格子占用：设备与基地内建实体占的格不可走；同族直线段只能垂直穿过（铺设时自动生成桥接）；
 * 允许上下交叠的另一族物流可以走；传送带不能出可建造区，任何物流都不能出外环。
 */
function createAutoRouteCellResolver(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  document: WorldDocument;
  ignoredEntityIds: ReadonlySet<string>;
}): (point: GridPoint) => AutoRouteCell {
  const registryQueries = options.context.workspace.registry.queries;
  const ownDefinition = options.context.workspace.registry.entityDefinitions.find((definition) =>
    isOrdinaryLogisticsDefinitionId(definition.id, options.kind, registryQueries)) ?? null;
  const occupied = new Map<string, AutoRouteCell>();
  const entities = [
    ...options.document.entityOrder.map((entityId) => options.document.entities[entityId]),
    ...resolveBaseBuiltinEntities({
      baseDefinitions: options.context.workspace.registry.baseDefinitions,
      baseId: options.document.baseId,
    }),
  ];
  for (const entity of entities) {
    if (entity === undefined || options.ignoredEntityIds.has(entity.id)) continue;
    const definition = options.context.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) continue;
    const cell = resolveAutoRouteOccupancy({ entity, definition, kind: options.kind, ownDefinition, registryQueries });
    if (cell === null) continue;
    const rect = resolveEntityGridRect({ entity, definition });
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      for (let y = rect.y; y < rect.y + rect.height; y += 1) {
        const key = gridPointKey({ x, y });
        // 同一格有多个实体时以最严格的为准。
        if (occupied.get(key)?.type !== "blocked") occupied.set(key, cell);
      }
    }
  }
  const baseDefinition = options.context.workspace.registry.baseDefinitions.find((base) => base.id === options.document.baseId);
  const baseAreas = baseDefinition === undefined ? null : resolveBaseAreas(baseDefinition);
  return (point) => {
    if (baseAreas !== null && (
      !isGridPointInBaseAreas(baseAreas, point, "outer")
      || (options.kind === LOGISTICS_KIND.belt && !isGridPointInBaseAreas(baseAreas, point, "placeable"))
    )) {
      return AUTO_ROUTE_BLOCKED;
    }
    return occupied.get(gridPointKey(point)) ?? AUTO_ROUTE_FREE;
  };
}

function resolveAutoRouteOccupancy(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
  ownDefinition: EntityDefinition | null;
  registryQueries: LogisticsActionContext["workspace"]["registry"]["queries"];
}): AutoRouteCell | null {
  if (isOrdinaryLogisticsDefinitionId(options.definition.id, options.kind, options.registryQueries)) {
    const input = options.definition.portGroups.find((group) => group.direction === "input")?.ports[0];
    const output = options.definition.portGroups.find((group) => group.direction === "output")?.ports[0];
    if (input === undefined || output === undefined || oppositeEdge(input.edge) !== output.edge) {
      return AUTO_ROUTE_BLOCKED;
    }
    const lineEdge = rotateGridEdge(input.edge, options.entity.rotation);
    return { type: "crossing", travelAxis: lineEdge === "NORTH" || lineEdge === "SOUTH" ? "horizontal" : "vertical" };
  }
  if (options.ownDefinition !== null && canDefinitionsOverlap(options.ownDefinition, options.definition)) {
    return null;
  }
  return AUTO_ROUTE_BLOCKED;
}

function compareDeviceRouteCandidates(left: DeviceRouteCandidate, right: DeviceRouteCandidate): number {
  return left.targetDistanceScore - right.targetDistanceScore
    || left.routeOrderPriority - right.routeOrderPriority
    || left.lengthScore - right.lengthScore
    || left.bendScore - right.bendScore
    || left.signature.localeCompare(right.signature);
}

function areCandidateLogisticsCellsPlaceable(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  cells: readonly LogisticsPathCell[];
  cellOverridesByGridKey: ReadonlyMap<string, AutoDraftCellOverride>;
  replacingEntityIds: readonly string[];
  document: WorldDocument;
}): boolean {
  const draftEntities = createDraftEntities({
    context: options.context,
    kind: options.kind,
    cells: options.cells,
    cellOverridesByGridKey: options.cellOverridesByGridKey,
    currentDocument: options.document,
    previousPreviewDrafts: [],
    previousPreviewDraftIds: new Set(),
    draftBatchCounter: 0,
  }).draftEntities;
  const validationByEntityId = resolvePlacementValidations({
    document: options.document,
    state: options.context.state,
    workspace: options.context.workspace,
    drafts: draftEntities,
    ignoredEntityIds: new Set(options.replacingEntityIds),
  });
  return draftEntities.every((entity) => validationByEntityId[entity.id]?.canPlace === true);
}

function countPathBends(points: readonly GridPoint[]): number {
  let bends = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (previous === undefined || current === undefined || next === undefined) {
      continue;
    }

    const inEdge = resolveDirectionEdge(previous, current);
    const outEdge = resolveDirectionEdge(current, next);
    if (inEdge !== null && outEdge !== null && inEdge !== outEdge) {
      bends += 1;
    }
  }

  return bends;
}

function resolveAutoDraftPlan(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  source: LogisticsDraftEndpoint;
  target: LogisticsDraftEndpoint | null;
  cells: readonly LogisticsPathCell[];
  replacingEntityId: string | null;
  autoCreateSplittersAndConvergers: boolean;
}): AutoDraftPlan {
  const currentDocument = options.context.document.getSnapshot();
  const cellOverridesByGridKey = new Map<string, AutoDraftCellOverride>();
  const replacingEntityIds = new Set<string>(
    options.replacingEntityId === null ? [] : [options.replacingEntityId],
  );
  let invalidReason: LogisticsDraftInvalidReason | null = null;

  const firstCell = options.cells[0] ?? null;
  const secondCell = options.cells[1] ?? null;
  let handledFixedExistingSource = false;
  if (
    firstCell !== null
    && options.source.type === "device-port"
    && options.source.fixedSource === true
    && options.replacingEntityId !== null
  ) {
    const sourceInfo = resolveOrdinaryLogisticsConnectionInfo({
      context: options.context,
      kind: options.kind,
      document: currentDocument,
      entityId: options.replacingEntityId,
    });
    if (sourceInfo !== null) {
      handledFixedExistingSource = true;
      const sourceAxis = resolveEdgeAxis(options.source.edge);
      const existingAxis = resolveEdgeAxis(sourceInfo.inputEdge);

      // 设备出口与旧物流正交时，只有新路径在首格沿设备输出轴直穿才生成桥接器。
      // 若首格立即转弯，则新弯道直接替换旧物流格。
      if (sourceAxis !== existingAxis) {
        if (resolveStraightCellAxis(firstCell) === sourceAxis) {
          cellOverridesByGridKey.set(
            gridPointKey(firstCell.gridPoint),
            createAutoDeviceOverride(options.context, options.kind, "connector", null),
          );
        }
        replacingEntityIds.add(sourceInfo.entity.id);
      } else if (firstCell.fromEdge === sourceInfo.inputEdge) {
        // 旧物流本身就是设备输出：拉出新分支时按开关创建分流器，否则改写普通物流段。
        replacingEntityIds.add(sourceInfo.entity.id);
        if (
          options.autoCreateSplittersAndConvergers
          && firstCell.toEdge !== sourceInfo.outputEdge
        ) {
          cellOverridesByGridKey.set(
            gridPointKey(firstCell.gridPoint),
            createAutoDeviceOverride(
              options.context,
              options.kind,
              "splitter",
              sourceInfo.inputEdge,
            ),
          );
        }
      } else {
        invalidReason = "overlap-existing-logistics";
      }
    }
  }

  if (
    firstCell !== null
    && (secondCell !== null || options.target?.type === "device-port")
    && options.source.type === "logistics-entity"
  ) {
    const sourceInfo = resolveOrdinaryLogisticsConnectionInfo({
      context: options.context,
      kind: options.kind,
      document: currentDocument,
      entityId: options.source.entityId,
    });
    // 单格路径接入相邻设备时没有 secondCell，分支方向应由设备目标写入的 firstCell.toEdge 决定。
    const firstStepEdge = secondCell === null
      ? firstCell.toEdge
      : resolveDirectionEdge(firstCell.gridPoint, secondCell.gridPoint);
    if (sourceInfo !== null && sourceInfo.outputConnected) {
      // 沿已有物流段原出口方向继续绘制属于合法复用，不应判非法或创建分流器。
      // 只有从其他方向拉出新分支时才按自动创建开关生成分流器。
      if (firstStepEdge !== null && firstStepEdge !== sourceInfo.outputEdge && firstStepEdge !== sourceInfo.inputEdge) {
        if (options.autoCreateSplittersAndConvergers) {
          cellOverridesByGridKey.set(
            gridPointKey(firstCell.gridPoint),
            createAutoDeviceOverride(
              options.context,
              options.kind,
              "splitter",
              sourceInfo.inputEdge,
            ),
          );
          replacingEntityIds.add(sourceInfo.entity.id);
        }
      }
    }
  }

  const lastCell = options.cells[options.cells.length - 1] ?? null;
  if (lastCell !== null && (options.cells.length > 1 || options.source.type === "device-port")) {
    const targetEntity = findTopEntityAtGridPoint({
      gridPoint: lastCell.gridPoint,
      document: currentDocument,
      drafts: [],
      entityDefinitionMap: options.context.entityDefinitionMap,
      registryQueries: options.context.workspace.registry.queries,
      baseDefinitions: options.context.workspace.registry.baseDefinitions,
      // 终点同格存在另一类普通物流时必须跳过它，继续识别下层同类物流目标。
      skipLogisticsKind: options.kind === LOGISTICS_KIND.belt
        ? LOGISTICS_KIND.pipe
        : LOGISTICS_KIND.belt,
    });
    const targetInfo = targetEntity === null
      ? null
      : resolveOrdinaryLogisticsConnectionInfo({
          context: options.context,
          kind: options.kind,
          document: currentDocument,
          entityId: targetEntity.id,
        });

    if (
      targetInfo !== null
      && targetInfo.entity.id !== options.replacingEntityId
      && options.target === null
    ) {
      // 从已有物流段的出口方向反向拉入会形成头对头，不能创建汇流器或普通替换。
      if (
        options.kind === LOGISTICS_KIND.belt
        && lastCell.fromEdge === targetInfo.outputEdge
      ) {
        invalidReason = "overlap-existing-logistics";
      } else if (
        options.kind === LOGISTICS_KIND.belt
        && lastCell.fromEdge === targetInfo.inputEdge
      ) {
        // 沿已有物流段同入口覆盖时，保留新路径形态并替换旧格。
        if (
          options.autoCreateSplittersAndConvergers
          && lastCell.toEdge !== targetInfo.outputEdge
          && targetInfo.outputConnected
        ) {
          cellOverridesByGridKey.set(
            gridPointKey(lastCell.gridPoint),
            createAutoDeviceOverride(
              options.context,
              options.kind,
              "splitter",
              targetInfo.inputEdge,
            ),
          );
        }
        replacingEntityIds.add(targetInfo.entity.id);
      } else if (targetInfo.inputConnected) {
        if (
          options.kind === LOGISTICS_KIND.belt
          && !options.autoCreateSplittersAndConvergers
          && lastCell.fromEdge !== null
        ) {
          // 关闭自动分/汇流时，终点允许替换已有传送带的入口并保留其出口。
          // 头对头已在上方由 fromEdge === outputEdge 拦截。
          const { shape, rotation } = resolveCellFromEdges(lastCell.fromEdge, targetInfo.outputEdge);
          cellOverridesByGridKey.set(
            gridPointKey(lastCell.gridPoint),
            {
              definitionId: options.context.workspace.registry.queries
                .resolveLogisticsDefinitionId(options.kind, shape),
              rotation,
            },
          );
          replacingEntityIds.add(targetInfo.entity.id);
        } else if (!options.autoCreateSplittersAndConvergers) {
          invalidReason = "overlap-existing-logistics";
        } else {
          // 有合法上游 → 创建汇流器
          cellOverridesByGridKey.set(
            gridPointKey(lastCell.gridPoint),
            createAutoDeviceOverride(
              options.context,
              options.kind,
              "converger",
              targetInfo.outputEdge,
            ),
          );
          replacingEntityIds.add(targetInfo.entity.id);
        }
      } else {
        // 无合法上游 → 替换目标物流格为普通物流段（弯道/直道），
        // 使其入口方向与新拉入方向一致，出口方向保持原物流段出口方向。
        // 原行为：仅在 outputConnected 时创建汇流器，否则路径重叠变红。
        if (lastCell.fromEdge !== null) {
          const { shape, rotation } = resolveCellFromEdges(lastCell.fromEdge, targetInfo.outputEdge);
          cellOverridesByGridKey.set(
            gridPointKey(lastCell.gridPoint),
            {
              definitionId: options.context.workspace.registry.queries
                .resolveLogisticsDefinitionId(options.kind, shape),
              rotation,
            },
          );
          replacingEntityIds.add(targetInfo.entity.id);
        }
      }
    }
  }

  if (
    firstCell !== null
    && options.source.type === "device-port"
    && !handledFixedExistingSource
  ) {
    if (options.target?.type === "device-port" || options.cells.length > 1) {
      invalidReason = resolveConnectorCrossingAutoDraftCell({
        context: options.context,
        kind: options.kind,
        document: currentDocument,
        cell: firstCell,
        cellOverridesByGridKey,
        replacingEntityIds,
      }) ?? invalidReason;
    }
  }


  if (
    lastCell !== null
    && options.target?.type === "device-port"
    && (
      firstCell === null
      || gridPointKey(lastCell.gridPoint) !== gridPointKey(firstCell.gridPoint)
      // 同一格既是既有物流源又连接设备目标时，源分支判定已经处理该格，不得再按桥接器重复分类。
      || (
        options.source.type !== "device-port"
        && options.source.type !== "logistics-entity"
      )
    )
  ) {
    invalidReason = resolveConnectorCrossingAutoDraftCell({
      context: options.context,
      kind: options.kind,
      document: currentDocument,
      cell: lastCell,
      cellOverridesByGridKey,
      replacingEntityIds,
    }) ?? invalidReason;
  }

  for (let index = 1; index < options.cells.length - 1; index += 1) {
    const cell = options.cells[index];
    if (cell === undefined) {
      continue;
    }
    invalidReason = resolveExistingLogisticsOverlapAutoDraftCell({
      context: options.context,
      kind: options.kind,
      document: currentDocument,
      cell,
      autoCreateSplittersAndConvergers: options.autoCreateSplittersAndConvergers,
      cellOverridesByGridKey,
      replacingEntityIds,
    }) ?? invalidReason;
  }

  if (invalidReason !== null) {
    return {
      cellOverridesByGridKey: new Map(),
      replacingEntityIds: options.replacingEntityId === null ? [] : [options.replacingEntityId],
      invalidReason,
    };
  }

  return {
    cellOverridesByGridKey,
    replacingEntityIds: Array.from(replacingEntityIds),
    invalidReason,
  };
}

function resolveExistingLogisticsOverlapAutoDraftCell(options: {
  readonly context: LogisticsActionContext;
  readonly kind: LogisticsKind;
  readonly document: WorldDocument;
  readonly cell: LogisticsPathCell;
  readonly autoCreateSplittersAndConvergers: boolean;
  readonly cellOverridesByGridKey: Map<string, AutoDraftCellOverride>;
  readonly replacingEntityIds: Set<string>;
}): LogisticsDraftInvalidReason | null {
  if (options.kind !== LOGISTICS_KIND.belt) {
    return resolveConnectorCrossingAutoDraftCell(options);
  }

  const entity = findTopEntityAtGridPoint({
    gridPoint: options.cell.gridPoint,
    document: options.document,
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    registryQueries: options.context.workspace.registry.queries,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  const info = entity === null
    ? null
    : resolveOrdinaryLogisticsConnectionInfo({
        context: options.context,
        kind: options.kind,
        document: options.document,
        entityId: entity.id,
      });
  if (info === null) {
    return null;
  }

  const fromEdge = options.cell.fromEdge;
  const toEdge = options.cell.toEdge;
  if (fromEdge === null || toEdge === null) {
    return "overlap-existing-logistics";
  }

  // 新路径从旧路径出口进入，或朝旧路径入口退出，都会形成头对头。
  if (fromEdge === info.outputEdge || toEdge === info.inputEdge) {
    return "overlap-existing-logistics";
  }

  if (fromEdge === info.inputEdge) {
    options.replacingEntityIds.add(info.entity.id);
    if (
      options.autoCreateSplittersAndConvergers
      && toEdge !== info.outputEdge
      && info.outputConnected
    ) {
      options.cellOverridesByGridKey.set(
        gridPointKey(options.cell.gridPoint),
        createAutoDeviceOverride(
          options.context,
          options.kind,
          "splitter",
          info.inputEdge,
        ),
      );
    }
    return null;
  }

  if (toEdge === info.outputEdge) {
    // 汇流只允许作为终点。若从侧面接入后继续沿旧主干移动，
    // 该格已经不是终点，继续覆盖会形成自动设备链，整条路径应判定为非法。
    return "overlap-existing-logistics";
  }

  return resolveConnectorCrossingAutoDraftCell(options);
}

function resolveConnectorCrossingAutoDraftCell(options: {
  readonly context: LogisticsActionContext;
  readonly kind: LogisticsKind;
  readonly document: WorldDocument;
  readonly cell: LogisticsPathCell;
  readonly cellOverridesByGridKey: Map<string, AutoDraftCellOverride>;
  readonly replacingEntityIds: Set<string>;
}): LogisticsDraftInvalidReason | null {
  const entity = findTopEntityAtGridPoint({
    gridPoint: options.cell.gridPoint,
    document: options.document,
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    registryQueries: options.context.workspace.registry.queries,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  const info = entity === null
    ? null
    : resolveOrdinaryLogisticsConnectionInfo({
        context: options.context,
        kind: options.kind,
        document: options.document,
        entityId: entity.id,
      });
  if (info === null || (!info.inputConnected && !info.outputConnected)) {
    return null;
  }

  if (!isPerpendicularConnectorPass({ cell: options.cell, info })) {
    return "unknown";
  }

  options.cellOverridesByGridKey.set(
    gridPointKey(options.cell.gridPoint),
    createAutoDeviceOverride(options.context, options.kind, "connector", null),
  );
  options.replacingEntityIds.add(info.entity.id);
  return null;
}

function resolveStraightCellAxis(cell: LogisticsPathCell): LogisticsPathAxis | null {
  if (cell.fromEdge === null || cell.toEdge === null) {
    return null;
  }

  if (oppositeEdge(cell.fromEdge) !== cell.toEdge) {
    return null;
  }

  return resolveEdgeAxis(cell.fromEdge);
}

function resolveEdgeAxis(edge: GridEdge): LogisticsPathAxis {
  return edge === "EAST" || edge === "WEST" ? "horizontal" : "vertical";
}

function isPerpendicularConnectorPass(options: {
  readonly cell: LogisticsPathCell;
  readonly info: OrdinaryLogisticsConnectionInfo;
}): boolean {
  if (options.cell.fromEdge === null || options.cell.toEdge === null) {
    return false;
  }

  if (oppositeEdge(options.cell.fromEdge) !== options.cell.toEdge) {
    return false;
  }

  return options.cell.fromEdge !== options.info.inputEdge
    && options.cell.fromEdge !== options.info.outputEdge
    && options.cell.toEdge !== options.info.inputEdge
    && options.cell.toEdge !== options.info.outputEdge;
}

function resolveOrdinaryLogisticsConnectionInfo(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  document: WorldDocument;
  entityId: string;
}): OrdinaryLogisticsConnectionInfo | null {
  const entity = findEntityById({
    entityId: options.entityId,
    document: options.document,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (
    entity === null
    || !isOrdinaryLogisticsDefinitionId(
      entity.definitionId,
      options.kind,
      options.context.workspace.registry.queries,
    )
  ) {
    return null;
  }

  const definition = options.context.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return null;
  }

  const inputEndpoint = resolveDevicePortEndpoints({
    entity,
    definition,
    kind: options.kind,
    direction: "input",
    pointerGridPoint: entity.position,
  })[0];
  const outputEndpoint = resolveDevicePortEndpoints({
    entity,
    definition,
    kind: options.kind,
    direction: "output",
    pointerGridPoint: entity.position,
  })[0];
  if (inputEndpoint === undefined || outputEndpoint === undefined) {
    return null;
  }

  return {
    entity,
    definition,
    inputEdge: inputEndpoint.edge,
    outputEdge: outputEndpoint.edge,
    inputConnected: doesNeighborOutputConnectToPoint({
      context: options.context,
      kind: options.kind,
      document: options.document,
      neighborGridPoint: inputEndpoint.outsideGridPoint,
      targetGridPoint: entity.position,
      ignoredEntityId: entity.id,
    }),
    outputConnected: doesPointOutputConnectToNeighborInput({
      context: options.context,
      kind: options.kind,
      document: options.document,
      sourceGridPoint: entity.position,
      neighborGridPoint: outputEndpoint.outsideGridPoint,
      ignoredEntityId: entity.id,
    }),
  };
}

function doesNeighborOutputConnectToPoint(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  document: WorldDocument;
  neighborGridPoint: GridPoint;
  targetGridPoint: GridPoint;
  ignoredEntityId: string;
}): boolean {
  const neighbor = findTopEntityAtGridPoint({
    gridPoint: options.neighborGridPoint,
    document: options.document,
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    registryQueries: options.context.workspace.registry.queries,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (neighbor === null || neighbor.id === options.ignoredEntityId) {
    return false;
  }

  const definition = options.context.entityDefinitionMap.get(neighbor.definitionId);
  if (definition === undefined) {
    return false;
  }

  return resolveDevicePortEndpoints({
    entity: neighbor,
    definition,
    kind: options.kind,
    direction: "output",
    pointerGridPoint: options.targetGridPoint,
  }).some((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.targetGridPoint));
}

function doesPointOutputConnectToNeighborInput(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  document: WorldDocument;
  sourceGridPoint: GridPoint;
  neighborGridPoint: GridPoint;
  ignoredEntityId: string;
}): boolean {
  const neighbor = findTopEntityAtGridPoint({
    gridPoint: options.neighborGridPoint,
    document: options.document,
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    registryQueries: options.context.workspace.registry.queries,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (neighbor === null || neighbor.id === options.ignoredEntityId) {
    return false;
  }

  const definition = options.context.entityDefinitionMap.get(neighbor.definitionId);
  if (definition === undefined) {
    return false;
  }

  return resolveDevicePortEndpoints({
    entity: neighbor,
    definition,
    kind: options.kind,
    direction: "input",
    pointerGridPoint: options.sourceGridPoint,
  }).some((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.sourceGridPoint));
}

function createAutoDeviceOverride(
  context: LogisticsActionContext,
  kind: LogisticsKind,
  deviceKind: AutoDeviceKind,
  edge: GridEdge | null,
): AutoDraftCellOverride {
  return {
    definitionId: resolveAutoDeviceDefinitionId(context, kind, deviceKind),
    rotation: resolveAutoDeviceRotation(deviceKind, edge),
  };
}

function resolveAutoDeviceDefinitionId(
  context: LogisticsActionContext,
  kind: LogisticsKind,
  deviceKind: AutoDeviceKind,
): string {
  const queries = context.workspace.registry.queries;
  // 自动生成对象只能是物流设备；传送带物流设备不包括传送带节，
  // 管道物流设备不包括管道节。
  const definition = context.workspace.registry.entityDefinitions.find((candidate) =>
    queries.resolveLogisticsRole(candidate.id) === deviceKind
    && (
      kind === LOGISTICS_KIND.belt
        ? queries.isBeltLogistics(candidate.id)
        : queries.isPipeLogistics(candidate.id)
    )
  );
  if (definition === undefined) {
    throw new Error(`缺少 ${kind} ${deviceKind} 物流设备定义`);
  }
  return definition.id;
}

function resolveAutoDeviceRotation(deviceKind: AutoDeviceKind, edge: GridEdge | null): GridRotation {
  if (deviceKind === "connector" || edge === null) {
    return 0;
  }

  const baseEdge: GridEdge = deviceKind === "splitter" ? "NORTH" : "SOUTH";
  for (const rotation of [0, 90, 180, 270] as const) {
    if (rotateGridEdge(baseEdge, rotation) === edge) {
      return rotation;
    }
  }

  return 0;
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const edgeOrder: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];
  const currentIndex = edgeOrder.indexOf(edge);
  const steps = rotation / 90;
  return edgeOrder[(currentIndex + steps) % edgeOrder.length] ?? edge;
}
