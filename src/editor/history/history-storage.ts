import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import type {
  EditorHistoryRecord,
} from "@/domain/editor/editor-history";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { migrateBlueprintDocumentState, migrateBlueprintEntityDeviceIds } from "@/shared/blueprint-device-id-migration";
import {
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";

const DOCUMENT_DATABASE_NAME = "v3-industrial-planner";
const EDITOR_HISTORY_STORE_NAME = "editorhistory";
const EDITOR_HISTORY_STORAGE_SCHEMA_VERSION = 3;

export interface PersistedEditorHistoryState {
  readonly schemaVersion: typeof EDITOR_HISTORY_STORAGE_SCHEMA_VERSION;
  readonly documentSchemaVersion?: number;
  readonly documentKey: string;
  readonly cursorSequence: number;
  readonly records: readonly EditorHistoryRecord[];
}

export async function readEditorHistoryState(
  documentKey: string,
): Promise<PersistedEditorHistoryState | null> {
  const persistedState = await readFromIndexedDb<unknown>(
    createEditorHistoryLocation(documentKey),
    { strict: true },
  );
  const document = persistedState === null ? null : await readFromIndexedDb<WorldDocument>({
    databaseName: DOCUMENT_DATABASE_NAME, storeName: "worddocument", key: documentKey,
  }, { strict: true });
  const normalizedState = normalizePersistedEditorHistoryState(persistedState, documentKey, document);
  if (persistedState !== null && normalizedState === null) throw new Error("Invalid editor history; original records were preserved.");



  return normalizedState;
}

export async function writeEditorHistoryState(
  historyState: PersistedEditorHistoryState,
): Promise<void> {
  await saveToIndexedDb(
    createEditorHistoryLocation(historyState.documentKey),
    { ...historyState, documentSchemaVersion: BLUEPRINT_SCHEMA_VERSION },
  );
}

function createEditorHistoryLocation(documentKey: string) {
  return {
    databaseName: DOCUMENT_DATABASE_NAME,
    storeName: EDITOR_HISTORY_STORE_NAME,
    key: documentKey,
  };
}

export function normalizePersistedEditorHistoryState(
  value: unknown,
  expectedDocumentKey: string,
  document: WorldDocument | null,
): PersistedEditorHistoryState | null {
  if (
    !isRecord(value)
    || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== EDITOR_HISTORY_STORAGE_SCHEMA_VERSION)
    || value.documentKey !== expectedDocumentKey
    || typeof value.cursorSequence !== "number"
    || !Array.isArray(value.records)
  ) {
    return null;
  }

  // 包装 schema 2 来自已发布的蓝图 schema 5；包装 schema 3 最早随蓝图 schema 6 引入。
  const sourceSchema = typeof value.documentSchemaVersion === "number"
    ? value.documentSchemaVersion : value.schemaVersion === 1 ? 1 : value.schemaVersion === 2 ? 5 : 6;
  if (!Number.isInteger(sourceSchema) || sourceSchema < 1 || sourceSchema > BLUEPRINT_SCHEMA_VERSION
    || !value.records.every(isEditorHistoryRecordLike)) return null;
  const context = { ...document?.entities };
  for (const item of value.records) {
    const record = item as unknown as EditorHistoryRecord;
    Object.assign(context, record.delta.entities.added, record.delta.entities.removed);
    for (const [id, change] of Object.entries(record.delta.entities.updated)) context[id] = change.after;
  }
  const sortedRecords = (value.records as Record<string, unknown>[])
    .slice()
    .sort((left, right) => (left.sequence as number) - (right.sequence as number));
  const storedCursorSequence = value.cursorSequence;
  const cursorIndex = sortedRecords.filter(record => (record.sequence as number) <= storedCursorSequence).length;
  const migrationResults = sortedRecords.map((record) => {
    try {
      return {
        record: normalizeEditorHistoryRecord(
          sourceSchema < BLUEPRINT_SCHEMA_VERSION
            ? migrateEditorHistoryRecordDeviceIds(record, sourceSchema, context, document?.baseId)
            : record,
        ),
        error: null,
      };
    } catch (error) {
      return { record: null, error };
    }
  });
  const lastFailedUndoIndex = migrationResults
    .slice(0, cursorIndex)
    .findLastIndex(result => result.error !== null);
  const firstFailedRedoOffset = migrationResults
    .slice(cursorIndex)
    .findIndex(result => result.error !== null);
  const retainedStart = lastFailedUndoIndex + 1;
  const retainedEnd = firstFailedRedoOffset < 0
    ? migrationResults.length
    : cursorIndex + firstFailedRedoOffset;
  const retainedRecords = migrationResults
    .slice(retainedStart, retainedEnd)
    .map((result, index) => ({
      ...result.record!,
      sequence: index + 1,
    }));
  const failedResults = migrationResults.flatMap((result, index) => result.error === null ? [] : [{
    sequence: sortedRecords[index]?.sequence,
    error: String(result.error),
  }]);
  if (failedResults.length > 0) {
    console.warn("Editor history migration truncated incompatible records.", {
      documentKey: value.documentKey,
      failedRecords: failedResults,
      discardedBefore: retainedStart,
      discardedAfter: migrationResults.length - retainedEnd,
      retained: retainedRecords.length,
    });
  }
  return {
    schemaVersion: EDITOR_HISTORY_STORAGE_SCHEMA_VERSION,
    documentSchemaVersion: BLUEPRINT_SCHEMA_VERSION,
    documentKey: value.documentKey,
    cursorSequence: Math.max(0, cursorIndex - retainedStart),
    records: retainedRecords,
  };
}

