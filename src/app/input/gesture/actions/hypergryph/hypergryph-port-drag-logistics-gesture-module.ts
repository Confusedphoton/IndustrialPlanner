import { runInAction } from "mobx";

import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridEdge, GridPoint, GridRect } from "@/domain/shared/grid";
import { resolveGridEdgeDelta, resolveRotatedPortGeometry, rotateGridEdge } from "@/shared/geometry/port";
import { offsetLanePath } from "@/app/canvas/line-comb";
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
      /** 梳线时随划过的端口改为最后一个端口。 */
      source: CreateLogisticsDraftStartOptions["source"];
      readonly allowEmptySource: boolean;
      /** 续画物流线末端时禁止在起点自动生成分流器（末格应改为转角而非分支）。 */
      readonly continuesLine?: true;
      readonly comb?: PortComb;
    }
  | {
      readonly mode: "reverse";
      readonly targetGridPoint: GridPoint;
      /** 指针仍处于这些格内时不生成草稿（设备本体、端口外侧格或线端本身）。 */
      readonly avoidRect: GridRect | null;
      readonly avoidPoint: GridPoint;
    }
);

/** 设备同组、同一边上的一个空闲输出口。 */
interface CombPort {
  readonly portId: string;
  readonly inside: GridPoint;
  readonly outside: GridPoint;
}

/**
 * 梳线：起笔后先沿设备边划过相邻的空闲输出口（swept），离开那一排后固定（fixed），
 * 主线从最后划过的口铺出，其余划过的口各铺一条与主线平行的线。
 */
interface PortComb {
  readonly entityId: string;
  readonly portGroupId: string;
  /** 物品流出端口的方向。 */
  readonly outward: GridPoint;
  /** 沿边排好序的空闲输出口。 */
  readonly ports: readonly CombPort[];
  readonly swept: number[];
  fixed: boolean;
}

/**
 * 从设备端口拖出即铺设物流。
 *
 * 选择工具下，鼠标/手写笔从设备的端口格开始拖动时：
 * - 输出端口：从该端口起笔，终点跟随指针（与传送带工具从输出端口起笔一致）；
 * - 输入端口：从指针所在格起笔、终点接入该端口，指针移动时重建路线；
 * 物流类型（传送带/管道）由端口所属物流族决定；松开即提交，取消则丢弃草稿。线头贴近画布边缘时平移地图。
 * 从设备内部（非端口格）开始的拖动不受影响，仍由移动/框选模块处理。
 * 手指同样从端口格（或线的开放端）直接拖出；在设备其他格上拖动仍是平移，长按仍是移动。
 */
