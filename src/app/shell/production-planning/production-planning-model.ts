import { isPlantCycleRecipe, resolveProductivePlantCycleRate as balanceProductivePlantCycle } from "@/shared/planner-plant-cycle";
import { findPlannerCycleIssues, type PlannerCycleIssue } from "@/shared/planner-cycle";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { isPlanningRawResourceItem } from "@/shared/registry/planning-resources";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { collectDefaultModuleIconItemIds } from "@/app/module-icon";
import {
  isItemAvailableByActivity,
  isRecipeAvailableByActivity,
} from "@/shared/registry/activity-availability";
import {
  compareRecipesByDefaultPriority,
  isRecipeVisibleInToolbox,
  sortRecipesByDefaultPriority,
} from "@/shared/registry/recipe-visibility";
import {
  buildDeviceRunningConsumptionRecipesByMachine,
  resolveCompanionDeviceRunningConsumptionRecipe,
} from "@/shared/device-running-consumption";
import {
  WATER_PURIFIER_BYPRODUCT_RECIPE_ID,
  WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT,
  WATER_PURIFIER_COLLECT_RECIPE_ID,
  WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE,
  WATER_PURIFIER_OUTPUT_ITEM_ID,
} from "@/shared/water-purifier-node";
import {
  createProductionPlanningModuleCandidateId,
  createProductionPlanningModuleSnapshot,
  createProductionPlanningRecipeCandidateId,
  normalizeProductionPlanningCandidateChoiceId,
  type ProductionPlanningCandidate,
  type ProductionPlanningCandidateSourceType,
  type ProductionPlanningModuleDefinition,
  type ProductionPlanningModuleSnapshot,
} from "./production-planning-candidate";

// panel no longer uses it. New logic uses ProductionPlanningSourceConfig.
export const PRODUCTION_PLANNING_SPECIAL_INFINITE_ITEM_IDS = [
  "item_liquid_sewage",
  "item_liquid_acid",
] as const;

export const PRODUCTION_PLANNING_BYPRODUCT_ITEM_IDS = new Set([
  "item_liquid_water",
  "item_liquid_acid",
]);

// 水驱矿机的清水是设备运行条件，不参与产线规划的物料供需；原始配方仍保留该输入，供 registry、模块配平与工序图使用。
const PRODUCTION_PLANNING_IGNORED_RECIPE_INPUT_ITEM_IDS = new Map<string, ReadonlySet<string>>([
  ["r_miner_copper_ore_basic", new Set(["item_liquid_water"])],
]);

export type ProductionPlanningByproductPolicy = "use-byproduct" | "dump-byproduct";
export type ProductionPlanningSewagePolicy = "external-supply" | "self-produce";
export type ProductionPlanningWaterPurifierPolicy = "disabled" | "use-when-available";
export type ProductionPlanningDeviceMinimumConsumptionMode = "none" | "fractional" | "ceil";

export interface ProductionPlanningSourceConfig {
  waterPolicy: ProductionPlanningByproductPolicy;
  acidPolicy: ProductionPlanningByproductPolicy;
  sewagePolicy: ProductionPlanningSewagePolicy;
  waterPurifierPolicy: ProductionPlanningWaterPurifierPolicy;
  includeDeviceMinimumConsumption: ProductionPlanningDeviceMinimumConsumptionMode;
}

export type ProductionPlanningDisplayMode = "item" | "device";
export type ProductionPlanningViewMode = "tree" | "flow" | "process";

export interface ProductionPlanningPort {
  id: string;
  itemId: string;
  perMinute: number;
  isInfinite?: boolean;
}

export interface ProductionPlanningIndex {
  /** registry 分类与 ID 解析入口；app 不保存 definition ID 副本。 */
  registryQueries: RegistryContract["queries"];
  itemById: Map<string, ItemDefinition>;
  entityById: Map<string, EntityDefinition>;
  recipeById: Map<string, RecipeDefinition>;
  consumptionRecipesByMachine: Map<string, RecipeDefinition[]>;
  recipesByOutputItem: Map<string, RecipeDefinition[]>;
  candidateById: Map<string, ProductionPlanningCandidate>;
  candidatesByOutputItem: Map<string, ProductionPlanningCandidate[]>;
  allItems: ItemDefinition[];
  naturalResourceItemIds: Set<string>;
  cropItemIds: Set<string>;
  rawResourceItemIds: Set<string>;
}

export interface ProductionPlanningIndexOptions {
  includeInactiveActivityContent?: boolean;
  activeActivityIds?: readonly string[];
  modules?: readonly ProductionPlanningModuleDefinition[];
}

export interface ProductionPlanningSupplyBreakdown {
  manual: number;
  surplus: number;
  infinite: number;
  cycle: number;
}

export interface ProductionPlanningItemNode {
  id: string;
  kind: "item";
  itemId: string;
  demandPerMinute: number;
  suppliedPerMinute: number;
  producedPerMinute: number;
  unresolvedPerMinute: number;
  supply: ProductionPlanningSupplyBreakdown;
  recipeNode: ProductionPlanningRecipeNode | null;
  isInfiniteSource: boolean;
  isCycleSource: boolean;
  blockedByCycle: boolean;
}

export interface ProductionPlanningRecipeNode {
  id: string;
  kind: "recipe";
  candidateId: string;
  candidateSourceType: ProductionPlanningCandidateSourceType;
  module: ProductionPlanningModuleSnapshot | null;
  recipeId: string | null;
  targetItemId: string;
  durationSeconds: number;
  cyclesPerMinute: number;
  deviceCount: number;
  inputs: ProductionPlanningPort[];
  deviceMinimumConsumptionInputs: ProductionPlanningPort[];
  outputs: ProductionPlanningPort[];
  inputItems: ProductionPlanningItemNode[];
  deviceMinimumConsumptionItems: ProductionPlanningItemNode[];
}

export interface ProductionPlanningItemTotal {
  itemId: string;
  demandPerMinute: number;
  suppliedPerMinute: number;
  producedPerMinute: number;
  unresolvedPerMinute: number;
  isByproduct: boolean;
}

export interface ProductionPlanningRecipeTotal {
  candidateId: string;
  candidateSourceType: ProductionPlanningCandidateSourceType;
  module: ProductionPlanningModuleSnapshot | null;
  recipeId: string | null;
  durationSeconds: number;
  cyclesPerMinute: number;
  deviceCount: number;
  inputs: ProductionPlanningPort[];
  deviceMinimumConsumptionInputs: ProductionPlanningPort[];
  outputs: ProductionPlanningPort[];
}

export interface ProductionPlanningResult {
  cycleIssues: readonly PlannerCycleIssue[];
  roots: ProductionPlanningItemNode[];
  itemTotals: ProductionPlanningItemTotal[];
  recipeTotals: ProductionPlanningRecipeTotal[];
  overflowItems: ProductionPlanningPort[];
  unresolvedPerMinute: number;
  byproductItemIds: ReadonlySet<string>;
}

export interface ProductionPlanningRequest {
  targets: readonly ProductionPlanningPort[];
  supplies: readonly ProductionPlanningPort[];
  infiniteItemIds: ReadonlySet<string>;
  recipeChoices: ReadonlyMap<string, string>;
  sourceConfig: ProductionPlanningSourceConfig;
  useModules?: boolean;
}

interface SolverContext {
  index: ProductionPlanningIndex;
  manualSupplyRemaining: Map<string, number>;
  surplusSupplyRemaining: Map<string, number>;
  infiniteItemIds: ReadonlySet<string>;
  recipeChoices: ReadonlyMap<string, string>;
  sourceConfig: ProductionPlanningSourceConfig;
  useModules: boolean;
  globalDemandRemaining: Map<string, number>;
  dumperAmounts: Map<string, number>;
  wasteTreatmentAmounts: Map<string, number>;
  nextNodeIndex: number;
}

const EPSILON = 0.0001;
const MAX_RECURSION_DEPTH = 48;

export function buildProductionPlanningIndex(
  registry: RegistryContract,
  options: ProductionPlanningIndexOptions = {},
): ProductionPlanningIndex {
  const includeInactiveActivityContent = options.includeInactiveActivityContent ?? true;
  const activeActivityIds = options.activeActivityIds ?? [];
  const itemDefinitions = includeInactiveActivityContent
    ? registry.itemDefinitions
    : registry.itemDefinitions.filter((item) => isItemAvailableByActivity(item, activeActivityIds));
  const itemById = new Map(itemDefinitions.map((item) => [item.id, item]));
  const entityById = new Map(registry.entityDefinitions.map((entity) => [entity.id, entity]));
  const visibleRecipes = sortRecipesByDefaultPriority(
    registry.recipeDefinitions
      .filter(isRecipeVisibleInToolbox)
      .filter((recipe) =>
      includeInactiveActivityContent
      || isRecipeAvailableByActivity(recipe, activeActivityIds),
      ),
  );
  const recipeById = new Map(visibleRecipes.map((recipe) => [recipe.id, recipe]));
  const consumptionRecipesByMachine = buildDeviceRunningConsumptionRecipesByMachine(
    registry.recipeDefinitions,
  );
  const recipesByOutputItem = new Map<string, RecipeDefinition[]>();

  for (const recipe of visibleRecipes) {
    for (const output of recipe.outputs) {
      const recipes = recipesByOutputItem.get(output.itemId);
      if (recipes === undefined) {
        recipesByOutputItem.set(output.itemId, [recipe]);
      } else {
        recipes.push(recipe);
      }
    }
  }

  const naturalResourceItemIds = new Set<string>();
  const cropItemIds = new Set<string>();
  const rawResourceItemIds = new Set<string>();
  for (const item of itemDefinitions) {
    if (isNaturalResourceItem(item)) {
      naturalResourceItemIds.add(item.id);
    }
    if (item.tags.includes("农作物")) cropItemIds.add(item.id);
    if (isPlanningRawResourceItem(item)) rawResourceItemIds.add(item.id);
  }

  const visibleModules = includeInactiveActivityContent
    ? options.modules ?? []
    : (options.modules ?? []).filter((module) => (
      [...module.inputs, ...module.outputs].every((port) => itemById.has(port.itemId))
    ));
  const candidates = buildProductionPlanningCandidates(visibleRecipes, visibleModules);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const candidatesByOutputItem = new Map<string, ProductionPlanningCandidate[]>();
  for (const candidate of candidates) {
    for (const output of candidate.outputs) {
      const outputCandidates = candidatesByOutputItem.get(output.itemId);
      if (outputCandidates === undefined) {
        candidatesByOutputItem.set(output.itemId, [candidate]);
      } else {
        outputCandidates.push(candidate);
      }
    }
  }

  return {
    registryQueries: registry.queries,
    itemById,
    entityById,
    recipeById,
    consumptionRecipesByMachine,
    recipesByOutputItem,
    candidateById,
    candidatesByOutputItem,
    allItems: [...itemDefinitions].sort((left, right) => left.nameKey.localeCompare(right.nameKey)),
    naturalResourceItemIds,
    cropItemIds,
    rawResourceItemIds,
  };
}

