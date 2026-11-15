import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { PositionedPlacementRequest } from "@/domain/editor/types/editor-session-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridEdge, GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { WAREHOUSE_BUS_SEGMENT_DEFINITION_ID, WAREHOUSE_BUS_SOURCE_DEFINITION_ID } from "@/shared/warehouse-bus";

import type { GestureMappingModule } from "../types";

/** 一次拖动最多铺出的基段数，避免拖出视野外时生成过长的预览。 */
const MAX_EXTENDED_SEGMENTS = 40;

type BusAxis = "horizontal" | "vertical";

interface BusExtendSession {
  readonly gestureId: string;
  readonly startCell: GridPoint;
  readonly origin: GridRect;
  /** 源桩可向四个方向延伸；基段只沿自身方向延伸。 */
  readonly axis: BusAxis | null;
  direction: GridEdge | null;
  /** 沿 direction 已有的最后一节（含起点自身）；新基段从它之后接续。 */
  chainEnd: GridRect | null;
  segmentCount: number;
}

/**
 * 从存取线源桩或基段拖出即沿直线铺设存取线基段，与从设备端口拖出传送带一致：
 * 选择工具下用鼠标/手写笔从源桩或基段起拖，沿拖动方向越过已有的基段，从线末端起每 8 格接一节，
 * 松开即提交（一步历史），取消则丢弃预览。源桩按拖动的主方向延伸，基段只沿自身走向延伸。
 */
