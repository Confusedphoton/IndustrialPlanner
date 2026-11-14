import { RemoteAssetUnavailableError } from "../clients";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import { createLogger } from "@/shared/logging/logger";
import type { SyncConflictItem, SyncConflictItemKind } from "@/domain/sync";
import type {
  RemoteAssetMeta,
  RemoteAssetPutParams,
  RemoteAssetTombstoneParams,
  SyncRemoteAdapterMode,
  SyncRemoteCollection,
  SyncRemoteSession,
  SyncRemoteWriteBatch,
  SyncStorageClient,
  SyncWriteOptions,
} from "../clients";
import {
  applyJsonPatch,
  generateJsonPatch,
  type JsonPatchOperation,
} from "@/shared/storage/json-patch-codec";
import {
  createSyncAssetKey,
  createSyncRemoteCollection,
} from "../remote-collections";
import {
  clearLastSeenRemoteEtag,
  readLastSeenRemoteRevision,
  writeLastSeenRemoteRevision,
} from "../storage";

const logger = createLogger("sync-adapter");

export type SyncAdapterMode = SyncRemoteAdapterMode;
export type SyncAdapterConflictResolution = "use-local" | "use-remote" | "pause";
export type SyncAdapterStatus = "idle" | "uploaded" | "downloaded" | "conflict" | "skipped";

export interface SyncAdapterResult {
  readonly adapterId: string;
  readonly mode: SyncAdapterMode;
  readonly status: SyncAdapterStatus;
  readonly changedAssetIds: readonly string[];
  /** 存在当前客户端无法解释的远端版本；禁止推进 collection/global 已应用游标。 */
  readonly remoteStateIncomplete?: boolean;
  /** 本轮观察到的 collection revision；引擎在 commit 成功后用于 markApplied。 */
  readonly collectionRevision?: number | null;
  /** 本轮观察到的 collection ETag；本 adapter 有上传时传 null 使检查重新探测。 */
  readonly collectionEtag?: string | null;
}

export interface SyncAdapterConflict<TValue> {
  readonly adapterId: string;
  readonly assetId: string;
  /** 弹框条目类型：upload（默认用我的）/ download（默认用远端）/ conflict（双向）。 */
  readonly kind?: SyncConflictItemKind;
  readonly localValue: TValue;
  readonly remoteValue: TValue | null;
  readonly localHash: string;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly remoteUnavailableReason?: SyncConflictItem["remoteUnavailableReason"];
}

export interface SyncAdapterConflictDecision {
  readonly adapterId: string;
  readonly assetId: string;
  readonly localHash: string;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly resolution: SyncAdapterConflictResolution;
}

// ============================================================================
// 同步引擎事务 — 先下载、后上传、单次 commit 的执行上下文
// ============================================================================

export type SyncPlanItemKind = "upload" | "download" | "conflict";
export type SyncLocalChangeState = "dirty" | "clean" | "unknown";

/**
 * 引擎级计划条目：一个资产的分类结果与决议执行句柄。
 * 弹框按条目逐项选择；引擎按决议调用 applyDownload / applyUpload / applyLocalRestore。
 */
export interface SyncPlanItem {
  readonly adapterId: string;
  readonly assetId: string;
  readonly kind: SyncPlanItemKind;
  readonly localValue: unknown;
  readonly remoteValue: unknown | null;
  readonly localHash: string | null;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
  /** 决议为“用远端”时执行；墓碑走二段删除，非墓碑立即下载落地。 */
  readonly applyDownload: () => Promise<void>;
  /** 决议为“用我的”时执行：登记上传 mutation + 暂存 touch。 */
  readonly applyUpload: () => Promise<void>;
  /** 下载条目改判“用我的”时恢复本地原值（之后引擎再登记上传）。 */
  readonly applyLocalRestore: () => Promise<void>;
  /**
   * 上传条目改判“用远端”时执行：放弃本地新增。
   * 本地资产按远端墓碑语义二段删除（commit 成功后才落地），touch 清空，
   * 使该资产若日后重新编辑，可再次按“远端从未存在”上传新增。
   */
  readonly applyDiscardLocal: () => Promise<void>;
  readonly remoteUnavailableReason?: SyncConflictItem["remoteUnavailableReason"];
}

export interface SyncPlanUpload {
  readonly adapterId: string;
  readonly assetId: string;
  readonly params: RemoteAssetPutParams | RemoteAssetTombstoneParams;
}

/**
 * 引擎在单轮同步内注入的事务对象。
 * adapter 只负责分类、下载落地与登记；上传 commit、touch 落盘、
 * 二段删除落地全部由引擎在 commit 成功后统一执行。
 */
export interface SyncEngineTransaction {
  /** 收齐已采纳输入后才统一落地；版本转换输入在全局冻结中提交。 */
  stageDownload?(key: string, value: { readonly label: string; readonly requiresMigration: boolean; readonly run: () => Promise<void> }): void;
  unstageDownload?(key: string): void;
  /** 共享上传批次；commit 由引擎在全部下载完成后执行。 */
  readonly writeBatch: SyncRemoteWriteBatch;
  /** 暂存 touch（lastSyncedHash），commit 成功后由引擎统一落盘。 */
  stageTouch(assetKey: string, contentHash: string | null): void;
  /** 暂存二段删除：commit 成功后执行；commit 失败或本轮被丢弃时不会执行。 */
  stageDeletion(adapterId: string, assetId: string, apply: () => Promise<void>): void;
  /** 登记弹框条目（upload / download / conflict）。 */
  recordItem(item: SyncPlanItem): void;
  /** 登记上传 mutation；由引擎在弹框决议后写入共享批次。 */
  recordUpload(upload: SyncPlanUpload): void;
  /** 下载落地前检查二代脏标；置位则抛 SyncDownloadDirtyAbortError 终止本轮。 */
  assertDownloadAllowed(adapterId: string, assetId: string): Promise<void>;
  /** 本轮开始时的本地变更状态；clean 可直接复用持久化 touch hash。 */
  getLocalChangeState?(adapterId: string, assetId: string): SyncLocalChangeState;
  /** 真正开始应用远端内容时通知引擎切换下载阶段。 */
  beginDownload?(): void;
}

/** 下载不容忍：落地前发现第二代脏标。引擎捕获后锁定画布并从头重跑。 */
export class SyncDownloadDirtyAbortError extends Error {
  public constructor(
    public readonly adapterId: string,
    public readonly assetId: string,
  ) {
    super(`Download aborted — asset ${adapterId}/${assetId} was edited during sync.`);
    this.name = "SyncDownloadDirtyAbortError";
  }
}

export interface SyncAdapterSyncOptions {
  readonly scope?: SyncAdapterScope;
  readonly transaction: SyncEngineTransaction;
}

export interface SyncAdapter {
  readonly id: string;
  readonly mode: SyncAdapterMode;
  readonly collection: SyncRemoteCollection;
  readonly checkPath: string | null;
  sync(
    session: SyncRemoteSession,
    options: SyncAdapterSyncOptions,
  ): Promise<SyncAdapterResult>;
}

export interface SyncAdapterScope {
  readonly includeAssetIds?: readonly string[];
  readonly excludeAssetIds?: readonly string[];
  readonly onProgress?: (progress: number) => void;
  readonly conflictDecisions?: readonly SyncAdapterConflictDecision[];
}

export interface FullNoRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly collection?: SyncRemoteCollection;
  readonly remotePath: string;
  readonly readLocal: () => Promise<TValue | null>;
  readonly writeLocal: (value: TValue) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
}

export interface FullWithRevisionEntry<TValue> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export interface FullWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly collection?: SyncRemoteCollection;
  readonly indexPath: string;
  readonly entryPath: (entryId: string) => string;
  readonly listLocal: (
    scope?: SyncAdapterScope,
  ) => Promise<readonly FullWithRevisionEntry<TValue>[]>;
  readonly writeLocal: (entry: FullWithRevisionEntry<TValue>) => Promise<void>;
  readonly isRemoteVersionUnsupported?: (value: unknown) => boolean;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
  readonly recoverUnavailableRemote?: boolean;
}

export interface PatchWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly collection?: SyncRemoteCollection;
  readonly directoryPath: string;
  readonly readLocal: () => Promise<TValue | null>;
  readonly writeLocal: (value: TValue) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly deltaThreshold?: number;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
}

export interface PatchWithRevisionEntry<TValue> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export interface PatchCollectionWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly collection?: SyncRemoteCollection;
  readonly indexPath: string;
  readonly directoryPath: (entryId: string) => string;
  readonly listLocal: (
    scope?: SyncAdapterScope,
  ) => Promise<readonly PatchWithRevisionEntry<TValue>[]>;
  readonly writeLocal: (entry: PatchWithRevisionEntry<TValue>) => Promise<void>;
  /** 仅在用户对远端独有资产明确选择“使用我的”时，将本地缺席解释为远端删除。 */
  readonly deleteRemoteOnlyOnUseLocal?: (assetId: string) => boolean;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly deltaThreshold?: number;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
  readonly recoverUnavailableRemote?: boolean;
  readonly isRemoteVersionUnsupported?: (value: unknown) => boolean;
}

interface RemoteIndexFile {
  readonly revision: number;
  readonly entries: Record<string, RemoteIndexEntry>;
}

interface RemoteIndexState {
  readonly index: RemoteIndexFile;
  readonly etag: string | null;
  readonly canonicalEtag: string | null;
  readonly canonicalMissing: boolean;
  readonly lastModified: string | null;
}

interface RemoteIndexEntry {
  readonly revision?: number;
  readonly contentHash: string;
  readonly protocolContentHash?: string | null;
  readonly deletedAt: string | null;
  readonly committedAt: string | null;
}

interface RemotePatchMetaFile {
  readonly revision: number;
  readonly currentFullHash: string;
  readonly deltaChain: readonly string[];
  readonly deltaThreshold: number;
  readonly committedAt: string | null;
}

