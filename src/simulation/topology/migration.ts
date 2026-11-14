import type {
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";

import { createLogger } from "@/shared/logging/logger";
import type {
  CompiledSimulationDevice,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  SimulationTopologyMigration,
} from "../contracts";

const logger = createLogger("simulation-topology");

interface CreateSimulationTopologyMigrationOptions {
  readonly previousDocument: WorldDocument | null;
  readonly nextDocument: WorldDocument;
  readonly previousTopology: CompiledSimulationTopology | null;
  readonly nextTopology: CompiledSimulationTopology;
  readonly baseTickNumber: number;
}

export function createSimulationTopologyMigration(
  options: CreateSimulationTopologyMigrationOptions,
): SimulationTopologyMigration | null {
  if (options.previousDocument === null || options.previousTopology === null) {
    return null;
  }

  const resetDeviceIds = new Set<string>();
  for (const entityId of Object.keys(options.nextDocument.entities).sort()) {
    const previousEntity = options.previousDocument.entities[entityId];
    const nextEntity = options.nextDocument.entities[entityId];
    if (previousEntity === undefined || nextEntity === undefined) {
      continue;
    }

    const deviceId = `device:${entityId}`;
    const reasons = collectEntityResetReasons({
      previousEntity,
      nextEntity,
      previousTopology: options.previousTopology,
      nextTopology: options.nextTopology,
      deviceId,
    });

    if (reasons.length > 0) {
      resetDeviceIds.add(deviceId);
      logger.info(
        `Device '${deviceId}' requires full reset. Reasons: ${reasons.join('; ')}`,
      );
    }
  }

  return {
    baseTickNumber: Math.max(0, Math.trunc(options.baseTickNumber)),
    resetDeviceIds: [...resetDeviceIds].sort(),
  };
}

function collectEntityResetReasons(options: {
  readonly previousEntity: WorldEntity;
  readonly nextEntity: WorldEntity;
  readonly previousTopology: CompiledSimulationTopology;
  readonly nextTopology: CompiledSimulationTopology;
  readonly deviceId: string;
}): string[] {
  const reasons: string[] = [];

  if (options.previousEntity.definitionId !== options.nextEntity.definitionId) {
    reasons.push(
      `definitionId changed: '${options.previousEntity.definitionId}' → '${options.nextEntity.definitionId}'`,
    );
  }

  const previousDevice = options.previousTopology.devices[options.deviceId];
  const nextDevice = options.nextTopology.devices[options.deviceId];
  if (previousDevice === undefined) {
    reasons.push('device not found in previous topology');
    return reasons;
  }
  if (nextDevice === undefined) {
    reasons.push('device not found in next topology');
    return reasons;
  }


  const prevNodeIds = [...previousDevice.nodeIds].sort();
  const nextNodeIds = [...nextDevice.nodeIds].sort();
  if (prevNodeIds.join(',') !== nextNodeIds.join(',')) {
    const added = nextNodeIds.filter((id) => !prevNodeIds.includes(id));
    const removed = prevNodeIds.filter((id) => !nextNodeIds.includes(id));
    const parts: string[] = [];
    if (added.length > 0) parts.push(`added: [${added.join(', ')}]`);
    if (removed.length > 0) parts.push(`removed: [${removed.join(', ')}]`);
    reasons.push(`nodeIds changed (${parts.join('; ')})`);
  }

  const prevIngredientIds = [
    ...previousDevice.recipeChannels.flatMap((ch) => ch.ingredientNodeIds),
  ].sort();
  const nextIngredientIds = [
    ...nextDevice.recipeChannels.flatMap((ch) => ch.ingredientNodeIds),
  ].sort();
  if (prevIngredientIds.join(',') !== nextIngredientIds.join(',')) {
    reasons.push('recipe ingredientNodeIds changed');
  }

  const prevProductIds = [
    ...previousDevice.recipeChannels.flatMap((ch) => ch.productNodeIds),
  ].sort();
  const nextProductIds = [
    ...nextDevice.recipeChannels.flatMap((ch) => ch.productNodeIds),
  ].sort();
  if (prevProductIds.join(',') !== nextProductIds.join(',')) {
    reasons.push('recipe productNodeIds changed');
  }

  const prevSlotIds = listDeviceSlotIds(options.previousTopology, previousDevice).sort();
  const nextSlotIds = listDeviceSlotIds(options.nextTopology, nextDevice).sort();
  const prevSlotIdSet = new Set(prevSlotIds);
  const nextSlotIdSet = new Set(nextSlotIds);

  for (const slotId of nextSlotIds) {
    if (!prevSlotIdSet.has(slotId)) {
      reasons.push(`slot '${slotId}' added`);
    }
  }
  for (const slotId of prevSlotIds) {
    if (!nextSlotIdSet.has(slotId)) {
      reasons.push(`slot '${slotId}' removed`);
    }
  }
  for (const slotId of prevSlotIds) {
    if (!nextSlotIdSet.has(slotId)) continue;
    const prevSlot = options.previousTopology.slots[slotId];
    const nextSlot = options.nextTopology.slots[slotId];
    reasons.push(...compareSlotRuntimeShape(prevSlot, nextSlot, slotId));
  }

  return reasons;
}

function compareSlotRuntimeShape(
  prevSlot: CompiledSimulationSlot | undefined,
  nextSlot: CompiledSimulationSlot | undefined,
  slotId: string,
): string[] {
  const reasons: string[] = [];
  if (prevSlot === undefined || nextSlot === undefined) return reasons;

  const fields: Array<{ key: keyof CompiledSimulationSlot; label: string }> = [
    { key: 'capacity', label: 'capacity' },
    { key: 'domain', label: 'domain' },
    { key: 'lock', label: 'lock' },
    { key: 'initialItemType', label: 'initialItemType' },
    { key: 'initialCount', label: 'initialCount' },
    { key: 'ignoreStock', label: 'ignoreStock' },
    { key: 'nodeId', label: 'nodeId' },
    { key: 'sourceStorageSlotGroupId', label: 'sourceStorageSlotGroupId' },
    { key: 'sourceSlotId', label: 'sourceSlotId' },
  ];

  for (const { key, label } of fields) {
    if (prevSlot[key] !== nextSlot[key]) {
      reasons.push(
        `slot '${slotId}' ${label} changed: ${JSON.stringify(prevSlot[key])} → ${JSON.stringify(nextSlot[key])}`,
      );
    }
  }

  return reasons;
}

function listDeviceSlotIds(
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): string[] {
  return device.nodeIds.flatMap((nodeId) => topology.nodes[nodeId]?.slotIds ?? []);
}




