import type {
  ProductionPlanningDisplayMode,
  ProductionPlanningIndex,
  ProductionPlanningRecipeNode,
  ProductionPlanningResult,
} from "../production-planning-model";
import {
  formatProductionDeviceCount,
  formatProductionFlow,
  isWasteTreatmentItem,
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  resolveProductionPlanningModuleIconSrcs,
} from "../production-planning-model";
import {
  buildProductionPlanningLedgerRows,
  isProductionPlanningDeviceMinimumConsumptionRecipeId,
  isProductionPlanningDisposalRecipeId,
  isProductionPlanningExternalSupplyRecipeId,
  resolveProductionPlanningDeviceMinimumConsumptionHostRecipeId,
  resolveProductionPlanningRecipeInputPorts,
  type ProductionPlanningLedgerRow,
} from "../production-planning-ledger";
import { createEntityIconAssetUrl, createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import type { SankeyInputLink, SankeyInputNode } from "./sankey-layout";

export type ProductionFlowNodeKind = "item" | "recipe";
export type ProductionFlowNodeTone = "normal" | "source" | "cycle" | "unresolved" | "byproduct";
export type ProductionFlowLinkNodeSide = "left" | "right";

export interface ProductionFlowNode extends SankeyInputNode {
  readonly kind: ProductionFlowNodeKind;
  readonly tone: ProductionFlowNodeTone;
  readonly title: string;
  readonly subtitle: string;
  /** 节点自身产物（处置类为处置量）的速率，卡片上单独强调显示。 */
  readonly rate?: string;
  /** 不带单位的速率数值，总览简化卡片只显示数字。 */
  readonly rateValue?: string;
  /** 设备数（“×N”），卡片上常驻显示，不随副标题截断。 */
  readonly machineCount?: string;
  /** 物品模式下生产该物品的设备图标。 */
  readonly machineIconSrc?: string;
  readonly iconSrcs: readonly string[];
  readonly itemId?: string;
  readonly recipeId?: string;
  readonly isTransient?: boolean;
  /** 规划目标的产出节点，流程图中加以强调。 */
  readonly isTarget?: boolean;
  readonly ledgerRow?: ProductionPlanningLedgerRow;
  readonly recipeNode?: ProductionPlanningRecipeNode;
}

export interface ProductionFlowLink extends SankeyInputLink {
  readonly itemId: string;
  readonly title: string;
  readonly label: string;
  readonly iconSrc?: string;
  readonly isDeviceMinimumConsumption: boolean;
  readonly sourceSide?: ProductionFlowLinkNodeSide;
  readonly targetSide?: ProductionFlowLinkNodeSide;
}

export interface ProductionFlowGraphInput {
  readonly nodes: ProductionFlowNode[];
  readonly links: ProductionFlowLink[];
}

interface LedgerBuildContext {
  readonly displayMode: ProductionPlanningDisplayMode;
  readonly index: ProductionPlanningIndex;
  readonly plan: ProductionPlanningResult;
  readonly translate: (key: string) => string;
  readonly targetItemIds: ReadonlySet<string>;
  readonly nodes: Map<string, ProductionFlowNode>;
  readonly links: Map<string, ProductionFlowLink>;
}

interface ItemFlowEndpoint {
  readonly itemId: string;
  readonly nodeId: string;
  readonly row: ProductionPlanningLedgerRow;
  readonly value: number;
  readonly isDeviceMinimumConsumption: boolean;
}

const FLOW_EPSILON = 0.0001;
const EXTERNAL_SUPPLY_ENTITY_ICON_SRC = createPublicAssetUrl("3d-top-view/sprites/item_port_sp_hub_1.webp");
const PLANTER_MACHINE_IDS = new Set(["planter_1", "planter_1_liquid"]);
const SEED_COLLECTOR_MACHINE_IDS = new Set(["seedcol_1"]);

export function buildProductionFlowGraph(
  plan: ProductionPlanningResult,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
  displayMode: ProductionPlanningDisplayMode,
): ProductionFlowGraphInput {
  const context: LedgerBuildContext = {
    displayMode,
    index,
    plan,
    translate,
    targetItemIds: new Set(plan.roots.map((root) => root.itemId)),
    nodes: new Map(),
    links: new Map(),
  };
  const rows = buildProductionPlanningLedgerRows(plan);
  const producersByItemId = new Map<string, ItemFlowEndpoint[]>();
  const consumersByItemId = new Map<string, ItemFlowEndpoint[]>();

  // 设备最低消耗不再自建节点，而是作为宿主配方节点的入线标注。
  // 预收集设备最低消耗，按宿主 recipeId 分组。
  const deviceMinByHost = new Map<string, { itemId: string; perMinute: number }[]>();
  for (const row of rows) {
    if (!isProductionPlanningDeviceMinimumConsumptionRecipeId(row.recipeId)) {
      continue;
    }
    const hostRecipeId = resolveProductionPlanningDeviceMinimumConsumptionHostRecipeId(row.recipeId);
    if (hostRecipeId === null) {
      continue;
    }
    for (const input of row.recipeNode.inputs) {
      if (input.perMinute <= FLOW_EPSILON) {
        continue;
      }
      const list = deviceMinByHost.get(hostRecipeId) ?? [];
      list.push({ itemId: input.itemId, perMinute: input.perMinute });
      deviceMinByHost.set(hostRecipeId, list);
    }
  }

  for (const row of rows) {
    // 设备最低消耗行不创建节点
    if (isProductionPlanningDeviceMinimumConsumptionRecipeId(row.recipeId)) {
      continue;
    }

    const isSecondaryWasteRow = isWasteTreatmentItem(row.targetItemId)
      && row.recipeNodes.every((recipeNode) => recipeNode.id.includes(":target:"));
    if (isSecondaryWasteRow) continue;

    addLedgerRowNode(row, context);
    const outputs = new Map([[row.targetItemId, findOutputFlow(row.recipeNode, row.targetItemId)]]);
    for (const recipeNode of row.recipeNodes) {
      if (recipeNode.id.includes(":target:") || recipeNode.targetItemId !== row.targetItemId) continue;
      for (const output of recipeNode.outputs) {
        if (output.itemId !== row.targetItemId && isWasteTreatmentItem(output.itemId)) {
          outputs.set(output.itemId, (outputs.get(output.itemId) ?? 0) + output.perMinute);
        }
      }
    }
    for (const [itemId, value] of outputs) {
      if (itemId.length === 0 || value <= FLOW_EPSILON) continue;
      appendEndpoint(producersByItemId, itemId, {
        itemId,
        nodeId: row.id,
        row,
        value,
        isDeviceMinimumConsumption: false,
      });
    }

    for (const input of resolveLedgerRowConsumerPorts(row)) {
      if (input.perMinute <= FLOW_EPSILON) {
        continue;
      }
      appendEndpoint(consumersByItemId, input.itemId, {
        itemId: input.itemId,
        nodeId: row.id,
        row,
        value: input.perMinute,
        isDeviceMinimumConsumption: false,
      });
    }

    // 设备最低消耗：挂到第一个宿主配方行上。
    // 若消耗品也是该配方产物（自消费），则跳过——内部循环不需要在流程图上显示。
    const deviceMins = deviceMinByHost.get(row.recipeId);
    if (deviceMins !== undefined) {
      deviceMinByHost.delete(row.recipeId);
      for (const dm of deviceMins) {
        if (findOutputFlow(row.recipeNode, dm.itemId) > FLOW_EPSILON) {
          continue;
        }
        appendEndpoint(consumersByItemId, dm.itemId, {
          itemId: dm.itemId,
          nodeId: row.id,
          row,
          value: dm.perMinute,
          isDeviceMinimumConsumption: true,
        });
      }
    }
  }

  const itemIds = new Set([...producersByItemId.keys(), ...consumersByItemId.keys()]);
  for (const itemId of itemIds) {
    connectItemFlow(itemId, producersByItemId.get(itemId) ?? [], consumersByItemId.get(itemId) ?? [], context);
  }

  return {
    nodes: [...context.nodes.values()],
    links: [...context.links.values()],
  };
}

function addLedgerRowNode(row: ProductionPlanningLedgerRow, context: LedgerBuildContext): void {
  if (context.nodes.has(row.id)) {
    return;
  }

  const isExternal = isProductionPlanningExternalSupplyRecipeId(row.recipeId);
  const targetName = resolveProductionPlanningItemName(row.targetItemId, context.index, context.translate);
  const machineName = resolveLedgerRowMachineName(row, context.index, context.translate);
  const producedPerMinute = findOutputFlow(row.recipeNode, row.targetItemId);
  const consumedPerMinute = sumPorts(resolveLedgerRowConsumerPorts(row));
  // 处置类配方没有产物，速率取处置量。
  const displayRate = producedPerMinute > 0 ? producedPerMinute : consumedPerMinute;
  const deviceCount = formatProductionDeviceCount(row.recipeNode.deviceCount);
  const kind: ProductionFlowNodeKind = context.displayMode === "item" ? "item" : "recipe";
  const titleShowsMachine = context.displayMode === "device" || isProductionPlanningDisposalRecipeId(row.recipeId);
  const title = titleShowsMachine ? machineName : targetName;
  const subtitle = titleShowsMachine ? targetName : machineName;
  const iconSrcs = context.displayMode === "item"
    ? [resolveProductionPlanningItemIconSrc(row.targetItemId, context.index)]
    : resolveLedgerRowMachineIconSrcs(row, context.index);

  context.nodes.set(row.id, {
    id: row.id,
    kind,
    tone: resolveLedgerRowTone(row),
    title,
    subtitle,
    rate: `${formatProductionFlow(displayRate)}/min`,
    rateValue: formatProductionFlow(displayRate),
    machineCount: isExternal ? undefined : `×${deviceCount}`,
    machineIconSrc: context.displayMode !== "item"
      ? undefined
      : resolveLedgerRowMachineIconSrcs(row, context.index)[0],
    iconSrcs,
    value: Math.max(producedPerMinute, consumedPerMinute, 1),
    itemId: row.targetItemId,
    recipeId: row.recipeId,
    isTarget: !isExternal && !row.isByproduct && context.targetItemIds.has(row.targetItemId),
    ledgerRow: row,
    recipeNode: row.recipeNode,
  });
}

function resolveLedgerRowTone(row: ProductionPlanningLedgerRow): ProductionFlowNodeTone {
  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    return "source";
  }
  if (row.isByproduct) {
    return "byproduct";
  }
  if (row.recipeNodes.some((recipeNode) => recipeNode.inputItems.some((itemNode) => itemNode.isCycleSource))) {
    return "cycle";
  }
  return "normal";
}

