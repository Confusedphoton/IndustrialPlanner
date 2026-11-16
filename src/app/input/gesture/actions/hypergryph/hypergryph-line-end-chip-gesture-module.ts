import { runInAction } from "mobx";

import type { CanvasInteractionController } from "@/app/canvas";
import { resolveLineEndOutputStub, resolveLineEndSnapPlacements } from "@/app/canvas/line-end-chip";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import type { GridEdge, GridPoint } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { outputPortItemIds } from "@/shared/device-item-labels";
import { resolveGridEdgeDelta, rotateGridEdge } from "@/shared/geometry/port";

import type { GestureMappingModule } from "../types";
import { holdDeviceForPlacement } from "./hypergryph-single-placement-gesture-module";

/** 向上游追溯物流线的最大格数，防止环线。 */
const MAX_TRACE_CELLS = 4096;

/**
 * 只观察不消费：线末端提示出现后，画布上的下一次点按、长按、从设备上开始的拖动、按 Esc 或切换工具都让它消失。
 * 在空白处拖动（平移视图或框选）、双指与滚轮缩放不算操作，提示随视图跟着末端。
 */
export function createHypergryphLineEndChipGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-line-end-chip",
    priority: 1100,
    handle(event, context) {
      if (context.canvas.state.runtime.lineEndChip === null) {
        return { status: "ignored" };
      }
      switch (event.type) {
        case "mouse dragstart":
        case "touch dragstart":
          if (event.pointerEntity !== null) closeLineEndChip(context.canvas);
          return { status: "ignored" };
        case "key down":
          if (event.key === "Escape") closeLineEndChip(context.canvas);
          return { status: "ignored" };
        case "mouse tap":
        case "touch tap":
        case "mouse-long-press-ready":
        case "tap-long-press-ready":
        case "multi finger tap":
        case "on-exit-active-tool":
          closeLineEndChip(context.canvas);
          return { status: "ignored" };
        default:
          return { status: "ignored" };
      }
    },
  };
}

export function closeLineEndChip(canvas: CanvasInteractionController): void {
  runInAction(() => {
    canvas.state.runtime.lineEndChip = null;
  });
}

export function expandLineEndChip(canvas: CanvasInteractionController): void {
  const chip = canvas.state.runtime.lineEndChip;
  if (chip === null) return;
  runInAction(() => {
    canvas.state.runtime.lineEndChip = { ...chip, expanded: true };
  });
}

/** 刚铺好的线末端仍开放且能追溯到线上物品时，在末端外侧给出「+ 设备」提示。 */
export function offerLineEndChip(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  kind: LogisticsKind,
  endCell: GridPoint,
): void {
  const end = resolveLineEndTarget(canvas, editor, kind, endCell);
  const itemIds = end === null ? [] : traceLineItemIds(canvas, editor, kind, endCell);
  runInAction(() => {
    canvas.state.runtime.lineEndChip = end === null || itemIds.length === 0
      ? null
      : { kind, endCell: { ...endCell }, targetCell: end.targetCell, flowEdge: end.flowEdge, itemIds, expanded: false };
  });
}

/**
 * 把选中的设备接到提示所在的线末端：按端口朝向找一个不冲突的摆法直接放下（一步撤销），
 * 连同它产物输出口外伸出的一格线，提示随即移到那里，可以一台接一台地把产线铺下去；
 * 末端周围放不下时提示原因，并把设备交到手上（朝向已对准），由用户自己找位置。
 */
