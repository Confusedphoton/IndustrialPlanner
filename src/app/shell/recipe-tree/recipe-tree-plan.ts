import { useMemo } from "react";

import type { AppHost } from "@/app/host/app-host";
import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  type ProductionPlanningIndex,
  type ProductionPlanningResult,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { recipeTreeOverlayState } from "./recipe-tree-state";

/** 与产线规划器默认来源策略一致，保证两处数值可互相对照。 */
export const RECIPE_TREE_SOURCE_CONFIG: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "fractional",
};
export const RECIPE_TREE_INFINITE_ITEM_IDS: ReadonlySet<string> = new Set(["item_liquid_sewage"]);

/** 配方树与待放清单共用的规划索引：按当前活动内容设置建立。 */
export function buildRecipeTreePlanningIndex(appHost: AppHost): ProductionPlanningIndex {
  return buildProductionPlanningIndex(appHost.workspace.registry, {
    includeInactiveActivityContent: appHost.internalState.settings.toolboxShowAllActivityContent,
    activeActivityIds: resolveEffectiveActivityIds({ selectedActivityIds: appHost.internalState.settings.selectedActivityIds }),
  });
}

export function useRecipeTreePlanningIndex(appHost: AppHost): ProductionPlanningIndex {
  const showAllActivityContent = appHost.internalState.settings.toolboxShowAllActivityContent;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  // 两项设置是索引的全部输入，变化时重建。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildRecipeTreePlanningIndex(appHost), [appHost, selectedActivityIds, showAllActivityContent]);
}

/** 合并全部钉住目标求解一次；没有钉住目标时为 null。 */
export function computeCombinedRecipeTreePlan(index: ProductionPlanningIndex): ProductionPlanningResult | null {
  const state = recipeTreeOverlayState;
  if (state.pins.length === 0) {
    return null;
  }
  const recipeChoices = new Map<string, string>();
  for (const pin of state.pins) {
    for (const [itemId, candidateId] of Object.entries(pin.recipeChoices)) {
      if (!recipeChoices.has(itemId)) {
        recipeChoices.set(itemId, candidateId);
      }
    }
  }
  return computeProductionPlan({
    targets: state.pins.map((pin) => ({ id: pin.id, itemId: pin.itemId, perMinute: pin.perMinute })),
    supplies: [],
    infiniteItemIds: RECIPE_TREE_INFINITE_ITEM_IDS,
    recipeChoices,
    sourceConfig: RECIPE_TREE_SOURCE_CONFIG,
    useModules: false,
  }, index);
}

/** 配方树流程图、节点菜单与待放清单共用的合并规划，用不到时不求解。 */
export function useCombinedRecipeTreePlan(index: ProductionPlanningIndex, needed: boolean): ProductionPlanningResult | null {
  const pinsSignature = needed
    ? JSON.stringify(recipeTreeOverlayState.pins.map((pin) => [pin.itemId, pin.perMinute, pin.recipeChoices]))
    : null;
  return useMemo<ProductionPlanningResult | null>(
    // pinsSignature 覆盖 pins 的全部求解输入。
    () => pinsSignature === null ? null : computeCombinedRecipeTreePlan(index),
    [index, pinsSignature],
  );
}