export function createHypergryphPortDragLogisticsGestureModule(): GestureMappingModule<AppHost> {
  let session: PortDragSession | null = null;

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
        case "mouse dragstart":
        case "touch dragstart": {
          // 手指（以及按触控处理的笔）同样从端口格直接拖出；长按仍是移动设备，多指是缩放平移。
          const fingerExcluded = event.type === "touch dragstart" && (event.longPress || event.activeTouchCount > 1);
          if (
            (event.type === "mouse dragstart" && event.originButton !== 0)
            || fingerExcluded
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
        case "touch dragmove":
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          drivePortLine(canvas, editor, session, event.position);
          return { status: "handled" };

        case "mouse dragend":
        case "touch dragend": {
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
  closePortCombLanes(canvas);
  const draft = editor.queries.resolveLogisticsDraftState();
  if (draft === null) {
    return;
  }
  if (commit && draft.canApply) {
    const mainCells = draft.cells.map((cell) => cell.gridPoint);
    const endCell = mainCells.at(-1) ?? null;
    editor.actions.applyLogisticDraft();
    if (session.mode === "forward" && session.comb !== undefined) {
      layCombLanes(canvas, editor, session.kind, session.comb, mainCells, draft.target);
    }
    // 顺流铺出的线末端停在空地上时，提示可在末端接上消费该物品的设备。
    if (session.mode === "forward" && endCell !== null) {
      offerLineEndChip(canvas, editor, draft.kind, endCell);
    }
    return;
  }
  editor.actions.cancelLogisticsDraft();
}

/** 同组同边、外侧格空着的输出口（含起笔的口），沿边排序；不足两个时不能梳线。 */
function resolvePortComb(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  kind: LogisticsKind,
  endpoint: DevicePortEndpoint,
): PortComb | null {
  const entity = editor.queries.getEntityById(endpoint.entityId);
  const definition = entity === null ? null : canvas.registry.queries.findEntityDefinition(entity.definitionId);
  const group = definition?.portGroups.find((entry) => entry.id === endpoint.portGroupId);
  if (entity === null || definition === null || group === undefined) {
    return null;
  }
  const ports = group.ports.flatMap((port): CombPort[] => {
    const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
    if (geometry.edge !== endpoint.edge) return [];
    const inside = { x: entity.position.x + geometry.cell.x, y: entity.position.y + geometry.cell.y };
    const outside = { x: inside.x + geometry.delta.x, y: inside.y + geometry.delta.y };
    // 端口外侧的空格会被识别为这台设备自己的端口，所以“没有线、只属于本设备”即算空闲。
    const beyond = editor.queries.findLogisticsDraftEndpointAtGridPoint(outside, kind);
    const free = port.id === endpoint.portId || (
      editor.queries.findTransportLineAtGridPoint(outside, kind) === null
      && (beyond?.type === "empty-cell" || (beyond?.type === "device-port" && beyond.entityId === entity.id))
    );
    return free ? [{ portId: port.id, inside, outside }] : [];
  }).sort((left, right) => left.inside.x - right.inside.x || left.inside.y - right.inside.y);
  const start = ports.findIndex((port) => port.portId === endpoint.portId);
  return ports.length < 2 || start < 0 ? null : {
    entityId: endpoint.entityId,
    portGroupId: endpoint.portGroupId,
    outward: resolveGridEdgeDelta(endpoint.edge),
    ports,
    swept: [start],
    fixed: false,
  };
}

/**
 * 指针仍在端口那一排时处理梳线：停在当前口上不画；沿同一方向移到相邻的空闲口则把它加入、主线改从它起笔。
 * 离开那一排即固定，之后照常铺线。返回 true 表示这次移动已由梳线处理。
 */
function sweepPortComb(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  session: Extract<PortDragSession, { mode: "forward" }>,
  pointer: GridPoint,
): boolean {
  const comb = session.comb!;
  const index = comb.ports.findIndex((port) => isSameGridPoint(port.inside, pointer) || isSameGridPoint(port.outside, pointer));
  const current = comb.swept.at(-1)!;
  if (index === current) {
    return true;
  }
  const step = index - current;
  const direction = comb.swept.length > 1 ? current - comb.swept.at(-2)! : step;
  if (index < 0 || Math.abs(step) !== 1 || step !== direction) {
    comb.fixed = true;
    return false;
  }
  comb.swept.push(index);
  if (editor.queries.resolveLogisticsDraftState() !== null) {
    editor.actions.cancelLogisticsDraft();
  }
  const port = comb.ports[index]!;
  session.source = {
    type: "fixed-device-port",
    entityId: comb.entityId,
    portGroupId: comb.portGroupId,
    portId: port.portId,
    outsideGridPoint: { ...port.outside },
  };
  return true;
}

/** 梳线的其余各条线（不含主线）的平行路径；走不通的为 null。 */
function resolveCombLanePaths(comb: PortComb, mainCells: readonly GridPoint[]): (GridPoint[] | null)[] {
  return comb.swept.slice(0, -1).reverse()
    .map((index) => offsetLanePath(mainCells, comb.ports[index]!.outside, comb.outward));
}

/** 铺线过程中把其余各条平行线画成预览。 */
function publishCombLanes(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  session: Extract<PortDragSession, { mode: "forward" }>,
): void {
  const comb = session.comb;
  const draft = editor.queries.resolveLogisticsDraftState();
  if (comb === undefined || comb.swept.length < 2 || draft === null) {
    return;
  }
  const lanes = resolveCombLanePaths(comb, draft.cells.map((cell) => cell.gridPoint));
  runInAction(() => {
    canvas.state.runtime.portComb = { kind: session.kind, lanes: lanes.filter((lane): lane is GridPoint[] => lane !== null) };
  });
}

function closePortCombLanes(canvas: CanvasInteractionController): void {
  if (canvas.state.runtime.portComb === null) return;
  runInAction(() => {
    canvas.state.runtime.portComb = null;
  });
}

/**
 * 主线落地后逐条铺其余平行线：照着平移后的路径画；主线接进了设备时，各线也试着自动接进同一台设备，
 * 接不上就停在平行的位置。铺不下的线略过并提示数量。
 */
function layCombLanes(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  kind: LogisticsKind,
  comb: PortComb,
  mainCells: readonly GridPoint[],
  mainTarget: LogisticsDraftEndpoint | null,
): void {
  if (comb.swept.length < 2) {
    return;
  }
  const autoCreateSplittersAndConvergers = canvas.workbench.state.settings.hypergryphAutoCreateSplittersAndConvergers;
  const draw = (port: CombPort, path: readonly GridPoint[], intoDevice: GridPoint | null): boolean => {
    editor.actions.createLogisticsDraftStart({
      kind,
      allowEmptySource: true,
      source: { type: "fixed-device-port", entityId: comb.entityId, portGroupId: comb.portGroupId, portId: port.portId, outsideGridPoint: { ...port.outside } },
    });
    for (const cell of [...path, ...(intoDevice === null ? [] : [intoDevice])]) {
      editor.actions.moveLogisticEnd({ pointerGridPoint: cell, allowEmptyTarget: true, autoCreateSplittersAndConvergers, routeMode: { type: "freehand" } });
    }
    if (editor.queries.resolveLogisticsDraftState()?.canApply === true && editor.actions.applyLogisticDraft()) {
      return true;
    }
    editor.actions.cancelLogisticsDraft();
    return false;
  };
  const intoDevice = mainTarget?.type === "device-port" ? mainTarget.insideGridPoint : null;
  const lanes = resolveCombLanePaths(comb, mainCells);
  const ports = comb.swept.slice(0, -1).reverse().map((index) => comb.ports[index]!);
  let skipped = 0;
  lanes.forEach((path, index) => {
    const port = ports[index]!;
    const laid = path !== null && ((intoDevice !== null && draw(port, path, intoDevice)) || draw(port, path, null));
    if (!laid) skipped += 1;
  });
  if (skipped > 0) {
    canvas.actions.showCanvasToast("lineComb.skipped");
  }
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
      comb: resolvePortComb(canvas, editor, kind, endpoint) ?? undefined,
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
    if (session.comb !== undefined && !session.comb.fixed && sweepPortComb(canvas, editor, session, pointer)) {
      return;
    }
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
    publishCombLanes(canvas, editor, session);
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