function resolveLedgerRowMachineName(
  row: ProductionPlanningLedgerRow,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
): string {
  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    return translate(index.naturalResourceItemIds.has(row.targetItemId)
      ? "productionPlanning.depotSupply"
      : "productionPlanning.externalSupply");
  }
  if (row.recipeNode.module !== null) {
    const sourceName = translate(
      row.recipeNode.module.sourceType === "custom-module"
        ? "moduleBalancing.customModules"
        : "moduleBalancing.recommendedModules",
    );
    return `${row.recipeNode.module.name} · ${sourceName}`;
  }

  const recipeId = resolveProductionPlanningDeviceMinimumConsumptionHostRecipeId(row.recipeId) ?? row.recipeId;
  const recipe = index.recipeById.get(recipeId);
  const machine = recipe === undefined ? undefined : index.entityById.get(recipe.machineId);
  if (machine !== undefined) {
    return translate(machine.nameKey);
  }
  return recipe?.machineId ?? row.recipeId;
}

function resolveLedgerRowMachineId(row: ProductionPlanningLedgerRow, index: ProductionPlanningIndex): string | null {
  if (row.recipeNode.module !== null) {
    return null;
  }
  const recipeId = resolveProductionPlanningDeviceMinimumConsumptionHostRecipeId(row.recipeId) ?? row.recipeId;
  return index.recipeById.get(recipeId)?.machineId ?? null;
}

