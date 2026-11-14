export {
  createSyncHost,
  type SyncHost,
  type SyncHostOptions,
} from "./sync-host";

// ============================================================
// Engine: sync-adapters (通用适配器，独立于具体存储后端)
// ============================================================
export {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  createPatchWithRevisionAdapter,
  SyncDownloadDirtyAbortError,
} from "./engine/sync-adapters";
export type {
  FullNoRevisionAdapterOptions,
  FullWithRevisionAdapterOptions,
  FullWithRevisionEntry,
  PatchCollectionWithRevisionAdapterOptions,
  PatchWithRevisionAdapterOptions,
  PatchWithRevisionEntry,
  SyncAdapter,
  SyncAdapterConflict,
  SyncAdapterConflictDecision,
  SyncAdapterConflictResolution,
  SyncAdapterMode,
  SyncAdapterResult,
  SyncAdapterScope,
  SyncAdapterStatus,
  SyncAdapterSyncOptions,
  SyncEngineTransaction,
  SyncLocalChangeState,
  SyncPlanItem,
  SyncPlanItemKind,
  SyncPlanUpload,
} from "./engine/sync-adapters";


// ============================================================
// Engine: sync-service (通用同步服务，独立于具体存储后端)
// ============================================================
export {
  createSyncService,
} from "./engine/sync-service";
export type {
  SyncService,
  SyncServiceOptions,
  SyncServicePhase,
  SyncServiceStatus,
  SyncMaintenanceTask,
  SyncRequestActivity,
  SyncLocalChange,
  SyncInitialPlan,
  SyncInitialBatch,
  SyncAdapterRequest,
  SyncClientRequestOptions,
  SyncServiceSaveState,
} from "./engine/sync-service";


// ============================================================
// Clients: 通用存储客户端接口
// ============================================================
export type {
  RemoteApplyResult,
  RemoteAssetContent,
  RemoteAssetMeta,
  RemoteAssetPutParams,
  RemoteAssetRef,
  RemoteAssetTombstoneParams,
  RemoteCheckResult,
  RemoteCollectionIndex,
  RemoteWriteBatchResult,
  RemoteWriteResult,
  SyncAssetType,
  SyncContentHashRequest,
  SyncHashAlgorithm,
  SyncLocalState,
  SyncRemote,
  SyncRemoteAdapterMode,
  SyncRemoteAssetIdCodec,
  SyncRemoteCollection,
  SyncRemoteCompleteOptions,
  SyncRemoteSession,
  SyncRemoteSessionContext,
  SyncRemoteWebDavBinding,
  SyncRemoteWriteBatch,
} from "./clients";
export {
  isRemoteSyncStaleError,
  RemoteDownloadStaleError,
  RemoteWriteConflictError,
} from "./clients";

export {
  createSyncAssetKey,
  createSyncRemoteCollection,
} from "./remote-collections";

export type {
  SyncStorageClient,
  SyncClientOptions,
  SyncWriteOptions,
  SyncReadOptions,
  SyncTextFile,
  SyncResourceStat,
} from "./clients/types";


export type { SyncRunReason } from "@/domain/sync";

// ============================================================
// Clients: WebDAV 具体实现
// ============================================================
export {
  createWebDavStorageClient,
} from "./clients/webdav/webdav-client";

export {
  createWebDavWorkerStorageClient,
} from "./clients/webdav/webdav-worker-client";
export type {
  WebDavWorkerRequestActivity,
  WebDavWorkerStorageClientOptions,
} from "./clients/webdav/webdav-worker-client";

export {
  createWebDavSyncRemote,
  WebDavSyncRemote,
  type WebDavSyncRemoteOptions,
} from "./clients/webdav/webdav-remote";

// ============================================================
// Storage
// ============================================================
export {
  clearLastSeenRemoteRevision,
  clearLastSeenRemoteEtag,
  clearLastSyncedContentHash,
  clearSyncMetadata,
  readLastSeenRemoteEtag,
  readLastSeenRemoteRevision,
  readLastSyncedContentHash,
  SYNC_METADATA_LOCAL_STORAGE_KEY,
  writeLastSeenRemoteEtag,
  writeLastSeenRemoteRevision,
  writeLastSyncedContentHash,
} from "./storage/sync-metadata";

export {
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  MAX_MAX_CONCURRENT_REQUESTS,
  MIN_MAX_CONCURRENT_REQUESTS,
  readSyncConnectionSettings,
  subscribeToSyncConnectionSettingsChanges,
  writeSyncConnectionSettings,
} from "./storage/sync-connection-settings";
export type {
  SyncConnectionSettings,
  SyncConnectionSettingsChangeListener,
} from "./storage/sync-connection-settings";
