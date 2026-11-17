import { runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { applyAdmissionItemToEntity } from "@/app/shell/inspector/admission-rule-inspector";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { ProductionFlowNode } from "@/app/shell/production-planning/flow/flow-graph-builder";
import {
  PanelPlacementDrag,
  resolveDevicePlacementTarget,
  type PanelPlacementTarget,
} from "@/app/shell/shared/panel-placement-drag";

/**
 * 配方树/流程图节点的快捷操作。
 *
 * 配方写入与属性面板配方磁贴一致：channelRecipes[首个生产频道]；可切换模式的设备同时切到手动，
 * 与自动规划（EDA）生成的设备配置保持一致。
 */

function resolveProductionChannelId(definition: EntityDefinition): string | null {
  return definition.recipeChannels.find((channel) => channel.type !== "consumption-channel")?.id ?? null;
}

function createRecipeConfig(definition: EntityDefinition, recipe: RecipeDefinition): Record<string, unknown> | null {
  const channelId = resolveProductionChannelId(definition);
  if (channelId === null) {
    return null;
  }

  const config: Record<string, unknown> = { channelRecipes: { [channelId]: recipe.id } };
  const automaticModeConfigKey = definition.recipeChannelBehavior?.automaticModeConfigKey;
  if (automaticModeConfigKey !== undefined) {
    config[automaticModeConfigKey] = false;
  }
  return config;
}

/** 该配方的拖出放置目标：配方所用设备，放下时带上该配方。 */
export function resolveRecipePlacementTarget(appHost: AppHost, recipe: RecipeDefinition): PanelPlacementTarget | null {
  const definition = appHost.workspace.registry.queries.findEntityDefinition(recipe.machineId);
  return definition === null ? null : resolveDevicePlacementTarget(appHost, definition.id, createRecipeConfig(definition, recipe));
}

/**
 * 原料的拖出放置目标：本基地可用的仓库取货设备里第一个能取这种物品的，放下即链接到该物品。
 * 没有能取它的设备时为 null。
 */
export function resolveItemSupplyPlacementTarget(appHost: AppHost, itemId: string): PanelPlacementTarget | null {
  const registry = appHost.workspace.registry;
  const domain = registry.queries.resolveItemDomain(itemId);
  if (domain === null) {
    return null;
  }
  const device = registry.entityDefinitions
    .filter((definition) => definition.uiGroup === "warehouse"
      && canPlaceEntityDefinitionInCurrentBase(appHost.mainCanvas, definition)
      && definition.inspectors.some((inspector) => inspector.type === INSPECTOR_TYPE.warehouseItemLink
        && inspector.slotGroupIds.some((groupId) =>
          ((definition.storageSlotGroups.find((group) => group.id === groupId)?.kind ?? 0) & domain) !== 0)))
    .sort((left, right) => left.displayOrder - right.displayOrder)[0];
  const target = device === undefined ? null : resolveDevicePlacementTarget(appHost, device.id);
  return target === null ? null : { ...target, warehouseItemId: itemId };
}

/** 流程图卡片拖出流程图时：有配方的卡片放下带该配方的设备，外部供给卡片放下链接该物品的取货设备。 */
export function createFlowNodePlacementDrag(appHost: AppHost, node: ProductionFlowNode): PanelPlacementDrag | null {
  const recipeId = node.recipeId ?? node.recipeNode?.recipeId ?? null;
  const recipe = recipeId === null ? null : appHost.workspace.registry.queries.findRecipeDefinition(recipeId);
  const target = recipe !== null
    ? resolveRecipePlacementTarget(appHost, recipe)
    : node.tone === "source" && node.itemId !== undefined ? resolveItemSupplyPlacementTarget(appHost, node.itemId) : null;
  return target === null ? null : new PanelPlacementDrag(appHost, target);
}

/** 进入该配方设备的放置模式，放下的设备自动带上该配方。返回是否成功进入放置。 */
export function startPlacementWithRecipe(appHost: AppHost, recipe: RecipeDefinition): boolean {
  const target = resolveRecipePlacementTarget(appHost, recipe);
  if (target === null) {
    return false;
  }

  runInAction(() => {
    appHost.mainCanvas.state.runtime.singlePlacementConfig = target.config;
    appHost.mainCanvas.state.runtime.singlePlacementWarehouseItemId = null;
    appHost.mainCanvas.state.runtime.singlePlacementRotation = null;
  });
  appHost.gestureAdapter.handleUiButtonMouseTap({
    uiButtonId: `ui-left-dock-placement-mode-${target.deviceId}-mouse-tap`,
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  });

  const runtime = appHost.mainCanvas.state.runtime;
  return appHost.mainCanvas.state.activeTool === "single-placement" && runtime.singlePlacementDeviceId === target.deviceId;
}

function readChannelRecipeIds(entity: WorldEntity): readonly string[] {
  const channelRecipes = entity.config.channelRecipes;
  if (typeof channelRecipes !== "object" || channelRecipes === null) {
    return [];
  }
  return Object.values(channelRecipes as Record<string, unknown>).filter((value): value is string => typeof value === "string");
}

/**
 * 选中画布上该配方的设备：优先已设定该配方的设备；没有时选中全部同型设备。
 * 返回选中数量。
 */
export function selectFacilitiesForRecipe(appHost: AppHost, recipe: RecipeDefinition): number {
  const editor = appHost.workspace.editor;
  if (editor === null) {
    return 0;
  }

  const sameMachine = editor.queries.listEntities().filter((entity) => entity.definitionId === recipe.machineId);
  const withRecipe = sameMachine.filter((entity) => readChannelRecipeIds(entity).includes(recipe.id));
  const targets = withRecipe.length > 0 ? withRecipe : sameMachine;
  replaceSelection(appHost, targets.map((entity) => entity.id));
  return targets.length;
}

/** 选中画布上消费或输出该物品的准入口（已设定为该物品的物品准入/管道准入）。 */
export function selectAdmissionsForItem(appHost: AppHost, itemId: string): number {
  const editor = appHost.workspace.editor;
  if (editor === null) {
    return 0;
  }

  const targets = editor.queries.listEntities().filter((entity) => Object.entries(entity.config).some(([key, value]) => (
    key.endsWith(".admissionRule")
    && typeof value === "object"
    && value !== null
    && (value as { itemId?: unknown }).itemId === itemId
  )));
  replaceSelection(appHost, targets.map((entity) => entity.id));
  return targets.length;
}

/** 把配方写入当前选中的同型设备；返回写入数量。 */
export function applyRecipeToSelection(appHost: AppHost, recipe: RecipeDefinition): number {
  const editor = appHost.workspace.editor;
  const definition = appHost.workspace.registry.queries.findEntityDefinition(recipe.machineId);
  if (editor === null || definition === null) {
    return 0;
  }

  const config = createRecipeConfig(definition, recipe);
  if (config === null) {
    return 0;
  }

  let applied = 0;
  for (const entityId of editor.state.collections.selection) {
    const entity = editor.queries.getEntityById(entityId);
    if (entity?.definitionId !== recipe.machineId) {
      continue;
    }
    editor.actions.patchEntityConfig(entityId, config);
    applied += 1;
  }
  return applied;
}

/** 把物品设为当前选中准入口（物品准入/管道准入）的准入物品；返回写入设备数。 */
export function applyItemToSelectedAdmissions(appHost: AppHost, itemId: string): number {
  const editor = appHost.workspace.editor;
  const item = appHost.workspace.registry.queries.findItemDefinition(itemId);
  if (editor === null || item === null) {
    return 0;
  }

  let applied = 0;
  for (const entityId of editor.state.collections.selection) {
    const entity = editor.queries.getEntityById(entityId);
    if (entity !== null && applyAdmissionItemToEntity({ appHost, entity, item }) > 0) {
      applied += 1;
    }
  }
  return applied;
}

/** 当前选中实体中，类型与配方设备相同的数量（用于决定是否显示“设为所选设备的配方”）。 */
export function countSelectedMachines(appHost: AppHost, machineId: string): number {
  const editor = appHost.workspace.editor;
  if (editor === null) {
    return 0;
  }
  return editor.state.collections.selection
    .filter((entityId) => editor.queries.getEntityById(entityId)?.definitionId === machineId)
    .length;
}

/** 当前选中实体中带物品准入口的设备数量。 */
export function countSelectedAdmissions(appHost: AppHost): number {
  const editor = appHost.workspace.editor;
  if (editor === null) {
    return 0;
  }
  return editor.state.collections.selection.filter((entityId) => {
    const entity = editor.queries.getEntityById(entityId);
    const definition = entity === null ? null : appHost.workspace.registry.queries.findEntityDefinition(entity.definitionId);
    return definition?.inspectors.some((declaration) => declaration.type === INSPECTOR_TYPE.admissionRule) === true;
  }).length;
}

function replaceSelection(appHost: AppHost, entityIds: readonly string[]): void {
  const editor = appHost.workspace.editor;
  if (editor === null) {
    return;
  }

  editor.actions.clearCollection(EntityCollectionType.selection);
  for (const entityId of entityIds) {
    editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  }
  if (entityIds.length > 0 && !appHost.state.workbench.rightDockOpen) {
    appHost.internalActions.setRightDockOpen(true, { preserveSingleSelection: true });
  }
}