function buildProductionPlanningCandidates(
  recipes: readonly RecipeDefinition[],
  modules: readonly ProductionPlanningModuleDefinition[],
): ProductionPlanningCandidate[] {
  const candidates: ProductionPlanningCandidate[] = [];

  for (const [order, recipe] of recipes.entries()) {
    if (recipe.durationSeconds <= EPSILON) {
      continue;
    }
    const multiplier = 60 / recipe.durationSeconds;
    candidates.push({
      id: createProductionPlanningRecipeCandidateId(recipe.id),
      sourceType: "system-recipe",
      inputs: resolveProductionPlanningRecipeInputs(recipe).map((input) => ({
        itemId: input.itemId,
        perMinute: input.amount * multiplier,
      })),
      outputs: recipe.outputs.map((output) => ({
        itemId: output.itemId,
        perMinute: output.amount * multiplier,
      })),
      order,
      recipeId: recipe.id,
      module: null,
    });
  }

  const seenModuleIds = new Set<string>();
  for (const module of modules) {
    const candidateId = createProductionPlanningModuleCandidateId(module.sourceType, module.id);
    if (seenModuleIds.has(candidateId)) {
      continue;
    }
    seenModuleIds.add(candidateId);
    const snapshot = createProductionPlanningModuleSnapshot(module);
    candidates.push({
      id: candidateId,
      sourceType: snapshot.sourceType,
      inputs: snapshot.inputs,
      outputs: snapshot.outputs,
      order: recipes.length + candidates.length,
      recipeId: null,
      module: snapshot,
    });
  }

  return candidates;
}

export function computeProductionPlan(
  request: ProductionPlanningRequest,
  index: ProductionPlanningIndex,
): ProductionPlanningResult {
  const baseline = computeProductionPlanPass(request, index, 0);
  if (request.sourceConfig.waterPurifierPolicy !== "use-when-available") {
    return baseline;
  }

  const replaceableOutputPerMinute = resolveReplaceableWaterPurifierOutputPerMinute(baseline);
  const surplusSewagePerMinute = resolveWasteTreatmentInputPerMinute(baseline, "item_liquid_sewage");
  let requestedOutputPerMinute = roundFlow(Math.min(
    replaceableOutputPerMinute,
    surplusSewagePerMinute / WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT,
    WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE,
  ));

  if (requestedOutputPerMinute <= EPSILON) {
    return baseline;
  }

  for (let pass = 0; pass < 12; pass += 1) {
    const candidate = computeProductionPlanPass(request, index, requestedOutputPerMinute);
    const actualOutputPerMinute = resolveRecipeOutputPerMinute(
      candidate,
      WATER_PURIFIER_BYPRODUCT_RECIPE_ID,
      WATER_PURIFIER_OUTPUT_ITEM_ID,
    );
    if (actualOutputPerMinute <= EPSILON) {
      return baseline;
    }

    const additionalOutputPerMinute = Math.min(
      resolveReplaceableWaterPurifierOutputPerMinute(candidate),
      resolveWasteTreatmentInputPerMinute(candidate, "item_liquid_sewage")
        / WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT,
      Math.max(0, WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE - actualOutputPerMinute),
    );
    const nextOutputPerMinute = roundFlow(actualOutputPerMinute + additionalOutputPerMinute);
    if (Math.abs(nextOutputPerMinute - requestedOutputPerMinute) <= EPSILON) {
      return candidate;
    }
    requestedOutputPerMinute = nextOutputPerMinute;
  }

  return computeProductionPlanPass(request, index, requestedOutputPerMinute);
}

function computeProductionPlanPass(
  request: ProductionPlanningRequest,
  index: ProductionPlanningIndex,
  waterPurifierOutputPerMinute: number,
  buildModuleDemandForecast = true,
): ProductionPlanningResult {
  const useModules = request.useModules === true;
  const globalDemandRemaining = useModules && buildModuleDemandForecast
    ? buildProductionPlanningModuleDemandForecast(request, index, waterPurifierOutputPerMinute)
    : buildDemandMap(request.targets);
  const context: SolverContext = {
    index,
    manualSupplyRemaining: buildSupplyMap(request.supplies),
    surplusSupplyRemaining: waterPurifierOutputPerMinute > EPSILON
      ? new Map([[WATER_PURIFIER_OUTPUT_ITEM_ID, waterPurifierOutputPerMinute]])
      : new Map(),
    infiniteItemIds: buildInfiniteItemIds(request.infiniteItemIds, request.supplies),
    recipeChoices: request.recipeChoices,
    sourceConfig: request.sourceConfig,
    useModules,
    globalDemandRemaining,
    dumperAmounts: new Map(),
    wasteTreatmentAmounts: new Map(),
    nextNodeIndex: 0,
  };

  const roots = sortProductionPlanningTargetsForSharedCandidates(request.targets, context)
    .map((target) => resolveDemand(target.itemId, target.perMinute, context, []));
  const recipeNodes = flattenProductionPlanningRecipeNodes(roots);

  // "use byproduct" 模式: 未被消费的副产物剩余量 → 送去倾倒
  for (const itemId of PRODUCTION_PLANNING_BYPRODUCT_ITEM_IDS) {
    if (isByproductItemDumpMode(itemId, context.sourceConfig)) {
      continue;
    }
    const remaining = context.surplusSupplyRemaining.get(itemId) ?? 0;
    if (remaining > EPSILON) {
      addSupply(context.dumperAmounts, itemId, remaining);
    }
  }

  const dumperRecipeNodes = buildDumperRecipeNodes(context);
  const waterPurifierRecipeNodes = buildWaterPurifierRecipeNodes(context, waterPurifierOutputPerMinute);
  const wasteTreatmentRecipeNodes = buildWasteTreatmentRecipeNodes(context);
  const allRecipeNodes = [
    ...recipeNodes,
    ...dumperRecipeNodes,
    ...waterPurifierRecipeNodes,
    ...wasteTreatmentRecipeNodes,
  ];

  const recipeTotals = aggregateRecipeTotals(allRecipeNodes, index, roots);
  const cycleIssues = findPlannerCycleIssues({ recipes: recipeTotals, targets: request.targets,
    externalSupplies: request.supplies, infiniteItemIds: context.infiniteItemIds });
  const invalidCycleItems = new Set(cycleIssues.flatMap(issue => issue.itemIds));
  for (const node of flattenProductionPlanningItemNodes(roots)) {
    if (!invalidCycleItems.has(node.itemId)) continue;
    node.blockedByCycle = true;
    if (!node.isCycleSource || node.supply.cycle <= EPSILON) continue;
    node.suppliedPerMinute = roundFlow(node.suppliedPerMinute - node.supply.cycle);
    node.unresolvedPerMinute = roundFlow(node.unresolvedPerMinute + node.supply.cycle);
    node.supply.cycle = 0;
  }
  const itemTotals = aggregateItemTotals(roots, allRecipeNodes, index);

  const byproductItemIds = collectProductionPlanningByproductItemIds(context);
  for (const total of itemTotals) {
    total.isByproduct = byproductItemIds.has(total.itemId);
  }
  const overflowItems = collectProductionPlanningOverflowItems(context, index);

  return {
    cycleIssues,
    roots,
    itemTotals,
    recipeTotals,
    overflowItems,
    unresolvedPerMinute: roundFlow(itemTotals.reduce((sum, item) => sum + item.unresolvedPerMinute, 0)),
    byproductItemIds,
  };
}

function buildProductionPlanningModuleDemandForecast(
  request: ProductionPlanningRequest,
  index: ProductionPlanningIndex,
  waterPurifierOutputPerMinute: number,
): Map<string, number> {
  const baseline = computeProductionPlanPass(
    { ...request, useModules: false },
    index,
    waterPurifierOutputPerMinute,
    false,
  );
  const forecast = new Map<string, number>();
  for (const item of baseline.itemTotals) {
    if (item.demandPerMinute > EPSILON) {
      forecast.set(item.itemId, item.demandPerMinute);
    }
  }
  return forecast;
}

export function flattenProductionPlanningItemNodes(
  nodes: readonly ProductionPlanningItemNode[],
): ProductionPlanningItemNode[] {
  const result: ProductionPlanningItemNode[] = [];

  for (const node of nodes) {
    result.push(node);
    if (node.recipeNode !== null) {
      result.push(...flattenProductionPlanningItemNodes(node.recipeNode.inputItems));
      result.push(...flattenProductionPlanningItemNodes(node.recipeNode.deviceMinimumConsumptionItems));
    }
  }

  return result;
}

