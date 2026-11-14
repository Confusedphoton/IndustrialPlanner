import {
  type WorldDocument,
  createWorldDocument,
} from "@/domain/document/world-document";
import {
  listFromIndexedDb,
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";
export { normalizeWorldDocument } from "@/shared/storage/world-document-storage";
import { reaction, runInAction } from "mobx";

import { createLogger } from "@/shared/logging/logger";
import type { EditorRuntimeHost } from "./editor-host";
import { ensureProtocolCoreEntity } from "./ensure-protocol-core";
import { EditorDocumentRepository } from "./document-repository";
import type { EditorStateReadWrite } from "./state-impl";
import type { EditorServices } from "./editor-services";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";
import { trySaveToIndexedDb } from "@/shared/storage/browser-storage";
import { emitStorageChange } from "@/shared/storage/storage-change-event";
import { reportStorageFailure } from "@/shared/storage/storage-failure";

const logger = createLogger("document-storage");

const DOCUMENT_DATABASE_NAME = "v3-industrial-planner";
const WORD_DOCUMENT_STORE_NAME = "worddocument";
const documentStorageFlushers = new WeakMap<EditorRuntimeHost, () => Promise<void>>();

/** 跨文档事务开始前，等待初始化及已排队的自动保存，避免旧快照随后覆盖事务。 */
export async function flushEditorDocumentStorage(editorHost: EditorRuntimeHost): Promise<void> {
  await documentStorageFlushers.get(editorHost)?.();
}

export const WORLD_DOCUMENT_DATABASE_LOCATION = {
  databaseName: DOCUMENT_DATABASE_NAME,
  storeName: WORD_DOCUMENT_STORE_NAME,
};

export function createEditorDocumentRepository(options: {
  readonly persistence?: "browser" | "memory";
  readonly document: SnapshotStoreReadWrite<WorldDocument>;
  readonly state: EditorStateReadWrite;
  readonly workspace: EditorServices;
}): EditorDocumentRepository {
  return new EditorDocumentRepository({
    persistence: options.persistence,
    activeDocument: options.document,
    read: async (baseId) => {
      const storedDocument = await resolveLatestWorldDocumentForBase({
        baseId,
        latestDocumentIdByBaseId: options.state.internalPersistState.latestDocumentIdByBaseId,
      });
      return ensureProtocolCoreEntity({
        document: storedDocument ?? createWorldDocument({ baseId }),
        queries: options.workspace.registry.queries,
        baseDefinitions: options.workspace.registry.baseDefinitions,
        isNewDocument: storedDocument === null,
      });
    },
    write: async (document, origin = "local") => {
      const saved = await trySaveToIndexedDb(createWordDocumentLocation(document.documentKey), document);
      if (saved) emitStorageChange({
        assetType: "world-document", assetId: document.documentKey, origin, timestamp: Date.now(),
      });
      return saved;
    },
    reportError: (error) => {
      logger.error("Editor document persistence failed.", { error: String(error) });
      reportStorageFailure("world-document", error);
    },
  });
}

export function hookDocumentStorage(
  editorHost: EditorRuntimeHost,
  options: { persistence?: "browser" | "memory"; initialDocument?: WorldDocument } = {},
): () => void {
  const repository = editorHost.internalDocuments;
  if (options.persistence === "memory") {
    const unsubscribe = editorHost.internalDocument.subscribe((document, context) => {
      repository.observeActive(document, context.origin);
    });
    void repository.initialize(async () => options.initialDocument ?? editorHost.internalDocument.getSnapshot());
    return () => {
      unsubscribe();
      repository.dispose();
    };
  }
  let disposed = false;
  let scopeSerial = 0;
  let scopeKey = "";
  const reconcileScope = (): void => {
    const active = editorHost.internalDocument.getSnapshot();
    const enabled = editorHost.services.app?.state.settings.regionalMultiBaseEnabled === true;
    const bases = editorHost.services.registry.baseDefinitions;
    const region = bases.find((base) => base.id === active.baseId)?.tag;
    const baseIds = enabled && region !== undefined
      ? bases.filter((base) => base.tag === region).map((base) => base.id)
      : [active.baseId];
    const key = baseIds.join("\u0000");
    if (key === scopeKey) return;
    scopeKey = key;
    repository.setScope(baseIds);
    const serial = ++scopeSerial;
    void (async () => {
      await repository.ready();
      if (disposed || serial !== scopeSerial) return;
      if (enabled) await repository.readMany(baseIds);
      if (disposed || serial !== scopeSerial) return;
      await repository.retain(baseIds, () => serial === scopeSerial);
    })().catch((error: unknown) => {
      if (!disposed && serial === scopeSerial) {
        scopeKey = "";
        logger.error("Failed to prepare regional documents.", { error: String(error) });
        reportStorageFailure("regional-documents load", error);
      }
    });
  };
  const unsubscribe = editorHost.internalDocument.subscribe((document, context) => {
    repository.observeActive(document, context.origin);
    if (context.origin !== "initial") {
      rememberLatestWorldDocument(editorHost, document);
      reconcileScope();
    }
  });
  void repository.initialize(() => options.initialDocument !== undefined
    ? Promise.resolve(options.initialDocument) : resolveInitialDocument(editorHost));
  const stopModeReaction = reaction(
    () => editorHost.services.app?.state.settings.regionalMultiBaseEnabled === true,
    reconcileScope,
  );
  documentStorageFlushers.set(editorHost, () => repository.flush());
  return () => {
    disposed = true;
    scopeSerial += 1;
    stopModeReaction();
    unsubscribe();
    documentStorageFlushers.delete(editorHost);
    repository.dispose();
  };
}


async function resolveInitialDocument(
  editorHost: EditorRuntimeHost,
): Promise<WorldDocument> {
  const lastDocumentId = resolveLastDocumentId(editorHost);
  logger.info("resolveInitialDocument start", { lastDocumentId });

  let document: WorldDocument | null = null;
  let isNewDocument = false;

  if (lastDocumentId !== null) {
    document = await readWorldDocument(lastDocumentId);
    logger.info("resolveInitialDocument readWorldDocument", {
      lastDocumentId,
      found: document !== null,
      baseId: document?.baseId,
      entityCount: document !== null ? Object.keys(document.entities).length : 0,
    });
  } else {
    logger.info("resolveInitialDocument no lastDocumentId, will create new");
  }

  // 校验 baseId 有效性。IndexedDB 可能残留已废弃基地的旧文档，或 V2 迁移引入了不存在的 baseId。
  if (document !== null) {
    const isValidBase = editorHost.services.registry.baseDefinitions
      .some((definition) => definition.id === document!.baseId);
    if (!isValidBase) {
      logger.warn("resolveInitialDocument baseId invalid, discarding document", {
        baseId: document.baseId,
      });
      document = null;
    }
  }

  if (document === null) {
    isNewDocument = true;
    document = createWorldDocument();
    logger.info("resolveInitialDocument created new document", {
      baseId: document.baseId,
      documentKey: document.documentKey,
    });
  }

  // 确保协议核心实体在首次加载时即存在，与 loadLatestBaseDocument 路径保持一致。
  const result = ensureProtocolCoreEntity({
    document,
    queries: editorHost.services.registry.queries,
    baseDefinitions: editorHost.services.registry.baseDefinitions,
    isNewDocument,
  });

  logger.info("resolveInitialDocument done", {
    baseId: result.baseId,
    documentKey: result.documentKey,
    entityCount: Object.keys(result.entities).length,
    hasProtocolCore: Object.values(result.entities).some(
      (e) => editorHost.services.registry.queries.isProtocolCore(e.definitionId),
    ),
  });

  return result;
}

export async function readWorldDocument(
  documentKey: string,
): Promise<WorldDocument | null> {
  const persistedDocument = await readFromIndexedDb<unknown>(
    createWordDocumentLocation(documentKey),
    { strict: true },
  );

  const result = normalizeWorldDocument(persistedDocument);
  if (persistedDocument !== null && result === null) throw new Error("Stored world document is unreadable; original retained.");

  logger.info("readWorldDocument", {
    documentKey,
    hasRawData: persistedDocument !== undefined,
    normalized: result !== null,
    baseId: result?.baseId ?? null,
    entityCount: result !== null ? Object.keys(result.entities).length : 0,
  });

  return result;
}

export async function writeWorldDocument(
  document: WorldDocument,
): Promise<void> {
  await saveToIndexedDb(
    createWordDocumentLocation(document.documentKey),
    document,
  );
}

export async function listWorldDocuments(): Promise<WorldDocument[]> {
  const persistedDocuments = await listFromIndexedDb<unknown>(
    WORLD_DOCUMENT_DATABASE_LOCATION,
    { strict: true },
  );

  return persistedDocuments.flatMap((persistedDocument) => {
    const document = normalizeWorldDocument(persistedDocument);

    if (document === null) throw new Error("Stored world document is unreadable; original retained.");
    return [document];
  });
}

export async function resolveLatestWorldDocumentForBase(options: {
  baseId: string;
  latestDocumentIdByBaseId: Readonly<Record<string, string>>;
}): Promise<WorldDocument | null> {
  const latestDocumentId = options.latestDocumentIdByBaseId[options.baseId];

  logger.info("resolveLatestWorldDocumentForBase start", {
    baseId: options.baseId,
    latestDocumentId: latestDocumentId ?? null,
  });

  if (typeof latestDocumentId === "string" && latestDocumentId.trim() !== "") {
    const document = await readWorldDocument(latestDocumentId);

    if (document?.baseId === options.baseId) {
      logger.info("resolveLatestWorldDocumentForBase found by latestDocumentId", {
        baseId: options.baseId,
        documentKey: document.documentKey,
        entityCount: Object.keys(document.entities).length,
      });
      return document;
    }
  }

  const documents = await listWorldDocuments();
  const matched = documents.filter((d) => d.baseId === options.baseId);

  logger.info("resolveLatestWorldDocumentForBase listWorldDocuments", {
    baseId: options.baseId,
    totalDocuments: documents.length,
    matchedForBase: matched.length,
  });

  const result = matched.sort(compareWorldDocumentRecency)[0] ?? null;

  logger.info("resolveLatestWorldDocumentForBase done", {
    baseId: options.baseId,
    found: result !== null,
    documentKey: result?.documentKey ?? null,
    entityCount: result !== null ? Object.keys(result.entities).length : 0,
  });

  return result;
}

export async function listLatestWorldDocumentsByBase(
  latestDocumentIdByBaseId: Readonly<Record<string, string>>,
): Promise<Map<string, WorldDocument>> {
  const documents = await listWorldDocuments();
  const latestByBaseId = new Map<string, WorldDocument>();

  for (const document of documents) {
    const currentLatest = latestByBaseId.get(document.baseId);

    if (
      currentLatest === undefined
      || compareWorldDocumentRecency(document, currentLatest) < 0
    ) {
      latestByBaseId.set(document.baseId, document);
    }
  }

  for (const [baseId, documentKey] of Object.entries(latestDocumentIdByBaseId)) {
    const indexedDocument = await readWorldDocument(documentKey);

    if (indexedDocument?.baseId === baseId) {
      latestByBaseId.set(baseId, indexedDocument);
    }
  }

  return latestByBaseId;
}

export function rememberLatestWorldDocument(
  editorHost: EditorRuntimeHost,
  document: WorldDocument,
): void {
  setLastDocumentId(editorHost, document.documentKey);
  setLatestDocumentIdByBaseId(editorHost, document.baseId, document.documentKey);
}

function createWordDocumentLocation(documentKey: string) {
  return {
    ...WORLD_DOCUMENT_DATABASE_LOCATION,
    key: documentKey,
  };
}

function resolveLastDocumentId(editorHost: EditorRuntimeHost): string | null {
  const lastDocumentId =
    editorHost.internalState.internalPersistState.lastDocumentId;

  return typeof lastDocumentId === "string" && lastDocumentId.trim() !== ""
    ? lastDocumentId
    : null;
}

function setLastDocumentId(
  editorHost: EditorRuntimeHost,
  documentKey: string,
): void {
  if (editorHost.internalState.internalPersistState.lastDocumentId === documentKey) {
    return;
  }

  runInAction(() => {
    editorHost.internalState.internalPersistState.lastDocumentId = documentKey;
  });
}

function setLatestDocumentIdByBaseId(
  editorHost: EditorRuntimeHost,
  baseId: string,
  documentKey: string,
): void {
  if (
    editorHost.internalState.internalPersistState.latestDocumentIdByBaseId[baseId]
    === documentKey
  ) {
    return;
  }

  runInAction(() => {
    editorHost.internalState.internalPersistState.latestDocumentIdByBaseId = {
      ...editorHost.internalState.internalPersistState.latestDocumentIdByBaseId,
      [baseId]: documentKey,
    };
  });
}

function compareWorldDocumentRecency(left: WorldDocument, right: WorldDocument): number {
  const updatedAtDelta = timestampToNumber(right.meta.updatedAt) - timestampToNumber(left.meta.updatedAt);

  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  const createdAtDelta = timestampToNumber(right.meta.createdAt) - timestampToNumber(left.meta.createdAt);

  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return right.documentKey.localeCompare(left.documentKey);
}

function timestampToNumber(value: string): number {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