interface RemotePatchMetaState {
  readonly meta: RemotePatchMetaFile;
  readonly etag: string | null;
  readonly canonicalMissing: boolean;
  readonly lastModified: string | null;
}

interface NormalizedRemoteAsset<TValue> {
  readonly value: TValue;
  /** 适配器归一化后的本地比较 hash。 */
  readonly contentHash: string;
  /** 远端结构化原值是否被适配器归一化；用于将 schema 迁移结果回写远端。 */
  readonly normalizationChanged: boolean;
  /** 远端协议返回的权威 hash，只能用于下一次乐观并发基线。 */
  readonly remoteContentHash: string;
  readonly revision: number;
  readonly committedAt: string | null;
  readonly etag: string | null;
}


async function createSyncContentHash(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  value: unknown,
): Promise<string> {
  const [hash] = await session.computeContentHashes([{
    algorithm: collection.hashAlgorithm,
    value,
  }]);
  if (hash === undefined) {
    throw new Error(`Content hash worker returned no result for "${collection.adapterId}".`);
  }
  return hash;
}

async function readRemoteAssetValue<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  assetId: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
  isRemoteVersionUnsupported?: (value: unknown) => boolean,
  onUnsupportedRemoteVersion?: () => void,
  onUnavailable?: (reason: NonNullable<SyncConflictItem["remoteUnavailableReason"]>) => Promise<void>,
): Promise<NormalizedRemoteAsset<TValue> | null> {
  const asset = await session.readAsset({ collection, assetId }).catch(async (error: unknown) => {
    if (onUnavailable !== undefined && error instanceof RemoteAssetUnavailableError) {
      await onUnavailable("invalid-content");
      return null;
    }
    throw error;
  });
  if (asset === null) {
    if (onUnavailable !== undefined) await onUnavailable("invalid-content");
    return null;
  }

  const parsed = asset.value;
  if (isRemoteVersionUnsupported?.(parsed) === true) {
    if (onUnavailable !== undefined) { await onUnavailable("unsupported-schema"); return null; }
    logger.info(
      `Remote asset ${collection.adapterId}/${assetId} uses a newer schema version → skipping`,
    );
    onUnsupportedRemoteVersion?.();
    return null;
  }
  let value: TValue | null;
  try { value = normalizeRemote === undefined ? parsed as TValue : normalizeRemote(parsed); }
  catch (error) {
    if (onUnavailable === undefined) throw error;
    await onUnavailable("invalid-content");
    return null;
  }
  if (value === null) {
    if (onUnavailable !== undefined) { await onUnavailable("invalid-content"); return null; }
    throw new Error(
      `Remote asset ${collection.adapterId}/${assetId} failed schema normalization.`,
    );
  }

  return {
    value,
    contentHash: await createSyncContentHash(session, collection, value),
    normalizationChanged:
      normalizeRemote !== undefined
      && createStableJsonHash(parsed) !== createStableJsonHash(value),
    remoteContentHash: asset.contentHash,
    revision: asset.revision,
    committedAt: asset.committedAt,
    etag: asset.etag ?? null,
  };
}



function resolveRemoteBaseContentHash(
  entry: RemoteIndexEntry | RemoteAssetMeta | null | undefined,
): string | null {
  const protocolHash = (entry as RemoteIndexEntry | null | undefined)?.protocolContentHash ?? null;
  return protocolHash ?? entry?.contentHash ?? null;
}

/** 索引 hash 是否处于可与本地口径 hash 直接比较的口径（fallback 口径不得比较）。 */
function isIndexHashComparable(
  entry: RemoteAssetMeta | null | undefined,
): boolean {
  return (entry?.contentHashCaliber ?? "adapter") !== "protocol-fallback";
}

// ============================================================================
// 三值分类（lastSyncedHash 为基线）
// ============================================================================

type SingleValueClassification =
  | { readonly kind: "idle" }
  | { readonly kind: "upload" }
  | { readonly kind: "download" }
  | { readonly kind: "conflict" };

interface ClassifySingleValueOptions {
  readonly localValue: unknown | null;
  readonly remoteValue: unknown | null;
  readonly localHash: string | null;
  readonly remoteHash: string | null;
  readonly lastSyncedHash: string | null;
  /** 远端资产消失时是否允许解释为“远端墓碑下载”（否则解释为本地新增上传）。 */
  readonly supportsRemoteTombstone: boolean;
  /** 定位埋点标签（adapterId/assetId），仅当判定为 conflict 时输出三方 hash 调试日志。 */
  readonly debugLabel?: string;
}

function classifySingleValue(options: ClassifySingleValueOptions): SingleValueClassification {
  // 定位埋点：conflict 判定时输出三方 hash，用于追溯 409 重启后假 conflict 的错位源。
  const conflict = (): SingleValueClassification => {
    if (options.debugLabel !== undefined) {
      logger.debug(
        `${options.debugLabel}: classified conflict — `
        + `localHash=${options.localHash ?? "null"} `
        + `remoteHash=${options.remoteHash ?? "null"} `
        + `lastSyncedHash=${options.lastSyncedHash ?? "null"}`,
      );
    }
    return { kind: "conflict" };
  };

  if (options.localValue === null && options.remoteValue === null) {
    return { kind: "idle" };
  }

  if (options.localValue !== null && options.remoteValue === null) {
    // 本地有、远端无。
    if (options.supportsRemoteTombstone && options.lastSyncedHash !== null) {
      if (options.localHash === options.lastSyncedHash) {
        // 曾同步过且本地未改 → 远端墓碑下载（二段删除）。
        return { kind: "download" };
      }
      // 曾同步过且本地已改 → 冲突。
      return conflict();
    }
    // 远端从未存在（或不支持墓碑的 adapter）→ 上传新增。
    return { kind: "upload" };
  }

  if (options.localValue === null && options.remoteValue !== null) {
    return { kind: "download" };
  }

  if (options.localHash === null || options.remoteHash === null) {
    return { kind: "idle" };
  }

  if (options.localHash === options.remoteHash) {
    return { kind: "idle" };
  }

  if (options.lastSyncedHash === options.remoteHash) {
    // 本地改了、远端没变 → 静默上传。
    return { kind: "upload" };
  }

  if (options.lastSyncedHash === options.localHash) {
    // 远端改了、本地没变 → 静默采用远端。
    return { kind: "download" };
  }

  return conflict();
}

// ============================================================================
// 计划条目构造
// ============================================================================

interface CreatePlanItemOptions<TValue> {
  readonly session: SyncRemoteSession;
  readonly collection: SyncRemoteCollection;
  readonly transaction: SyncEngineTransaction;
  readonly adapterId: string;
  readonly assetId: string;
  readonly kind: SyncPlanItemKind;
  readonly localValue: TValue | null;
  readonly localDeletedAt: string | null;
  readonly localHash: string | null;
  readonly remoteValue: TValue | null;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly writeLocal: (value: TValue, deletedAt: string | null) => Promise<void>;
  /** 远端独有且本地无值时，“使用我的”的显式处理；默认保持原有跳过语义。 */
  readonly onUseLocalWithoutLocalValue?: () => Promise<void>;
  /** 远端墓碑落地（二段删除）；不提供则该 asset 不支持墓碑下载。 */
  readonly applyRemoteTombstone: ((remoteDeletedAt: string) => Promise<void>) | null;
  /** 读取远端资产（决策翻转为“用远端”时执行下载）。 */
  readonly readRemoteValue: () => Promise<NormalizedRemoteAsset<TValue> | null>;
  /** 构造正文上传参数。 */
  readonly createPutParams: (
    value: TValue,
    contentHash: string,
  ) => Promise<RemoteAssetPutParams>;
  /** 构造墓碑上传参数；不提供则该 asset 不支持墓碑上传。 */
  readonly createTombstoneParams: ((
    value: TValue,
    deletedAt: string,
    contentHash: string,
  ) => Promise<RemoteAssetTombstoneParams>) | null;
}

/**
 * 构造计划条目。下载落地（含脏标代际检查）统一走 applyDownload；
 * 上传登记（mutation + touch 暂存）统一走 applyUpload。
 */
