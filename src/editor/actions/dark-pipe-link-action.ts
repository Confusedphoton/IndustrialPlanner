import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldDocument } from "@/domain/document/world-document";
import type { RegionalDarkPipeEndpoint } from "@/domain/shared/dark-pipe-link";
import { reaction } from "mobx";
import {
  createDarkPipeSlotLink,
  createRegionalDarkPipeLink,
  findDarkPipeSlotLinkForEntity,
  findRegionalDarkPipeLinkForEndpoint,
  isSameRegionalDarkPipeEndpoint,
  listDocumentRegionalDarkPipeLinks,
  prepareDarkPipeLinkDocument,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { createLogger } from "@/shared/logging/logger";
import { createWorldDocumentDelta } from "../history";
import type { EditorDocumentChange } from "../document-repository";
import { emitEditorDocumentChanges, persistEditorDocumentChanges } from "../document-transactions";
import type { EditorActionsContext } from "./types";

const logger = createLogger("dark-pipe-link-action");
type EditorDarkPipeLinkActions = Pick<EditorAction, "createDarkPipeLink" | "removeDarkPipeLink">;

export function createEditorDarkPipeLinkActions(context: EditorActionsContext): EditorDarkPipeLinkActions {
  const { document, documents, workspace, history } = context;
  const multiBaseEnabled = () => workspace.app?.state.settings.regionalMultiBaseEnabled === true;

  const regionDocuments = async (baseId: string): Promise<readonly WorldDocument[]> => {
    const region = workspace.registry.baseDefinitions.find(base => base.id === baseId)?.tag;
    if (region === undefined) return [];
    return documents.readMany(workspace.registry.baseDefinitions.filter(base => base.tag === region).map(base => base.id));
  };

  const createOperationGuard = (regional: boolean): (() => boolean) => {
    const activeKey = document.getSnapshot().documentKey;
    const enabled = multiBaseEnabled();
    const ownerIsCurrent = context.captureOperationGuard();
    return () => document.getSnapshot().documentKey === activeKey
      && multiBaseEnabled() === enabled
      && ownerIsCurrent()
      && !regional;
  };

  const commit = async (changes: readonly EditorDocumentChange[], isCurrent: () => boolean, label: string): Promise<boolean> => {
    const changed = changes.filter(change => change.before !== change.after);
    if (changed.length === 0 || !isCurrent()) return false;
    for (const { after } of changed) await history.prepareDocumentHistory(after.documentKey);
    const cancellation = new AbortController();
    const stop = reaction(isCurrent, current => { if (!current) cancellation.abort(); });
    try {
      const saved = await documents.commit(changes,
        signal => persistEditorDocumentChanges(changes, signal), isCurrent, cancellation.signal);
      if (!saved) return false;
      for (const { before, after } of changed) {
        const delta = createWorldDocumentDelta(before, after);
        if (delta !== null) history.record({ documentKey: after.documentKey, action: { type: "document.unknown", label }, delta });
      }
      emitEditorDocumentChanges(changed);
      return true;
    } finally {
      stop();
    }
  };

  return {
    async createDarkPipeLink(options) {
      try {
        await documents.ready();
        // 先归并选点前的视口变化，避免延迟保存使本次关系事务误判为并发编辑。
        context.beforeDocumentChange();
        const activeBaseId = document.getSnapshot().baseId;
        const sourceEndpoint = { baseId: options.sourceBaseId ?? activeBaseId, entityId: options.sourceEntityId };
        const targetEndpoint = { baseId: options.targetBaseId ?? activeBaseId, entityId: options.targetEntityId };
        if (isSameRegionalDarkPipeEndpoint(sourceEndpoint, targetEndpoint)) return false;
        const regional = sourceEndpoint.baseId !== targetEndpoint.baseId;
        const isCurrent = createOperationGuard(regional);
        if (!isCurrent()) return false;
        // 单基地下显式重新配置也要查找旧的远端占用，避免重新开启时旧连接复活。
        const snapshots = await regionDocuments(sourceEndpoint.baseId);
        const sourceDocument = snapshots.find(snapshot => snapshot.baseId === sourceEndpoint.baseId);
        const targetDocument = snapshots.find(snapshot => snapshot.baseId === targetEndpoint.baseId);
        const source = sourceDocument?.entities[sourceEndpoint.entityId];
        const target = targetDocument?.entities[targetEndpoint.entityId];
        if (sourceDocument === undefined || targetDocument === undefined || source === undefined || target === undefined) return false;
        const sourceRole = resolveDarkPipeRole(source.definitionId);
        const targetRole = resolveDarkPipeRole(target.definitionId);
        if (sourceRole === null || targetRole === null || sourceRole === targetRole) return false;
        if (findDarkPipeSlotLinkForEntity(sourceDocument, source.id) !== null
          || findDarkPipeSlotLinkForEntity(targetDocument, target.id) !== null) return false;

        const relations = listDocumentRegionalDarkPipeLinks(snapshots);
        const conflicts = relations.filter(link => [link.inlet, link.outlet].some(endpoint =>
          isSameRegionalDarkPipeEndpoint(endpoint, sourceEndpoint) || isSameRegionalDarkPipeEndpoint(endpoint, targetEndpoint)));
        if (multiBaseEnabled() && conflicts.length > 0) return false;
        const inlet = sourceRole === "inlet" ? sourceEndpoint : targetEndpoint;
        const outlet = sourceRole === "outlet" ? sourceEndpoint : targetEndpoint;
        const relative = createDarkPipeSlotLink({ inletEntityId: inlet.entityId, outletEntityId: outlet.entityId });
        const nextLink = regional ? {
          ...relative,
          id: createRegionalDarkPipeLink({ inlet, outlet }).id,
          target: { ...relative.target, baseId: inlet.baseId },
        } : relative;
        const timestamp = new Date().toISOString();
        const changes = snapshots.map(before => {
          let after = prepareDarkPipeLinkDocument(before, [inlet, outlet].filter(endpoint => endpoint.baseId === before.baseId).map(endpoint => endpoint.entityId));
          const removedIds = new Set(conflicts.filter(link => link.outlet.baseId === before.baseId).map(link => link.id));
          if (removedIds.size > 0) after = { ...after, slotLinks: after.slotLinks.filter(link => !removedIds.has(link.id)) };
          if (before.baseId === outlet.baseId) after = { ...after, slotLinks: [...after.slotLinks, nextLink] };
          if (before !== after) after = { ...after, meta: { ...after.meta, updatedAt: timestamp } };
          return { before, after };
        });
        return await commit(changes, isCurrent, "创建暗管链接");
      } catch (error) {
        logger.error("Failed to create dark-pipe link.", { error: String(error) });
        return false;
      }
    },

    async removeDarkPipeLink(entityId) {
      try {
        await documents.ready();
        context.beforeDocumentChange();
        const active = document.getSnapshot();
        const baseGuard = createOperationGuard(false);
        const endpoint: RegionalDarkPipeEndpoint = { baseId: active.baseId, entityId };
        const local = findDarkPipeSlotLinkForEntity(active, entityId);
        const snapshots = await regionDocuments(active.baseId);
        const regional = local === null ? findRegionalDarkPipeLinkForEndpoint(listDocumentRegionalDarkPipeLinks(snapshots), endpoint) : null;
        if (local === null && regional === null) return false;
        const isCurrent = () => baseGuard() && document.getSnapshot() === active
          && regional === null;
        if (!isCurrent()) return false;
        const ownerBaseId = regional?.outlet.baseId ?? active.baseId;
        const linkId = regional?.id ?? local!.id;
        const endpoints = regional === null
          ? [{ baseId: active.baseId, entityId: local!.source.entityId }, { baseId: active.baseId, entityId: local!.target.entityId }]
          : [regional.inlet, regional.outlet];
        const timestamp = new Date().toISOString();
        const changes = snapshots.map(before => {
          let after = prepareDarkPipeLinkDocument(before, endpoints.filter(candidate => candidate.baseId === before.baseId).map(candidate => candidate.entityId));
          if (before.baseId === ownerBaseId) after = { ...after, slotLinks: after.slotLinks.filter(link => link.id !== linkId) };
          if (before !== after) after = { ...after, meta: { ...after.meta, updatedAt: timestamp } };
          return { before, after };
        });
        return await commit(changes, isCurrent, "断开暗管链接");
      } catch (error) {
        logger.error("Failed to remove dark-pipe link.", { error: String(error) });
        return false;
      }
    },
  };
}

