

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";

import { createLogger } from "@/shared/logging/logger";

import { collectPoweredEntityIds } from "@/shared/geometry/power-range";

import type { RegionalResourceSupplySetting } from "../contracts";

export const PLAYBACK_HOT_QUEUE_CAPACITY = 20;

export const PLAYBACK_HOT_QUEUE_LOW_WATER = 10;

export const logger = createLogger("simulation-runtime");


export function cloneWorldDocument(document: WorldDocument): WorldDocument {
  return JSON.parse(JSON.stringify(document)) as WorldDocument;
}


export function computePoweredEntityIds(options: {
  readonly document: WorldDocument;
  readonly registry: WorkspaceContract["registry"];
}): Set<string> {
  return collectPoweredEntityIds(resolveOrderedDocumentEntities(options.document), options.registry.entityDefinitions);
}

export function resolveOrderedDocumentEntities(document: WorldDocument): WorldEntity[] {
  return document.entityOrder.flatMap((entityId) => {
    const entity = document.entities[entityId];

    return entity === undefined ? [] : [entity];
  });
}

export function normalizeActiveActivityIds(activityIds: readonly string[]): string[] {
  return [...new Set(activityIds)]
    .filter((activityId) => activityId.length > 0)
    .sort();
}

export function normalizeRegionalResourceSettings(
  settings: readonly RegionalResourceSupplySetting[],
): RegionalResourceSupplySetting[] {
  return [...settings]
    .map((setting) => ({
      itemId: setting.itemId,
      mode: setting.mode,
      perMinute: setting.perMinute,
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}