function resolveLedgerRowMachineIconSrcs(row: ProductionPlanningLedgerRow, index: ProductionPlanningIndex): string[] {
  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    return [EXTERNAL_SUPPLY_ENTITY_ICON_SRC];
  }
  if (row.recipeNode.module !== null) {
    return resolveProductionPlanningModuleIconSrcs(row.recipeNode.module, index);
  }

  const recipeId = resolveProductionPlanningDeviceMinimumConsumptionHostRecipeId(row.recipeId) ?? row.recipeId;
  const recipe = index.recipeById.get(recipeId);
  return [recipe === undefined
    ? createEntityIconAssetUrl(undefined)
    : resolveProductionPlanningEntityIconSrc(recipe.machineId, index)];
}

function resolveLedgerRowConsumerPorts(row: ProductionPlanningLedgerRow): ProductionPlanningRecipeNode["inputs"] {
  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    return [];
  }

  const ports = new Map<string, ProductionPlanningRecipeNode["inputs"][number]>();
  for (const recipeNode of row.recipeNodes) {
    if (!shouldLedgerRecipeNodeConsumeInputs(row, recipeNode)) {
      continue;
    }

    for (const input of resolveProductionPlanningRecipeInputPorts(recipeNode)) {
      const existing = ports.get(input.itemId);
      if (existing === undefined) {
        ports.set(input.itemId, { ...input });
      } else {
        ports.set(input.itemId, {
          ...existing,
          perMinute: existing.perMinute + input.perMinute,
        });
      }
    }
  }
  return [...ports.values()];
}

