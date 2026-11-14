import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import { createLogger } from "@/shared/logging/logger";
import type { EditorStateReadWrite } from "../state-impl";
import { action, runInAction } from "mobx";
import type { EditorActionsContext } from "./types";
import { listWorldDocuments, WORLD_DOCUMENT_DATABASE_LOCATION } from "@/shared/storage/world-document-storage";
import { applyIndexedDbStoreMutations } from "@/shared/storage/browser-storage";
import { emitStorageChange } from "@/shared/storage/storage-change-event";
import { ensureProtocolCoreEntity } from "../ensure-protocol-core";

const logger = createLogger("document-action");

type EditorDocumentActions = Pick<
  EditorAction,
  "applySynchronizedDocument" | "removeSynchronizedBaseDocument" | "loadLatestBaseDocument" | "writeDocumentSettings"
>;

export function createEditorDocumentActions({
  document,
  documentWriter,
  documents,
  beforeDocumentChange,
  state,
  workspace,
}: EditorActionsContext): EditorDocumentActions {
  return {
    applySynchronizedDocument: action(async (nextDocument) => {
      await documents.ready();
      if (document.getSnapshot().baseId === nextDocument.baseId) {
        beforeDocumentChange();
        runInAction(() => resetDocumentRuntimeState(state));
      }
      await documents.applyRemote(nextDocument);
    }),

    removeSynchronizedBaseDocument: action(async (baseId) => {
      await documents.ready();
      if (document.getSnapshot().baseId === baseId) {
        beforeDocumentChange();
        runInAction(() => resetDocumentRuntimeState(state));
      }
      await documents.removeRemote(baseId, async () => {
        const storedDocuments = (await listWorldDocuments()).filter((candidate) => candidate.baseId === baseId);
        const removed = await applyIndexedDbStoreMutations(WORLD_DOCUMENT_DATABASE_LOCATION,
          storedDocuments.map((candidate) => ({ type: "delete" as const, key: candidate.documentKey })),
        );
        if (removed) {
          for (const candidate of storedDocuments) emitStorageChange({
            assetType: "world-document", assetId: candidate.documentKey, origin: "remote-sync", timestamp: Date.now(),
          });
        }
        return removed;
      }, () => ensureProtocolCoreEntity({
        document: createWorldDocument({ baseId }), queries: workspace.registry.queries,
        baseDefinitions: workspace.registry.baseDefinitions, isNewDocument: true,
      }));
    }),

    loadLatestBaseDocument: action(async (baseId) => {
      if (!workspace.registry.baseDefinitions.some((definition) => definition.id === baseId)) {
        logger.warn("loadLatestBaseDocument invalid baseId", { baseId });
        return false;
      }
      try {
        return await documents.activate(baseId, () => {
          beforeDocumentChange();
          runInAction(() => resetDocumentRuntimeState(state));
        });
      } catch (error) {
        logger.error("Failed to activate base document.", { baseId, error: String(error) });
        return false;
      }
    }),


    writeDocumentSettings: (patch) => {
      const currentDocument = document.getSnapshot();
      const nextDocument: WorldDocument = {
        ...currentDocument,
        documentSettings: {
          ...currentDocument.documentSettings,
          ...patch,
        },
      };

      if (nextDocument.documentSettings === currentDocument.documentSettings) {
        return;
      }

      documentWriter.setSnapshot(nextDocument, { mode: "silent" });
    },
  };
}

function resetDocumentRuntimeState(state: EditorStateReadWrite): void {
  state.drafts = [];
  state.marqueeGridRect = null;
  state.internalTransientState.logisticsDraft = null;
  state.internalTransientState.logisticsDeviceRouteCycleSignature = null;
  state.internalTransientState.logisticsDeviceRouteCycleIndex = 0;
  state.internalTransientState.placementDraftSlotLinks = null;
  state.internalTransientState.placementDraftEntityIdMap = null;
  state.internalTransientState.placementHistoryAction = null;
  state.internalTransientState.placementValidationByEntityId = {};
  state.regionAnnotations.selectedId = null;
  state.regionAnnotations.hoveredId = null;
  state.regionAnnotations.hiddenIds.replace([]);
  state.regionAnnotations.draft = null;
  state.regionAnnotations.draftOperation = "add";
  state.regionAnnotations.draftMarqueeGridRect = null;
  state.regionAnnotations.placementPreview = [];
  state.regionAnnotations.moveFeedback = null;

  for (const collectionType of Object.values(EntityCollectionType)) {
    state.collections[collectionType].replace([]);
  }
}