export function flattenProductionPlanningRecipeNodes(
  nodes: readonly ProductionPlanningItemNode[],
): ProductionPlanningRecipeNode[] {
  const result: ProductionPlanningRecipeNode[] = [];

  for (const node of nodes) {
    if (node.recipeNode === null) {
      continue;
    }

    result.push(node.recipeNode);
    result.push(...flattenProductionPlanningRecipeNodes(node.recipeNode.inputItems));
    result.push(...flattenProductionPlanningRecipeNodes(node.recipeNode.deviceMinimumConsumptionItems));
  }

  return result;
}

export function resolveProductionPlanningItemName(
  itemId: string,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
): string {
  const item = index.itemById.get(itemId);
  return item === undefined ? itemId : translate(item.nameKey);
}

export function resolveProductionPlanningRecipeName(
  recipe: RecipeDefinition,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
): string {
  const outputNames = recipe.outputs.map((output) => resolveProductionPlanningItemName(output.itemId, index, translate));
  const machine = index.entityById.get(recipe.machineId);
  const machineName = machine === undefined ? recipe.machineId : translate(machine.nameKey);
  return outputNames.length === 0 ? machineName : `${machineName} · ${outputNames.join(" + ")}`;
}

export function resolveProductionPlanningCandidateName(
  candidate: ProductionPlanningCandidate,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
): string {
  if (candidate.module !== null) {
    const sourceName = translate(
      candidate.module.sourceType === "custom-module"
        ? "moduleBalancing.customModules"
        : "moduleBalancing.recommendedModules",
    );
    return `${candidate.module.name} · ${sourceName}`;
  }
  const recipe = candidate.recipeId === null ? undefined : index.recipeById.get(candidate.recipeId);
  return recipe === undefined
    ? candidate.id
    : resolveProductionPlanningRecipeName(recipe, index, translate);
}

export function resolveProductionPlanningItemIconSrc(itemId: string, index: ProductionPlanningIndex): string {
  const item = index.itemById.get(itemId);
  return createItemIconAssetUrl(item?.iconId ?? itemId);
}

export function resolveProductionPlanningModuleIconSrcs(
  module: ProductionPlanningModuleSnapshot,
  index: ProductionPlanningIndex,
): string[] {
  const validIconItemIds = module.iconItemIds.filter((itemId) => index.itemById.has(itemId));
  const itemIds = validIconItemIds.length > 0
    ? validIconItemIds
    : collectDefaultModuleIconItemIds(
      module.outputs.map((port) => port.itemId),
      module.inputs.map((port) => port.itemId),
    );
  return (itemIds.length > 0 ? itemIds : module.iconItemIds)
    .map((itemId) => resolveProductionPlanningItemIconSrc(itemId, index));
}

export function resolveProductionPlanningEntityIconSrc(
  entityId: string,
  index: ProductionPlanningIndex,
): string {
  return createEntityIconAssetUrl(index.entityById.get(entityId)?.iconPath);
}

export function formatProductionFlow(value: number): string {
  if (Math.abs(value) < 0.005) {
    return value > 0 ? "<0.01" : "0";
  }

  const rounded = roundFlow(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatProductionDeviceCount(value: number): string {
  if (Math.abs(value) < 0.005) {
    return value > 0 ? "<0.01" : "0";
  }

  if (value < 0.1) {
    return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  return formatProductionFlow(value);
}

export function isRecipeExcludedFromProductionPlanningAuto(
  recipe: RecipeDefinition,
  index: ProductionPlanningIndex,
): boolean {
  // 2026-10-16 用户硬约束：原料既无当前可用的工业生产配方，也未标记为自然资源时，禁止自动选择；手动外供不豁免。
  return !isRecipeVisibleInToolbox(recipe)
    || isWaterPurifierNodeRecipe(recipe)
    || recipe.inputs.some((input) => (
      !index.rawResourceItemIds.has(input.itemId)
      && !(index.recipesByOutputItem.get(input.itemId) ?? [])
        .some((producer) => producer.durationSeconds > EPSILON)
    ));
}

export function resolveProductionPlanningAutoRecipe(
  recipes: readonly RecipeDefinition[],
  index: ProductionPlanningIndex,
): RecipeDefinition | undefined {
  return sortRecipesByDefaultPriority(
    recipes.filter((recipe) => !isRecipeExcludedFromProductionPlanningAuto(recipe, index)),
  )[0];
}

export function isWaterPurifierNodeRecipe(recipe: RecipeDefinition): boolean {
  return recipe.id === WATER_PURIFIER_COLLECT_RECIPE_ID
    || recipe.id === WATER_PURIFIER_BYPRODUCT_RECIPE_ID;
}


function resolveProductionPlanningRecipeInputs(
  recipe: RecipeDefinition,
): readonly RecipeDefinition["inputs"][number][] {
  const ignoredItemIds = PRODUCTION_PLANNING_IGNORED_RECIPE_INPUT_ITEM_IDS.get(recipe.id);
  if (ignoredItemIds === undefined) {
    return recipe.inputs;
  }
  return recipe.inputs.filter((input) => !ignoredItemIds.has(input.itemId));
}

export function createProductionPlanningId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 计算物品的默认吞吐率：单个设备满速运行一分钟的产出。
 * 若无可用配方则回退到 60。
 */
export function computeItemDefaultPerMinute(
  itemId: string,
  index: ProductionPlanningIndex,
): number {
  const recipes = index.recipesByOutputItem.get(itemId);
  if (!recipes || recipes.length === 0) return 60;

  const candidate = resolveProductionPlanningAutoRecipe(
    recipes,
    index,
  );
  if (!candidate) return 60;

  const output = candidate.outputs.find((o) => o.itemId === itemId);
  if (!output || candidate.durationSeconds <= 0) return 60;

  return (output.amount / candidate.durationSeconds) * 60;
}

function resolveDemand(
  itemId: string,
  demandPerMinute: number,
  context: SolverContext,
  stack: readonly string[],
  closedPlantCycleItemIds: readonly string[] = [],
): ProductionPlanningItemNode {
  const demand = roundFlow(Math.max(0, demandPerMinute));
  const supply = consumeAvailableSupply(itemId, demand, context);
  const suppliedByStoredItems = roundFlow(supply.manual + supply.surplus);
  let remaining = roundFlow(demand - suppliedByStoredItems);

  if (remaining > EPSILON && context.infiniteItemIds.has(itemId)) {
    supply.infinite = remaining;
    remaining = 0;
  }

  const supplyAfterInfinite = roundFlow(supply.manual + supply.surplus + supply.infinite);
  if (remaining <= EPSILON) {
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: 0,
      supply,
      recipeNode: null,
      isInfiniteSource: supply.infinite > EPSILON,
      isCycleSource: false,
      blockedByCycle: false,
    }, context);
  }

  if (stack.includes(itemId)) {
    // 先记录回流引用；全链聚合后由共享净流量诊断撤销不能成立的循环供给。
    supply.cycle = closedPlantCycleItemIds.includes(itemId) ? 0 : remaining;
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: roundFlow(supplyAfterInfinite + supply.cycle),
      producedPerMinute: 0,
      unresolvedPerMinute: 0,
      supply,
      recipeNode: null,
      isInfiniteSource: false,
      isCycleSource: true,
      blockedByCycle: false,
    }, context);
  }

  if (stack.length >= MAX_RECURSION_DEPTH) {
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: remaining,
      supply,
      recipeNode: null,
      isInfiniteSource: false,
      isCycleSource: false,
      blockedByCycle: true,
    }, context);
  }

  const candidate = resolveCandidateForItem(itemId, remaining, context, stack);
  const candidateOutput = candidate?.outputs.find((output) => output.itemId === itemId);
  const recipe = candidate?.recipeId === null || candidate === undefined
    ? undefined
    : context.index.recipeById.get(candidate.recipeId);

  if (candidate === undefined || candidateOutput === undefined || candidateOutput.perMinute <= EPSILON) {
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: remaining,
      supply,
      recipeNode: null,
      isInfiniteSource: false,
      isCycleSource: false,
      blockedByCycle: false,
    }, context);
  }

  const deviceConsumptionAmounts = recipe === undefined
    ? new Map<string, number>()
    : resolveDeviceMinimumConsumptionAmountsPerCycle(recipe, context);
  const recipeOutput = recipe?.outputs.find((output) => output.itemId === itemId);
  const targetDeviceConsumptionAmountPerCycle = deviceConsumptionAmounts.get(itemId) ?? 0;
  const netOutputPerUnit = recipe === undefined
    ? candidateOutput.perMinute
    : roundFlow((recipeOutput?.amount ?? 0) - targetDeviceConsumptionAmountPerCycle);

  if (netOutputPerUnit <= EPSILON) {
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: remaining,
      supply,
      recipeNode: null,
      isInfiniteSource: false,
      isCycleSource: false,
      blockedByCycle: false,
    }, context);
  }

  const plantCycleRate = recipe === undefined ? null : resolveProductivePlantCycleRate(
    itemId, remaining, netOutputPerUnit, recipe, context, stack,
  );
  // 长周期田块的周期率必须保留精度，否则 1/30 先舍入会使实际产量变成 0.999/min。
  let cyclesPerMinute = plantCycleRate?.cyclesPerMinute ?? remaining / netOutputPerUnit;
  if (recipe !== undefined && recipeOutput !== undefined && targetDeviceConsumptionAmountPerCycle > EPSILON
    && context.sourceConfig.includeDeviceMinimumConsumption === "ceil") {
    // 自耗材按整台运行时，先由满载净产能确定台数，再补足这些设备的实际耗材。
    const machineCycles = 60 / recipe.durationSeconds;
    const machines = Math.ceil(remaining / (netOutputPerUnit * machineCycles) - 1e-6);
    cyclesPerMinute = (remaining + machines * targetDeviceConsumptionAmountPerCycle * machineCycles) / recipeOutput.amount;
  }
  const deviceCount = recipe === undefined
    ? cyclesPerMinute
    : roundFlow(Math.max(cyclesPerMinute / (60 / recipe.durationSeconds), plantCycleRate?.minimumDeviceCount ?? 0));
  const candidateInputPorts = recipe === undefined
    ? candidate.inputs.map((input) => ({
      id: `${candidate.id}-in-${input.itemId}`,
      itemId: input.itemId,
      perMinute: roundFlow(input.perMinute * deviceCount),
    }))
    : resolveProductionPlanningRecipeInputs(recipe).map((input) => ({
      id: `${candidate.id}-in-${input.itemId}`,
      itemId: input.itemId,
      perMinute: roundFlow(input.amount * cyclesPerMinute),
    }));
  const deviceConsumptionPorts = Array.from(deviceConsumptionAmounts, ([consumedItemId, amount]) => ({
    id: `${candidate.id}-device-consumption-${consumedItemId}`,
    itemId: consumedItemId,
    perMinute: resolveDeviceMinimumConsumptionPerMinute(
      amount,
      cyclesPerMinute,
      recipe?.durationSeconds ?? 60,
      deviceCount,
      context.sourceConfig.includeDeviceMinimumConsumption,
    ),
  }));
  const inputPorts = mergePorts(candidateInputPorts, deviceConsumptionPorts);
  const outputPorts = recipe === undefined
    ? candidate.outputs.map((output) => ({
      id: `${candidate.id}-out-${output.itemId}`,
      itemId: output.itemId,
      perMinute: roundFlow(output.perMinute * deviceCount),
    }))
    : recipe.outputs.map((output) => ({
      id: `${candidate.id}-out-${output.itemId}`,
      itemId: output.itemId,
      perMinute: roundFlow(output.amount * cyclesPerMinute),
    }));


  if (candidate.module !== null) {
    const replacedSystemDemand = collectSystemRecipeDemandFootprint(
      itemId,
      remaining,
      context,
      stack,
    );
    for (const [replacedItemId, replacedPerMinute] of replacedSystemDemand) {
      if (replacedItemId !== itemId) {
        consumeSupply(context.globalDemandRemaining, replacedItemId, replacedPerMinute);
      }
    }
  }

  for (const outputPort of outputPorts) {
    if (outputPort.itemId !== itemId && outputPort.perMinute > EPSILON) {
      if (isByproductItemDumpMode(outputPort.itemId, context.sourceConfig)) {
        addSupply(context.dumperAmounts, outputPort.itemId, outputPort.perMinute);
      } else {
        addSupply(context.surplusSupplyRemaining, outputPort.itemId, outputPort.perMinute);
      }
    }
  }

  for (const input of candidateInputPorts) {
    addSupply(context.globalDemandRemaining, input.itemId, input.perMinute);
  }
  for (const input of deviceConsumptionPorts) {
    addSupply(context.globalDemandRemaining, input.itemId, input.perMinute);
  }
  const inputItems = candidateInputPorts.map((input) => (
    resolveDemand(input.itemId, input.perMinute, context, [...stack, itemId],
      input.itemId === plantCycleRate?.partnerItemId
        ? [...closedPlantCycleItemIds, itemId] : closedPlantCycleItemIds)
  ));
  const deviceMinimumConsumptionItems = deviceConsumptionPorts.map((input) => (
    input.itemId === itemId
      ? createProductionPlanningCycleSupplyItemNode(input.itemId, input.perMinute, context)
      : resolveDemand(input.itemId, input.perMinute, context, [...stack, itemId], closedPlantCycleItemIds)
  ));
  const recipeNode: ProductionPlanningRecipeNode = {
    id: createNodeId(candidate.sourceType === "system-recipe" ? "recipe" : "module", context),
    kind: "recipe",
    candidateId: candidate.id,
    candidateSourceType: candidate.sourceType,
    module: candidate.module,
    recipeId: candidate.recipeId,
    targetItemId: itemId,
    durationSeconds: recipe?.durationSeconds ?? 60,
    cyclesPerMinute,
    deviceCount,
    inputs: inputPorts,
    deviceMinimumConsumptionInputs: deviceConsumptionPorts,
    outputs: outputPorts,
    inputItems,
    deviceMinimumConsumptionItems,
  };

  return createItemNode({
    itemId,
    demandPerMinute: demand,
    suppliedPerMinute: supplyAfterInfinite,
    producedPerMinute: remaining,
    unresolvedPerMinute: 0,
    supply,
    recipeNode,
    isInfiniteSource: false,
    isCycleSource: false,
    blockedByCycle: false,
  }, context);
}

