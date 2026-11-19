import type { CanvasInteractionController } from "@/app/canvas";
import { layoutPlanInRect, orderPlanStages, type PlanMachine } from "@/app/canvas/plan-layout";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { countPlacedMachines, resolvePlacementTodoEntries } from "@/app/shell/panels/placement-todo-list";
import { resolveRecipePlacementTarget } from "@/app/shell/recipe-tree/recipe-quick-actions";
import { recipeTreeOverlayState } from "@/app/shell/recipe-tree/recipe-tree-state";
import { buildRecipeTreePlanningIndex, computeCombinedRecipeTreePlan } from "@/app/shell/recipe-tree/recipe-tree-plan";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { PositionedPlacementRequest } from "@/domain/editor/types/editor-session-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";

/** 一台要放的设备及其配方配置。 */
interface LassoMachine extends PlanMachine {
  readonly config: Readonly<Record<string, unknown>> | null;
}

export function resolvePinnedPlanPlacementEntries(appHost: AppHost, editor: EditorContract) {
  if (recipeTreeOverlayState.pins.length === 0) return null;
  const index = buildRecipeTreePlanningIndex(appHost);
  const plan = computeCombinedRecipeTreePlan(index);
  return plan === null ? null : resolvePlacementTodoEntries(plan, countPlacedMachines(editor.document.getSnapshot()), (recipeId) => {
    const recipe = index.recipeById.get(recipeId);
    return recipe === undefined ? null : { machineId: recipe.machineId, outputItemId: recipe.outputs[0]?.itemId ?? null };
  });
}

/**
 * 钉住的规划里还没放够的设备（按配方的放置目标，带上配方）；没有钉住目标时为 null。
 */
export function resolvePlanMachinesToPlace(appHost: AppHost): LassoMachine[] | null {
  const editor = appHost.workspace.editor;
  const entries = editor === null ? null : resolvePinnedPlanPlacementEntries(appHost, editor);
  if (entries === null) {
    return null;
  }
  const registry = appHost.workspace.registry.queries;
  return entries.flatMap((entry): LassoMachine[] => {
    const recipe = registry.findRecipeDefinition(entry.recipeId);
    const target = recipe === null ? null : resolveRecipePlacementTarget(appHost, recipe);
    const definition = target === null ? null : registry.findEntityDefinition(target.deviceId);
    if (recipe === null || target === null || definition === null || entry.placed >= entry.needed) {
      return [];
    }
    return [{
      recipeId: recipe.id,
      machineId: definition.id,
      count: entry.needed - entry.placed,
      width: definition.footprint.width,
      height: definition.footprint.height,
      inputItemIds: recipe.inputs.map((flow) => flow.itemId),
      outputItemIds: recipe.outputs.map((flow) => flow.itemId),
      config: target.config,
    }];
  });
}

/**
 * 把规划里还缺的设备摆进笔圈出的区域：按阶段分列居中排好，一次放下（一步撤销）。
 * 放不进去的设备略过并提示；都已放够、圈太小或圈里全被挡着时只给出提示。
 */
export function pourPlanIntoLasso(
  canvas: CanvasInteractionController,
  machines: readonly LassoMachine[],
  stroke: readonly GesturePosition[],
): void {
  const editor = canvas.editor;
  if (editor === null) {
    return;
  }
  if (machines.length === 0) {
    canvas.actions.showCanvasToast("planLasso.nothingLeft");
    return;
  }
  const cells = stroke.flatMap((point): GridPoint[] => {
    const cell = canvas.view.queries.findGridCellForClientPixelPoint(point);
    return cell === null ? [] : [cell];
  });
  if (cells.length === 0) {
    return;
  }
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  // 圈的边线本身不放设备，往里收一格。
  const rect = {
    x: Math.min(...xs) + 1,
    y: Math.min(...ys) + 1,
    width: Math.max(...xs) - Math.min(...xs) - 1,
    height: Math.max(...ys) - Math.min(...ys) - 1,
  };
  // 有的设备有自己的位置要求（例如只能贴着基地外缘），放不进圈里：去掉它们重排一次，它们留在待放清单里。
  const first = tryLayout(editor, machines, rect);
  if (first === null) {
    canvas.actions.showCanvasToast("planLasso.tooSmall");
    return;
  }
  const fitting = machines.filter((machine) => !first.blockedRecipeIds.has(machine.recipeId));
  const second = first.blockedRecipeIds.size === 0 || fitting.length === 0 ? first : tryLayout(editor, fitting, rect);
  if (second === null || second.blockedRecipeIds.size > 0 || fitting.length === 0) {
    canvas.actions.showCanvasToast("planLasso.blocked");
    return;
  }
  editor.actions.createPositionedPlacementDraft(second.requests);
  if (!editor.actions.applyPlacementDraft()) {
    editor.actions.cancelPlacementDraft();
    canvas.actions.showCanvasToast("planLasso.blocked");
    return;
  }
  if (fitting.length < machines.length) {
    canvas.actions.showCanvasToast("planLasso.someSkipped");
  }
}

/** 排好并试放一次：返回放置请求与放不下的配方；整块超出圈时为 null。 */
function tryLayout(editor: EditorContract, machines: readonly LassoMachine[], rect: GridRect): {
  readonly requests: PositionedPlacementRequest[];
  readonly blockedRecipeIds: ReadonlySet<string>;
} | null {
  const layout = layoutPlanInRect(orderPlanStages(machines), rect);
  if (!layout.fits) {
    return null;
  }
  const configOf = new Map(machines.map((machine) => [machine.recipeId, machine.config]));
  const requests = layout.placements.map((placement): PositionedPlacementRequest => {
    const config = configOf.get(placement.recipeId);
    return {
      definitionId: placement.machineId,
      position: placement.position,
      rotation: 0,
      config: config === null || config === undefined ? undefined : structuredClone(config) as Record<string, unknown>,
    };
  });
  editor.actions.createPositionedPlacementDraft(requests);
  const blockedRecipeIds = new Set(editor.state.collections[EntityCollectionType.preview].flatMap((previewId, index) =>
    editor.queries.getEntityPlacementValidation(previewId).canPlace ? [] : [layout.placements[index]!.recipeId]));
  editor.actions.cancelPlacementDraft();
  return { requests, blockedRecipeIds };
}