function migrateEditorHistoryRecordDeviceIds(
  record: Record<string, unknown>, sourceSchema: number,
  context: Record<string, WorldEntity>, baseId?: string,
): Record<string, unknown> {
  // 6→7 是空步骤，不需要解析历史连接端点，也不能因此截断原本有效的历史。
  if (sourceSchema === 6 && BLUEPRINT_SCHEMA_VERSION === 7) return record;
  const typedRecord = record as unknown as EditorHistoryRecord;
  return {
    ...typedRecord,
    action: {
      ...typedRecord.action,
      definitionIds: typedRecord.action.definitionIds?.map(id => migrateHistoryDefinitionId(id, sourceSchema)),
    },
    delta: {
      ...typedRecord.delta,
      slotLinks: typedRecord.delta.slotLinks === null ? null : {
        before: migrateHistoryLinks(typedRecord.delta.slotLinks.before, context, sourceSchema, baseId),
        after: migrateHistoryLinks(typedRecord.delta.slotLinks.after, context, sourceSchema, baseId),
      },
      entities: {
        added: migrateHistoryEntityRecord(typedRecord.delta.entities.added, sourceSchema, baseId),
        removed: migrateHistoryEntityRecord(typedRecord.delta.entities.removed, sourceSchema, baseId),
        updated: Object.fromEntries(
          Object.entries(typedRecord.delta.entities.updated).map(([entityId, change]) => [
            entityId,
            {
              before: migrateHistoryEntity(change.before, sourceSchema, baseId),
              after: migrateHistoryEntity(change.after, sourceSchema, baseId),
            },
          ]),
        ),
      },
    },
  };
}

function normalizeEditorHistoryRecord(record: Record<string, unknown>): EditorHistoryRecord {
  const typedRecord = record as unknown as EditorHistoryRecord;
  const deltaRecord = typedRecord.delta as unknown as Record<string, unknown>;

  return {
    ...typedRecord,
    schemaVersion: 2,
    delta: {
      ...typedRecord.delta,
      regions: record.schemaVersion === 2 && "regions" in deltaRecord
        ? typedRecord.delta.regions
        : null,
    },
  };
}

function migrateHistoryEntityRecord(
  entities: Readonly<Record<string, WorldEntity>>, sourceSchema: number, baseId?: string,
): Record<string, WorldEntity> {
  const migrated = migrateBlueprintDocumentState({
    baseId, entities: { ...entities }, entityOrder: Object.keys(entities), slotLinks: [], regions: [],
  }, sourceSchema);
  if (migrated === null) throw new Error("Cannot migrate editor history entities.");
  return migrated.entities;
}

function migrateHistoryEntity(entity: WorldEntity, sourceSchema: number, baseId?: string): WorldEntity {
  return migrateHistoryEntityRecord({ entity }, sourceSchema, baseId).entity ?? entity;
}

function migrateHistoryDefinitionId(definitionId: string, sourceSchema: number): string {
  return migrateBlueprintEntityDeviceIds({
    entity: {
      id: "history-definition-id",
      definitionId,
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    },
  }, sourceSchema, BLUEPRINT_SCHEMA_VERSION)?.entities.entity?.definitionId ?? definitionId;
}

function isEditorHistoryRecordLike(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value)
    && (value.schemaVersion === 1 || value.schemaVersion === 2)
    && typeof value.id === "string"
    && typeof value.documentKey === "string"
    && typeof value.sequence === "number"
    && typeof value.createdAt === "string"
    && isRecord(value.action)
    && isRecord(value.delta)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}


function migrateHistoryLinks(
  links: Readonly<WorldDocument["slotLinks"]>, context: Record<string, WorldEntity>, sourceSchema: number, baseId?: string,
): Readonly<WorldDocument["slotLinks"]> {
  if (links.some(link => context[link.source.entityId] === undefined || context[link.target.entityId] === undefined)) {
    throw new Error("Cannot migrate history links without their entities; original history was preserved.");
  }
  const migrated = migrateBlueprintDocumentState({
    baseId, entities: context, entityOrder: Object.keys(context), slotLinks: links, regions: [],
  }, sourceSchema);
  if (migrated === null) throw new Error("Cannot migrate editor history links.");
  return migrated.slotLinks;
}