/** 采种与种植的回流属于内部消耗；用净外供量反推两台设备的实际运行速率。 */
function resolveProductivePlantCycleRate(
  itemId: string,
  externalDemand: number,
  outputPerCycle: number,
  recipe: RecipeDefinition,
  context: SolverContext,
  stack: readonly string[],
): { cyclesPerMinute: number; partnerItemId: string; minimumDeviceCount: number } | null {
  if (!isPlantCycleRecipe(recipe)) return null;
  for (const input of resolveProductionPlanningRecipeInputs(recipe)) {
    if (stack.includes(input.itemId) || context.infiniteItemIds.has(input.itemId)) continue;
    const partner = resolveCandidateForItem(input.itemId, input.amount, context, [...stack, itemId]);
    if (partner?.sourceType !== "system-recipe" || partner.recipeId === null) continue;
    const partnerRecipe = context.index.recipeById.get(partner.recipeId);
    if (partnerRecipe === undefined) continue;
    const rate = balanceProductivePlantCycle({ recipe, partnerRecipe, itemId, externalDemand, outputPerCycle,
      availablePartnerSupply: (context.manualSupplyRemaining.get(input.itemId) ?? 0)
        + (context.surplusSupplyRemaining.get(input.itemId) ?? 0) });
    if (rate && rate.partnerCyclesPerMinute > EPSILON) return rate;
  }
  return null;
}


function resolveDeviceMinimumConsumptionAmountsPerCycle(
  recipe: RecipeDefinition,
  context: SolverContext,
): ReadonlyMap<string, number> {
  if (context.sourceConfig.includeDeviceMinimumConsumption === "none") {
    return new Map();
  }

  const consumptionRecipe = resolveCompanionDeviceRunningConsumptionRecipe(
    recipe,
    context.index.consumptionRecipesByMachine,
  );
  const consumptionInput = consumptionRecipe?.inputs[0];
  if (
    consumptionRecipe === undefined
    || consumptionInput === undefined
    || consumptionRecipe.durationSeconds <= EPSILON
  ) {
    return new Map();
  }

  return new Map([[
    consumptionInput.itemId,
    roundFlow(
      consumptionInput.amount * recipe.durationSeconds / consumptionRecipe.durationSeconds,
    ),
  ]]);
}

function resolveDeviceMinimumConsumptionPerMinute(
  amountPerCycle: number,
  cyclesPerMinute: number,
  hostRecipeDurationSeconds: number,
  deviceCount: number,
  mode: ProductionPlanningDeviceMinimumConsumptionMode,
): number {
  if (mode === "none") {
    return 0;
  }

  if (mode === "ceil") {
    const roundedDeviceCount = Math.ceil(deviceCount - EPSILON);
    const cyclesPerMachinePerMinute = 60 / hostRecipeDurationSeconds;
    return roundFlow(amountPerCycle * roundedDeviceCount * cyclesPerMachinePerMinute);
  }

  return roundFlow(amountPerCycle * cyclesPerMinute);
}

function createProductionPlanningCycleSupplyItemNode(
  itemId: string,
  perMinute: number,
  context: SolverContext,
): ProductionPlanningItemNode {
  return createItemNode({
    itemId,
    demandPerMinute: perMinute,
    suppliedPerMinute: perMinute,
    producedPerMinute: 0,
    unresolvedPerMinute: 0,
    supply: {
      manual: 0,
      surplus: 0,
      infinite: 0,
      cycle: perMinute,
    },
    recipeNode: null,
    isInfiniteSource: false,
    isCycleSource: true,
    blockedByCycle: false,
  }, context);
}

function createItemNode(
  node: Omit<ProductionPlanningItemNode, "id" | "kind">,
  context: SolverContext,
): ProductionPlanningItemNode {
  consumeSupply(context.globalDemandRemaining, node.itemId, node.demandPerMinute);
  return {
    id: createNodeId("item", context),
    kind: "item",
    ...node,
    suppliedPerMinute: roundFlow(node.suppliedPerMinute),
    producedPerMinute: roundFlow(node.producedPerMinute),
    unresolvedPerMinute: roundFlow(node.unresolvedPerMinute),
  };
}

function buildDemandMap(ports: readonly ProductionPlanningPort[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const port of ports) {
    if (port.itemId.length > 0 && port.perMinute > EPSILON) {
      addSupply(result, port.itemId, port.perMinute);
    }
  }
  return result;
}

function sortProductionPlanningTargetsForSharedCandidates(
  targets: readonly ProductionPlanningPort[],
  context: SolverContext,
): ProductionPlanningPort[] {
  const validTargets = targets.filter(
    (target) => target.itemId.length > 0 && target.perMinute > EPSILON,
  );
  const priorityByItemId = new Map<string, number>();

  for (const candidate of context.index.candidateById.values()) {
    if (!isCandidateAvailableInContext(candidate, context) || candidate.outputs.length < 2) {
      continue;
    }
    const ratios = candidate.outputs.map((output) => {
      const demand = context.globalDemandRemaining.get(output.itemId) ?? 0;
      return {
        itemId: output.itemId,
        ratio: output.perMinute > EPSILON ? demand / output.perMinute : 0,
      };
    });
    if (ratios.some((entry) => entry.ratio <= EPSILON)) {
      continue;
    }
    ratios.sort((left, right) => left.ratio - right.ratio || left.itemId.localeCompare(right.itemId));
    const limitingItemId = ratios[0]!.itemId;
    priorityByItemId.set(limitingItemId, (priorityByItemId.get(limitingItemId) ?? 0) - 1);
  }

  return [...validTargets].sort((left, right) => (
    (priorityByItemId.get(left.itemId) ?? 0) - (priorityByItemId.get(right.itemId) ?? 0)
    || left.itemId.localeCompare(right.itemId)
    || left.id.localeCompare(right.id)
  ));
}