function createPlanItem<TValue>(options: CreatePlanItemOptions<TValue>): SyncPlanItem {
  const {
    session,
    collection,
    transaction,
    adapterId,
    assetId,
    kind,
    localValue,
    localDeletedAt,
    localHash,
    remoteDeletedAt,
  } = options;
  const assetKey = createSyncAssetKey(collection, assetId);

  const applyDownload = async (): Promise<void> => {
    await transaction.assertDownloadAllowed(adapterId, assetId);
    transaction.beginDownload?.();
    if (remoteDeletedAt !== null) {
      if (options.applyRemoteTombstone === null) {
        logger.warn(`${adapterId}/${assetId}: remote tombstone not supported → skipping`);
        return;
      }
      transaction.stageDeletion(adapterId, assetId, () =>
        options.applyRemoteTombstone!(remoteDeletedAt));
      transaction.stageTouch(assetKey, options.remoteHash);
      return;
    }

    const remoteAsset = await options.readRemoteValue();
    if (remoteAsset === null) {
      logger.warn(`${adapterId}/${assetId}: use-remote but remote asset not found → skipping`);
      return;
    }
    const apply = async () => {
      await transaction.assertDownloadAllowed(adapterId, assetId);
      await options.writeLocal(remoteAsset.value, null);
      transaction.stageTouch(assetKey, remoteAsset.contentHash);
      if (remoteAsset.normalizationChanged) {
        // 已采纳远端的升级属于本轮本地回写，复用远端 revision 校验，不另建冲突决议。
        transaction.recordUpload({ adapterId, assetId, params: await options.createPutParams(remoteAsset.value, remoteAsset.contentHash) });
      }
    };
    if (transaction.stageDownload) transaction.stageDownload(assetKey, {
      label: "下载内容", requiresMigration: remoteAsset.normalizationChanged, run: apply,
    });
    else await apply();
  };

  const applyUpload = async (): Promise<void> => {
    transaction.unstageDownload?.(assetKey);
    if (localDeletedAt !== null) {
      if (options.createTombstoneParams === null || localValue === null) {
        logger.warn(`${adapterId}/${assetId}: local tombstone upload not supported → skipping`);
        return;
      }
      const targetContentHash = await createSyncContentHash(session, collection, null);
      const params = await options.createTombstoneParams(
        localValue,
        localDeletedAt,
        targetContentHash,
      );
      transaction.recordUpload({ adapterId, assetId, params });
      transaction.stageTouch(assetKey, localHash);
      return;
    }

    // 本地缺席代表删除远端；具体墓碑与本地清理在适配器提供的回调中登记。
    if (localValue === null && options.onUseLocalWithoutLocalValue !== undefined) {
      await options.onUseLocalWithoutLocalValue();
      return;
    }
    if (localValue === null || localHash === null) {
      logger.warn(`${adapterId}/${assetId}: use-local but local value not found → skipping`);
      return;
    }
    const params = await options.createPutParams(localValue, localHash);
    transaction.recordUpload({ adapterId, assetId, params });
    transaction.stageTouch(assetKey, localHash);
  };

  const applyLocalRestore = async (): Promise<void> => {
    transaction.unstageDownload?.(assetKey);
    if (localValue === null) {
      return;
    }
    await options.writeLocal(localValue, localDeletedAt);
  };

  // 本地资产删除（远端墓碑落地，二段式：commit 成功后才执行删除），touch 清空。
  // 原实现走 applyDownload 的“远端资产不存在 → skipping”分支，本地原样保留、不上传，
  // 但本轮同步照常推进 acknowledged 与脏标清理，制造“已同步”假象，
  // 使真实上传被推迟到不可预期的下一轮同步（全量重新分类时），进而污染以
  // 空间 revision 为等待信号的调用方。
  const applyDiscardLocal = async (): Promise<void> => {
    await transaction.assertDownloadAllowed(adapterId, assetId);
    transaction.beginDownload?.();
    if (options.applyRemoteTombstone === null) {
      logger.warn(
        `${adapterId}/${assetId}: local discard not supported → skipping`,
      );
      return;
    }
    transaction.stageDeletion(adapterId, assetId, () =>
      options.applyRemoteTombstone!(new Date().toISOString()));
    transaction.stageTouch(assetKey, null);
  };

  return {
    adapterId,
    assetId,
    kind,
    localValue: localValue as unknown,
    remoteValue: options.remoteValue as unknown | null,
    localHash,
    remoteHash: options.remoteHash,
    remoteDeletedAt,
    remoteUpdatedAt: options.remoteUpdatedAt,
    applyDownload,
    applyUpload,
    applyLocalRestore,
    applyDiscardLocal,
  };
}


export function createFullNoRevisionAdapter<TValue>(
  options: FullNoRevisionAdapterOptions<TValue>,
): SyncAdapter {
  const collection = options.collection ?? createSyncRemoteCollection({
    adapterId: options.id,
    mode: "full-no-revision",
    stateKey: options.remotePath,
    webDav: {
      kind: "full-no-revision",
      remotePath: options.remotePath,
    },
  });

  return {
    id: options.id,
    mode: "full-no-revision",
    collection,
    checkPath: options.remotePath,
    sync: async (session, syncOptions) => await syncFullNoRevision(
      session,
      collection,
      options,
      syncOptions,
    ),
  };
}

export function createFullWithRevisionAdapter<TValue>(
  options: FullWithRevisionAdapterOptions<TValue>,
): SyncAdapter {
  const collection = options.collection ?? createSyncRemoteCollection({
    adapterId: options.id,
    mode: "full-with-revision",
    stateKey: options.indexPath,
    webDav: {
      kind: "full-with-revision",
      indexPath: options.indexPath,
      entryPath: options.entryPath,
    },
  });

  return {
    id: options.id,
    mode: "full-with-revision",
    collection,
    checkPath: options.indexPath,
    sync: async (session, syncOptions) => await syncFullWithRevision(
      session,
      collection,
      options,
      syncOptions,
    ),
  };
}

export function createPatchWithRevisionAdapter<TValue>(
  options: PatchWithRevisionAdapterOptions<TValue>,
): SyncAdapter {
  const metaPath = `${options.directoryPath}/meta.json`;
  const collection = options.collection ?? createSyncRemoteCollection({
    adapterId: options.id,
    mode: "patch-with-revision",
    stateKey: metaPath,
    webDav: {
      kind: "patch-with-revision",
      directoryPath: options.directoryPath,
      ...(options.deltaThreshold === undefined ? {} : { deltaThreshold: options.deltaThreshold }),
    },
  });

  return {
    id: options.id,
    mode: "patch-with-revision",
    collection,
    checkPath: metaPath,
    sync: async (session, syncOptions) => await syncPatchWithRevision(
      session,
      collection,
      options,
      syncOptions,
    ),
  };
}

export function createPatchCollectionWithRevisionAdapter<TValue>(
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
): SyncAdapter {
  const collection = options.collection ?? createSyncRemoteCollection({
    adapterId: options.id,
    mode: "patch-with-revision",
    stateKey: options.indexPath,
    webDav: {
      kind: "patch-collection-with-revision",
      indexPath: options.indexPath,
      directoryPath: options.directoryPath,
      ...(options.deltaThreshold === undefined ? {} : { deltaThreshold: options.deltaThreshold }),
    },
  });

  return {
    id: options.id,
    mode: "patch-with-revision",
    collection,
    checkPath: options.indexPath,
    sync: async (session, syncOptions) => await syncPatchCollectionWithRevision(
      session,
      collection,
      options,
      syncOptions,
    ),
  };
}


async function syncFullNoRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: FullNoRevisionAdapterOptions<TValue>,
  syncOptions: SyncAdapterSyncOptions,
): Promise<SyncAdapterResult> {
  const { transaction } = syncOptions;
  const assetId = "single";
  const assetKey = createSyncAssetKey(collection, assetId);
  const localValue = await options.readLocal();
  const remoteAsset = await readRemoteAssetValue(
    session,
    collection,
    assetId,
    options.normalizeRemote,
  );
  const remoteValue = remoteAsset?.value ?? null;
  const lastSyncedHash = await session.localState.getLastSyncedHash(assetKey);
  const localHash = localValue === null
    ? null
    : await createSyncContentHash(session, collection, localValue);
  const remoteHash = remoteValue === null
    ? null
    : await createSyncContentHash(session, collection, remoteValue);
  const classification = classifySingleValue({
    localValue,
    remoteValue,
    localHash,
    remoteHash,
    lastSyncedHash,
    // full-no-revision 没有墓碑存储，远端消失一律解释为本地新增上传。
    supportsRemoteTombstone: false,
    debugLabel: `${options.id}/${assetId}`,
  });

  let status: SyncAdapterStatus = "idle";
  if (classification.kind === "idle") {
    if (localHash !== null && localHash === remoteHash) {
      transaction.stageTouch(assetKey, localHash);
    }
  } else if (classification.kind === "download") {
    const item = createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId,
      kind: "download",
      localValue,
      localDeletedAt: null,
      localHash,
      remoteValue,
      remoteHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: remoteAsset?.committedAt ?? null,
      writeLocal: async (value) => {
        await options.writeLocal(value);
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, assetId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId,
        value,
        contentHash,
        baseRevision: remoteAsset?.revision ?? null,
        baseContentHash: remoteAsset?.remoteContentHash ?? null,
      }),
      createTombstoneParams: null,
    });
    transaction.recordItem(item);
    await item.applyDownload();
    status = "downloaded";
  } else if (classification.kind === "upload") {
    transaction.recordItem(createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId,
      kind: "upload",
      localValue,
      localDeletedAt: null,
      localHash,
      remoteValue,
      remoteHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: remoteAsset?.committedAt ?? null,
      writeLocal: async (value) => {
        await options.writeLocal(value);
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, assetId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId,
        value,
        contentHash,
        baseRevision: remoteAsset?.revision ?? null,
        baseContentHash: remoteAsset?.remoteContentHash ?? null,
      }),
      createTombstoneParams: null,
    }));
    status = "uploaded";
  } else {
    transaction.recordItem(createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId,
      kind: "conflict",
      localValue,
      localDeletedAt: null,
      localHash,
      remoteValue,
      remoteHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: remoteAsset?.committedAt ?? null,
      writeLocal: async (value) => {
        await options.writeLocal(value);
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, assetId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId,
        value,
        contentHash,
        baseRevision: remoteAsset?.revision ?? null,
        baseContentHash: remoteAsset?.remoteContentHash ?? null,
      }),
      createTombstoneParams: null,
    }));
    status = "conflict";
  }

  return {
    adapterId: options.id,
    mode: "full-no-revision",
    status,
    changedAssetIds: status === "idle" ? [] : ["single"],
    collectionRevision: remoteAsset?.revision ?? null,
    collectionEtag: status === "uploaded" ? null : remoteAsset?.etag ?? null,
  };
}