function shouldLedgerRecipeNodeConsumeInputs(
  row: ProductionPlanningLedgerRow,
  recipeNode: ProductionPlanningRecipeNode,
): boolean {
  if (isProductionPlanningDisposalRecipeId(row.recipeId)) {
    return true;
  }
  if (recipeNode.outputs.length === 0) {
    return true;
  }
  return !recipeNode.id.includes(":target:");
}

function appendEndpoint(
  endpointsByItemId: Map<string, ItemFlowEndpoint[]>,
  itemId: string,
  endpoint: ItemFlowEndpoint,
): void {
  const endpoints = endpointsByItemId.get(itemId);
  if (endpoints === undefined) {
    endpointsByItemId.set(itemId, [endpoint]);
  } else {
    endpoints.push(endpoint);
  }
}

function connectItemFlow(
  itemId: string,
  producers: readonly ItemFlowEndpoint[],
  consumers: readonly ItemFlowEndpoint[],
  context: LedgerBuildContext,
): void {
  if (producers.length === 0 || consumers.length === 0) {
    return;
  }

  if (producers.length > 1 && consumers.length > 1) {
    const junctionId = transientItemFlowNodeId(itemId);
    const producerValue = producers.reduce((sum, endpoint) => sum + endpoint.value, 0);
    const consumerValue = consumers.reduce((sum, endpoint) => sum + endpoint.value, 0);
    addTransientItemNode(itemId, Math.max(producerValue, consumerValue), context);
    for (const producer of producers) {
      addLedgerLink(producer.nodeId, junctionId, itemId, producer.value, context);
    }
    for (const consumer of consumers) {
      addLedgerLink(
        junctionId,
        consumer.nodeId,
        itemId,
        consumer.value,
        context,
        resolveConsumerLinkOptions(itemId, producers, consumer, context),
      );
    }
    return;
  }

  if (producers.length === 1) {
    const producer = producers[0];
    if (producer === undefined) {
      return;
    }
    for (const consumer of consumers) {
      addLedgerLink(
        producer.nodeId,
        consumer.nodeId,
        itemId,
        consumer.value,
        context,
        resolveConsumerLinkOptions(itemId, [producer], consumer, context),
      );
    }
    return;
  }

  if (consumers.length === 1) {
    const consumer = consumers[0];
    if (consumer === undefined) {
      return;
    }
    for (const producer of producers) {
      addLedgerLink(
        producer.nodeId,
        consumer.nodeId,
        itemId,
        producer.value,
        context,
        resolveConsumerLinkOptions(itemId, [producer], consumer, context),
      );
    }
  }
}

