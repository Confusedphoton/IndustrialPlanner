import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type { WorldDocument } from "@/domain/document/world-document";
import {
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  type ProductionPlanningResult,
} from "@/app/shell/production-planning/production-planning-model";
import { resolveRecipePlacementTarget } from "@/app/shell/recipe-tree/recipe-quick-actions";
import { useCombinedRecipeTreePlan, useRecipeTreePlanningIndex } from "@/app/shell/recipe-tree/recipe-tree-plan";
import { recipeTreeOverlayState } from "@/app/shell/recipe-tree/recipe-tree-state";
import { HoldableDeviceTile } from "@/app/shell/shared/holdable-device-tile";
import { useEditorDocumentSnapshot } from "../hooks";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export interface PlacementTodoEntry {
  readonly recipeId: string;
  readonly machineId: string;
  readonly outputItemId: string | null;
  readonly needed: number;
  readonly placed: number;
}

/** 画布上已放的生产设备：设定了配方的按配方计；没设配方的（游戏里按投入的原料自动生产）按型号计。 */
export interface PlacedMachineCounts {
  readonly byRecipe: Readonly<Record<string, number>>;
  readonly unsetByMachine: Readonly<Record<string, number>>;
}

/**
 * 待放清单：配方树钉住的目标还需要的设备，按“已放 / 需要”计数；已放够的排到最后。
 * 已放的数量先算设定了该配方的设备，再把同型号、没设配方的设备按规划顺序补到各条目上。
 */
export function resolvePlacementTodoEntries(
  plan: ProductionPlanningResult,
  placed: PlacedMachineCounts,
  machineIdOfRecipe: (recipeId: string) => { readonly machineId: string; readonly outputItemId: string | null } | null,
): PlacementTodoEntry[] {
  const unsetLeft = new Map(Object.entries(placed.unsetByMachine));
  const entries = plan.recipeTotals.flatMap((total): PlacementTodoEntry[] => {
    const recipe = total.recipeId === null ? null : machineIdOfRecipe(total.recipeId);
    if (total.recipeId === null || recipe === null || total.deviceCount <= 0) {
      return [];
    }
    const needed = Math.ceil(total.deviceCount - 1e-4);
    const configured = placed.byRecipe[total.recipeId] ?? 0;
    const unset = unsetLeft.get(recipe.machineId) ?? 0;
    const borrowed = Math.min(unset, Math.max(0, needed - configured));
    unsetLeft.set(recipe.machineId, unset - borrowed);
    return [{
      recipeId: total.recipeId,
      machineId: recipe.machineId,
      outputItemId: recipe.outputItemId,
      needed,
      placed: configured + borrowed,
    }];
  });
  return [
    ...entries.filter((entry) => entry.placed < entry.needed),
    ...entries.filter((entry) => entry.placed >= entry.needed),
  ];
}

/** 画布上已放的生产设备计数。 */
export function countPlacedMachines(document: Pick<WorldDocument, "entities" | "entityOrder">): PlacedMachineCounts {
  const byRecipe: Record<string, number> = {};
  const unsetByMachine: Record<string, number> = {};
  for (const entityId of document.entityOrder) {
    const entity = document.entities[entityId];
    if (entity === undefined) continue;
    const channelRecipes = entity.config.channelRecipes;
    const recipeIds = typeof channelRecipes === "object" && channelRecipes !== null
      ? Object.values(channelRecipes as Record<string, unknown>).filter((recipeId): recipeId is string => typeof recipeId === "string")
      : [];
    for (const recipeId of recipeIds) byRecipe[recipeId] = (byRecipe[recipeId] ?? 0) + 1;
    if (recipeIds.length === 0) unsetByMachine[entity.definitionId] = (unsetByMachine[entity.definitionId] ?? 0) + 1;
  }
  return { byRecipe, unsetByMachine };
}

/** 文档快照比较用：计数变了才重新渲染。 */
const selectPlacedMachineCounts = (document: WorldDocument) => JSON.stringify(countPlacedMachines(document));

