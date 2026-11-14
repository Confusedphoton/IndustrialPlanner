import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridEdge, GridPoint, GridRect } from "@/domain/shared/grid";
import { resolveGridEdgeDelta, rotateGridEdge } from "@/shared/geometry/port";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import type { CreateLogisticsDraftStartOptions, LogisticsKind } from "@/domain/shared/logistics";

import type { GestureMappingModule } from "../types";

/**
 * forward：固定起点，终点跟随指针（设备输出端口、物流线开放的输出端）。
 * reverse：从指针格起笔、终点固定（设备输入端口、物流线开放的输入端），每次移动重建路线。
 */
type PortDragSession = {
  readonly gestureId: string;
  readonly kind: LogisticsKind;
  lastGridPoint: GridPoint | null;
} & (
  | {
      readonly mode: "forward";
      readonly source: CreateLogisticsDraftStartOptions["source"];
      readonly allowEmptySource: boolean;
      /** 续画物流线末端时禁止在起点自动生成分流器（末格应改为转角而非分支）。 */
      readonly continuesLine?: true;
    }
  | {
      readonly mode: "reverse";
      readonly targetGridPoint: GridPoint;
      /** 指针仍处于这些格内时不生成草稿（设备本体、端口外侧格或线端本身）。 */
      readonly avoidRect: GridRect | null;
      readonly avoidPoint: GridPoint;
    }
);

/**
 * 从设备端口拖出即铺设物流。
 *
 * 选择工具下，鼠标/手写笔从设备的端口格开始拖动时：
 * - 输出端口：从该端口起笔，终点跟随指针（与传送带工具从输出端口起笔一致）；
 * - 输入端口：从指针所在格起笔、终点接入该端口，指针移动时重建路线；
 * 物流类型（传送带/管道）由端口所属物流族决定；松开即提交，取消则丢弃草稿。
 * 从设备内部（非端口格）开始的拖动不受影响，仍由移动/框选模块处理。
 */
export function createHypergryphPortDragLogisticsGestureModule(): GestureMappingModule<AppHost> {
  let session: PortDragSession | null = null;

  const finish = (editor: EditorContract | null, commit: boolean) => {
    session = null;
    if (editor === null || editor.queries.resolveLogisticsDraftState() === null) {
      return;
    }
    if (commit && editor.queries.resolveLogisticsDraftState()?.canApply === true) {
      editor.actions.applyLogisticDraft();
      return;
    }
    editor.actions.cancelLogisticsDraft();
  };

  return {
    id: "hypergryph-port-drag-logistics-gesture",
    // 高于选择（100），在移动/框选之前判定是否从端口格起拖。
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
            || editor.queries.resolveLogisticsDraftState() !== null
          ) {
            return { status: "ignored" };
          }
          const startGridPoint = resolveGridPoint(canvas, event.startPosition);
          const pointerGridPoint = resolveGridPoint(canvas, event.position);
          if (startGridPoint === null) {
            return { status: "ignored" };
          }
          const next = resolvePortSession(canvas, editor, event.gestureId, startGridPoint)
            ?? resolveLineEndSession(canvas, editor, event.gestureId, startGridPoint, pointerGridPoint);
          if (next === null) {
            return { status: "ignored" };
          }

          session = next;
          updateDraft(canvas, editor, session, pointerGridPoint);
          return { status: "claimed" };
        }

        case "mouse dragmove":
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          updateDraft(canvas, editor, session, resolveGridPoint(canvas, event.position));
          return { status: "handled" };

        case "mouse dragend":
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          finish(editor, event.reason === "release");
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function resolveGridPoint(canvas: CanvasInteractionController, position: GesturePosition | null): GridPoint | null {
  return position === null ? null : canvas.view.queries.findGridCellForClientPixelPoint(position);
}

function isGridPointInsideRect(point: GridPoint, rect: GridRect): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function isSameGridPoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

/** 起拖格恰好是设备端口（输入或输出）内侧格时的会话；设备内部其余格不触发。 */
function resolvePortSession(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  gestureId: string,
  gridPoint: GridPoint,
): PortDragSession | null {
  const port = editor.queries.findDevicePortAtGridPoint(gridPoint);
  if (port === null) {
    return null;
  }
  const { kind, endpoint } = port;
  if (endpoint.portDirection === "output") {
    return {
      gestureId,
      kind,
      lastGridPoint: null,
      mode: "forward",
      allowEmptySource: canvas.workbench.state.settings.hypergryphAllowEmptyLogisticsEndpoints,
      source: {
        type: "fixed-device-port",
        entityId: endpoint.entityId,
        portGroupId: endpoint.portGroupId,
        portId: endpoint.portId,
        outsideGridPoint: { ...endpoint.outsideGridPoint },
      },
    };
  }
  const entity = editor.queries.getEntityById(endpoint.entityId);
  const definition = entity === null ? null : canvas.registry.queries.findEntityDefinition(entity.definitionId);
  return {
    gestureId,
    kind,
    lastGridPoint: null,
    mode: "reverse",
    targetGridPoint: endpoint.insideGridPoint,
    avoidRect: entity === null || definition === null ? null : resolveEntityGridRect({ entity, definition }),
    avoidPoint: endpoint.outsideGridPoint,
  };
}

/**
 * 起拖格是传送带/管道线的开放端时续画该线：开放的输出端向前延伸，开放的输入端从指针接回。
 * 传送带与管道在同一格垂直交叠时，按拖动方向选择走向一致的那条线。线中段不触发。
 */
