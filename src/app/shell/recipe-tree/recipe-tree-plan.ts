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
export function useRecipeTreePlanningIndex(appHost: AppHost): ProductionPlanningIndex {
  const registry = appHost.workspace.registry;
  const showAllActivityContent = appHost.internalState.settings.toolboxShowAllActivityContent;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  return useMemo(
    () => buildProductionPlanningIndex(registry, {
      includeInactiveActivityContent: showAllActivityContent,
      activeActivityIds: resolveEffectiveActivityIds({ selectedActivityIds }),
    }),
    [registry, selectedActivityIds, showAllActivityContent],
  );
}

/** 合并全部钉住目标求解一次；配方树流程图、节点菜单与待放清单共用，用不到时不求解。 */
export function useCombinedRecipeTreePlan(index: ProductionPlanningIndex, needed: boolean): ProductionPlanningResult | null {
  const state = recipeTreeOverlayState;
  const pinsSignature = needed
    ? JSON.stringify(state.pins.map((pin) => [pin.itemId, pin.perMinute, pin.recipeChoices]))
    : null;
  return useMemo<ProductionPlanningResult | null>(() => {
    if (pinsSignature === null) {
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
    // pinsSignature 覆盖 pins 的全部求解输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, pinsSignature]);
}

