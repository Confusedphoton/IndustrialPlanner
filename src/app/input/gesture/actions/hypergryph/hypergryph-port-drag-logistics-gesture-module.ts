import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridEdge, GridPoint, GridRect } from "@/domain/shared/grid";
import { oppositeGridEdge, resolveGridEdgeDelta, resolveRotatedPortGeometry, rotateGridEdge } from "@/shared/geometry/port";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import type { CreateLogisticsDraftStartOptions, LogisticsDraftEndpoint, LogisticsKind } from "@/domain/shared/logistics";

import type { GestureMappingModule } from "../types";
import { isOpenBeyondLine, offerLineEndChip } from "./hypergryph-line-end-chip-gesture-module";

type DevicePortEndpoint = Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>;

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
 * 物流类型（传送带/管道）由端口所属物流族决定；松开即提交，取消则丢弃草稿。线头贴近画布边缘时平移地图。
 * 从设备内部（非端口格）开始的拖动不受影响，仍由移动/框选模块处理。
 * 手指没有这条路（拖设备是平移、长按是移动），改由选中设备后出现的端口把手发起，见 pressPortHandle。
 */
export function createHypergryphPortDragLogisticsGestureModule(
  ownerCanvas: CanvasInteractionController,
): GestureMappingModule<AppHost> {
  let session: PortDragSession | null = null;

  return {
    id: "hypergryph-port-drag-logistics-gesture",
    // 高于选择（100），在移动/框选之前判定是否从端口格起拖。
    priority: 150,
    cancel() {
      session = null;
      cancelPortHandlePress(ownerCanvas);
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
          const port = editor.queries.findDevicePortAtGridPoint(startGridPoint);
          const next = port !== null
            ? resolvePortSession(canvas, editor, event.gestureId, port.kind, port.endpoint)
            : resolveLineEndSession(canvas, editor, event.gestureId, startGridPoint, pointerGridPoint);
          if (next === null) {
            return { status: "ignored" };
          }

          session = next;
          drivePortLine(canvas, editor, session, event.position);
          return { status: "claimed" };
        }

        case "mouse dragmove":
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          drivePortLine(canvas, editor, session, event.position);
          return { status: "handled" };

        case "mouse dragend": {
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          const finished = session;
          session = null;
          finishPortLine(canvas, editor, finished, event.reason === "release");
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

/** 端口把手：设备的某个端口（选中设备时在端口外侧格显示），或物流线的开放端。 */
export type PortHandleSource =
  | { readonly type: "device-port"; readonly kind: LogisticsKind; readonly endpoint: DevicePortEndpoint }
  | { readonly type: "line-end"; readonly lineCell: GridPoint; readonly handleCell: GridPoint };

/** 按下把手后移动超过该距离才开始拉线，避免点按时抖出一格线。 */
const HANDLE_DRAG_START_PX = 8;

export interface PortHandlePress {
  readonly move: (position: GesturePosition) => void;
  readonly end: (commit: boolean) => void;
}

interface ActivePortHandlePress {
  readonly editor: EditorContract;
  readonly source: PortHandleSource;
  readonly start: GesturePosition;
  readonly onSettle: () => void;
  readonly onDrawing: () => void;
  session: PortDragSession | null;
}

/** 每块画布至多一个正在按住的把手；路由取消（含输入被挂起）时由该画布的端口拖动模块丢弃。 */
const activeHandlePresses = new WeakMap<CanvasInteractionController, ActivePortHandlePress>();

/**
 * 按下端口把手（手指、关闭精确输入的笔都走这里）：移动超过起拖距离后，与从端口格直接拖动同一套铺设、
 * 边缘平移与提交。按下的那一刻就登记到画布，起拖前被取消也同样失效；之后的 move/end 一律忽略，
 * 并通过 onSettle 通知把手复原。
 */
export function pressPortHandle(
  canvas: CanvasInteractionController,
  source: PortHandleSource,
  start: GesturePosition,
  callbacks: { readonly onDrawing: () => void; readonly onSettle: () => void },
): PortHandlePress | null {
  const editor = canvas.editor;
  if (editor === null || !canStartPortHandleDrag(canvas, editor)) {
    return null;
  }
  cancelPortHandlePress(canvas);
  const press: ActivePortHandlePress = { editor, source, start, session: null, ...callbacks };
  activeHandlePresses.set(canvas, press);
  const current = () => activeHandlePresses.get(canvas) === press;
  return {
    move: (position) => {
      if (!current()) return;
      // 挂起或换了工具（如另一只手点了管道工具）：这次按住作废。
      if (canvas.isInputSuspended || canvas.state.activeTool !== "select") {
        cancelPortHandlePress(canvas);
        return;
      }
      if (press.session === null) {
        if (Math.hypot(position.x - start.x, position.y - start.y) < HANDLE_DRAG_START_PX) return;
        press.session = canStartPortHandleDrag(canvas, editor) ? resolveHandleSession(canvas, editor, source) : null;
        if (press.session === null) {
          cancelPortHandlePress(canvas);
          return;
        }
        press.onDrawing();
      }
      drivePortLine(canvas, editor, press.session, position);
    },
    end: (commit) => {
      if (!current()) return;
      activeHandlePresses.delete(canvas);
      if (press.session !== null) {
        finishPortLine(canvas, editor, press.session, commit && !canvas.isInputSuspended && canvas.state.activeTool === "select");
      }
      press.onSettle();
    },
  };
}

function canStartPortHandleDrag(canvas: CanvasInteractionController, editor: EditorContract): boolean {
  return !canvas.isInputSuspended
    && canvas.state.activeTool === "select"
    && canvas.canUseWorkbenchActions
    && canvas.isOperationEnabled("logistics-placement")
    && editor.queries.resolveLogisticsDraftState() === null;
}

function resolveHandleSession(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  source: PortHandleSource,
): PortDragSession | null {
  const gestureId = "port-handle";
  return source.type === "device-port"
    ? resolvePortSession(canvas, editor, gestureId, source.kind, source.endpoint)
    : resolveLineEndSession(canvas, editor, gestureId, source.lineCell, source.handleCell);
}

function cancelPortHandlePress(canvas: CanvasInteractionController): void {
  const press = activeHandlePresses.get(canvas);
  if (press === undefined) return;
  activeHandlePresses.delete(canvas);
  if (press.session !== null) finishPortLine(canvas, press.editor, press.session, false);
  press.onSettle();
}

export interface PortDragHandle {
  readonly key: string;
  readonly source: PortHandleSource;
  /** 把手所在格：端口或线端外侧的空格。 */
  readonly cell: GridPoint;
  /** 物品在把手处流动的方向（输出向外、输入向内），用于画箭头。 */
  readonly flowEdge: GridEdge;
}

/**
 * 选中实体可以拖出线的把手：设备每个外侧仍空着的输入/输出端口；传送带/管道节则是它开放的一端
 * （与从线端直接拖动的取舍一致：输出端开放时只给输出端）。
 */
export function resolvePortDragHandles(canvas: CanvasInteractionController, entityId: string): PortDragHandle[] {
  const editor = canvas.editor;
  const entity = editor?.queries.getEntityById(entityId) ?? null;
  const registry = canvas.registry.queries;
  const definition = entity === null ? null : registry.findEntityDefinition(entity.definitionId);
  if (editor === null || entity === null || definition === null) {
    return [];
  }
  const offset = (cell: GridPoint, edge: GridEdge): GridPoint => {
    const delta = resolveGridEdgeDelta(edge);
    return { x: cell.x + delta.x, y: cell.y + delta.y };
  };

  const lineKind: LogisticsKind | null = registry.isBelt(definition.id) ? "belt" : registry.isPipe(definition.id) ? "pipe" : null;
  if (lineKind !== null) {
    const edgeOf = (direction: "input" | "output") => {
      const port = definition.portGroups.find((group) => group.direction === direction)?.ports[0];
      return port === undefined ? null : rotateGridEdge(port.edge, entity.rotation);
    };
    const outputEdge = edgeOf("output");
    const inputEdge = edgeOf("input");
    const cell = entity.position;
    for (const [edge, flowEdge] of [[outputEdge, outputEdge], [inputEdge, inputEdge === null ? null : oppositeGridEdge(inputEdge)]] as const) {
      if (edge === null || flowEdge === null || !isOpenBeyondLine(editor, entity, lineKind, offset(cell, edge))) continue;
      const handleCell = offset(cell, edge);
      return [{ key: `${entity.id}:${edge}`, source: { type: "line-end", lineCell: { ...cell }, handleCell }, cell: handleCell, flowEdge }];
    }
    return [];
  }

  return definition.portGroups.flatMap((group) => {
    if (group.direction === "bidirectional") return [];
    const kind: LogisticsKind = group.isPipe ? "pipe" : "belt";
    return group.ports.flatMap((port): PortDragHandle[] => {
      const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
      const inside = { x: entity.position.x + geometry.cell.x, y: entity.position.y + geometry.cell.y };
      const outside = offset(inside, geometry.edge);
      if (!isOpenBeyondLine(editor, entity, kind, outside)) return [];
      const endpoint: DevicePortEndpoint = {
        type: "device-port",
        entityId: entity.id,
        portGroupId: group.id,
        portId: port.id,
        portKind: group.kind,
        portDirection: group.direction === "output" ? "output" : "input",
        insideGridPoint: inside,
        outsideGridPoint: outside,
        edge: geometry.edge,
      };
      return [{
        key: `${entity.id}:${group.id}:${port.id}`,
        source: { type: "device-port", kind, endpoint },
        cell: outside,
        flowEdge: group.direction === "output" ? geometry.edge : oppositeGridEdge(geometry.edge),
      }];
    });
  });
}

/** 按指针位置更新草稿，并让线头贴近画布边缘时平移地图（平移后按新的格重画）。 */
function drivePortLine(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  session: PortDragSession,
  position: GesturePosition,
): void {
  updateDraft(canvas, editor, session, resolveGridPoint(canvas, position));
  canvas.edgePan.track(position, (next) => {
    updateDraft(canvas, editor, session, resolveGridPoint(canvas, next));
  }, "pointer");
}

function finishPortLine(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  session: PortDragSession,
  commit: boolean,
): void {
  canvas.edgePan.stop("pointer");
  const draft = editor.queries.resolveLogisticsDraftState();
  if (draft === null) {
    return;
  }
  if (commit && draft.canApply) {
    const endCell = draft.cells.at(-1)?.gridPoint ?? null;
    editor.actions.applyLogisticDraft();
    // 顺流铺出的线末端停在空地上时，提示可在末端接上消费该物品的设备。
    if (session.mode === "forward" && endCell !== null) {
      offerLineEndChip(canvas, editor, draft.kind, endCell);
    }
    return;
  }
  editor.actions.cancelLogisticsDraft();
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

/** 从设备端口（输入或输出，传送带或管道族）起拖的会话。 */
function resolvePortSession(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  gestureId: string,
  kind: LogisticsKind,
  endpoint: DevicePortEndpoint,
): PortDragSession | null {
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
  const isOpen = (edge: GridEdge) => isOpenBeyondLine(editor, candidate.entity, candidate.kind, neighborOf(edge));

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