function resolveConsumerLinkOptions(
  itemId: string,
  producers: readonly ItemFlowEndpoint[],
  consumer: ItemFlowEndpoint,
  context: LedgerBuildContext,
): Pick<ProductionFlowLink, "preferredFeedback" | "sourceSide" | "targetSide" | "isDeviceMinimumConsumption"> {
  if (shouldEnterConsumerFromRight(itemId, producers, consumer, context)) {
    return {
      preferredFeedback: true,
      isDeviceMinimumConsumption: consumer.isDeviceMinimumConsumption,
    };
  }

  return { isDeviceMinimumConsumption: consumer.isDeviceMinimumConsumption };
}

function shouldEnterConsumerFromRight(
  itemId: string,
  producers: readonly ItemFlowEndpoint[],
  consumer: ItemFlowEndpoint,
  context: LedgerBuildContext,
): boolean {
  return isPlantBodyItemId(itemId)
    && isSeedCollectorLedgerRow(consumer.row, context.index)
    && producers.some((producer) => isPlanterLedgerRow(producer.row, context.index));
}

function isPlantBodyItemId(itemId: string): boolean {
  return itemId.startsWith("item_plant_")
    && !itemId.includes("_seed")
    && !itemId.includes("_powder");
}

function isPlanterLedgerRow(row: ProductionPlanningLedgerRow, index: ProductionPlanningIndex): boolean {
  const machineId = resolveLedgerRowMachineId(row, index);
  return machineId !== null && PLANTER_MACHINE_IDS.has(machineId);
}

function isSeedCollectorLedgerRow(row: ProductionPlanningLedgerRow, index: ProductionPlanningIndex): boolean {
  const machineId = resolveLedgerRowMachineId(row, index);
  return machineId !== null && SEED_COLLECTOR_MACHINE_IDS.has(machineId);
}

function addTransientItemNode(itemId: string, value: number, context: LedgerBuildContext): void {
  const id = transientItemFlowNodeId(itemId);
  if (context.nodes.has(id)) {
    return;
  }

  context.nodes.set(id, {
    id,
    kind: "item",
    tone: context.plan.byproductItemIds.has(itemId) ? "byproduct" : "normal",
    title: resolveProductionPlanningItemName(itemId, context.index, context.translate),
    subtitle: "",
    rate: `${formatProductionFlow(value)}/min`,
    rateValue: formatProductionFlow(value),
    iconSrcs: [resolveProductionPlanningItemIconSrc(itemId, context.index)],
    value: Math.max(value, 1),
    itemId,
    isTransient: true,
  });
}

function addLedgerLink(
  source: string,
  target: string,
  itemId: string,
  value: number,
  context: LedgerBuildContext,
  options: Partial<Pick<ProductionFlowLink, "preferredFeedback" | "sourceSide" | "targetSide" | "isDeviceMinimumConsumption">> = {},
): void {
  if (value <= FLOW_EPSILON) {
    return;
  }

  const id = `flow:${source}->${target}:${itemId}`;
  const existing = context.links.get(id);
  const nextValue = (existing?.value ?? 0) + value;
  context.links.set(id, {
    id,
    source,
    target,
    itemId,
    value: nextValue,
    title: resolveProductionPlanningItemName(itemId, context.index, context.translate),
    label: `${formatProductionFlow(nextValue)}/min`,
    iconSrc: resolveProductionPlanningItemIconSrc(itemId, context.index),
    ...options,
    isDeviceMinimumConsumption: options.isDeviceMinimumConsumption ?? false,
  });
}

function transientItemFlowNodeId(itemId: string): string {
  return `item:${itemId}`;
}

function findOutputFlow(node: ProductionPlanningRecipeNode, itemId: string): number {
  return node.outputs.find((output) => output.itemId === itemId)?.perMinute ?? 0;
}

function sumPorts(ports: readonly { readonly perMinute: number }[]): number {
  return ports.reduce((sum, port) => sum + port.perMinute, 0);
}
