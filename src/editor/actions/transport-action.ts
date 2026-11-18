import type { EditorAction } from "@/domain/editor/editor-action";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { LogisticsPortDirection } from "@/domain/shared/logistics";
import { isLocalSlotLinkEndpoint } from "@/shared/slot-link";
import { collectTransportSegmentEntityIds } from "@/shared/transport-component";

import { action } from "mobx";
import type { EditorActionsContext } from "./types";

type EditorTransportActions = Pick<
  EditorAction,
  "removeTransportComponent" | "removeTransportComponentUpstream" | "removeTransportComponentDownstream"
>;

export function createEditorTransportActions(
  context: EditorActionsContext,
): EditorTransportActions {
  const { document, documentWriter, state, workspace } = context;

  const removeEntityIdsFromCollections = (entityIds: ReadonlySet<string>) => {
    for (const collectionType of Object.values(EntityCollectionType)) {
      const collection = state.collections[collectionType];

      if (collection.length === 0) {
        continue;
      }

      const nextEntityIds = collection.filter((entityId) => !entityIds.has(entityId));

      if (nextEntityIds.length === collection.length) {
        continue;
      }

      collection.replace(nextEntityIds);
    }
  };

  const removeDirectedTransportComponent = (
    entityId: string,
    directions: readonly LogisticsPortDirection[],
    label: string,
  ) => {
    const currentDocument = document.getSnapshot();
    const entity = currentDocument.entities[entityId];

    if (entity === undefined) {
      return;
    }

    const toDelete = collectTransportSegmentEntityIds({
      startEntity: entity,
      document: currentDocument,
      registry: workspace.registry,
      directions,
    });

    if (toDelete.size === 0) {
      return;
    }

    const nextEntities = { ...currentDocument.entities };

    for (const deleteId of toDelete) {
      if (nextEntities[deleteId] !== undefined) {
        delete nextEntities[deleteId];
      }
    }

    documentWriter.commit({
      action: {
        type: "entity.delete",
        label,
        entityIds: Array.from(toDelete),
        definitionIds: [],
        count: toDelete.size,
      },
      update: (documentSnapshot) => ({
        ...documentSnapshot,
        entities: nextEntities,
        slotLinks: documentSnapshot.slotLinks.filter((link) =>
          !(isLocalSlotLinkEndpoint(link.source, documentSnapshot.baseId) && toDelete.has(link.source.entityId))
          && !(isLocalSlotLinkEndpoint(link.target, documentSnapshot.baseId) && toDelete.has(link.target.entityId)),
        ),
        // 删除物流段时同步清理 entityOrder，否则残留 ID 导致计数虚高。
        entityOrder: documentSnapshot.entityOrder.filter(
          (entityId) => !toDelete.has(entityId),
        ),
      }),
    });

    // 从所有集合中移除已删除的实体
    removeEntityIdsFromCollections(toDelete);
  };

  return {
    removeTransportComponent: action((entityId) => {
      removeDirectedTransportComponent(entityId, ["input", "output"], "删除整段");
    }),
    removeTransportComponentUpstream: action((entityId) => {
      removeDirectedTransportComponent(entityId, ["input"], "删除前段");
    }),
    removeTransportComponentDownstream: action((entityId) => {
      removeDirectedTransportComponent(entityId, ["output"], "删除后段");
    }),
  };
}
