import { observer } from "mobx-react-lite";
import { useCallback } from "react";

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

/**
 * 待放清单：配方树钉住的目标还需要的设备，按“已放 / 需要”计数；已放够的排到最后。
 * 已放的数量只算画布上设定了该配方的同型号设备。
 */
export function resolvePlacementTodoEntries(
  plan: ProductionPlanningResult,
  placedByRecipe: ReadonlyMap<string, number>,
  machineIdOfRecipe: (recipeId: string) => { readonly machineId: string; readonly outputItemId: string | null } | null,
): PlacementTodoEntry[] {
  const entries = plan.recipeTotals.flatMap((total): PlacementTodoEntry[] => {
    const recipe = total.recipeId === null ? null : machineIdOfRecipe(total.recipeId);
    if (total.recipeId === null || recipe === null || total.deviceCount <= 0) {
      return [];
    }
    return [{
      recipeId: total.recipeId,
      machineId: recipe.machineId,
      outputItemId: recipe.outputItemId,
      needed: Math.ceil(total.deviceCount - 1e-4),
      placed: placedByRecipe.get(total.recipeId) ?? 0,
    }];
  });
  return [
    ...entries.filter((entry) => entry.placed < entry.needed),
    ...entries.filter((entry) => entry.placed >= entry.needed),
  ];
}

function countPlacedByRecipe(document: WorldDocument): string {
  const counts: Record<string, number> = {};
  for (const entityId of document.entityOrder) {
    const channelRecipes = document.entities[entityId]?.config.channelRecipes;
    if (typeof channelRecipes !== "object" || channelRecipes === null) continue;
    for (const recipeId of Object.values(channelRecipes as Record<string, unknown>)) {
      if (typeof recipeId === "string") counts[recipeId] = (counts[recipeId] ?? 0) + 1;
    }
  }
  return JSON.stringify(counts);
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
  const plan = useCombinedRecipeTreePlan(index, recipeTreeOverlayState.pins.length > 0);
  const selectCounts = useCallback(countPlacedByRecipe, []);
  const counts = useEditorDocumentSnapshot(appHost.workspace.editor, selectCounts, Object.is);
  if (plan === null) {
    return null;
  }
  const registry = appHost.workspace.registry;
  const entries = resolvePlacementTodoEntries(plan, new Map(Object.entries(JSON.parse(counts ?? "{}") as Record<string, number>)), (recipeId) => {
    const recipe = index.recipeById.get(recipeId);
    return recipe === undefined ? null : { machineId: recipe.machineId, outputItemId: recipe.outputs[0]?.itemId ?? null };
  });
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
              label={`${outputName} · ${machineName} ${entry.placed}/${entry.needed}`}
              peekClassName={cm(styles, "placement-shelf-peek")}
            />
          );
        })}
      </div>
    </section>
  );
});