/** 配方树钉住的规划对应的待放条目（随画布上的设备更新）；没有钉住目标时为空。 */
export function usePlacementTodoEntries(appHost: AppHost): PlacementTodoEntry[] {
  const index = useRecipeTreePlanningIndex(appHost);
  const plan = useCombinedRecipeTreePlan(index, recipeTreeOverlayState.pins.length > 0);
  const counts = useEditorDocumentSnapshot(appHost.workspace.editor, selectPlacedMachineCounts, Object.is);
  if (plan === null) {
    return [];
  }
  const placed = counts === null
    ? { byRecipe: {}, unsetByMachine: {} }
    : JSON.parse(counts) as PlacedMachineCounts;
  return resolvePlacementTodoEntries(plan, placed, (recipeId) => {
    const recipe = index.recipeById.get(recipeId);
    return recipe === undefined ? null : { machineId: recipe.machineId, outputItemId: recipe.outputs[0]?.itemId ?? null };
  });
}

/**
 * 放置面板顶部（或窄设备架上方）的待放清单：点按把设备连同配方交到手上，拖到画布上放下一台，
 * 每放一台计数随之更新。没有钉住目标时不显示。
 */
export const PlacementTodoList = observer(function PlacementTodoList({
  appHost,
  variant,
}: {
  appHost: AppHost;
  variant: "panel" | "shelf";
}) {
  const t = appHost.actions.translate;
  const index = useRecipeTreePlanningIndex(appHost);
  const entries = usePlacementTodoEntries(appHost);
  const registry = appHost.workspace.registry;
  if (entries.length === 0) {
    return null;
  }

  const canvas = appHost.mainCanvas;
  const runtime = canvas.state.runtime;
  const heldRecipeIds = canvas.state.activeTool === "single-placement"
    ? Object.values((runtime.singlePlacementConfig?.channelRecipes ?? {}) as Record<string, unknown>)
    : [];
  const title = t("placement.todo");

  return (
    <section aria-label={title} className={cm(styles, variant === "shelf" ? "placement-todo is-shelf" : "placement-todo")}>
      {variant === "panel" ? <h3 className={cm(styles, "placement-todo-title")}>{title}</h3> : null}
      <div className={cm(styles, "placement-todo-list")}>
        {entries.map((entry) => {
          const recipe = registry.queries.findRecipeDefinition(entry.recipeId);
          const target = recipe === null ? null : resolveRecipePlacementTarget(appHost, recipe);
          if (target === null) return null;
          const machineName = t(registry.queries.findEntityDefinition(entry.machineId)?.nameKey ?? entry.machineId);
          const outputName = entry.outputItemId === null ? machineName : resolveProductionPlanningItemName(entry.outputItemId, index, t);
          const done = entry.placed >= entry.needed;
          return (
            <HoldableDeviceTile
              appHost={appHost}
              badge={(
                <span className={cm(styles, done ? "placement-todo-badge is-done" : "placement-todo-badge")}>
                  {entry.outputItemId === null ? null : (
                    <img alt="" src={resolveProductionPlanningItemIconSrc(entry.outputItemId, index)} />
                  )}
                  {entry.placed}/{entry.needed}
                </span>
              )}
              className={cm(styles, done ? "placement-todo-tile is-done" : "placement-todo-tile")}
              device={{ deviceId: target.deviceId, config: target.config }}
              held={runtime.singlePlacementDeviceId === target.deviceId && heldRecipeIds.includes(entry.recipeId)}
              key={entry.recipeId}
              label={t("placement.todoEntry")
                .replace("{item}", outputName)
                .replace("{machine}", machineName)
                .replace("{placed}", String(entry.placed))
                .replace("{needed}", String(entry.needed))}
              peekClassName={cm(styles, "placement-shelf-peek")}
            />
          );
        })}
      </div>
    </section>
  );
});