async function syncFullWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: FullWithRevisionAdapterOptions<TValue>,
  syncOptions: SyncAdapterSyncOptions,
): Promise<SyncAdapterResult> {
  const { transaction } = syncOptions;
  const scope = syncOptions.scope;
  const localEntries = (await options.listLocal(scope)).filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  const remoteIndexState = await session.readIndex(collection);
  const changedAssetIds: string[] = [];
  const unavailableAssetIds = new Set<string>();
  let status: SyncAdapterStatus = "idle";
  let remoteStateIncomplete = false;
  const unsupportedRemoteAssetIds = new Set<string>();
  const readRemoteEntry = async (assetId: string): Promise<NormalizedRemoteAsset<TValue> | null> =>
    await readRemoteAssetValue(
      session,
      collection,
      assetId,
      options.normalizeRemote,
      options.isRemoteVersionUnsupported,
      () => {
        remoteStateIncomplete = true;
        unsupportedRemoteAssetIds.add(assetId);
      },
      onUnavailable(assetId),
    );
  const localHashStatesById = await resolveLocalHashStates({
    session,
    collection,
    transaction,
    adapterId: options.id,
    localEntries,
  });
  const localContentHashesById = new Map(Array.from(
    localHashStatesById,
    ([assetId, state]) => [assetId, state.contentHash] as const,
  ));

  const onUnavailable = (assetId: string) => options.recoverUnavailableRemote !== true
    || remoteIndexState.entries[assetId] === undefined
    || remoteIndexState.entries[assetId]?.deletedAt !== null ? undefined
    : async (reason: NonNullable<SyncConflictItem["remoteUnavailableReason"]>) => {
      if (unavailableAssetIds.has(assetId)) return;
      const meta = remoteIndexState.entries[assetId];
      if (meta === undefined) throw new Error("Cannot repair remote content without its index identity.");
      unavailableAssetIds.add(assetId);
      changedAssetIds.push(assetId);
      transaction.recordItem(createUnavailableRemoteItem({
        session, collection, transaction, assetId, reason, meta,
        local: localEntryById.get(assetId) ?? null,
        localHash: localContentHashesById.get(assetId) ?? null,
      }));
    };

  const remoteValuesByLocalId = new Map(await Promise.all(localEntries.flatMap((entry) => {
    const remoteEntry = remoteIndexState.entries[entry.id];
    if (
      remoteEntry !== undefined
      && (
        remoteEntry.deletedAt !== null
        || (
          entry.deletedAt === null
          && isIndexHashComparable(remoteEntry)
          && localContentHashesById.get(entry.id) === remoteEntry.contentHash
        )
      )
    ) {
      return [];
    }

    return [readRemoteEntry(entry.id).then((value) => [entry.id, value] as const)];
  })));

  const createEntryItem = (
    localEntry: FullWithRevisionEntry<TValue>,
    kind: SyncPlanItemKind,
    itemRemote: {
      readonly remoteValue: TValue | null;
      readonly remoteHash: string | null;
      readonly remoteDeletedAt: string | null;
      readonly remoteUpdatedAt: string | null;
    },
  ): SyncPlanItem => {
    const remoteEntry = remoteIndexState.entries[localEntry.id] ?? null;
    return createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId: localEntry.id,
      kind,
      localValue: localEntry.value,
      localDeletedAt: localEntry.deletedAt,
      localHash: localContentHashesById.get(localEntry.id) ?? null,
      remoteValue: itemRemote.remoteValue,
      remoteHash: itemRemote.remoteHash,
      remoteDeletedAt: itemRemote.remoteDeletedAt,
      remoteUpdatedAt: itemRemote.remoteUpdatedAt,
      writeLocal: async (value, deletedAt) => {
        await options.writeLocal({ id: localEntry.id, value, deletedAt });
      },
      applyRemoteTombstone: async (remoteDeletedAt) => {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteDeletedAt,
        });
      },
      readRemoteValue: async () => await readRemoteEntry(localEntry.id),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId: localEntry.id,
        value,
        contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
      }),
      createTombstoneParams: async (_value, deletedAt, contentHash) => ({
        collection,
        assetId: localEntry.id,
        deletedAt,
        targetContentHash: contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
      }),
    });
  };

  for (const localEntry of localEntries) {
    if (unavailableAssetIds.has(localEntry.id)) continue;
    const remoteEntry = remoteIndexState.entries[localEntry.id] ?? null;
    const assetKey = createSyncAssetKey(collection, localEntry.id);
    const localContentHash = localContentHashesById.get(localEntry.id)
      ?? await createSyncContentHash(session, collection, localEntry.value);
    const localHashState = localHashStatesById.get(localEntry.id);
    const lastSyncedHash = localHashState === undefined
      ? await session.localState.getLastSyncedHash(assetKey)
      : localHashState.lastSyncedHash;
    const remoteValue = remoteValuesByLocalId.get(localEntry.id) ?? null;

    // 远端墓碑（WebDAV 索引携带 deletedAt）。
    if (remoteEntry !== null && remoteEntry.deletedAt !== null) {
      if (localEntry.deletedAt !== null) {
        if (localEntry.deletedAt !== remoteEntry.deletedAt) {
          const item = createEntryItem(localEntry, "download", {
            remoteValue: null,
            remoteHash: remoteEntry.contentHash,
            remoteDeletedAt: remoteEntry.deletedAt,
            remoteUpdatedAt:
              remoteEntry.committedAt ?? remoteIndexState.committedAt,
          });
          transaction.recordItem(item);
          await item.applyDownload();
          status = mergeStatus(status, "downloaded");
          changedAssetIds.push(localEntry.id);
        } else {
          transaction.stageTouch(assetKey, remoteEntry.contentHash);
        }
        continue;
      }

      if (
        lastSyncedHash === localContentHash
        || (
          isIndexHashComparable(remoteEntry)
          && localContentHash === remoteEntry.contentHash
        )
      ) {
        const item = createEntryItem(localEntry, "download", {
          remoteValue: null,
          remoteHash: remoteEntry.contentHash,
          remoteDeletedAt: remoteEntry.deletedAt,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        await item.applyDownload();
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: null,
        remoteHash: remoteEntry.contentHash,
        remoteDeletedAt: remoteEntry.deletedAt,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地墓碑、远端活或远端无。
    if (localEntry.deletedAt !== null) {
      if (remoteEntry === null) {
        // 远端从未有过该资产（例如从 WebDAV 迁移到 Cloudflare），
        // 墓碑无意义，直接标记为已同步。
        logger.debug(`${options.id}/${localEntry.id}: local tombstone has no remote entry → skip`);
        transaction.stageTouch(assetKey, localContentHash);
        continue;
      }
      if (remoteValue === null) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const remoteContentHash = remoteValue.contentHash;
      if (
        localContentHash === remoteContentHash
        || lastSyncedHash === remoteContentHash
      ) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: remoteValue.value,
          remoteHash: remoteContentHash,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: remoteValue.value,
        remoteHash: remoteContentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地活、远端索引无条目：
    // 从未同步过 → 上传新增；曾同步过 → 远端墓碑（CF plan 不含已删除资产）→ 下载或冲突。
    if (remoteEntry === null) {
      if (lastSyncedHash === null) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt: null,
          remoteUpdatedAt: null,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }
      if (localContentHash === lastSyncedHash) {
        const item = createEntryItem(localEntry, "download", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt:
            remoteIndexState.committedAt ?? new Date().toISOString(),
          remoteUpdatedAt: remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        await item.applyDownload();
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }
      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: null,
        remoteHash: null,
        remoteDeletedAt:
          remoteIndexState.committedAt ?? new Date().toISOString(),
        remoteUpdatedAt: remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地活、远端活。
    if (
      isIndexHashComparable(remoteEntry)
      && localContentHash === remoteEntry.contentHash
    ) {
      logger.debug(`${options.id}/${localEntry.id}: collection index hash matches → idle`);
      transaction.stageTouch(assetKey, remoteEntry.contentHash);
      continue;
    }

    if (remoteValue === null) {
      if (unsupportedRemoteAssetIds.has(localEntry.id)) {
        continue;
      }
      // 索引有条目但正文读取为空：罕见异常，跳过本资产避免误判。
      logger.warn(`${options.id}/${localEntry.id}: remote entry exists but asset unreadable → skipping`);
      continue;
    }

    const classification = classifySingleValue({
      localValue: localEntry.value,
      remoteValue: remoteValue.value,
      localHash: localContentHash,
      remoteHash: remoteValue.contentHash,
      lastSyncedHash,
      supportsRemoteTombstone: false,
      debugLabel: `${options.id}/${localEntry.id}`,
    });

    if (classification.kind === "idle") {
      transaction.stageTouch(assetKey, localContentHash);
      if (remoteValue.normalizationChanged) {
        // 远端旧 schema 规范化后与本地语义一致，仍需回写当前 schema，完成逐条迁移。
        transaction.recordItem(createEntryItem(localEntry, "upload", {
          remoteValue: remoteValue.value,
          remoteHash: remoteValue.contentHash,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        }));
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
      }
      continue;
    }
    if (classification.kind === "upload") {
      transaction.recordItem(createEntryItem(localEntry, "upload", {
        remoteValue: remoteValue.value,
        remoteHash: remoteValue.contentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      }));
      status = mergeStatus(status, "uploaded");
      changedAssetIds.push(localEntry.id);
      continue;
    }
    if (classification.kind === "download") {
      const item = createEntryItem(localEntry, "download", {
        remoteValue: remoteValue.value,
        remoteHash: remoteValue.contentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      await item.applyDownload();
      status = mergeStatus(status, "downloaded");
      changedAssetIds.push(localEntry.id);
      continue;
    }
    transaction.recordItem(createEntryItem(localEntry, "conflict", {
      remoteValue: remoteValue.value,
      remoteHash: remoteValue.contentHash,
      remoteDeletedAt: null,
      remoteUpdatedAt:
        remoteEntry.committedAt ?? remoteIndexState.committedAt,
    }));
    status = mergeStatus(status, "conflict");
    changedAssetIds.push(localEntry.id);
  }

  const remoteOnlyValues = await Promise.all(
    Object.entries(remoteIndexState.entries).flatMap(([entryId, remoteEntry]) =>
      isAssetIncludedInScope(entryId, scope)
        && !localEntryById.has(entryId)
        && remoteEntry.deletedAt === null
        ? [readRemoteEntry(entryId).then((value) => ({ entryId, value }))]
        : []
    ),
  );
  for (const { entryId, value: remoteAsset } of remoteOnlyValues) {
    if (remoteAsset === null) {
      continue;
    }

    const item = createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId: entryId,
      kind: "download",
      localValue: null,
      localDeletedAt: null,
      localHash: null,
      remoteValue: remoteAsset.value,
      remoteHash: remoteAsset.contentHash,
      remoteDeletedAt: null,
      remoteUpdatedAt:
        remoteAsset.committedAt ?? remoteIndexState.committedAt,
      writeLocal: async (value, deletedAt) => {
        await options.writeLocal({ id: entryId, value, deletedAt });
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () => await readRemoteEntry(entryId),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId: entryId,
        value,
        contentHash,
        baseRevision: null,
        baseContentHash: null,
      }),
      createTombstoneParams: null,
    });
    transaction.recordItem(item);
    await item.applyDownload();
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }

  return {
    adapterId: options.id,
    mode: "full-with-revision",
    status: unavailableAssetIds.size > 0 ? "conflict" : status === "idle" && remoteStateIncomplete ? "skipped" : status,
    changedAssetIds: Array.from(new Set(changedAssetIds)),
    remoteStateIncomplete,
    ...(remoteStateIncomplete
      ? {}
      : {
          collectionRevision: remoteIndexState.revision,
          collectionEtag: remoteIndexState.etag ?? null,
        }),
  };
}

async function syncPatchWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: PatchWithRevisionAdapterOptions<TValue>,
  syncOptions: SyncAdapterSyncOptions,
): Promise<SyncAdapterResult> {
  const { transaction } = syncOptions;
  const assetId = "snapshot";
  const assetKey = createSyncAssetKey(collection, assetId);
  const localValue = await options.readLocal();
  const remoteAsset = await readRemoteAssetValue(
    session,
    collection,
    assetId,
    options.normalizeRemote,
  );
  const remoteValue = remoteAsset?.value ?? null;
  const lastSyncedHash = await session.localState.getLastSyncedHash(assetKey);
  const localHash = localValue === null
    ? null
    : await createSyncContentHash(session, collection, localValue);
  const remoteHash = remoteValue === null
    ? null
    : await createSyncContentHash(session, collection, remoteValue);
  const classification = classifySingleValue({
    localValue,
    remoteValue,
    localHash,
    remoteHash,
    lastSyncedHash,
    // patch-with-revision 单值资产没有墓碑存储，远端消失一律解释为本地新增上传。
    supportsRemoteTombstone: false,
    debugLabel: `${options.id}/${assetId}`,
  });

  let status: SyncAdapterStatus = "idle";
  const createItem = (kind: SyncPlanItemKind): SyncPlanItem =>
    createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId,
      kind,
      localValue,
      localDeletedAt: null,
      localHash,
      remoteValue,
      remoteHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: remoteAsset?.committedAt ?? null,
      writeLocal: async (value) => {
        await options.writeLocal(value);
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, assetId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId,
        value,
        contentHash,
        baseRevision: remoteAsset?.revision ?? null,
        baseContentHash: remoteAsset?.remoteContentHash ?? null,
      }),
      createTombstoneParams: null,
    });

  if (classification.kind === "idle") {
    if (localHash !== null && localHash === remoteHash) {
      transaction.stageTouch(assetKey, localHash);
    }
  } else if (classification.kind === "download") {
    const item = createItem("download");
    transaction.recordItem(item);
    await item.applyDownload();
    status = "downloaded";
  } else if (classification.kind === "upload") {
    transaction.recordItem(createItem("upload"));
    status = "uploaded";
  } else {
    transaction.recordItem(createItem("conflict"));
    status = "conflict";
  }

  return {
    adapterId: options.id,
    mode: "patch-with-revision",
    status,
    changedAssetIds: status === "idle" ? [] : ["snapshot"],
    collectionRevision: remoteAsset?.revision ?? null,
    collectionEtag: status === "uploaded" ? null : remoteAsset?.etag ?? null,
  };
}