export function createHypergryphBusExtendGestureModule(): GestureMappingModule<AppHost> {
  let session: BusExtendSession | null = null;

  return {
    id: "hypergryph-bus-extend-gesture",
    // 与端口拖出物流同级，在移动/框选之前判定。
    priority: 150,
    cancel() {
      session = null;
    },
    handle(event, context) {
      const canvas = context.canvas;
      const editor = canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse dragstart": {
          if (
            event.originButton !== 0
            || canvas.state.activeTool !== "select"
            || editor.state.collections.preview.length > 0
            || editor.queries.resolveLogisticsDraftState() !== null
          ) {
            return { status: "ignored" };
          }
          const next = resolveSession(canvas, editor, event.gestureId, event.startPosition);
          if (next === null) {
            return { status: "ignored" };
          }
          session = next;
          updatePreview(canvas, editor, session, event.position);
          return { status: "claimed" };
        }

        case "mouse dragmove":
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          updatePreview(canvas, editor, session, event.position);
          return { status: "handled" };

        case "mouse dragend": {
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          const committed = event.reason === "release" && session.segmentCount > 0;
          session = null;
          if (committed) {
            editor.actions.applyPlacementDraft();
          } else {
            editor.actions.cancelPlacementDraft();
          }
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

function resolveSession(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  gestureId: string,
  startPosition: GesturePosition,
): BusExtendSession | null {
  const startCell = canvas.view.queries.findGridCellForClientPixelPoint(startPosition);
  const segmentDefinition = canvas.registry.queries.findEntityDefinition(WAREHOUSE_BUS_SEGMENT_DEFINITION_ID);
  if (
    startCell === null
    || segmentDefinition === null
    || !canPlaceEntityDefinitionInCurrentBase(canvas, segmentDefinition)
  ) {
    return null;
  }

  const bus = listBusEntities(canvas, editor).find(({ rect }) => isCellInsideRect(startCell, rect));
  if (bus === undefined) {
    return null;
  }

  return {
    gestureId,
    startCell,
    origin: bus.rect,
    axis: bus.entity.definitionId === WAREHOUSE_BUS_SOURCE_DEFINITION_ID
      ? null
      : bus.rect.width > bus.rect.height ? "horizontal" : "vertical",
    direction: null,
    chainEnd: null,
    segmentCount: 0,
  };
}

function updatePreview(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  session: BusExtendSession,
  position: GesturePosition,
): void {
  const pointer = canvas.view.queries.findGridCellForClientPixelPoint(position);
  const segmentDefinition = canvas.registry.queries.findEntityDefinition(WAREHOUSE_BUS_SEGMENT_DEFINITION_ID);
  if (pointer === null || segmentDefinition === null) {
    return;
  }

  if (session.direction === null) {
    session.direction = resolveDragDirection(session, pointer);
    if (session.direction === null) {
      return;
    }
    session.chainEnd = walkExistingChain(canvas, editor, session.origin, session.direction, segmentDefinition);
  }

  const chainEnd = session.chainEnd!;
  const length = getRotatedGridFootprint(segmentDefinition.footprint, 0).height;
  const reach = resolveReachBeyond(chainEnd, session.direction, pointer);
  const count = Math.min(MAX_EXTENDED_SEGMENTS, reach <= 0 ? 0 : Math.ceil(reach / length));
  if (count === session.segmentCount) {
    return;
  }
  session.segmentCount = count;

  if (count === 0) {
    editor.actions.cancelPlacementDraft();
    return;
  }
  const requests: PositionedPlacementRequest[] = [];
  let previous = chainEnd;
  for (let index = 0; index < count; index += 1) {
    const slot = resolveNextSlot(previous, session.direction, segmentDefinition);
    requests.push({ definitionId: segmentDefinition.id, position: { x: slot.rect.x, y: slot.rect.y }, rotation: slot.rotation });
    previous = slot.rect;
  }
  editor.actions.createPositionedPlacementDraft(requests);
}

/** 指针离开起拖格后的延伸方向：源桩取主方向，基段只取自身走向上的方向。 */
function resolveDragDirection(session: BusExtendSession, pointer: GridPoint): GridEdge | null {
  const dx = pointer.x - session.startCell.x;
  const dy = pointer.y - session.startCell.y;
  const horizontal = session.axis === "horizontal" || (session.axis === null && Math.abs(dx) >= Math.abs(dy));
  if (horizontal) {
    return dx === 0 ? null : dx > 0 ? "EAST" : "WEST";
  }
  return dy === 0 ? null : dy > 0 ? "SOUTH" : "NORTH";
}

/** 紧接在 rect 之后、沿 direction 对齐的下一节基段位置。 */
function resolveNextSlot(
  rect: GridRect,
  direction: GridEdge,
  segmentDefinition: EntityDefinition,
): { readonly rect: GridRect; readonly rotation: GridRotation } {
  const rotation: GridRotation = direction === "EAST" || direction === "WEST" ? 90 : 0;
  const size = getRotatedGridFootprint(segmentDefinition.footprint, rotation);
  const x = direction === "EAST" ? rect.x + rect.width : direction === "WEST" ? rect.x - size.width : rect.x;
  const y = direction === "SOUTH" ? rect.y + rect.height : direction === "NORTH" ? rect.y - size.height : rect.y;
  return { rect: { x, y, ...size }, rotation };
}

function walkExistingChain(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  origin: GridRect,
  direction: GridEdge,
  segmentDefinition: EntityDefinition,
): GridRect {
  const segmentRects = listBusEntities(canvas, editor)
    .filter(({ entity }) => entity.definitionId === WAREHOUSE_BUS_SEGMENT_DEFINITION_ID)
    .map(({ rect }) => rect);
  let end = origin;
  for (;;) {
    const next = resolveNextSlot(end, direction, segmentDefinition).rect;
    if (!segmentRects.some((rect) => areRectsEqual(rect, next))) {
      return end;
    }
    end = next;
  }
}

/** 指针沿延伸方向越过 rect 远端的格数（含指针所在格）。 */
function resolveReachBeyond(rect: GridRect, direction: GridEdge, pointer: GridPoint): number {
  switch (direction) {
    case "EAST": return pointer.x - (rect.x + rect.width) + 1;
    case "WEST": return rect.x - pointer.x;
    case "SOUTH": return pointer.y - (rect.y + rect.height) + 1;
    case "NORTH": return rect.y - pointer.y;
  }
}

function listBusEntities(
  canvas: CanvasInteractionController,
  editor: EditorContract,
): Array<{ readonly entity: WorldEntity; readonly rect: GridRect }> {
  return editor.queries.listEntities().flatMap((entity) => {
    if (
      entity.definitionId !== WAREHOUSE_BUS_SOURCE_DEFINITION_ID
      && entity.definitionId !== WAREHOUSE_BUS_SEGMENT_DEFINITION_ID
    ) {
      return [];
    }
    const definition = canvas.registry.queries.findEntityDefinition(entity.definitionId);
    return definition === null ? [] : [{ entity, rect: resolveEntityGridRect({ entity, definition }) }];
  });
}

function isCellInsideRect(cell: GridPoint, rect: GridRect): boolean {
  return cell.x >= rect.x && cell.x < rect.x + rect.width && cell.y >= rect.y && cell.y < rect.y + rect.height;
}

function areRectsEqual(left: GridRect, right: GridRect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