interface ProductionPlanningPlanEstimate {
  readonly externalResources: Map<string, number>;
  readonly unusedOutputs: Map<string, number>;
  readonly unresolvedResources: Map<string, number>;
  readonly depth: number;
  readonly nodeCount: number;
}

function resolveCandidateForItem(
  itemId: string,
  demandPerMinute: number,
  context: SolverContext,
  stack: readonly string[],
): ProductionPlanningCandidate | undefined {
  const candidates = resolveAvailableCandidatesForItem(itemId, context);
  const selectedChoice = context.recipeChoices.get(itemId);
  if (selectedChoice !== undefined) {
    const selected = context.index.candidateById.get(
      normalizeProductionPlanningCandidateChoiceId(selectedChoice),
    );
    if (
      selected !== undefined
      && isCandidateAvailableInContext(selected, context)
      && isCandidateAllowedForManualSelection(selected, context.index)
      && selected.outputs.some((output) => output.itemId === itemId)
    ) {
      return selected;
    }
  }

  const defaultSystemCandidate = candidates.find((candidate) => candidate.sourceType === "system-recipe");
  const moduleCandidates = candidates.filter((candidate) => candidate.sourceType !== "system-recipe");
  if (moduleCandidates.length === 0) {
    return defaultSystemCandidate;
  }

  let best: ProductionPlanningCandidate | undefined;
  let bestEstimate: ProductionPlanningPlanEstimate | undefined;
  for (const candidate of [
    ...(defaultSystemCandidate === undefined ? [] : [defaultSystemCandidate]),
    ...moduleCandidates,
  ]) {
    const estimate = estimateProductionPlanningCandidate(
      candidate,
      itemId,
      demandPerMinute,
      context,
      stack,
    );
    if (
      best === undefined
      || bestEstimate === undefined
      || compareProductionPlanningEstimates(estimate, bestEstimate, candidate, best) < 0
    ) {
      best = candidate;
      bestEstimate = estimate;
    }
  }

  return best;
}

function isCandidateAllowedForManualSelection(
  candidate: ProductionPlanningCandidate,
  index: ProductionPlanningIndex,
): boolean {
  if (candidate.recipeId === null) {
    return true;
  }
  const recipe = index.recipeById.get(candidate.recipeId);
  return recipe !== undefined && !isWaterPurifierNodeRecipe(recipe);
}

function resolveAvailableCandidatesForItem(
  itemId: string,
  context: SolverContext,
): ProductionPlanningCandidate[] {
  return (context.index.candidatesByOutputItem.get(itemId) ?? [])
    .filter((candidate) => isCandidateAvailableInContext(candidate, context))
    .filter((candidate) => {
      if (candidate.recipeId === null) {
        return true;
      }
      const recipe = context.index.recipeById.get(candidate.recipeId);
      return recipe !== undefined && !isRecipeExcludedFromProductionPlanningAuto(recipe, context.index);
    })
    .sort((left, right) => compareProductionPlanningCandidatesByDefaultPriority(left, right, context.index));
}

function compareProductionPlanningCandidatesByDefaultPriority(
  left: ProductionPlanningCandidate,
  right: ProductionPlanningCandidate,
  index: ProductionPlanningIndex,
): number {
  if (left.recipeId === null || right.recipeId === null) {
    return Number(left.recipeId === null) - Number(right.recipeId === null)
      || left.order - right.order
      || left.id.localeCompare(right.id);
  }
  const leftRecipe = index.recipeById.get(left.recipeId);
  const rightRecipe = index.recipeById.get(right.recipeId);
  if (leftRecipe === undefined || rightRecipe === undefined) {
    return left.order - right.order || left.id.localeCompare(right.id);
  }
  return compareRecipesByDefaultPriority(leftRecipe, rightRecipe);
}

function isCandidateAvailableInContext(
  candidate: ProductionPlanningCandidate,
  context: SolverContext,
): boolean {
  return candidate.sourceType === "system-recipe" || context.useModules;
}

function estimateProductionPlanningCandidate(
  candidate: ProductionPlanningCandidate,
  targetItemId: string,
  demandPerMinute: number,
  context: SolverContext,
  stack: readonly string[],
): ProductionPlanningPlanEstimate {
  const output = candidate.outputs.find((port) => port.itemId === targetItemId);
  if (output === undefined || output.perMinute <= EPSILON) {
    return createUnresolvedEstimate(targetItemId, demandPerMinute);
  }

  const quantity = demandPerMinute / output.perMinute;
  const inputEstimate = estimateCandidateInputs(candidate, quantity, context, [...stack, targetItemId]);
  const externalResources = new Map(inputEstimate.externalResources);
  const unusedOutputs = new Map(inputEstimate.unusedOutputs);
  const replacedSystemDemand = collectSystemRecipeDemandFootprint(
    targetItemId,
    demandPerMinute,
    context,
    stack,
  );
  let avoidedNodeCount = 0;

  for (const candidateOutput of candidate.outputs) {
    if (candidateOutput.itemId === targetItemId) {
      continue;
    }
    const produced = roundFlow(candidateOutput.perMinute * quantity);
    const useful = Math.min(
      produced,
      Math.max(
        0,
        (context.globalDemandRemaining.get(candidateOutput.itemId) ?? 0)
          - (replacedSystemDemand.get(candidateOutput.itemId) ?? 0),
      ),
    );
    const unused = roundFlow(produced - useful);
    if (unused > EPSILON) {
      addSupply(unusedOutputs, candidateOutput.itemId, unused);
    }
    if (useful <= EPSILON) {
      continue;
    }

    const avoided = estimateSystemRecipeItem(
      candidateOutput.itemId,
      useful,
      context,
      [...stack, targetItemId],
      new Set([candidate.id]),
    );
    subtractEstimateResources(externalResources, avoided.externalResources);
    avoidedNodeCount += avoided.nodeCount;
  }

  return {
    externalResources,
    unusedOutputs,
    unresolvedResources: inputEstimate.unresolvedResources,
    depth: inputEstimate.depth + 1,
    nodeCount: Math.max(0, inputEstimate.nodeCount + 1 - avoidedNodeCount),
  };
}

function estimateCandidateInputs(
  candidate: ProductionPlanningCandidate,
  quantity: number,
  context: SolverContext,
  stack: readonly string[],
): ProductionPlanningPlanEstimate {
  const estimate = createEmptyEstimate();
  const inputPorts = candidate.inputs.map((input) => ({
    itemId: input.itemId,
    perMinute: input.perMinute * quantity,
  }));
  if (candidate.recipeId !== null) {
    const recipe = context.index.recipeById.get(candidate.recipeId);
    if (recipe !== undefined) {
      const amounts = resolveDeviceMinimumConsumptionAmountsPerCycle(recipe, context);
      const cyclesPerMinute = quantity * 60 / recipe.durationSeconds;
      for (const [itemId, amount] of amounts) {
        inputPorts.push({
          itemId,
          perMinute: resolveDeviceMinimumConsumptionPerMinute(
            amount,
            cyclesPerMinute,
            recipe.durationSeconds,
            quantity,
            context.sourceConfig.includeDeviceMinimumConsumption,
          ),
        });
      }
    }
  }

  for (const input of inputPorts) {
    mergeEstimate(
      estimate,
      estimateSystemRecipeItem(input.itemId, input.perMinute, context, stack, new Set()),
    );
  }
  return estimate;
}

function collectSystemRecipeDemandFootprint(
  itemId: string,
  demandPerMinute: number,
  context: SolverContext,
  stack: readonly string[],
): Map<string, number> {
  const footprint = new Map<string, number>();
  if (demandPerMinute <= EPSILON) {
    return footprint;
  }
  addSupply(footprint, itemId, demandPerMinute);
  if (
    stack.includes(itemId)
    || stack.length >= MAX_RECURSION_DEPTH
    || context.index.rawResourceItemIds.has(itemId)
    || isRawPlantResourceItem(itemId)
    || context.infiniteItemIds.has(itemId)
  ) {
    return footprint;
  }

  const supplied = Math.min(context.manualSupplyRemaining.get(itemId) ?? 0, demandPerMinute);
  const productionDemand = roundFlow(demandPerMinute - supplied);
  if (productionDemand <= EPSILON) {
    return footprint;
  }

  const bestCandidate = resolveAvailableCandidatesForItem(itemId, context)
    .find(candidate => candidate.sourceType === "system-recipe");
  if (bestCandidate === undefined) return footprint;

  const output = bestCandidate.outputs.find((port) => port.itemId === itemId);
  if (output === undefined || output.perMinute <= EPSILON) {
    return footprint;
  }
  const quantity = productionDemand / output.perMinute;
  for (const input of bestCandidate.inputs) {
    const inputFootprint = collectSystemRecipeDemandFootprint(
      input.itemId,
      input.perMinute * quantity,
      context,
      [...stack, itemId],
    );
    for (const [inputItemId, inputPerMinute] of inputFootprint) {
      addSupply(footprint, inputItemId, inputPerMinute);
    }
  }
  return footprint;
}

