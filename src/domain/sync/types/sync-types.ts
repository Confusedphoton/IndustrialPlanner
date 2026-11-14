export type SyncPhase = "idle" | "uploading" | "downloading" | "error";

export type SyncSaveState = "idle" | "pending" | "saving" | "error";

export type SyncInitialSyncStage =
  | "canvas"
  | "blueprints"
  | "modules"
  | "toolbox"
  | "ready";

export type SyncConflictResolution = "use-local" | "use-remote" | "pause";

export type SyncConflictPhase =
  | "discovering"
  | "awaiting-resolution"
  | "applying";

export type SyncRunReason =
  | "startup"
  | "foreground"
  | "interval"
  | "local-change"
  | "settings-change"
  | "manual";

export type SyncTaskKind =
  | "canvas"
  | "blueprints"
  | "modules"
  | "toolbox"
  | "background-documents"
  | "directory-maintenance"
  | "update-check";

export type SyncTaskPhase =
  | "idle"
  | "queued"
  | "running"
  | "success"
  | "error";

export type SyncTaskDirection = "upload" | "download";

export interface SyncTaskStatus {
  readonly kind: SyncTaskKind;
  readonly phase: SyncTaskPhase;
  readonly direction: SyncTaskDirection | null;
  readonly completedUnitCount: number;
  readonly totalUnitCount: number;
  readonly lastStartedAt: string | null;
  readonly lastFinishedAt: string | null;
  readonly lastError: string | null;
}

export interface SyncSettings {
  readonly enabled: boolean;
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly maxConcurrentRequests: number;
}

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly saveState: SyncSaveState;
  readonly currentLocalRevision: string | null;
  readonly initialSyncStage: SyncInitialSyncStage;
  readonly hasCompletedInitialFeatureSync: boolean;
  readonly currentRunReason: SyncRunReason | null;
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
  readonly tasks: readonly SyncTaskStatus[];
  readonly pendingLocalChangeCount: number;
  readonly saveError: string | null;
  readonly lastUploadAt: string | null;
  readonly lastDownloadAt: string | null;
  readonly lastError: string | null;
  readonly lastUpdateCheckAt: string | null;
  /** 下载不容忍中止后锁定画布，阻断继续编辑直到本轮同步结束。 */
  readonly canvasLocked: boolean;
}


export type SyncConflictItemKind = "upload" | "download" | "conflict";

export interface SyncConflictItem {
  readonly adapterId: string;
  readonly assetId: string;
  /** 条目类型：上传（默认用我的）、下载（默认用远端）或双向冲突。 */
  readonly kind: SyncConflictItemKind;
  readonly remoteUpdatedAt: string | null;
  readonly remoteUnavailableReason?: "unsupported-schema" | "invalid-content";
}

export interface SyncConflictDecision {
  readonly adapterId: string;
  readonly assetId: string;
  readonly resolution: SyncConflictResolution;
}

export interface SyncPendingConflict {
  readonly phase: SyncConflictPhase;
  readonly items: readonly SyncConflictItem[];
}

export interface SyncAssetEntry<TValue = unknown> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export type SyncAssetSourceMode =
  | "full-with-revision"
  | "patch-with-revision";

/**
 * 顶层业务模块向同步模块提供的资源端口。
 *
 * `remotePath` 在 full 模式下是单个资源文件路径，在 patch 模式下是资源目录路径。
 * 端口只描述业务资源，不暴露 WebDAV、队列或网络实现。
 */
export interface SyncAssetSource<TValue = unknown> {
  readonly id: string;
  readonly mode: SyncAssetSourceMode;
  readonly indexPath: string;
  readonly remotePath: (assetId: string) => string;
  readonly listLocal: () => Promise<readonly SyncAssetEntry<TValue>[]>;
  readonly writeLocal: (entry: SyncAssetEntry<TValue>) => Promise<void>;
  /** 未来 schema 由旧客户端静默跳过，不得落地、回写或推进同步游标。 */
  readonly isRemoteVersionUnsupported?: (value: unknown) => boolean;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly subscribe: (listener: () => void) => () => void;
}