function resolveLineEndSession(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  gestureId: string,
  gridPoint: GridPoint,
  pointerGridPoint: GridPoint | null,
): PortDragSession | null {
  const candidates = (["belt", "pipe"] as const).flatMap((kind) => {
    const entity = editor.queries.findTransportLineAtGridPoint(gridPoint, kind);
    const definition = entity === null ? null : canvas.registry.queries.findEntityDefinition(entity.definitionId);
    if (entity === null || definition === null) {
      return [];
    }
    const outputGroup = definition.portGroups.find((group) => group.direction === "output");
    const outputPort = outputGroup?.ports[0];
    const inputPort = definition.portGroups.find((group) => group.direction === "input")?.ports[0];
    if (outputGroup === undefined || outputPort === undefined || inputPort === undefined) {
      return [];
    }
    const outputEdge = rotateGridEdge(outputPort.edge, entity.rotation);
    const inputEdge = rotateGridEdge(inputPort.edge, entity.rotation);
    return [{ kind, entity, outputGroupId: outputGroup.id, outputPortId: outputPort.id, outputEdge, inputEdge }];
  });
  if (candidates.length === 0) {
    return null;
  }

  // 交叠时按拖动主轴选择：水平拖动选输出端朝东/西的线，竖直拖动选朝南/北的线。
  let candidate = candidates[0]!;
  if (candidates.length > 1 && pointerGridPoint !== null) {
    const horizontalDrag = Math.abs(pointerGridPoint.x - gridPoint.x) >= Math.abs(pointerGridPoint.y - gridPoint.y);
    candidate = candidates.find((entry) => (
      (entry.outputEdge === "EAST" || entry.outputEdge === "WEST") === horizontalDrag
    )) ?? candidate;
  }

  const neighborOf = (edge: GridEdge): GridPoint => {
    const delta = resolveGridEdgeDelta(edge);
    return { x: gridPoint.x + delta.x, y: gridPoint.y + delta.y };
  };
  // 开放端：相邻格没有同族物流线，且除本线自身端口外侧格外不属于其他设备端口。
  const isOpen = (edge: GridEdge) => {
    const neighbor = neighborOf(edge);
    if (editor.queries.findTransportLineAtGridPoint(neighbor, candidate.kind) !== null) {
      return false;
    }
    const endpoint = editor.queries.findLogisticsDraftEndpointAtGridPoint(neighbor, candidate.kind);
    return endpoint?.type === "empty-cell"
      || (endpoint?.type === "device-port" && endpoint.entityId === candidate.entity.id);
  };

  if (isOpen(candidate.outputEdge)) {
    // 从本线末格起笔（该格可随拖动方向改为转角），延续原有物流线。
    return {
      gestureId,
      kind: candidate.kind,
      lastGridPoint: null,
      mode: "forward",
      allowEmptySource: true,
      source: { type: "logistics-entity", entityId: candidate.entity.id, gridPoint: { ...gridPoint } },
      continuesLine: true,
    };
  }
  if (isOpen(candidate.inputEdge)) {
    return {
      gestureId,
      kind: candidate.kind,
      lastGridPoint: null,
      mode: "reverse",
      targetGridPoint: { ...gridPoint },
      avoidRect: null,
      avoidPoint: { ...gridPoint },
    };
  }
  return null;
}

function updateDraft(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  session: PortDragSession,
  pointer: GridPoint | null,
): void {
  if (pointer === null || (session.lastGridPoint !== null && isSameGridPoint(session.lastGridPoint, pointer))) {
    return;
  }
  session.lastGridPoint = pointer;
  const moveOptions = {
    allowEmptyTarget: true,
    autoCreateSplittersAndConvergers: canvas.workbench.state.settings.hypergryphAutoCreateSplittersAndConvergers,
  };

  if (session.mode === "forward") {
    if (editor.queries.resolveLogisticsDraftState() === null) {
      editor.actions.createLogisticsDraftStart({
        kind: session.kind,
        allowEmptySource: session.allowEmptySource,
        source: session.source,
      });
    }
    editor.actions.moveLogisticEnd({
      pointerGridPoint: pointer,
      ...moveOptions,
      autoCreateSplittersAndConvergers: session.continuesLine === true ? false : moveOptions.autoCreateSplittersAndConvergers,
      routeMode: { type: "freehand" },
    });
    return;
  }

  // reverse：从指针格到固定终点重建路线；指针仍在避让区域内时不生成草稿。
  if (editor.queries.resolveLogisticsDraftState() !== null) {
    editor.actions.cancelLogisticsDraft();
  }
  if (
    isSameGridPoint(pointer, session.avoidPoint)
    || (session.avoidRect !== null && isGridPointInsideRect(pointer, session.avoidRect))
  ) {
    return;
  }
  const pointerEndpoint = editor.queries.findLogisticsDraftEndpointAtGridPoint(pointer, session.kind);
  const source: CreateLogisticsDraftStartOptions["source"] = pointerEndpoint?.type === "logistics-entity"
    ? { type: "logistics-entity", entityId: pointerEndpoint.entityId, gridPoint: pointer }
    : { type: "empty-cell", gridPoint: pointer };
  editor.actions.createLogisticsDraftStart({ kind: session.kind, allowEmptySource: true, source });
  editor.actions.moveLogisticEnd({
    pointerGridPoint: session.targetGridPoint,
    ...moveOptions,
    routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
  });
}