function estimateSystemRecipeItem(
  itemId: string,
  demandPerMinute: number,
  context: SolverContext,
  stack: readonly string[],
  excludedCandidateIds: ReadonlySet<string>,
): ProductionPlanningPlanEstimate {
  if (demandPerMinute <= EPSILON) {
    return createEmptyEstimate();
  }
  if (stack.includes(itemId)) {
    return createResourceEstimate(itemId, demandPerMinute);
  }
  if (stack.length >= MAX_RECURSION_DEPTH) {
    return createUnresolvedEstimate(itemId, demandPerMinute);
  }
  if (context.index.rawResourceItemIds.has(itemId) || isRawPlantResourceItem(itemId)) {
    return createResourceEstimate(itemId, demandPerMinute);
  }

  const manualAvailable = context.manualSupplyRemaining.get(itemId) ?? 0;
  if (manualAvailable > EPSILON || context.infiniteItemIds.has(itemId)) {
    const supplied = context.infiniteItemIds.has(itemId)
      ? demandPerMinute
      : Math.min(demandPerMinute, manualAvailable);
    const estimate = createResourceEstimate(itemId, supplied);
    const remaining = demandPerMinute - supplied;
    if (remaining > EPSILON) {
      mergeEstimate(
        estimate,
        estimateSystemRecipeItem(itemId, remaining, context, stack, excludedCandidateIds),
      );
    }
    return estimate;
  }

  const candidate = resolveAvailableCandidatesForItem(itemId, context)
    .find(candidate => candidate.sourceType === "system-recipe" && !excludedCandidateIds.has(candidate.id));
  if (candidate === undefined) return createUnresolvedEstimate(itemId, demandPerMinute);
  return estimateSystemRecipeCandidate(candidate, itemId, demandPerMinute, context, stack, excludedCandidateIds);
}

function estimateSystemRecipeCandidate(
  candidate: ProductionPlanningCandidate,
  targetItemId: string,
  demandPerMinute: number,
  context: SolverContext,
  stack: readonly string[],
  excludedCandidateIds: ReadonlySet<string>,
): ProductionPlanningPlanEstimate {
  const output = candidate.outputs.find((port) => port.itemId === targetItemId);
  if (output === undefined || output.perMinute <= EPSILON) {
    return createUnresolvedEstimate(targetItemId, demandPerMinute);
  }
  const quantity = demandPerMinute / output.perMinute;
  const estimate = createEmptyEstimate();
  const inputPorts = candidate.inputs.map((input) => ({
    itemId: input.itemId,
    perMinute: input.perMinute * quantity,
  }));
  if (candidate.recipeId !== null) {
    const recipe = context.index.recipeById.get(candidate.recipeId);
    if (recipe !== undefined) {
      const amounts = resolveDeviceMinimumConsumptionAmountsPerCycle(recipe, context);
      const cyclesPerMinute = quantity * 60 / recipe.durationSeconds;
      for (const [consumedItemId, amount] of amounts) {
        inputPorts.push({
          itemId: consumedItemId,
          perMinute: resolveDeviceMinimumConsumptionPerMinute(
            amount,
            cyclesPerMinute,
            recipe.durationSeconds,
            quantity,
            context.sourceConfig.includeDeviceMinimumConsumption,
          ),
        });
      }
    }
  }
  for (const input of inputPorts) {
    mergeEstimate(
      estimate,
      estimateSystemRecipeItem(
        input.itemId,
        input.perMinute,
        context,
        [...stack, targetItemId],
        excludedCandidateIds,
      ),
    );
  }
  return {
    externalResources: estimate.externalResources,
    unusedOutputs: estimate.unusedOutputs,
    unresolvedResources: estimate.unresolvedResources,
    depth: estimate.depth + 1,
    nodeCount: estimate.nodeCount + 1,
  };
}

function compareProductionPlanningEstimates(
  left: ProductionPlanningPlanEstimate,
  right: ProductionPlanningPlanEstimate,
  leftCandidate: ProductionPlanningCandidate,
  rightCandidate: ProductionPlanningCandidate,
): number {
  const unresolvedCompare = compareZeroAndDominance(left.unresolvedResources, right.unresolvedResources);
  if (unresolvedCompare !== 0) {
    return unresolvedCompare;
  }
  const unusedCompare = compareZeroAndDominance(left.unusedOutputs, right.unusedOutputs);
  if (unusedCompare !== 0) {
    return unusedCompare;
  }
  const resourceCompare = compareResourceDominance(left.externalResources, right.externalResources);
  if (resourceCompare !== 0) {
    return resourceCompare;
  }
  if (
    leftCandidate.sourceType === "system-recipe"
    && rightCandidate.sourceType === "system-recipe"
    && !areResourceMapsEqual(left.externalResources, right.externalResources)
  ) {
    return leftCandidate.order - rightCandidate.order || leftCandidate.id.localeCompare(rightCandidate.id);
  }
  if (Math.abs(left.depth - right.depth) > EPSILON) {
    return left.depth - right.depth;
  }
  if (Math.abs(left.nodeCount - right.nodeCount) > EPSILON) {
    return left.nodeCount - right.nodeCount;
  }
  const sourceCompare = Number(leftCandidate.sourceType !== "system-recipe")
    - Number(rightCandidate.sourceType !== "system-recipe");
  if (sourceCompare !== 0) {
    return sourceCompare;
  }
  return leftCandidate.order - rightCandidate.order || leftCandidate.id.localeCompare(rightCandidate.id);
}

