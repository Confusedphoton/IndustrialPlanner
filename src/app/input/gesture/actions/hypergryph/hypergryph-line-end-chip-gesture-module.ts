import { runInAction } from "mobx";

import type { CanvasInteractionController } from "@/app/canvas";
import { resolveLineEndOutputStub, resolveLineEndSnapPlacements } from "@/app/canvas/line-end-chip";
import { configuredRecipeIds, resolveLineEdge, traceLine } from "@/app/canvas/line-trace";
import { resolveRecipePlacementTarget } from "@/app/shell/recipe-tree/recipe-quick-actions";
import { buildRecipeTreePlanningIndex, computeCombinedRecipeTreePlan } from "@/app/shell/recipe-tree/recipe-tree-plan";
import { isRecipeAvailableByActivity, resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { isRecipeVisibleInToolbox } from "@/shared/registry/recipe-visibility";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridEdge, GridPoint } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { outputPortItemIds } from "@/shared/device-item-labels";
import { resolveGridEdgeDelta } from "@/shared/geometry/port";

import type { GestureMappingModule } from "../types";
import { holdDeviceForPlacement } from "./hypergryph-single-placement-gesture-module";

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

/**
 * 一条线刚铺好之后：末端还空着时给出「+ 设备」提示；末端接进一台还没设配方的设备时，按线上物品替它选配方
 * （钉住的规划里只有一种用到该物品的配方时用它，否则只有这台设备只有一种这样的配方时才选），不必再开菜单。
 */
export function afterLineLaid(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  kind: LogisticsKind,
  endCell: GridPoint,
): void {
  offerLineEndChip(canvas, editor, kind, endCell);
  inferRecipeForFedMachine(canvas, editor, kind, endCell);
}

function inferRecipeForFedMachine(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  kind: LogisticsKind,
  endCell: GridPoint,
): void {
  const registry = canvas.registry.queries;
  const trace = traceLine(editor, registry, kind, endCell);
  const sink = trace?.sink ?? null;
  if (trace === null || sink === null || configuredRecipeIds(sink.entity).length > 0) {
    return;
  }
  const itemIds = traceLineItemIds(canvas, editor, kind, endCell);
  if (itemIds.length === 0) {
    return;
  }
  const appHost = canvas.workbench;
  const activityIds = resolveEffectiveActivityIds({ selectedActivityIds: appHost.internalState.settings.selectedActivityIds });
  const candidates = registry.findRecipeDefinitionsByMachine(sink.entity.definitionId).filter((recipe) => (
    isRecipeVisibleInToolbox(recipe)
    && (appHost.internalState.settings.toolboxShowAllActivityContent || isRecipeAvailableByActivity(recipe, activityIds))
    && recipe.inputs.some((input) => itemIds.includes(input.itemId))
  ));
  const plannedRecipeIds = new Set(
    computeCombinedRecipeTreePlan(buildRecipeTreePlanningIndex(appHost))?.recipeTotals.flatMap((total) => total.recipeId === null ? [] : [total.recipeId]) ?? [],
  );
  const planned = candidates.filter((recipe) => plannedRecipeIds.has(recipe.id));
  const choice = planned.length === 1 ? planned[0]! : candidates.length === 1 ? candidates[0]! : null;
  const config = choice === null ? null : resolveRecipePlacementTarget(appHost, choice)?.config ?? null;
  if (config !== null) {
    editor.actions.patchEntityConfig(sink.entity.id, config);
  }
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

/** 沿线逆流找到上游设备的输出端口，取该端口运送的物品；中途遇到分流器等物流设备时不再追溯。 */
function traceLineItemIds(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  kind: LogisticsKind,
  endCell: GridPoint,
): string[] {
  const source = traceLine(editor, canvas.registry.queries, kind, endCell)?.source ?? null;
  const definition = source === null ? null : canvas.registry.queries.findEntityDefinition(source.entity.definitionId);
  return source === null || definition === null
    ? []
    : [...outputPortItemIds(definition, source.entity, source.portGroupId, canvas.registry, source.portId)];
}
