import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";

/** 只将明确链接到输出槽组的仓库物品作为供给标签，不从任意缓存猜测配置。 */
export function configuredDeviceItemIds(definition: EntityDefinition, entityId: string,
  document: Pick<WorldDocument, "slotLinks">, registry: RegistryContract): readonly string[] {
  const outputs = new Set(definition.portGroups.filter(group => group.direction === "output").map(group => group.id));
  const outputGroups = new Set(definition.portStorageBindings.filter(binding => outputs.has(binding.portGroupId)).map(binding => binding.storageSlotGroupId));
  const groups = new Set(definition.inspectors.flatMap(inspector => inspector.type === "warehouse-item-link" ? inspector.slotGroupIds : []));
  return [...new Set(document.slotLinks.filter(link => link.source.entityId === entityId && link.target.entityId === "warehouse"
    && groups.has(link.source.storageSlotGroupId) && outputGroups.has(link.source.storageSlotGroupId)).map(link => link.target.slotId))].filter(id => registry.queries.findItemDefinition(id) !== null);
}

/**
 * 设备已选（手动或计划）配方的主要产物，用于非运行状态下的画布标签。
 * channelRecipes 由属性面板配方磁贴或自动规划写入；运输类“same-as-input”配方无固定产物，跳过。
 */
export function selectedRecipeDeviceItemIds(entity: Pick<WorldEntity, "config"> | null,
  registry: RegistryContract, channelIds: ReadonlySet<string> | null = null): readonly string[] {
  const channelRecipes = entity?.config?.channelRecipes;
  if (typeof channelRecipes !== "object" || channelRecipes === null) return [];
  const items = new Set<string>();
  for (const [channelId, recipeId] of Object.entries(channelRecipes as Record<string, unknown>)) {
    if (typeof recipeId !== "string" || (channelIds !== null && !channelIds.has(channelId))) continue;
    const recipe = registry.queries.findRecipeDefinition(recipeId);
    for (const id of recipe?.primaryOutputs ?? []) if (registry.queries.findItemDefinition(id)) items.add(id);
  }
  return [...items];
}

/** 输出端口组设定的出口物品（端口接收规则改为指定物品）；未设定时为 null。 */
export function configuredOutputPortItemId(definition: EntityDefinition, entity: Pick<WorldEntity, "config">,
  portGroupId: string): string | null {
  const groupIndex = definition.portGroups.findIndex(group => group.id === portGroupId);
  const rule = groupIndex < 0 ? undefined : entity.config[`portGroups[${groupIndex}].ports[0].acceptRule`];
  const base = typeof rule === "object" && rule !== null ? (rule as { base?: unknown }).base : undefined;
  return typeof base === "object" && base !== null && (base as { kind?: unknown }).kind === "item"
    && typeof (base as { itemId?: unknown }).itemId === "string" ? (base as { itemId: string }).itemId : null;
}

/**
 * 某个输出端口运送的物品：端口设定了出口物品时取设定；否则取把产物写入该端口所绑定存储组的频道上
 * 已选配方的主要产物，并按端口的物品域过滤。
 */
export function outputPortItemIds(definition: EntityDefinition, entity: Pick<WorldEntity, "config">,
  portGroupId: string, registry: RegistryContract): readonly string[] {
  const group = definition.portGroups.find(entry => entry.id === portGroupId);
  if (group === undefined) return [];
  const configured = configuredOutputPortItemId(definition, entity, portGroupId);
  if (configured !== null) return registry.queries.findItemDefinition(configured) ? [configured] : [];
  const storageGroupIds = new Set(definition.portStorageBindings.filter(binding => binding.portGroupId === portGroupId)
    .map(binding => binding.storageSlotGroupId));
  const channelIds = new Set(definition.recipeChannels.filter(channel => storageGroupIds.size === 0
    || channel.productStorageGroupIds.some(id => storageGroupIds.has(id))).map(channel => channel.id));
  return selectedRecipeDeviceItemIds(entity, registry, channelIds)
    .filter(id => ((registry.queries.resolveItemDomain(id) ?? 0) & group.kind) !== 0);
}

/** 运输配方的占位产物取实际输出槽物品，只有真实运行通道可以提供此标签。 */
export function runningDeviceItemIds(definition: EntityDefinition, status: SimulationDeviceRuntimeStatusReadModel,
  registry: RegistryContract): readonly string[] {
  const items = new Set<string>();
  for (const channel of Object.values(status.channelRecipes)) {
    if (!channel?.recipeId || channel.state !== "running" && channel.state !== "waiting-output") continue;
    const recipe = registry.queries.findRecipeDefinition(channel.recipeId);
    for (const id of recipe?.primaryOutputs ?? []) if (registry.queries.findItemDefinition(id)) items.add(id);
    if (!recipe?.outputs.some(flow => flow.itemId === "same-as-input")) continue;
    const groups = definition.recipeChannels.find(entry => entry.id === channel.channelId)?.productStorageGroupIds ?? [];
    for (const slot of status.slotItems) if (groups.includes(slot.storageGroupId) && slot.itemType
      && (slot.count > 0 || slot.reserved > 0) && registry.queries.findItemDefinition(slot.itemType)) items.add(slot.itemType);
  }
  return [...items];
}

export function deviceLabelEntityId(entity: WorldEntity | null, fallback: string): string {
  return entity && "originalEntityId" in entity && typeof entity.originalEntityId === "string" ? entity.originalEntityId : fallback;
}