function areResourceMapsEqual(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean {
  const itemIds = new Set([...left.keys(), ...right.keys()]);
  for (const itemId of itemIds) {
    if (Math.abs((left.get(itemId) ?? 0) - (right.get(itemId) ?? 0)) > EPSILON) {
      return false;
    }
  }
  return true;
}

function compareZeroAndDominance(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): number {
  const leftHasValue = hasPositiveMapValue(left);
  const rightHasValue = hasPositiveMapValue(right);
  if (leftHasValue !== rightHasValue) {
    return leftHasValue ? 1 : -1;
  }
  return compareResourceDominance(left, right);
}

function compareResourceDominance(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): number {
  const itemIds = new Set([...left.keys(), ...right.keys()]);
  let leftStrictlyLower = false;
  let rightStrictlyLower = false;
  for (const itemId of itemIds) {
    const leftValue = left.get(itemId) ?? 0;
    const rightValue = right.get(itemId) ?? 0;
    if (leftValue < rightValue - EPSILON) {
      leftStrictlyLower = true;
    } else if (rightValue < leftValue - EPSILON) {
      rightStrictlyLower = true;
    }
  }
  if (leftStrictlyLower && !rightStrictlyLower) {
    return -1;
  }
  if (rightStrictlyLower && !leftStrictlyLower) {
    return 1;
  }
  return 0;
}

function hasPositiveMapValue(values: ReadonlyMap<string, number>): boolean {
  return Array.from(values.values()).some((value) => value > EPSILON);
}

function createEmptyEstimate(): ProductionPlanningPlanEstimate {
  return {
    externalResources: new Map(),
    unusedOutputs: new Map(),
    unresolvedResources: new Map(),
    depth: 0,
    nodeCount: 0,
  };
}

function createResourceEstimate(itemId: string, perMinute: number): ProductionPlanningPlanEstimate {
  return {
    externalResources: new Map([[itemId, roundFlow(perMinute)]]),
    unusedOutputs: new Map(),
    unresolvedResources: new Map(),
    depth: 0,
    nodeCount: 0,
  };
}

function createUnresolvedEstimate(itemId: string, perMinute: number): ProductionPlanningPlanEstimate {
  return {
    externalResources: new Map(),
    unusedOutputs: new Map(),
    unresolvedResources: new Map([[itemId, roundFlow(perMinute)]]),
    depth: 0,
    nodeCount: 0,
  };
}

function mergeEstimate(
  target: {
    externalResources: Map<string, number>;
    unusedOutputs: Map<string, number>;
    unresolvedResources: Map<string, number>;
    depth: number;
    nodeCount: number;
  },
  source: ProductionPlanningPlanEstimate,
): void {
  for (const [itemId, perMinute] of source.externalResources) {
    addSupply(target.externalResources, itemId, perMinute);
  }
  for (const [itemId, perMinute] of source.unusedOutputs) {
    addSupply(target.unusedOutputs, itemId, perMinute);
  }
  for (const [itemId, perMinute] of source.unresolvedResources) {
    addSupply(target.unresolvedResources, itemId, perMinute);
  }
  target.depth = Math.max(target.depth, source.depth);
  target.nodeCount += source.nodeCount;
}

function subtractEstimateResources(
  target: Map<string, number>,
  source: ReadonlyMap<string, number>,
): void {
  for (const [itemId, perMinute] of source) {
    target.set(itemId, roundFlow((target.get(itemId) ?? 0) - perMinute));
  }
}

function isRawPlantResourceItem(itemId: string): boolean {
  return itemId.startsWith("item_plant_")
    && !itemId.includes("_powder")
    && !itemId.includes("_seed");
}

function consumeAvailableSupply(
  itemId: string,
  demand: number,
  context: SolverContext,
): ProductionPlanningSupplyBreakdown {
  const surplus = consumeSupply(context.surplusSupplyRemaining, itemId, demand);
  const manual = consumeSupply(context.manualSupplyRemaining, itemId, roundFlow(demand - surplus));

  return {
    manual,
    surplus,
    infinite: 0,
    cycle: 0,
  };
}

function consumeSupply(source: Map<string, number>, itemId: string, demand: number): number {
  if (demand <= EPSILON) {
    return 0;
  }

  const available = source.get(itemId) ?? 0;
  const used = Math.min(available, demand);
  if (used <= EPSILON) {
    return 0;
  }

  const remaining = roundFlow(available - used);
  if (remaining <= EPSILON) {
    source.delete(itemId);
  } else {
    source.set(itemId, remaining);
  }

  return roundFlow(used);
}

function buildSupplyMap(supplies: readonly ProductionPlanningPort[]): Map<string, number> {
  const result = new Map<string, number>();

  for (const supply of supplies) {
    if (supply.itemId.length > 0 && supply.perMinute > EPSILON && supply.isInfinite !== true) {
      addSupply(result, supply.itemId, supply.perMinute);
    }
  }

  return result;
}

function buildInfiniteItemIds(
  baseItemIds: ReadonlySet<string>,
  supplies: readonly ProductionPlanningPort[],
): ReadonlySet<string> {
  const result = new Set(baseItemIds);

  for (const supply of supplies) {
    if (supply.itemId.length > 0 && supply.isInfinite === true) {
      result.add(supply.itemId);
    }
  }

  return result;
}

function addSupply(source: Map<string, number>, itemId: string, amount: number) {
  source.set(itemId, roundFlow((source.get(itemId) ?? 0) + amount));
}

function aggregateItemTotals(
  roots: readonly ProductionPlanningItemNode[],
  recipeNodes: readonly ProductionPlanningRecipeNode[],
  index: ProductionPlanningIndex,
): ProductionPlanningItemTotal[] {
  const totals = new Map<string, ProductionPlanningItemTotal>();
  for (const node of flattenProductionPlanningItemNodes(roots)) {
    const total = ensureItemTotal(totals, node.itemId);
    total.demandPerMinute = roundFlow(total.demandPerMinute + node.demandPerMinute);
    total.suppliedPerMinute = roundFlow(total.suppliedPerMinute + node.suppliedPerMinute);
    total.unresolvedPerMinute = roundFlow(total.unresolvedPerMinute + node.unresolvedPerMinute);
  }

  for (const recipe of recipeNodes) {
    for (const output of recipe.outputs) {
      const total = ensureItemTotal(totals, output.itemId);
      total.producedPerMinute = roundFlow(total.producedPerMinute + output.perMinute);
    }
  }

  return sortItemTotals(Array.from(totals.values()), index);
}

function aggregateRecipeTotals(
  recipeNodes: readonly ProductionPlanningRecipeNode[],
  index: ProductionPlanningIndex,
  roots: readonly ProductionPlanningItemNode[],
): ProductionPlanningRecipeTotal[] {
  const totals = new Map<string, ProductionPlanningRecipeTotal>();

  for (const node of recipeNodes) {
    const total = totals.get(node.candidateId);
    if (total === undefined) {
      totals.set(node.candidateId, {
        candidateId: node.candidateId,
        candidateSourceType: node.candidateSourceType,
        module: node.module,
        recipeId: node.recipeId,
        durationSeconds: node.durationSeconds,
        cyclesPerMinute: node.cyclesPerMinute,
        deviceCount: node.deviceCount,
        inputs: node.inputs.map(clonePort),
        deviceMinimumConsumptionInputs: node.deviceMinimumConsumptionInputs.map(clonePort),
        outputs: node.outputs.map(clonePort),
      });
      continue;
    }

    total.cyclesPerMinute += node.cyclesPerMinute;
    total.deviceCount = roundFlow(total.deviceCount + node.deviceCount);
    total.inputs = mergePorts(total.inputs, node.inputs);
    total.deviceMinimumConsumptionInputs = mergePorts(
      total.deviceMinimumConsumptionInputs,
      node.deviceMinimumConsumptionInputs,
    );
    total.outputs = mergePorts(total.outputs, node.outputs);
  }

  mergeSharedPlantDeviceCounts(totals, recipeNodes, roots, index);

  return Array.from(totals.values()).sort((left, right) => {
    const leftRecipe = left.candidateSourceType === "system-recipe" && left.recipeId !== null
      ? index.recipeById.get(left.recipeId)
      : undefined;
    const rightRecipe = right.candidateSourceType === "system-recipe" && right.recipeId !== null
      ? index.recipeById.get(right.recipeId)
      : undefined;
    const leftMachine = leftRecipe?.machineId ?? left.module?.name ?? left.candidateId;
    const rightMachine = rightRecipe?.machineId ?? right.module?.name ?? right.candidateId;
    return leftMachine.localeCompare(rightMachine) || left.candidateId.localeCompare(right.candidateId);
  });
}

/** 同配方的共享支路先合并连续流量，再计算不能线性相加的离散设备下限。 */
function mergeSharedPlantDeviceCounts(
  totals: ReadonlyMap<string, ProductionPlanningRecipeTotal>,
  recipeNodes: readonly ProductionPlanningRecipeNode[],
  roots: readonly ProductionPlanningItemNode[],
  index: ProductionPlanningIndex,
): void {
  const flows = new Map<string, number>();
  const key = (source: string, target: string, itemId: string) => `${source}\0${target}\0${itemId}`;
  const visit = (node: ProductionPlanningItemNode, parent: ProductionPlanningRecipeNode | undefined,
    ancestors: readonly ProductionPlanningItemNode[]): void => {
    // 回流引用指向本条祖先链中的生产者；有限外供和普通外供循环不计入内部回流。
    const producer = node.recipeNode ?? (node.isCycleSource
      ? [...ancestors].reverse().find(entry => entry.itemId === node.itemId)?.recipeNode : undefined);
    const amount = node.recipeNode ? node.producedPerMinute : node.isCycleSource
      ? Math.max(0, node.demandPerMinute - node.suppliedPerMinute) : 0;
    if (producer && parent && amount > EPSILON) {
      const id = key(producer.candidateId, parent.candidateId, node.itemId);
      flows.set(id, (flows.get(id) ?? 0) + amount);
    }
    if (node.recipeNode) for (const input of [...node.recipeNode.inputItems, ...node.recipeNode.deviceMinimumConsumptionItems]) {
      visit(input, node.recipeNode, [...ancestors, node]);
    }
  };
  for (const root of roots) visit(root, undefined, []);
  for (const total of totals.values()) {
    const recipe = total.recipeId === null ? undefined : index.recipeById.get(total.recipeId);
    if (!recipe || !isPlantCycleRecipe(recipe) || recipe.machineId === "seedcol_1") continue;
    const branches = recipeNodes.filter(node => node.candidateId === total.candidateId);
    if (branches.length < 2) continue;
    let count = total.cyclesPerMinute * recipe.durationSeconds / 60;
    for (const output of recipe.outputs) {
      const partners = [...totals.values()].flatMap(partner => {
        const definition = partner.recipeId === null ? undefined : index.recipeById.get(partner.recipeId);
        const feedback = definition?.inputs.find(input => input.itemId === output.itemId);
        if (!definition || !feedback) return [];
        const amount = flows.get(key(total.candidateId, partner.candidateId, output.itemId)) ?? 0;
        const rate = balanceProductivePlantCycle({ recipe, partnerRecipe: definition, itemId: output.itemId,
          externalDemand: 0, availablePartnerSupply: 0, existingCyclesPerMinute: total.cyclesPerMinute,
          existingPartnerCyclesPerMinute: amount / feedback.amount });
        return amount > EPSILON && rate && rate.minimumDeviceCount > 0 ? [{ definition, feedback, amount }] : [];
      });
      const first = partners[0];
      if (!first) continue;
      const feedback = partners.reduce((sum, partner) => sum + partner.amount, 0);
      const rate = balanceProductivePlantCycle({ recipe, partnerRecipe: first.definition, itemId: output.itemId,
        externalDemand: 0, availablePartnerSupply: 0, existingCyclesPerMinute: total.cyclesPerMinute,
        existingPartnerCyclesPerMinute: feedback / first.feedback.amount })!;
      count = Math.max(count, rate.minimumDeviceCount);
    }
    count = roundFlow(count);
    if (Math.abs(count - total.deviceCount) <= EPSILON) continue;
    total.deviceCount = count;
    // 树节点保留各自流量，设备数改为共享总产能的占比，避免流程图仍累加旧支路台数。
    let remaining = count;
    branches.forEach((node, branch) => {
      node.deviceCount = branch === branches.length - 1 ? remaining
        : Math.min(remaining, roundFlow(count * node.cyclesPerMinute / total.cyclesPerMinute));
      remaining = roundFlow(remaining - node.deviceCount);
    });
  }
}

function ensureItemTotal(
  totals: Map<string, ProductionPlanningItemTotal>,
  itemId: string,
): ProductionPlanningItemTotal {
  const existing = totals.get(itemId);
  if (existing !== undefined) {
    return existing;
  }

  const total = {
    itemId,
    demandPerMinute: 0,
    suppliedPerMinute: 0,
    producedPerMinute: 0,
    unresolvedPerMinute: 0,
    isByproduct: false,
  };
  totals.set(itemId, total);
  return total;
}

function mergePorts(
  left: readonly ProductionPlanningPort[],
  right: readonly ProductionPlanningPort[],
): ProductionPlanningPort[] {
  const totals = new Map<string, number>();

  for (const port of [...left, ...right]) {
    totals.set(port.itemId, roundFlow((totals.get(port.itemId) ?? 0) + port.perMinute));
  }

  return Array.from(totals.entries()).map(([itemId, perMinute]) => ({
    id: itemId,
    itemId,
    perMinute,
  }));
}

function sortItemTotals(
  totals: ProductionPlanningItemTotal[],
  index: ProductionPlanningIndex,
): ProductionPlanningItemTotal[] {
  return totals.sort((left, right) => {
    const missingCompare = right.unresolvedPerMinute - left.unresolvedPerMinute;
    if (Math.abs(missingCompare) > EPSILON) {
      return missingCompare;
    }

    const demandCompare = right.demandPerMinute - left.demandPerMinute;
    if (Math.abs(demandCompare) > EPSILON) {
      return demandCompare;
    }

    const leftName = index.itemById.get(left.itemId)?.nameKey ?? left.itemId;
    const rightName = index.itemById.get(right.itemId)?.nameKey ?? right.itemId;
    return leftName.localeCompare(rightName);
  });
}

function clonePort(port: ProductionPlanningPort): ProductionPlanningPort {
  return {
    id: port.id,
    itemId: port.itemId,
    perMinute: port.perMinute,
    ...(port.isInfinite === true ? { isInfinite: true } : {}),
  };
}

function collectProductionPlanningByproductItemIds(context: SolverContext): Set<string> {
  const result = new Set<string>();

  for (const [itemId, perMinute] of context.surplusSupplyRemaining) {
    if (perMinute > EPSILON) {
      result.add(itemId);
    }
  }

  for (const [itemId, perMinute] of context.dumperAmounts) {
    if (perMinute > EPSILON) {
      result.add(itemId);
    }
  }

  return result;
}

function collectProductionPlanningOverflowItems(
  context: SolverContext,
  index: ProductionPlanningIndex,
): ProductionPlanningPort[] {
  const totals = new Map(context.surplusSupplyRemaining);

  for (const [itemId, perMinute] of context.dumperAmounts) {
    // “使用副产物”策略会把最终剩余量同时登记到 surplus 与 dumper；
    // 这里取较大值，既保留直接倾倒的产出，也避免重复计算同一份溢出。
    totals.set(itemId, Math.max(totals.get(itemId) ?? 0, perMinute));
  }

  return Array.from(totals.entries())
    .filter(([, perMinute]) => perMinute > EPSILON)
    .sort(([leftItemId], [rightItemId]) => {
      const leftName = index.itemById.get(leftItemId)?.nameKey ?? leftItemId;
      const rightName = index.itemById.get(rightItemId)?.nameKey ?? rightItemId;
      return leftName.localeCompare(rightName);
    })
    .map(([itemId, perMinute]) => ({
      id: `overflow-${itemId}`,
      itemId,
      perMinute: roundFlow(perMinute),
    }));
}

function isNaturalResourceItem(item: ItemDefinition): boolean {
  return item.tags.includes("自然资源");
}

function isByproductItemDumpMode(
  itemId: string,
  config: ProductionPlanningSourceConfig,
): boolean {
  if (itemId === "item_liquid_water") {
    return config.waterPolicy === "dump-byproduct";
  }
  if (itemId === "item_liquid_acid") {
    return config.acidPolicy === "dump-byproduct";
  }
  return false;
}

const DUMPER_RECIPE_MAP: Record<string, { recipeId: string; durationSeconds: number; inputAmount: number }> = {
  "item_liquid_water": { recipeId: "r_dumper_void_liquid_water_basic", durationSeconds: 0.5, inputAmount: 1 },
  "item_liquid_acid": { recipeId: "r_dumper_void_liquid_acid_basic", durationSeconds: 0.5, inputAmount: 1 },
};

const WASTE_TREATMENT_RECIPE_MAP: Record<string, { recipeId: string; durationSeconds: number; inputAmount: number }> = {
  "item_liquid_sewage": { recipeId: "r_chrono_wastewater_treatment_void_wastewater_basic", durationSeconds: 2, inputAmount: 1 },
  "item_liquid_xiranite_poly": { recipeId: "r_chrono_wastewater_treatment_void_xiranite_waste_liquid_basic", durationSeconds: 2, inputAmount: 1 },
  "item_liquid_xiranite_lowpoly": { recipeId: "r_chrono_wastewater_treatment_void_inert_xiranite_waste_liquid_basic", durationSeconds: 2, inputAmount: 1 },
};

function buildDumperRecipeNodes(context: SolverContext): ProductionPlanningRecipeNode[] {
  const nodes: ProductionPlanningRecipeNode[] = [];

  for (const [itemId, perMinute] of context.dumperAmounts) {
    if (perMinute <= EPSILON) {
      continue;
    }

    const dumperDef = DUMPER_RECIPE_MAP[itemId];
    if (dumperDef === undefined) {
      continue;
    }

    const recipe = context.index.recipeById.get(dumperDef.recipeId);
    if (recipe === undefined) {
      continue;
    }

    const cyclesPerMinute = roundFlow(perMinute / dumperDef.inputAmount);
    const deviceCount = roundFlow(cyclesPerMinute / (60 / dumperDef.durationSeconds));

    nodes.push({
      id: createNodeId("recipe", context),
      kind: "recipe",
      candidateId: createProductionPlanningRecipeCandidateId(dumperDef.recipeId),
      candidateSourceType: "system-recipe",
      module: null,
      recipeId: dumperDef.recipeId,
      targetItemId: itemId,
      durationSeconds: dumperDef.durationSeconds,
      cyclesPerMinute,
      deviceCount,
      inputs: [{ id: `${dumperDef.recipeId}-in-${itemId}`, itemId, perMinute }],
      deviceMinimumConsumptionInputs: [],
      outputs: [],
      inputItems: [],
      deviceMinimumConsumptionItems: [],
    });
  }

  return nodes;
}

function buildWasteTreatmentRecipeNodes(context: SolverContext): ProductionPlanningRecipeNode[] {
  const nodes: ProductionPlanningRecipeNode[] = [];

  for (const [itemId, perMinute] of context.surplusSupplyRemaining) {
    if (perMinute <= EPSILON) {
      continue;
    }

    const treatmentDef = WASTE_TREATMENT_RECIPE_MAP[itemId];
    if (treatmentDef === undefined) {
      continue;
    }

    const recipe = context.index.recipeById.get(treatmentDef.recipeId);
    if (recipe === undefined) {
      continue;
    }

    const cyclesPerMinute = roundFlow(perMinute / treatmentDef.inputAmount);
    const deviceCount = roundFlow(cyclesPerMinute / (60 / treatmentDef.durationSeconds));

    nodes.push({
      id: createNodeId("waste-treatment", context),
      kind: "recipe",
      candidateId: createProductionPlanningRecipeCandidateId(treatmentDef.recipeId),
      candidateSourceType: "system-recipe",
      module: null,
      recipeId: treatmentDef.recipeId,
      targetItemId: itemId,
      durationSeconds: treatmentDef.durationSeconds,
      cyclesPerMinute,
      deviceCount,
      inputs: [{ id: `${treatmentDef.recipeId}-in-${itemId}`, itemId, perMinute }],
      deviceMinimumConsumptionInputs: [],
      outputs: [],
      inputItems: [],
      deviceMinimumConsumptionItems: [],
    });
  }

  return nodes;
}

function buildWaterPurifierRecipeNodes(
  context: SolverContext,
  requestedOutputPerMinute: number,
): ProductionPlanningRecipeNode[] {
  if (requestedOutputPerMinute <= EPSILON) {
    return [];
  }

  const recipe = context.index.recipeById.get(WATER_PURIFIER_BYPRODUCT_RECIPE_ID);
  if (recipe === undefined) {
    return [];
  }

  const requestedSewagePerMinute = roundFlow(
    requestedOutputPerMinute * WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT,
  );
  // 壤晶废液按四位精度求解后再乘 30 会留下低于一个输出精度单位的伪污水；
  // 仅在未触及 360/min 上限时闭合这部分量化余量，真实的超限污水仍进入废水处理。
  const availableSewagePerMinute = context.surplusSupplyRemaining.get("item_liquid_sewage") ?? 0;
  const remainingSewagePerMinute = roundFlow(availableSewagePerMinute - requestedSewagePerMinute);
  const maximumSewagePerMinute = WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE
    * WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT;
  const sewageQuantizationTolerance = WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT * EPSILON;
  const sewageDemandPerMinute = availableSewagePerMinute <= maximumSewagePerMinute
    && remainingSewagePerMinute > EPSILON
    && remainingSewagePerMinute < sewageQuantizationTolerance
    ? availableSewagePerMinute
    : requestedSewagePerMinute;
  const sewagePerMinute = consumeSupply(
    context.surplusSupplyRemaining,
    "item_liquid_sewage",
    sewageDemandPerMinute,
  );
  const outputPerMinute = roundFlow(sewagePerMinute / WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT);
  if (outputPerMinute <= EPSILON) {
    return [];
  }

  const recipeOutputAmount = recipe.outputs.find(
    (output) => output.itemId === WATER_PURIFIER_OUTPUT_ITEM_ID,
  )?.amount ?? 1;
  const cyclesPerMinute = roundFlow(outputPerMinute / recipeOutputAmount);

  return [{
    id: createNodeId("water-purifier", context),
    kind: "recipe",
    candidateId: createProductionPlanningRecipeCandidateId(recipe.id),
    candidateSourceType: "system-recipe",
    module: null,
    recipeId: recipe.id,
    targetItemId: WATER_PURIFIER_OUTPUT_ITEM_ID,
    durationSeconds: recipe.durationSeconds,
    cyclesPerMinute,
    deviceCount: roundFlow(outputPerMinute / WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE),
    inputs: [{
      id: `${recipe.id}-in-item_liquid_sewage`,
      itemId: "item_liquid_sewage",
      perMinute: sewagePerMinute,
    }],
    deviceMinimumConsumptionInputs: [],
    outputs: [{
      id: `${recipe.id}-out-${WATER_PURIFIER_OUTPUT_ITEM_ID}`,
      itemId: WATER_PURIFIER_OUTPUT_ITEM_ID,
      perMinute: outputPerMinute,
    }],
    inputItems: [],
    deviceMinimumConsumptionItems: [],
  }];
}

function resolveReplaceableWaterPurifierOutputPerMinute(
  result: ProductionPlanningResult,
): number {
  return roundFlow(flattenProductionPlanningItemNodes(result.roots)
    .filter((node) => node.itemId === WATER_PURIFIER_OUTPUT_ITEM_ID)
    .reduce((sum, node) => sum + node.producedPerMinute + node.unresolvedPerMinute, 0));
}

function resolveWasteTreatmentInputPerMinute(
  result: ProductionPlanningResult,
  itemId: string,
): number {
  const treatmentRecipeId = WASTE_TREATMENT_RECIPE_MAP[itemId]?.recipeId;
  if (treatmentRecipeId === undefined) {
    return 0;
  }

  const treatment = result.recipeTotals.find((total) => total.recipeId === treatmentRecipeId);
  return treatment?.inputs.find((input) => input.itemId === itemId)?.perMinute ?? 0;
}

function resolveRecipeOutputPerMinute(
  result: ProductionPlanningResult,
  recipeId: string,
  itemId: string,
): number {
  const recipe = result.recipeTotals.find((total) => total.recipeId === recipeId);
  return recipe?.outputs.find((output) => output.itemId === itemId)?.perMinute ?? 0;
}


function createNodeId(prefix: string, context: SolverContext): string {
  context.nextNodeIndex += 1;
  return `${prefix}-${context.nextNodeIndex}`;
}

function roundFlow(value: number): number {
  if (Math.abs(value) < EPSILON) {
    return 0;
  }

  return Math.round(value * 10000) / 10000;
}
