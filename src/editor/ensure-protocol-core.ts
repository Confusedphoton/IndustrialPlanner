import type { WorldDocument } from "@/domain/document/world-document";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import { allowsFreeProtocolCorePlacement, PRIMARY_PROTOCOL_CORE_DEFINITION_ID, removeForbiddenProtocolCoreEntities, resolveProtocolCoreDefinitionIdForBase } from "@/shared/protocol-core";

/**
 * 确保文档中包含协议核心实体（item_port_sp_hub_1）。
 * 如果已存在则直接返回原文档，否则在 (0,0) 注入核心并置顶 entityOrder。
 */
export function ensureProtocolCoreEntity(options: {
  document: WorldDocument;
  queries: RegistryQuery;
  baseDefinitions: readonly BaseDefinition[];
  isNewDocument?: boolean;
}): WorldDocument {
  const freePlacement = allowsFreeProtocolCorePlacement(options.document.baseId, options.baseDefinitions);
  if (freePlacement && options.isNewDocument !== true) {
    return options.document;
  }
  const expectedDefinitionId = freePlacement
    ? PRIMARY_PROTOCOL_CORE_DEFINITION_ID
    : resolveProtocolCoreDefinitionIdForBase(options.document.baseId);
  if (expectedDefinitionId === null) {
    return removeForbiddenProtocolCoreEntities(options.document);
  }
  const protocolCoreEntityIds = Object.values(options.document.entities)
    .filter((entity) => options.queries.isProtocolCore(entity.definitionId))
    .map((entity) => entity.id);

  if (protocolCoreEntityIds.length > 0) {
    const retainedEntityId = resolveRetainedProtocolCoreEntityId({
      document: options.document,
      protocolCoreEntityIds,
      expectedDefinitionId,
    });
    const retainedEntity = options.document.entities[retainedEntityId];
    if (retainedEntity === undefined) {
      return options.document;
    }

    const removedEntityIds = new Set(
      protocolCoreEntityIds.filter((entityId) => entityId !== retainedEntityId),
    );
    if (
      retainedEntity.definitionId === expectedDefinitionId
      && removedEntityIds.size === 0
    ) {
      return options.document;
    }

    const entities = { ...options.document.entities };
    entities[retainedEntityId] = {
      ...retainedEntity,
      definitionId: expectedDefinitionId,
    };
    for (const entityId of removedEntityIds) {
      delete entities[entityId];
    }

    const entityOrder = Array.from(new Set(
      options.document.entityOrder.filter((entityId) => !removedEntityIds.has(entityId)),
    ));
    if (!entityOrder.includes(retainedEntityId)) {
      entityOrder.unshift(retainedEntityId);
    }

    return {
      ...options.document,
      entities,
      entityOrder,
      slotLinks: options.document.slotLinks.filter((link) =>
        !removedEntityIds.has(link.source.entityId)
        && !removedEntityIds.has(link.target.entityId),
      ),
    };
  }


  const entityId = `protocol-core:${options.document.baseId}`;

  return {
    ...options.document,
    entities: {
      ...options.document.entities,
      [entityId]: {
        id: entityId,
        definitionId: expectedDefinitionId,
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
    entityOrder: options.document.entityOrder.includes(entityId)
      ? options.document.entityOrder
      : [entityId, ...options.document.entityOrder],
  };
}

function resolveRetainedProtocolCoreEntityId(options: {
  readonly document: WorldDocument;
  readonly protocolCoreEntityIds: readonly string[];
  readonly expectedDefinitionId: string;
}): string {
  const protocolCoreEntityIdSet = new Set(options.protocolCoreEntityIds);
  const orderedEntityIds = [
    ...options.document.entityOrder.filter((entityId) => protocolCoreEntityIdSet.has(entityId)),
    ...options.protocolCoreEntityIds,
  ];
  const expectedEntityId = orderedEntityIds.find((entityId) =>
    options.document.entities[entityId]?.definitionId === options.expectedDefinitionId,
  );

  return expectedEntityId ?? orderedEntityIds[0]!;
}
