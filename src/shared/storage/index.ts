export {
  applyIndexedDbTransactionMutations,
  deleteFromLocalStorage,
  listFromIndexedDb,
  readFromIndexedDb,
  readFromLocalStorage,
  saveToIndexedDb,
  saveToLocalStorage,
  trySaveToLocalStorage,
} from "@/shared/storage/browser-storage";

export {
  clearAllStorageAndReload,
  estimateTotalStorageBytes,
  formatStorageBytesToMB,
} from "@/shared/storage/browser-storage-estimate";

export type {
  BlueprintDirectoryListing,
  BlueprintFolderRecord,
  BlueprintRecord,
  BlueprintSyncEntry,
  BlueprintStorageEntry,
  CreateBlueprintFolderInput,
  RenameBlueprintFolderInput,
  SaveBlueprintOptions,
  UpsertBlueprintFolderInput,
} from "@/shared/storage/blueprint-storage";

export {
  createBlueprintFolder,
  applyBlueprintSyncEntry,
  deleteBlueprintFolder,
  deleteBlueprintDocument,
  listBlueprintDirectory,
  listBlueprintStorageEntries,
  listBlueprintSyncEntries,
  readBlueprintFolder,
  readBlueprintRecord,
  renameBlueprintFolder,
  saveBlueprintDocument,
  upsertBlueprintFolder,
  BLUEPRINT_STORE_LOCATION,
} from "@/shared/storage/blueprint-storage";

export type {
  ConvertLegacyBlueprintOptions,
  LegacyBlueprintJson,
} from "@/shared/storage/legacy-blueprint-import";

export {
  convertLegacyBlueprintJson,
  normalizeLegacyBlueprintJson,
} from "@/shared/storage/legacy-blueprint-import";

export type {
  LegacyV2BlueprintLinkSnapshot,
  LegacyV2BlueprintSnapshot,
  LegacyV2DeviceSnapshot,
  LegacyV2LayoutLinkSnapshot,
  LegacyV2LayoutSnapshot,
} from "@/shared/storage/legacy-v2-blueprint-migration";

export {
  convertLegacyV2LayoutToBlueprintDocument,
  convertLegacyV2LayoutToWorldDocument,
  createLegacyBlueprintJsonFromV2BlueprintSnapshot,
  createLegacyBlueprintJsonFromV2Layout,
  createWorldDocumentFromMigratedBlueprint,
  filterLegacyV2LayoutBaseBuiltinEntities,
  normalizeLegacyV2BlueprintSnapshotsStorage,
  normalizeLegacyV2LayoutsByBaseStorage,
} from "@/shared/storage/legacy-v2-blueprint-migration";

export type {
  IndexedDbDatabaseLocation,
  IndexedDbStoreMutationBatch,
  IndexedDbStoreLocation,
  IndexedDbStorageLocation,
  IndexedDbMutationOperation,
  JsonStorageCodec,
} from "@/shared/storage/browser-storage";

export type {
  LocalAccountImportRequiredDecision,
  LocalAccountImportResolution,
  LocalAccountRemoteDatasetStatus,
  LocalSyncDataOwner,
  LocalSyncOwnerKind,
  LocalSyncOwnerState,
  LocalPendingAccountImport,
  LocalCompletedAccountImport,
} from "@/shared/storage/sync-owner-storage";

export {
  activateAccountOwnerAfterImport,
  areLocalSyncDataOwnersEqual,
  createLocalSyncOwnerScopeKey,
  ensureLocalSyncOwnerState,
  normalizeLocalSyncDataOwner,
  readLocalSyncOwnerState,
  recordPendingAccountImportDecision,
  SYNC_OWNER_STATE_STORE_LOCATION,
} from "@/shared/storage/sync-owner-storage";

export {
  createSha256CanonicalHash,
  createStableJsonHash,
} from "@/shared/storage/hash-utils";


export type {
  JsonPatchOperation,
} from "@/shared/storage/json-patch-codec";

export {
  applyJsonPatch,
  generateJsonPatch,
} from "@/shared/storage/json-patch-codec";


export type {
  StorageAssetType,
  StorageChangeEvent,
  StorageChangeListener,
} from "@/shared/storage/storage-change-event";

export {
  emitStorageChange,
  subscribeToStorageChanges,
} from "@/shared/storage/storage-change-event";


export type {
  EditorPersistState,
} from "@/shared/storage/editor-persist-state-storage";

export {
  EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
  normalizeEditorPersistState,
  readEditorPersistState,
  writeEditorPersistState,
} from "@/shared/storage/editor-persist-state-storage";

export {
  listLatestWorldDocumentsByBase,
  listWorldDocuments,
  normalizeWorldDocument,
  readWorldDocument,
  replaceWorldDocuments,
  resolveLatestWorldDocumentForBase,
  writeWorldDocument,
  WORLD_DOCUMENT_DATABASE_LOCATION,
} from "@/shared/storage/world-document-storage";

export {
  readFromIndexedDbWithMigration,
  readFromLocalStorageWithMigration,
  saveToIndexedDbWithVersion,
  saveToLocalStorageWithVersion,
} from "@/shared/storage/migration";

export type {
  StorageMigration,
} from "@/shared/storage/migration";
