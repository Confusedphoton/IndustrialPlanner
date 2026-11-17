import { observable, runInAction } from "mobx";
import { useMemo } from "react";

import type { AppHost } from "@/app/host/app-host";
import { readRecommendedModuleLibrary } from "@/app/shell/module-balancing/recommended-module-library";
import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  type ProductionPlanningIndex,
  type ProductionPlanningPort,
  type ProductionPlanningRequest,
  type ProductionPlanningResult,
} from "@/app/shell/production-planning/production-planning-model";
import type { ModuleBalancingRecommendedModule } from "@/app/toolbox-types";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { recipeTreeOverlayState } from "./recipe-tree-state";

const recommendedModules = observable.box<readonly ModuleBalancingRecommendedModule[] | null>(null, { deep: false });
let recommendedModulesRequested = false;

/** 推荐模块库按需读取一次；读取完成前（或失败时）只有自定义模块参与规划。 */
function readRecommendedModules(): readonly ModuleBalancingRecommendedModule[] {
  if (!recommendedModulesRequested) {
    recommendedModulesRequested = true;
    void readRecommendedModuleLibrary()
      .then((library) => runInAction(() => recommendedModules.set(library.modules)))
      .catch(() => runInAction(() => recommendedModules.set([])));
  }
  return recommendedModules.get() ?? [];
}

/** 规划可用的模块：开启“使用模块”时为自定义模块加上同 ID 未被覆盖的推荐模块。 */
function resolvePlanningModules(appHost: AppHost) {
  if (!recipeTreeOverlayState.useModules) {
    return [];
  }
  const customModules = appHost.internalState.workbench.toolbox.moduleBalancing.customModules;
  return [
    ...customModules,
    ...readRecommendedModules().filter((module) => !customModules.some((custom) => custom.id === module.id)),
  ];
}

/** 配方树、待放清单与画布提示共用的规划索引：按当前活动内容设置与可用模块建立。 */
export function buildRecipeTreePlanningIndex(appHost: AppHost): ProductionPlanningIndex {
  return buildProductionPlanningIndex(appHost.workspace.registry, {
    includeInactiveActivityContent: appHost.internalState.settings.toolboxShowAllActivityContent,
    activeActivityIds: resolveEffectiveActivityIds({ selectedActivityIds: appHost.internalState.settings.selectedActivityIds }),
    modules: resolvePlanningModules(appHost),
  });
}

export function useRecipeTreePlanningIndex(appHost: AppHost): ProductionPlanningIndex {
  const showAllActivityContent = appHost.internalState.settings.toolboxShowAllActivityContent;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  const modulesSignature = JSON.stringify(resolvePlanningModules(appHost).map((module) => [module.id, module.inputs, module.outputs]));
  // 活动内容设置与可用模块是索引的全部输入，变化时重建。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildRecipeTreePlanningIndex(appHost), [appHost, selectedActivityIds, showAllActivityContent, modulesSignature]);
}

/** 按配方树的规划设置（外部供给、来源策略、模块）组成一次求解请求。 */
export function createRecipeTreePlanRequest(
  targets: readonly ProductionPlanningPort[],
  recipeChoices: ReadonlyMap<string, string>,
  options: { readonly includeSupplies: boolean },
): ProductionPlanningRequest {
  const state = recipeTreeOverlayState;
  return {
    targets: [...targets],
    supplies: options.includeSupplies ? state.supplies.map((supply) => ({ ...supply })) : [],
    infiniteItemIds: new Set(state.sourceConfig.sewagePolicy === "external-supply" ? ["item_liquid_sewage"] : []),
    recipeChoices: new Map(recipeChoices),
    sourceConfig: state.sourceConfig,
    useModules: state.useModules,
  };
}

/** 规划设置的全部输入，用作缓存键。 */
export function recipeTreePlanSettingsSignature(): string {
  const state = recipeTreeOverlayState;
  return JSON.stringify([state.supplies, state.sourceConfig, state.useModules]);
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
  return computeProductionPlan(createRecipeTreePlanRequest(
    state.pins.map((pin) => ({ id: pin.id, itemId: pin.itemId, perMinute: pin.perMinute })),
    recipeChoices,
    { includeSupplies: true },
  ), index);
}

/** 配方树流程图、节点菜单与待放清单共用的合并规划，用不到时不求解。 */
export function useCombinedRecipeTreePlan(index: ProductionPlanningIndex, needed: boolean): ProductionPlanningResult | null {
  const pinsSignature = needed
    ? JSON.stringify([recipeTreeOverlayState.pins.map((pin) => [pin.itemId, pin.perMinute, pin.recipeChoices]), recipeTreePlanSettingsSignature()])
    : null;
  return useMemo<ProductionPlanningResult | null>(
    // pinsSignature 覆盖 pins 与规划设置的全部求解输入。
    () => pinsSignature === null ? null : computeCombinedRecipeTreePlan(index),
    [index, pinsSignature],
  );
}