export function placeConsumerAtLineEnd(
  canvas: CanvasInteractionController,
  device: { readonly deviceId: string; readonly config: Readonly<Record<string, unknown>> | null },
  source: "mouse" | "touch",
): void {
  const chip = canvas.state.runtime.lineEndChip;
  const editor = canvas.editor;
  closeLineEndChip(canvas);
  const definition = canvas.registry.queries.findEntityDefinition(device.deviceId);
  if (chip === null || editor === null || definition === null) {
    return;
  }
  const end = resolveLineEndTarget(canvas, editor, chip.kind, chip.endCell);
  const placements = end === null ? [] : resolveLineEndSnapPlacements({
    definition,
    kind: chip.kind,
    targetCell: end.targetCell,
    flowEdge: end.flowEdge,
    itemIds: chip.itemIds,
    resolveItemDomain: canvas.registry.queries.resolveItemDomain,
  });
  // 在传送带/管道工具里，鼠标悬停时可能还挂着下一条线的起笔预览；先收起，避免与设备放置混在一起。
  if (editor.queries.resolveLogisticsDraftState() !== null) {
    editor.actions.cancelLogisticsDraft();
  }
  const config = device.config === null ? undefined : structuredClone(device.config) as Record<string, unknown>;
  for (const placement of placements) {
    const stub = resolveLineEndOutputStub({ registry: canvas.registry, definition, placement, config, flowEdge: chip.flowEdge });
    // 先连同产物输出口外的一格线一起放；那一格放不下时只放设备。
    for (const withStub of stub === null ? [false] : [true, false]) {
      editor.actions.createPositionedPlacementDraft([
        { definitionId: definition.id, ...placement, config },
        ...(withStub && stub !== null ? [{ definitionId: stub.definitionId, position: stub.cell, rotation: stub.rotation }] : []),
      ]);
      const previewIds = editor.state.collections[EntityCollectionType.preview];
      if (
        previewIds.length > 0
        && previewIds.every((previewId) => editor.queries.getEntityPlacementValidation(previewId).canPlace)
        && editor.actions.applyPlacementDraft()
      ) {
        // 接着往下：提示移到新设备伸出的线端，列出消费它产物的设备。
        if (withStub && stub !== null) offerLineEndChip(canvas, editor, stub.kind, stub.cell);
        return;
      }
      editor.actions.cancelPlacementDraft();
    }
  }
  canvas.actions.showCanvasToast("lineEndChip.noRoom");
  const targetRect = canvas.view.queries.findClientRectForGridCell(chip.targetCell);
  holdDeviceForPlacement(canvas, { deviceId: definition.id, config: device.config, rotation: placements[0]?.rotation }, {
    source,
    position: targetRect === null ? null : { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 },
  });
}

/** 末格是指定族的物流线、输出方向外侧是空格时返回该空格与流出方向；否则（如线已被撤销或接上）为 null。 */
export function resolveLineEndTarget(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  kind: LogisticsKind,
  endCell: GridPoint,
): { readonly targetCell: GridPoint; readonly flowEdge: GridEdge } | null {
  const line = editor.queries.findTransportLineAtGridPoint(endCell, kind);
  const flowEdge = line === null ? null : resolveLineEdge(canvas.registry.queries, line, "output");
  if (line === null || flowEdge === null) {
    return null;
  }
  const delta = resolveGridEdgeDelta(flowEdge);
  const targetCell = { x: endCell.x + delta.x, y: endCell.y + delta.y };
  return isOpenBeyondLine(editor, line, kind, targetCell) ? { targetCell, flowEdge } : null;
}

/** 线端外侧格是否开放：没有同族物流线，除本线自身端口外也不属于其他设备端口。 */
export function isOpenBeyondLine(
  editor: EditorContract,
  line: WorldEntity,
  kind: LogisticsKind,
  neighbor: GridPoint,
): boolean {
  if (editor.queries.findTransportLineAtGridPoint(neighbor, kind) !== null) {
    return false;
  }
  const endpoint = editor.queries.findLogisticsDraftEndpointAtGridPoint(neighbor, kind);
  return endpoint?.type === "empty-cell" || (endpoint?.type === "device-port" && endpoint.entityId === line.id);
}

function resolveLineEdge(registry: RegistryQuery, line: WorldEntity, direction: "input" | "output"): GridEdge | null {
  const port = registry.findEntityDefinition(line.definitionId)?.portGroups.find((group) => group.direction === direction)?.ports[0];
  return port === undefined ? null : rotateGridEdge(port.edge, line.rotation);
}

/** 沿线逆流找到上游设备的输出端口，取该端口运送的物品；中途遇到分流器等物流设备时不再追溯。 */
function traceLineItemIds(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  kind: LogisticsKind,
  endCell: GridPoint,
): string[] {
  const registry = canvas.registry.queries;
  const visited = new Set<string>();
  let cell = endCell;
  for (let step = 0; step < MAX_TRACE_CELLS; step += 1) {
    const line = editor.queries.findTransportLineAtGridPoint(cell, kind);
    const inputEdge = line === null || visited.has(line.id) ? null : resolveLineEdge(registry, line, "input");
    if (line === null || inputEdge === null) {
      return [];
    }
    visited.add(line.id);
    const delta = resolveGridEdgeDelta(inputEdge);
    const upstream = { x: cell.x + delta.x, y: cell.y + delta.y };
    if (editor.queries.findTransportLineAtGridPoint(upstream, kind) !== null) {
      cell = upstream;
      continue;
    }
    const port = editor.queries.findDevicePortAtGridPoint(upstream);
    if (port === null || port.kind !== kind || port.endpoint.portDirection !== "output") {
      return [];
    }
    const device = editor.queries.getEntityById(port.endpoint.entityId);
    const definition = device === null ? null : canvas.registry.queries.findEntityDefinition(device.definitionId);
    return device === null || definition === null
      ? []
      : [...outputPortItemIds(definition, device, port.endpoint.portGroupId, canvas.registry)];
  }
  return [];
}