async function syncPatchCollectionWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
  syncOptions: SyncAdapterSyncOptions,
): Promise<SyncAdapterResult> {
  const { transaction } = syncOptions;
  const scope = syncOptions.scope;
  reportSyncProgress(scope, 0);
  const localEntries = (await options.listLocal(scope)).filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  reportSyncProgress(scope, 10);
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  const remoteIndexState = await session.readIndex(collection);
  reportSyncProgress(scope, 35);
  const changedAssetIds: string[] = [];
  const unavailableAssetIds = new Set<string>();
  let status: SyncAdapterStatus = "idle";
  const localHashStatesById = await resolveLocalHashStates({
    session,
    collection,
    transaction,
    adapterId: options.id,
    localEntries,
  });
  const localContentHashesById = new Map(Array.from(
    localHashStatesById,
    ([assetId, state]) => [assetId, state.contentHash] as const,
  ));

  const onUnavailable = (assetId: string) => options.recoverUnavailableRemote !== true
    || remoteIndexState.entries[assetId] === undefined
    || remoteIndexState.entries[assetId]?.deletedAt !== null ? undefined
    : async (reason: NonNullable<SyncConflictItem["remoteUnavailableReason"]>) => {
      if (unavailableAssetIds.has(assetId)) return;
      const meta = remoteIndexState.entries[assetId];
      if (meta === undefined) throw new Error("Cannot repair remote content without its index identity.");
      unavailableAssetIds.add(assetId);
      changedAssetIds.push(assetId);
      transaction.recordItem(createUnavailableRemoteItem({
        session, collection, transaction, assetId, reason, meta,
        local: localEntryById.get(assetId) ?? null,
        localHash: localContentHashesById.get(assetId) ?? null,
      }));
    };

  const remoteStatesByLocalId = new Map(await Promise.all(localEntries.flatMap((entry) => {
    const remoteEntry = remoteIndexState.entries[entry.id];
    if (
      remoteEntry !== undefined
      && (
        remoteEntry.deletedAt !== null
        || (
          entry.deletedAt === null
          && isIndexHashComparable(remoteEntry)
          && localContentHashesById.get(entry.id) === remoteEntry.contentHash
        )
      )
    ) {
      return [];
    }

    return [readRemoteAssetValue(
      session,
      collection,
      entry.id,
      options.normalizeRemote,
      options.isRemoteVersionUnsupported, undefined, onUnavailable(entry.id),
    ).then((value) => [entry.id, value] as const)];
  })));
  reportSyncProgress(scope, 55);

  const createEntryItem = (
    localEntry: PatchWithRevisionEntry<TValue>,
    kind: SyncPlanItemKind,
    itemRemote: {
      readonly remoteValue: TValue | null;
      readonly remoteHash: string | null;
      readonly remoteDeletedAt: string | null;
      readonly remoteUpdatedAt: string | null;
    },
  ): SyncPlanItem => {
    const remoteEntry = remoteIndexState.entries[localEntry.id] ?? null;
    return createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId: localEntry.id,
      kind,
      localValue: localEntry.value,
      localDeletedAt: localEntry.deletedAt,
      localHash: localContentHashesById.get(localEntry.id) ?? null,
      remoteValue: itemRemote.remoteValue,
      remoteHash: itemRemote.remoteHash,
      remoteDeletedAt: itemRemote.remoteDeletedAt,
      remoteUpdatedAt: itemRemote.remoteUpdatedAt,
      writeLocal: async (value, deletedAt) => {
        await options.writeLocal({ id: localEntry.id, value, deletedAt });
      },
      applyRemoteTombstone: async (remoteDeletedAt) => {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteDeletedAt,
        });
      },
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, localEntry.id, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId: localEntry.id,
        value,
        contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
      }),
      createTombstoneParams: async (_value, deletedAt, contentHash) => ({
        collection,
        assetId: localEntry.id,
        deletedAt,
        targetContentHash: contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
      }),
    });
  };

  for (const [localEntryIndex, localEntry] of localEntries.entries()) {
    reportSyncProgress(
      scope,
      interpolateProgress(55, 75, localEntryIndex, localEntries.length),
    );
    if (unavailableAssetIds.has(localEntry.id)) continue;
    const remoteEntry = remoteIndexState.entries[localEntry.id] ?? null;
    const assetKey = createSyncAssetKey(collection, localEntry.id);
    const localContentHash = localContentHashesById.get(localEntry.id)
      ?? await createSyncContentHash(session, collection, localEntry.value);
    const localHashState = localHashStatesById.get(localEntry.id);
    const lastSyncedHash = localHashState === undefined
      ? await session.localState.getLastSyncedHash(assetKey)
      : localHashState.lastSyncedHash;
    const remoteState = remoteStatesByLocalId.get(localEntry.id) ?? null;

    // 远端墓碑（WebDAV 索引携带 deletedAt）。
    if (remoteEntry !== null && remoteEntry.deletedAt !== null) {
      if (localEntry.deletedAt !== null) {
        if (localEntry.deletedAt !== remoteEntry.deletedAt) {
          const item = createEntryItem(localEntry, "download", {
            remoteValue: null,
            remoteHash: remoteEntry.contentHash,
            remoteDeletedAt: remoteEntry.deletedAt,
            remoteUpdatedAt:
              remoteEntry.committedAt ?? remoteIndexState.committedAt,
          });
          transaction.recordItem(item);
          await item.applyDownload();
          status = mergeStatus(status, "downloaded");
          changedAssetIds.push(localEntry.id);
        } else {
          transaction.stageTouch(assetKey, remoteEntry.contentHash);
        }
        continue;
      }

      if (
        lastSyncedHash === localContentHash
        || (
          isIndexHashComparable(remoteEntry)
          && localContentHash === remoteEntry.contentHash
        )
      ) {
        const item = createEntryItem(localEntry, "download", {
          remoteValue: null,
          remoteHash: remoteEntry.contentHash,
          remoteDeletedAt: remoteEntry.deletedAt,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        await item.applyDownload();
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: null,
        remoteHash: remoteEntry.contentHash,
        remoteDeletedAt: remoteEntry.deletedAt,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地墓碑、远端活或远端无。
    if (localEntry.deletedAt !== null) {
      if (remoteEntry === null) {
        // 远端从未有过该资产，墓碑无意义，直接标记为已同步。
        logger.debug(`${options.id}/${localEntry.id}: local tombstone has no remote entry → skip`);
        transaction.stageTouch(assetKey, localContentHash);
        continue;
      }
      if (remoteState === null) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const remoteContentHash = remoteState.contentHash;
      if (
        localContentHash === remoteContentHash
        || lastSyncedHash === remoteContentHash
      ) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: remoteState.value,
          remoteHash: remoteContentHash,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteState.committedAt
            ?? remoteEntry.committedAt
            ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: remoteState.value,
        remoteHash: remoteContentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteState.committedAt
          ?? remoteEntry.committedAt
          ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地活、远端索引无条目：
    // 从未同步过 → 上传新增；曾同步过 → 远端墓碑（CF plan 不含已删除资产）→ 下载或冲突。
    if (remoteEntry === null) {
      if (lastSyncedHash === null) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt: null,
          remoteUpdatedAt: null,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }
      if (localContentHash === lastSyncedHash) {
        const item = createEntryItem(localEntry, "download", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt:
            remoteIndexState.committedAt ?? new Date().toISOString(),
          remoteUpdatedAt: remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        await item.applyDownload();
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }
      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: null,
        remoteHash: null,
        remoteDeletedAt:
          remoteIndexState.committedAt ?? new Date().toISOString(),
        remoteUpdatedAt: remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地活、远端活。
    if (
      isIndexHashComparable(remoteEntry)
      && localContentHash === remoteEntry.contentHash
    ) {
      logger.debug(`${options.id}/${localEntry.id}: patch index hash matches → idle`);
      transaction.stageTouch(assetKey, remoteEntry.contentHash);
      continue;
    }

    if (remoteState === null) {
      // 索引有条目但正文读取为空：罕见异常，跳过本资产避免误判。
      logger.warn(`${options.id}/${localEntry.id}: remote entry exists but asset unreadable → skipping`);
      continue;
    }

    const classification = classifySingleValue({
      localValue: localEntry.value,
      remoteValue: remoteState.value,
      localHash: localContentHash,
      remoteHash: remoteState.contentHash,
      lastSyncedHash,
      supportsRemoteTombstone: false,
    });

    if (classification.kind === "idle") {
      transaction.stageTouch(assetKey, localContentHash);
      // 与本地口径归一化 hash 比较不得得出“不等”结论，回传分支必须跳过（消除 echo upload）。
      // 不依赖 fallback 索引 hash 的跨口径比较；此时必须回传以持久化 schema 迁移结果。
      if (
        remoteEntry.deletedAt === null
        && (
          remoteState.normalizationChanged
          || (
            isIndexHashComparable(remoteEntry)
            && remoteEntry.contentHash !== remoteState.contentHash
          )
        )
      ) {
        const normalizedRemoteHash = remoteState.contentHash;
        transaction.recordItem(createPlanItem<TValue>({
          session,
          collection,
          transaction,
          adapterId: options.id,
          assetId: localEntry.id,
          kind: "upload",
          localValue: localEntry.value,
          localDeletedAt: null,
          localHash: localContentHash,
          remoteValue: remoteState.value,
          remoteHash: normalizedRemoteHash,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteState.committedAt
            ?? remoteEntry.committedAt
            ?? remoteIndexState.committedAt,
          writeLocal: async (value, deletedAt) => {
            await options.writeLocal({ id: localEntry.id, value, deletedAt });
          },
          applyRemoteTombstone: null,
          readRemoteValue: async () =>
            await readRemoteAssetValue(session, collection, localEntry.id, options.normalizeRemote),
          createPutParams: async (_value, contentHash) => ({
            collection,
            assetId: localEntry.id,
            value: remoteState.value,
            contentHash,
            baseRevision: remoteEntry.revision ?? remoteIndexState.revision,
            baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
          }),
          createTombstoneParams: null,
        }));
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
      }
      continue;
    }
    if (classification.kind === "upload") {
      transaction.recordItem(createEntryItem(localEntry, "upload", {
        remoteValue: remoteState.value,
        remoteHash: remoteState.contentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteState.committedAt
          ?? remoteEntry.committedAt
          ?? remoteIndexState.committedAt,
      }));
      status = mergeStatus(status, "uploaded");
      changedAssetIds.push(localEntry.id);
      continue;
    }
    if (classification.kind === "download") {
      const item = createEntryItem(localEntry, "download", {
        remoteValue: remoteState.value,
        remoteHash: remoteState.contentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteState.committedAt
          ?? remoteEntry.committedAt
          ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      await item.applyDownload();
      status = mergeStatus(status, "downloaded");
      changedAssetIds.push(localEntry.id);
      continue;
    }
    transaction.recordItem(createEntryItem(localEntry, "conflict", {
      remoteValue: remoteState.value,
      remoteHash: remoteState.contentHash,
      remoteDeletedAt: null,
      remoteUpdatedAt:
        remoteState.committedAt
        ?? remoteEntry.committedAt
        ?? remoteIndexState.committedAt,
    }));
    status = mergeStatus(status, "conflict");
    changedAssetIds.push(localEntry.id);

  }
  reportSyncProgress(scope, 75);

  const remoteOnlyStates = await Promise.all(
    Object.entries(remoteIndexState.entries).flatMap(([entryId, remoteEntry]) =>
      isAssetIncludedInScope(entryId, scope)
        && !localEntryById.has(entryId)
        && remoteEntry.deletedAt === null
        ? [readRemoteAssetValue(
          session,
          collection,
          entryId,
          options.normalizeRemote,
          options.isRemoteVersionUnsupported, undefined, onUnavailable(entryId),
        ).then((state) => ({ entryId, state }))]
      : []
    ),
  );
  reportSyncProgress(scope, 88);
  for (const [remoteEntryIndex, {
    entryId,
    state: remoteState,
  }] of remoteOnlyStates.entries()) {
    reportSyncProgress(
      scope,
      interpolateProgress(88, 94, remoteEntryIndex, remoteOnlyStates.length),
    );
    if (remoteState === null) {
      continue;
    }

    const deleteOnUseLocal = options.deleteRemoteOnlyOnUseLocal?.(entryId) === true;

    const item = createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId: entryId,
      kind: "download",
      localValue: null,
      localDeletedAt: null,
      localHash: null,
      remoteValue: remoteState.value,
      remoteHash: remoteState.contentHash,
      remoteDeletedAt: null,
      remoteUpdatedAt:
        remoteState.committedAt ?? remoteIndexState.committedAt,
      writeLocal: async (value, deletedAt) => {
        await options.writeLocal({ id: entryId, value, deletedAt });
      },
      onUseLocalWithoutLocalValue: deleteOnUseLocal
        ? async () => {
          const deletedAt = new Date().toISOString();
          const targetContentHash = await createSyncContentHash(session, collection, null);
          const remoteEntry = remoteIndexState.entries[entryId];
          transaction.recordUpload({
            adapterId: options.id,
            assetId: entryId,
            params: {
              collection,
              assetId: entryId,
              deletedAt,
              targetContentHash,
              baseRevision: remoteEntry?.revision ?? remoteIndexState.revision,
              baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
            },
          });
          transaction.stageDeletion(options.id, entryId, async () => {
            await options.writeLocal({ id: entryId, value: remoteState.value, deletedAt });
          });
          transaction.stageTouch(createSyncAssetKey(collection, entryId), null);
        }
        : undefined,
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, entryId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId: entryId,
        value,
        contentHash,
        baseRevision: null,
        baseContentHash: null,
      }),
      createTombstoneParams: null,
    });
    transaction.recordItem(item);
    await item.applyDownload();
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }
  reportSyncProgress(scope, 94);
  reportSyncProgress(scope, 100);

  return {
    adapterId: options.id,
    mode: "patch-with-revision",
    status: unavailableAssetIds.size > 0 ? "conflict" : status,
    changedAssetIds: Array.from(new Set(changedAssetIds)),
    collectionRevision: remoteIndexState.revision,
    collectionEtag: remoteIndexState.etag ?? null,
  };
}

function isAssetIncludedInScope(
  assetId: string,
  scope: SyncAdapterScope | undefined,
): boolean {
  if (
    scope?.includeAssetIds !== undefined
    && !scope.includeAssetIds.includes(assetId)
  ) {
    return false;
  }

  return scope?.excludeAssetIds?.includes(assetId) !== true;
}

function reportSyncProgress(
  scope: SyncAdapterScope | undefined,
  progress: number,
): void {
  scope?.onProgress?.(Math.min(100, Math.max(0, progress)));
}



interface LocalHashState {
  readonly contentHash: string;
  readonly lastSyncedHash: string | null;
}

async function resolveLocalHashStates<TValue>(options: {
  readonly session: SyncRemoteSession;
  readonly collection: SyncRemoteCollection;
  readonly transaction: SyncEngineTransaction;
  readonly adapterId: string;
  readonly localEntries: readonly {
    readonly id: string;
    readonly value: TValue;
    readonly deletedAt: string | null;
  }[];
}): Promise<ReadonlyMap<string, LocalHashState>> {
  const states = await Promise.all(options.localEntries.map(async (entry) => {
    const lastSyncedHash = await options.session.localState.getLastSyncedHash(
      createSyncAssetKey(options.collection, entry.id),
    );
    const localChangeState = options.transaction.getLocalChangeState?.(
      options.adapterId,
      entry.id,
    ) ?? "unknown";
    const canReuseTouchHash = localChangeState === "clean"
      && entry.deletedAt === null
      && lastSyncedHash !== null;
    const contentHash = canReuseTouchHash
      ? lastSyncedHash
      : await createSyncContentHash(
        options.session,
        options.collection,
        entry.value,
      );

    return [entry.id, { contentHash, lastSyncedHash }] as const;
  }));

  return new Map(states);
}

function interpolateProgress(
  start: number,
  end: number,
  completedUnitCount: number,
  totalUnitCount: number,
): number {
  if (totalUnitCount <= 0) {
    return end;
  }

  return start + (end - start) * completedUnitCount / totalUnitCount;
}


async function readRemoteJson<TValue>(
  client: SyncStorageClient,
  remotePath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<TValue | null> {
  return (await readRemoteJsonFile(
    client,
    remotePath,
    normalizeRemote,
  ))?.value ?? null;
}

async function readRemoteJsonFile<TValue>(
  client: SyncStorageClient,
  remotePath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<{
  readonly value: TValue;
  readonly etag: string | null;
  readonly lastModified: string | null;
} | null> {
  const file = await client.readTextFile(remotePath);
  if (file === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(file.content);
    const value = normalizeRemote === undefined
      ? parsed as TValue
      : normalizeRemote(parsed);

    return value === null
      ? null
      : {
        value,
        etag: file.etag,
        lastModified: normalizeRemoteTimestamp(file.lastModified),
      };
  } catch {
    return null;
  }
}

async function _readRemoteIndexState(
  client: SyncStorageClient,
  indexPath: string,
): Promise<RemoteIndexState> {
  const lastSeenRevision = readLastSeenRemoteRevision(indexPath);
  const canonicalFilePromise = client.readTextFile(indexPath);
  const file = await canonicalFilePromise;
  let canonicalState: RemoteIndexState | null = null;
  if (file !== null) {
    try {
      canonicalState = {
        index: normalizeRemoteIndex(JSON.parse(file.content)),
        etag: file.etag,
        canonicalEtag: file.etag,
        canonicalMissing: false,
        lastModified: normalizeRemoteTimestamp(file.lastModified),
      };
    } catch {
      canonicalState = null;
    }
  }

  const shouldScanJournal = canonicalState === null
    || (
      lastSeenRevision !== null
      && canonicalState.index.revision < lastSeenRevision
    );
  const journalState = shouldScanJournal
    ? await readLatestRevisionJournalState(
      client,
      indexPath,
      normalizeRemoteIndex,
    )
    : null;
  const canonicalFallback: RemoteIndexState = canonicalState ?? {
    index: { revision: 0, entries: {} },
    etag: file?.etag ?? null,
    canonicalEtag: null,
    canonicalMissing: true,
    lastModified: normalizeRemoteTimestamp(file?.lastModified ?? null),
  };
  const selectedState = journalState !== null
    && journalState.value.revision >= canonicalFallback.index.revision
    ? { index: journalState.value, etag: journalState.etag }
    : canonicalFallback;
  const result: RemoteIndexState = {
    ...selectedState,
    canonicalMissing: canonicalFallback.canonicalMissing
      && journalState === null,
    lastModified: journalState === null
      ? canonicalFallback.lastModified
      : null,
    canonicalEtag: canonicalFallback.canonicalEtag !== null
      && createStableJsonHash(canonicalFallback.index)
        === createStableJsonHash(selectedState.index)
      ? canonicalFallback.canonicalEtag
      : null,
  };
  writeLastSeenRemoteRevision(indexPath, result.index.revision);

  return result;
}

async function _writeRemoteIndex(
  client: SyncStorageClient,
  indexPath: string,
  index: RemoteIndexFile,
  expectedRevision: number,
  canonicalMissing: boolean,
): Promise<void> {
  clearLastSeenRemoteEtag(indexPath);
  const committedIndex: RemoteIndexFile = {
    ...index,
    revision: expectedRevision + 1,
  };
  await writeRevisionJournalState(
    client,
    indexPath,
    committedIndex,
    createAtomicWriteOptions(canonicalMissing),
  );
  writeLastSeenRemoteRevision(indexPath, committedIndex.revision);
}

function normalizeRemoteIndex(value: unknown): RemoteIndexFile {
  if (!isRecord(value) || !isRecord(value.entries)) {
    return { revision: 0, entries: {} };
  }

  const entries = Object.fromEntries(
    Object.entries(value.entries).flatMap(([entryId, entry]) => {
      if (!isRecord(entry) || typeof entry.contentHash !== "string") {
        return [];
      }

      const deletedAt = typeof entry.deletedAt === "string" ? entry.deletedAt : null;
      const committedAt = normalizeRemoteTimestamp(entry.committedAt);

      return [[entryId, {
        contentHash: entry.contentHash,
        deletedAt,
        committedAt,
      } satisfies RemoteIndexEntry]];
    }),
  );

  return {
    revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0
      ? value.revision
      : 0,
    entries,
  };
}

function _upsertRemoteIndexEntry(
  index: RemoteIndexFile,
  entryId: string,
  entry: Omit<RemoteIndexEntry, "committedAt">,
): RemoteIndexFile {
  const existingEntry = index.entries[entryId];

  if (
    existingEntry?.contentHash === entry.contentHash
    && existingEntry.deletedAt === entry.deletedAt
  ) {
    return index;
  }

  return {
    revision: index.revision + 1,
    entries: {
      ...index.entries,
      [entryId]: {
        ...entry,
        committedAt: new Date().toISOString(),
      },
    },
  };
}

async function _readRemotePatchState<TValue>(
  client: SyncStorageClient,
  directoryPath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<{
  readonly meta: RemotePatchMetaFile;
  readonly value: TValue;
  readonly etag: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly canonicalMissing: boolean;
} | null> {
  const metaState = await readRemotePatchMetaState(client, directoryPath);
  if (metaState === null) {
    return null;
  }
  const meta = metaState.meta;
  const canonicalMissing = metaState.canonicalMissing;

  const [fullValue, patches] = await Promise.all([
    readRemoteJson(
      client,
      resolvePatchFullPath(directoryPath, meta.currentFullHash),
      normalizeRemote,
    ),
    Promise.all(meta.deltaChain.map(async (targetHash, index) => {
      const baseHash = index === 0
        ? meta.currentFullHash
        : meta.deltaChain[index - 1]!;

      return await readRemoteJson<JsonPatchOperation[]>(
        client,
        resolvePatchDeltaPath(directoryPath, baseHash, targetHash),
        normalizeJsonPatchOperations,
      );
    })),
  ]);
  if (fullValue === null || patches.some((patch) => patch === null)) {
    return null;
  }

  let value = fullValue;
  for (const patch of patches) {
    value = applyJsonPatch(value, patch!);
  }
  const normalizedValue = normalizeRemote === undefined
    ? value
    : normalizeRemote(value);
  if (normalizedValue === null) {
    return null;
  }

  return {
    meta,
    value: normalizedValue,
    etag: metaState.etag,
    remoteUpdatedAt: meta.committedAt ?? metaState.lastModified,
    canonicalMissing,
  };
}

async function readRemotePatchMetaState(
  client: SyncStorageClient,
  directoryPath: string,
): Promise<RemotePatchMetaState | null> {
  const metaPath = resolvePath(directoryPath, "meta.json");
  const lastSeenRevision = readLastSeenRemoteRevision(metaPath);
  const canonicalFilePromise = client.readTextFile(metaPath);
  const file = await canonicalFilePromise;
  let canonicalState: RemotePatchMetaState | null = null;
  if (file !== null) {
    try {
      const meta = normalizeRemotePatchMeta(JSON.parse(file.content));
      canonicalState = meta === null
        ? null
        : {
          meta,
          etag: file.etag,
          canonicalMissing: false,
          lastModified: normalizeRemoteTimestamp(file.lastModified),
        };
    } catch {
      canonicalState = null;
    }
  }

  const shouldScanJournal = canonicalState === null
    || (
      lastSeenRevision !== null
      && canonicalState.meta.revision < lastSeenRevision
    );
  const journalState = shouldScanJournal
    ? await readLatestRevisionJournalState(
      client,
      metaPath,
      normalizeRemotePatchMeta,
    )
    : null;
  if (
    journalState !== null
    && (
      canonicalState === null
      || journalState.value.revision >= canonicalState.meta.revision
    )
  ) {
    const result = {
      meta: journalState.value,
      etag: journalState.etag,
      canonicalMissing: canonicalState === null,
      lastModified: null,
    };
    writeLastSeenRemoteRevision(metaPath, result.meta.revision);

    return result;
  }

  if (canonicalState !== null) {
    writeLastSeenRemoteRevision(
      metaPath,
      canonicalState.meta.revision,
    );
  }
  return canonicalState;
}

function normalizeRemotePatchMeta(value: unknown): RemotePatchMetaFile | null {
  if (!isRecord(value) || typeof value.currentFullHash !== "string" || !Array.isArray(value.deltaChain)) {
    return null;
  }

  return {
    revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0
      ? value.revision
      : 0,
    currentFullHash: value.currentFullHash,
    deltaChain: value.deltaChain.filter((entry): entry is string => typeof entry === "string"),
    deltaThreshold: typeof value.deltaThreshold === "number" && Number.isInteger(value.deltaThreshold) && value.deltaThreshold > 0
      ? value.deltaThreshold
      : 50,
    committedAt: normalizeRemoteTimestamp(value.committedAt),
  };
}

interface WriteRemotePatchContentResult {
  readonly nextMeta: RemotePatchMetaFile;
  readonly metaWriteOptions: SyncWriteOptions;
}

async function writeRemotePatchContent<TValue>(options: {
  readonly client: SyncStorageClient;
  readonly directoryPath: string;
  readonly value: TValue;
  readonly previousState: { readonly meta: RemotePatchMetaFile; readonly value: TValue; readonly etag: string | null; readonly canonicalMissing: boolean } | null;
  readonly deltaThreshold: number;
}): Promise<WriteRemotePatchContentResult> {
  await options.client.makeDirectory(options.directoryPath);
  const nextHash = createStableJsonHash(options.value);

  if (options.previousState === null) {
    await options.client.writeTextFile(resolvePatchFullPath(options.directoryPath, nextHash), JSON.stringify(options.value));
    return {
      nextMeta: {
        revision: 1,
        currentFullHash: nextHash,
        deltaChain: [],
        deltaThreshold: options.deltaThreshold,
        committedAt: new Date().toISOString(),
      },
      metaWriteOptions: createAtomicWriteOptions(false),
    };
  }

  const previousHash = resolvePatchLatestHash(options.previousState.meta);
  const nextDeltaChain = [...options.previousState.meta.deltaChain, nextHash];
  const nextRevision = options.previousState.meta.revision + 1;

  if (nextDeltaChain.length >= options.previousState.meta.deltaThreshold) {
    await options.client.writeTextFile(resolvePatchFullPath(options.directoryPath, nextHash), JSON.stringify(options.value));
    return {
      nextMeta: {
        revision: nextRevision,
        currentFullHash: nextHash,
        deltaChain: [],
        deltaThreshold: options.previousState.meta.deltaThreshold,
        committedAt: new Date().toISOString(),
      },
      metaWriteOptions: createAtomicWriteOptions(options.previousState.canonicalMissing),
    };
  }

  const patch = generateJsonPatch(options.previousState.value, options.value);
  await options.client.writeTextFile(resolvePatchDeltaPath(options.directoryPath, previousHash, nextHash), JSON.stringify(patch));
  return {
    nextMeta: {
      revision: nextRevision,
      currentFullHash: options.previousState.meta.currentFullHash,
      deltaChain: nextDeltaChain,
      deltaThreshold: options.previousState.meta.deltaThreshold,
      committedAt: new Date().toISOString(),
    },
    metaWriteOptions: createAtomicWriteOptions(options.previousState.canonicalMissing),
  };
}

async function _writeRemotePatchState<TValue>(options: {
  readonly client: SyncStorageClient;
  readonly directoryPath: string;
  readonly value: TValue;
  readonly previousState: { readonly meta: RemotePatchMetaFile; readonly value: TValue; readonly etag: string | null; readonly canonicalMissing: boolean } | null;
  readonly deltaThreshold: number;
}): Promise<void> {
  const { nextMeta, metaWriteOptions } = await writeRemotePatchContent(options);
  await writeRemotePatchMeta(options.client, options.directoryPath, nextMeta, metaWriteOptions);
}

function createAtomicWriteOptions(canonicalMissing: boolean): SyncWriteOptions {
  return canonicalMissing ? {} : { ifNoneMatch: "*" };
}


async function writeRemotePatchMeta(
  client: SyncStorageClient,
  directoryPath: string,
  meta: RemotePatchMetaFile,
  writeOptions: SyncWriteOptions,
): Promise<void> {
  const metaPath = resolvePath(directoryPath, "meta.json");
  await writeRevisionJournalState(
    client,
    metaPath,
    meta,
    writeOptions,
  );
  writeLastSeenRemoteRevision(metaPath, meta.revision);
}


async function readLatestRevisionJournalState<TValue extends { readonly revision: number }>(
  client: SyncStorageClient,
  canonicalPath: string,
  normalize: (value: unknown) => TValue | null,
): Promise<{
  readonly value: TValue;
  readonly etag: string | null;
} | null> {
  const revisionDirectoryPath = resolveRevisionDirectoryPath(canonicalPath);
  const directoryStat = await client.stat(revisionDirectoryPath);
  if (directoryStat?.type !== "directory") {
    return null;
  }

  const entries = await client.listDirectory(revisionDirectoryPath);
  const candidates = entries.flatMap((entry) => {
    const match = /^rev-(\d+)\.json$/.exec(entry.basename);
    if (entry.type !== "file" || match === null) {
      return [];
    }

    const revision = Number(match[1]);
    return Number.isSafeInteger(revision) && revision >= 0
      ? [{ basename: entry.basename, revision }]
      : [];
  }).sort((left, right) => right.revision - left.revision);

  for (const candidate of candidates) {
    const file = await client.readTextFile(
      resolvePath(revisionDirectoryPath, candidate.basename),
    );
    if (file === null) {
      continue;
    }

    try {
      const value = normalize(JSON.parse(file.content));
      if (value?.revision === candidate.revision) {
        return {
          value,
          etag: file.etag,
        };
      }
    } catch {
      // 跳过不完整或损坏的修订文件，继续读取上一个完整修订。
    }
  }

  return null;
}


async function writeRevisionJournalState<TValue extends { readonly revision: number }>(
  client: SyncStorageClient,
  canonicalPath: string,
  value: TValue,
  writeOptions: SyncWriteOptions = { ifNoneMatch: "*" },
): Promise<void> {
  const revisionDirectoryPath = resolveRevisionDirectoryPath(canonicalPath);
  await client.makeDirectory(revisionDirectoryPath);
  const serializedValue = JSON.stringify(value);
  const revisionPath = resolvePath(
    revisionDirectoryPath,
    `rev-${value.revision.toString().padStart(12, "0")}.json`,
  );

  // 修订文件通过临时文件 + MOVE(Overwrite:F) 原子认领；canonical 文件仅是便于人工查看的镜像。
  await Promise.all([
    client.writeTextFile(revisionPath, serializedValue, writeOptions),
    client.writeTextFile(canonicalPath, serializedValue),
  ]);
}

function resolveRevisionDirectoryPath(canonicalPath: string): string {
  const slashIndex = canonicalPath.lastIndexOf("/");
  const directoryPath = slashIndex < 0 ? "" : canonicalPath.slice(0, slashIndex);
  const fileName = slashIndex < 0 ? canonicalPath : canonicalPath.slice(slashIndex + 1);
  const stem = fileName.endsWith(".json") ? fileName.slice(0, -".json".length) : fileName;

  return resolvePath(directoryPath, `${stem}-revisions`);
}

function resolvePatchLatestHash(meta: RemotePatchMetaFile): string {
  return meta.deltaChain.at(-1) ?? meta.currentFullHash;
}

function resolvePatchFullPath(directoryPath: string, hash: string): string {
  return resolvePath(directoryPath, `full-${encodeURIComponent(hash)}.json`);
}

function resolvePatchDeltaPath(directoryPath: string, baseHash: string, targetHash: string): string {
  return resolvePath(directoryPath, `delta-${encodeURIComponent(baseHash)}-${encodeURIComponent(targetHash)}.json`);
}

function resolvePath(directoryPath: string, fileName: string): string {
  const normalizedDirectoryPath = directoryPath.replace(/\/+$/, "");

  return normalizedDirectoryPath === "" ? fileName : `${normalizedDirectoryPath}/${fileName}`;
}

async function _ensureRemoteParentDirectory(
  client: SyncStorageClient,
  remotePath: string,
): Promise<void> {
  const slashIndex = remotePath.lastIndexOf("/");
  if (slashIndex <= 0) {
    return;
  }

  await client.makeDirectory(remotePath.slice(0, slashIndex));
}

function normalizeJsonPatchOperations(value: unknown): JsonPatchOperation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value as JsonPatchOperation[];
}

function mergeStatus(
  current: SyncAdapterStatus,
  next: SyncAdapterStatus,
): SyncAdapterStatus {
  if (current === "conflict" || next === "conflict") {
    return "conflict";
  }

  if (current === "uploaded" || next === "uploaded") {
    return "uploaded";
  }

  if (current === "downloaded" || next === "downloaded") {
    return "downloaded";
  }

  return next === "skipped" ? "skipped" : current;
}

function normalizeRemoteTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createUnavailableRemoteItem<TValue>(options: {
  session: SyncRemoteSession; collection: SyncRemoteCollection; transaction: SyncEngineTransaction;
  assetId: string; reason: NonNullable<SyncConflictItem["remoteUnavailableReason"]>; meta: RemoteAssetMeta;
  local: { value: TValue; deletedAt: string | null } | null; localHash: string | null;
}): SyncPlanItem {
  const { session, collection, transaction, assetId, meta, local } = options;
  const refuseRemote = async () => { throw new Error("Unavailable remote content cannot be selected."); };
  return {
    adapterId: collection.adapterId, assetId, kind: "conflict", remoteUnavailableReason: options.reason,
    localValue: local?.value ?? null, localHash: options.localHash, remoteValue: null,
    remoteHash: meta.contentHash, remoteDeletedAt: meta.deletedAt, remoteUpdatedAt: meta.committedAt,
    applyDownload: refuseRemote, applyDiscardLocal: refuseRemote, applyLocalRestore: async () => {},
    applyUpload: async () => {
      const base = { collection, assetId, baseRevision: meta.revision, baseContentHash: resolveRemoteBaseContentHash(meta) };
      if (local === null || local.deletedAt !== null) {
        transaction.recordUpload({ adapterId: collection.adapterId, assetId, params: {
          ...base, deletedAt: local?.deletedAt ?? new Date().toISOString(),
          targetContentHash: await createSyncContentHash(session, collection, null),
        } });
        transaction.stageTouch(createSyncAssetKey(collection, assetId), local === null ? null : options.localHash);
      } else {
        const contentHash = options.localHash ?? await createSyncContentHash(session, collection, local.value);
        transaction.recordUpload({ adapterId: collection.adapterId, assetId, params: {
          ...base, value: local.value, contentHash, replaceContent: true,
        } });
        transaction.stageTouch(createSyncAssetKey(collection, assetId), contentHash);
      }
    },
  };
}
