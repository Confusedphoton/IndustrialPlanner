// Cloudflare cf-sync-v2 远端实现。
// 协议版本：cf-sync-v2，直接 HTTP fetch，不使用 Web Worker。
// 当前实现位于 cloudflare-v2-remote.ts 与 cloudflare-v2-worker-runtime.ts。
//
// 协议流程：
//   plan:      GET  /v1/sync/spaces/:spaceId/plan
//   check:     GET  /v1/sync/spaces/:spaceId/check?knownRevision=N
//   写入:      POST /v1/sync/spaces/:spaceId/mutations { action: "prepare" }
//              → 上传 blob 到 upload instructions 中的 URL
//              → POST /v1/sync/spaces/:spaceId/mutations { action: "commit" }
//   下载:      从 plan 的 downloadUrl + ticket 直接 GET
//   创建空间:  POST /v1/sync/spaces

import {
  applyIndexedDbStoreMutations,
  clearIndexedDbStores,
  readFromIndexedDb,
  type IndexedDbStorageLocation,
  type IndexedDbStoreLocation,
  type IndexedDbMutationOperation,
} from "@/shared/storage/browser-storage";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";
import { CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME } from "@/shared/storage/sync-tombstone-storage";
import { createUuid } from "@/domain/shared/uuid";
import { createLogger } from "@/shared/logging/logger";
import {
  createSha256CanonicalHash,
  createSha256Hash,
  createStableJsonHash,
} from "@/shared/storage/hash-utils";
import type {
  CfV2PlanResponse,
  CfV2CheckResponse,
  CfV2PrepareResponse,
  CfV2CommitResult,
  CfV2PrepareObject,
  CfV2PrepareDeletion,
} from "./cloudflare-v2-types";
import { CF_SYNC_V2_PROTOCOL, CfV2HttpError } from "./cloudflare-v2-types";
import type {
  RemoteApplyResult,
  RemoteAssetContent,
  RemoteAssetPutParams,
  RemoteAssetRef,
  RemoteAssetTombstoneParams,
  RemoteCheckResult,
  RemoteCollectionIndex,
  RemoteWriteBatchResult,
  RemoteWriteResult,
  SyncLocalState,
  SyncRemote,
  SyncRemoteCollection,
  SyncRemoteCompleteOptions,
  SyncRemoteSession,
  SyncRemoteSessionContext,
  SyncRemoteWriteBatch,
  SyncContentHashRequest,
} from "../remote-types";
import { RemoteWriteConflictError } from "../remote-types";

const logger = createLogger("cloudflare-v2");

// ============================================================================
// IndexedDB 配置
// ============================================================================

const CF_DATABASE_NAME = "v3-industrial-planner";
const CF_STATE_STORE = "cf-sync-state";
const CF_STATE_KEY_PREFIX = "state";
const CF_ASSETS_STORE = "cf-sync-assets";

const CF_ASSETS_LOCATION: IndexedDbStoreLocation = {
  databaseName: CF_DATABASE_NAME,
  storeName: CF_ASSETS_STORE,
};

// ============================================================================
// 本地状态
// ============================================================================

interface CfLocalState {
  schemaVersion: 3;
  spaceId: string;
  revision: string; // 当前已同步的远端 revision（字符串，仅比较相等性）
}


interface CfAssetState {
  assetKey: string;
  remoteRevision: number | null;
  lastSyncedContentHash: string | null;
  remoteProtocolContentHash: string | null;
  remoteAdapterContentHash: string | null;
}

// 存储在 CF_STATE_STORE 下，不受 generation/epoch 影响。
const CF_COLLECTION_ETAG_PREFIX = "col-etag";

function defaultState(spaceId: string): CfLocalState {
  return {
    schemaVersion: 3,
    spaceId,
    revision: "0",
  };
}

// ============================================================================
// CloudflareSyncLocalState
// ============================================================================

class CloudflareSyncLocalState implements SyncLocalState {
  private readonly stateLocation: IndexedDbStorageLocation;
  private cachedState: CfLocalState | null = null;
  private readonly pendingAdapterHashStorageKeys = new Set<string>();

  public constructor(
    private readonly apiBase: string,
    private readonly spaceId: string,
  ) {
    this.stateLocation = {
      databaseName: CF_DATABASE_NAME,
      storeName: CF_STATE_STORE,
      key: `${CF_STATE_KEY_PREFIX}\u0000${apiBase}\u0000${spaceId}`,
    };
  }

  // ---- SyncLocalState 接口 ---- //

  public async getLastSyncedHash(assetKey: string): Promise<string | null> {
    const storageKey = await this.createAssetStorageKey(assetKey);
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    return record?.lastSyncedContentHash ?? null;
  }

  public async setLastSyncedHash(assetKey: string, hash: string | null): Promise<void> {
    const storageKey = await this.createAssetStorageKey(assetKey);
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    if (hash === null) {
      if (existing === null) return;
      await this.applyAssetMutations([{
        type: "put",
        key: storageKey,
        value: {
          ...normalizeAssetState(existing, assetKey),
          lastSyncedContentHash: null,
        },
      }]);
      return;
    }
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: {
        assetKey,
        remoteRevision: existing?.remoteRevision ?? null,
        lastSyncedContentHash: hash,
        remoteProtocolContentHash: existing?.remoteProtocolContentHash ?? null,
        // 原逻辑：pendingAdapterHashStorageKeys 中有 storageKey 时用 hash填充 remoteAdapterContentHash。
        // 新逻辑：lastSyncedContentHash 正常更新，remoteAdapterContentHash 不在此处设置（由 noteRemoteHashMapping 负责）。
        // 下载后的首次 setLastSyncedHash 必须完成协议 hash → 适配器 hash 映射。
        remoteAdapterContentHash: this.pendingAdapterHashStorageKeys.has(storageKey)
          ? hash
          : existing?.remoteAdapterContentHash ?? null,
      },
    }]);
    this.pendingAdapterHashStorageKeys.delete(storageKey);
  }

  public async getRemoteRevision(key: string): Promise<number | null> {
    const storageKey = await this.createAssetStorageKey(key);
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    return record?.remoteRevision ?? null;
  }

  public async setRemoteRevision(key: string, revision: number | null): Promise<void> {
    const storageKey = await this.createAssetStorageKey(key);
    if (revision === null) {
      await this.applyAssetMutations([{ type: "delete", key: storageKey }]);
      return;
    }
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: {
        assetKey: key,
        remoteRevision: revision,
        lastSyncedContentHash: existing?.lastSyncedContentHash ?? null,
        remoteProtocolContentHash: existing?.remoteProtocolContentHash ?? null,
        remoteAdapterContentHash: existing?.remoteAdapterContentHash ?? null,
      },
    }]);
  }

  public async getComparableRemoteHash(
    assetKey: string,
    protocolContentHash: string,
  ): Promise<string | null> {
    const storageKey = await this.createAssetStorageKey(assetKey);
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    return record?.remoteProtocolContentHash === protocolContentHash
      ? record.remoteAdapterContentHash ?? null
      : null;
  }

  public async noteRemoteHashMapping(
    assetKey: string,
    protocolContentHash: string,
    adapterContentHash?: string,
  ): Promise<void> {
    const storageKey = await this.createAssetStorageKey(assetKey);
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    const normalized = normalizeAssetState(existing, assetKey);
    const protocolUnchanged = normalized.remoteProtocolContentHash === protocolContentHash;
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: {
        ...normalized,
        remoteProtocolContentHash: protocolContentHash,
        remoteAdapterContentHash: adapterContentHash
          ?? (protocolUnchanged ? normalized.remoteAdapterContentHash : null),
      },
    }]);
    if (adapterContentHash === undefined) {
      this.pendingAdapterHashStorageKeys.add(storageKey);
    } else {
      this.pendingAdapterHashStorageKeys.delete(storageKey);
    }
  }

  public async getRemoteEtag(key: string): Promise<string | null> {
    const record = await readFromIndexedDb<{ etag: string | null }>({
      databaseName: CF_DATABASE_NAME,
      storeName: CF_STATE_STORE,
      key: `${CF_COLLECTION_ETAG_PREFIX}\u0000${key}`,
    });
    return record?.etag ?? null;
  }

  public async setRemoteEtag(key: string, etag: string | null): Promise<void> {
    const storageKey = `${CF_COLLECTION_ETAG_PREFIX}\u0000${key}`;
    await applyIndexedDbStoreMutations(
      {
        databaseName: CF_DATABASE_NAME,
        storeName: CF_STATE_STORE,
      },
      etag === null
        ? [{ type: "delete", key: storageKey }]
        : [{ type: "put", key: storageKey, value: { etag } }],
    );
  }

  // ---- 内部方法 ---- //

  public async readState(): Promise<CfLocalState> {
    if (this.cachedState !== null) return this.cachedState;
    const stored = await readFromIndexedDb<unknown>(this.stateLocation);
    const normalized = normalizeState(stored, this.spaceId);
    const state = normalized ?? defaultState(this.spaceId);
    this.cachedState = state;
    if (normalized === null) {
      await this.writeState(state);
    }
    return state;
  }

  public async writeState(state: CfLocalState): Promise<void> {
    const saved = await applyIndexedDbStoreMutations(this.stateLocation, [
      { type: "put", key: this.stateLocation.key, value: state },
    ]);
    if (!saved) throw new Error("Failed to persist Cloudflare sync state.");
    this.cachedState = state;
  }

  public async advanceToRevision(revision: string): Promise<void> {
    const state = await this.readState();
    if (state.revision === revision) return;
    await this.writeState({ ...state, revision });
  }

  public async reset(): Promise<void> {
    this.cachedState = null;
    this.pendingAdapterHashStorageKeys.clear();
    const cleared = await clearIndexedDbStores(
      { databaseName: CF_DATABASE_NAME },
      [
        CF_STATE_STORE,
        CF_ASSETS_STORE,
        CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME,
      ],
    );
    if (!cleared) {
      throw new Error("Failed to clear Cloudflare sync metadata and cache.");
    }
  }

  private async createAssetStorageKey(assetKey: string): Promise<string> {
    return assetKey;
  }

  private async applyAssetMutations(
    operations: readonly IndexedDbMutationOperation<CfAssetState>[],
  ): Promise<void> {
    const saved = await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, operations);
    if (!saved) throw new Error("Failed to persist Cloudflare asset sync metadata.");
  }
}

function normalizeState(value: unknown, spaceId: string): CfLocalState | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<CfLocalState>;
  if (
    candidate.schemaVersion !== 3
    || candidate.spaceId !== spaceId
    || typeof candidate.revision !== "string"
  ) {
    return null;
  }
  return candidate as CfLocalState;
}

function normalizeAssetState(
  value: CfAssetState | null,
  assetKey: string,
): CfAssetState {
  return {
    assetKey,
    remoteRevision: value?.remoteRevision ?? null,
    lastSyncedContentHash: value?.lastSyncedContentHash ?? null,
    remoteProtocolContentHash: value?.remoteProtocolContentHash ?? null,
    remoteAdapterContentHash: value?.remoteAdapterContentHash ?? null,
  };
}

// ============================================================================
// HTTP 工具函数
// ============================================================================

async function cfV2Fetch(apiBase: string, path: string, init?: RequestInit): Promise<Response> {
  const url = `${apiBase}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok && response.status !== 204) {
    let body: Record<string, unknown> = {};
    try { body = await response.json() as Record<string, unknown>; } catch { /* ignore */ }
    throw new CfV2HttpError(
      response.status,
      typeof body.error === "string" ? body.error : "unknown",
      typeof body.message === "string" ? body.message : `HTTP ${response.status}`,
      body,
    );
  }
  return response;
}

async function cfV2GetJson<T>(apiBase: string, path: string): Promise<T> {
  const response = await cfV2Fetch(apiBase, path);
  if (response.status === 204) return undefined as unknown as T;
  return response.json() as Promise<T>;
}

async function cfV2PostJson<T>(apiBase: string, path: string, body: unknown): Promise<T> {
  const response = await cfV2Fetch(apiBase, path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
}

async function cancelPreparedBatch(
  apiBase: string,
  spaceId: string,
  prepare: CfV2PrepareResponse,
): Promise<void> {
  try {
    await cfV2PostJson(
      apiBase,
      `/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
      {
        protocol: CF_SYNC_V2_PROTOCOL,
        action: "cancel",
        uploadId: prepare.uploadId,
        commitToken: prepare.commitToken,
      },
    );
  } catch (cancelError) {
    // commit 可能已经开始或完成；此时后端只允许向前恢复，不能取消。
    logger.warn(`Failed to cancel Cloudflare transaction ${prepare.uploadId}.`, cancelError);
  }
}

async function commitPreparedBatch(
  apiBase: string,
  spaceId: string,
  prepare: CfV2PrepareResponse,
): Promise<CfV2CommitResult> {
  return await cfV2PostJson<CfV2CommitResult>(
    apiBase,
    `/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
    {
      protocol: CF_SYNC_V2_PROTOCOL,
      action: "commit",
      uploadId: prepare.uploadId,
      commitToken: prepare.commitToken,
    },
  );
}

// ============================================================================
// CloudflareSyncRemoteSession
// ============================================================================

class CloudflareSyncRemoteSession implements SyncRemoteSession {
  private planCache: CfV2PlanResponse | null = null;
  private readonly apiBase: string;
  private latestCommittedRevision: number | null = null;

  public constructor(
    public readonly localState: CloudflareSyncLocalState,
    private readonly context: SyncRemoteSessionContext,
    apiBase: string,
  ) {
    this.apiBase = apiBase;
  }

  public async computeContentHashes(
    requests: readonly SyncContentHashRequest[],
  ): Promise<readonly string[]> {
    return await Promise.all(requests.map(async (request) =>
      request.algorithm === "sha256-canonical-json-v1"
        ? await createSha256CanonicalHash(request.value)
        : createStableJsonHash(request.value)
    ));
  }

  // -- 确保空间存在 -- //

  private async ensureSpace(): Promise<CfLocalState> {
    const state = await this.localState.readState();
    try {
      await cfV2Fetch(this.apiBase, `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/plan`);
      return state;
    } catch (error) {
      if (error instanceof CfV2HttpError && error.status === 404) {
        logger.info(`Creating Cloudflare space: ${state.spaceId}`);
        await cfV2PostJson(this.apiBase, "/v1/sync/spaces", {
          spaceId: state.spaceId,
        });
        return state;
      }
      throw error;
    }
  }

  // -- prefetchIndexes：获取 plan -- //

  public async prefetchIndexes(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    if (this.planCache !== null) return;
    await this.ensureSpace();
    const state = await this.localState.readState();
    const plan = await cfV2GetJson<CfV2PlanResponse>(
      this.apiBase,
      `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/plan`,
    );
    this.planCache = plan;
  }

  public async refreshIndexes(collections: readonly SyncRemoteCollection[]): Promise<void> {
    this.planCache = null;
    await this.prefetchIndexes(collections);
  }

  // -- readIndex：从 plan cache 计算 -- //

  public async readIndex(collection: SyncRemoteCollection): Promise<RemoteCollectionIndex> {
    const plan = this.planCache;
    if (plan === null) return { revision: 0, entries: {}, committedAt: null };

    const assets = plan.assets.filter((asset) =>
      asset.assetType === collection.assetType
      && (collection.assetIdCodec.acceptsRemoteAssetId?.(asset.assetId) ?? true)
    );
    if (assets.length === 0) {
      return { revision: toLegacyNumericRevision(plan.revision), entries: {}, committedAt: null };
    }

    const codec = collection.assetIdCodec;
    const entries: Record<string, RemoteCollectionIndex["entries"][string]> = {};

    await Promise.all(assets.map(async (asset) => {
      const adapterAssetId = codec.toAdapterAssetId(asset.assetId);
      const protocolContentHash = toAdapterContentHash(asset.contentHash);
      const comparableContentHash = await this.localState.getComparableRemoteHash(
        createAssetStateKey(collection, adapterAssetId),
        protocolContentHash,
      ) ?? protocolContentHash;
      entries[adapterAssetId] = {
        revision: toLegacyNumericRevision(asset.lastModifiedRevision),
        contentHash: comparableContentHash,
        protocolContentHash,
        deletedAt: null,
        committedAt: null,
      };
    }));

    return { revision: toLegacyNumericRevision(plan.revision), entries, committedAt: plan.serverTime };
  }

  // -- readAsset：下载远端资产内容 -- //

  public async readAsset(params: RemoteAssetRef): Promise<RemoteAssetContent | null> {
    const plan = this.planCache;
    if (plan === null) return null;

    const remoteAssetId = params.collection.assetIdCodec.toRemoteAssetId(params.assetId);
    const asset = plan.assets.find(
      (a) => a.assetType === params.collection.assetType && a.assetId === remoteAssetId,
    );
    if (asset === undefined) return null;

    const contentHash = toAdapterContentHash(asset.contentHash);

    // 直接使用 downloadUrl 下载内容
    const response = await fetch(asset.downloadUrl);
    if (!response.ok) {
      throw new CfV2HttpError(
        response.status,
        "download_failed",
        `Failed to download ${asset.assetType}/${asset.assetId}: HTTP ${response.status}`,
      );
    }
    const contentBytes = new Uint8Array(await response.arrayBuffer());
    const receivedHash = (await createSha256Hash(contentBytes)).slice(7);
    const expectedHash = asset.contentHash.startsWith("sha256:")
      ? asset.contentHash.slice(7)
      : asset.contentHash;
    if (receivedHash !== expectedHash) {
      throw new Error(
        `Downloaded content hash mismatch for ${asset.assetType}/${asset.assetId}: `
        + `expected ${expectedHash}, received ${receivedHash}.`,
      );
    }
    const content = new TextDecoder().decode(contentBytes);
    const value = JSON.parse(content) as unknown;

    await this.localState.noteRemoteHashMapping(
      createAssetStateKey(params.collection, params.assetId),
      contentHash,
    );

    return {
      revision: toLegacyNumericRevision(plan.revision),
      value,
      contentHash,
      committedAt: plan.serverTime,
    };
  }

  // -- checkCollections：检查远端是否有变更 -- //

  public async checkCollections(
    collections: readonly SyncRemoteCollection[],
  ): Promise<RemoteCheckResult> {
    await this.ensureSpace();
    const state = await this.localState.readState();

    const response = await cfV2Fetch(
      this.apiBase,
      `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/check?knownRevision=${state.revision}`,
    );

    // 204 = 未变化
    if (response.status === 204) {
      return { changedCollections: [] };
    }

    const check = await response.json() as CfV2CheckResponse;

    if (!check.changed) {
      return { changedCollections: [], globalCursor: toLegacyNumericRevision(check.revision) };
    }

    // 有变更 → 标记所有请求的集合为已变更
    const assetTypes = new Set(collections.map((c) => c.assetType));
    const changedCollections = collections
      .filter((c) => assetTypes.has(c.assetType))
      .map((c) => c.adapterId);

    return {
      changedCollections,
      globalCursor: toLegacyNumericRevision(check.revision),
    };
  }

  // -- 写入相关 -- //

  public beginWriteBatch(): SyncRemoteWriteBatch {
    return new CloudflareSyncWriteBatch(this);
  }

  public async markApplied(result: RemoteApplyResult): Promise<void> {
    if (result.collectionRevision !== null) {
      await this.localState.setRemoteRevision(
        result.collection.stateKey,
        result.collectionRevision,
      );
    }
    // 在每次同步完成后写入 CF_STATE_STORE，供下次 foreground sync 的
    // isRemoteIndexUnchangedForCleanLocalEntries 使用。
    if (result.collectionEtag !== undefined) {
      await this.localState.setRemoteEtag(
        result.collection.stateKey,
        result.collectionEtag,
      );
    } else if (result.collectionRevision !== null) {
      await this.localState.setRemoteEtag(
        result.collection.stateKey,
        String(result.collectionRevision),
      );
    }
  }

  public async prepareCollections(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    // Cloudflare v2 无目录概念
  }

  public async complete(options?: SyncRemoteCompleteOptions): Promise<void> {
    if (options?.advanceAppliedRevision === false) return;
    if (this.context.reason === "local-change" || this.planCache === null) return;
    const state = await this.localState.readState();
    // epoch 参数已移除。revision 仅比较相等性，不存在大小关系。
    // complete 必须保留 commit 返回的新 revision，不能回退到旧 plan revision。
    const targetRevision = String(
      this.latestCommittedRevision ?? this.planCache.revision,
    );
    if (targetRevision !== state.revision) {
      await this.localState.advanceToRevision(targetRevision);
    }
  }

  public dispose(): void {
    this.planCache = null;
  }

  // -- 供 CloudflareSyncWriteBatch 使用 -- //

  public registerCommittedRevision(revision: number): void {
    this.latestCommittedRevision = revision;
  }

  public getApiBase(): string {
    return this.apiBase;
  }

  public getObservedRemoteRevision(): number | null {
    return this.planCache === null
      ? null
      : toLegacyNumericRevision(this.planCache.revision);
  }
}

// ============================================================================
// CloudflareSyncWriteBatch（两阶段提交）
// ============================================================================

interface BatchMutation {
  clientMutationId: string;
  operation: "put" | "delete";
  collection: SyncRemoteCollection;
  adapterAssetId: string;
  assetType: string;
  assetId: string;
  value: unknown;
  contentHash: string | null;
  deletedAt: string | null;
}

class CloudflareSyncWriteBatch implements SyncRemoteWriteBatch {
  private mutations: BatchMutation[] = [];
  private committed = false;

  public constructor(private readonly session: CloudflareSyncRemoteSession) {}

  public putAsset(params: RemoteAssetPutParams): void {
    if (this.committed) return;
    this.mutations.push({
      clientMutationId: createUuid(),
      operation: "put",
      collection: params.collection,
      adapterAssetId: params.assetId,
      assetType: params.collection.assetType,
      assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
      value: params.value,
      contentHash: params.contentHash,
      deletedAt: null,
    });
  }

  public putTombstone(params: RemoteAssetTombstoneParams): void {
    if (this.committed) return;
    this.mutations.push({
      clientMutationId: createUuid(),
      operation: "delete",
      collection: params.collection,
      adapterAssetId: params.assetId,
      assetType: params.collection.assetType,
      assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
      value: null,
      contentHash: null,
      deletedAt: params.deletedAt,
    });
  }

  public async commit(): Promise<RemoteWriteBatchResult> {
    if (this.committed) return { writes: [] };
    this.committed = true;
    if (this.mutations.length === 0) return { writes: [] };

    const apiBase = this.session.getApiBase();
    const state = await this.session.localState.readState();
    const clientBatchId = createUuid();

    // 分片提交：后端限制每批最多 32 条
    const writes: RemoteWriteResult[] = [];
    const baseRev = this.session.getObservedRemoteRevision()
      ?? Number(state.revision);
    let latestRevision = baseRev;

    for (let offset = 0; offset < this.mutations.length; offset += 32) {
      const chunk = this.mutations.slice(offset, offset + 32);
      latestRevision = await this.commitChunk(
        apiBase, state.spaceId, clientBatchId, offset,
        chunk, writes, latestRevision,
      );
    }

    if (latestRevision !== baseRev) {
      this.session.registerCommittedRevision(latestRevision);
    }

    return { writes, globalCursor: latestRevision };
  }

  private async commitChunk(
    apiBase: string,
    spaceId: string,
    clientBatchId: string,
    offset: number,
    chunk: BatchMutation[],
    writes: RemoteWriteResult[],
    baseRevision: number,
  ): Promise<number> {
    // Phase 1: Prepare
    const objects: CfV2PrepareObject[] = [];
    const deletions: CfV2PrepareDeletion[] = [];

    for (const m of chunk) {
      if (m.operation === "put") {
        const content = JSON.stringify(m.value);
        const contentBytes = new TextEncoder().encode(content);
        // blobHash 必须是原始内容字节的 SHA-256 hex（不含 "sha256:" 前缀）
        // canonical JSON；上传协议 hash 必须始终对实际传输字节重新计算。
        const blobHash = (await createSha256Hash(contentBytes)).slice(7);
        objects.push({
          clientMutationId: m.clientMutationId,
          assetType: m.assetType,
          assetId: m.assetId,
          metadata: "{}",
          blobHash,
          blobByteSize: contentBytes.byteLength,
          storageMode: "full",
          schemaVersion: 1,
          encoding: "identity",
          writerAppVersion: "0.0.0",
          writerBuildId: "browser",
        });
      } else {
        deletions.push({
          clientMutationId: m.clientMutationId,
          assetType: m.assetType,
          assetId: m.assetId,
        });
      }
    }

    const suffix = offset > 0 ? `-${offset}` : "";

    let prepare: CfV2PrepareResponse;
    try {
      prepare = await cfV2PostJson<CfV2PrepareResponse>(
        apiBase,
        `/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
        {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "prepare",
          baseRevision,
          clientBatchId: `${clientBatchId}${suffix}`,
          objects,
          deletions,
        },
      );
    } catch (error) {
      throw translateWriteError(error);
    }

    try {
      // Phase 2: Upload blobs
      for (const instruction of prepare.uploads) {
        if (!instruction.required || !instruction.url) continue;
        const mutation = chunk.find(
          (m) => m.assetType === instruction.assetType && m.assetId === instruction.assetId,
        );
        if (!mutation || mutation.operation !== "put") continue;

        const uploadResponse = await fetch(instruction.url, {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            ...instruction.headers,
          },
          body: JSON.stringify(mutation.value),
        });
        if (!uploadResponse.ok) {
          let errorBody = "";
          try { errorBody = await uploadResponse.text(); } catch { /* ignore */ }
          throw new CfV2HttpError(
            uploadResponse.status,
            "upload_failed",
            `Failed to upload ${instruction.assetType}/${instruction.assetId}: ${errorBody}`,
          );
        }
      }

      // Phase 3: Commit
      const result = await commitPreparedBatch(apiBase, spaceId, prepare);

      // 更新本地状态
      const currentState = await this.session.localState.readState();
      const resultRevision = String(result.revision);
      if (resultRevision !== currentState.revision) {
        await this.session.localState.advanceToRevision(resultRevision);
      }

      // 映射结果
      for (const mutation of chunk) {
        const applied = result.assets.find(
          (a) => a.assetType === mutation.assetType && a.assetId === mutation.assetId,
        );
        if (applied) {
          writes.push({
            collection: mutation.collection,
            assetId: mutation.adapterAssetId,
            revision: toLegacyNumericRevision(result.revision),
            contentHash: toAdapterContentHash(applied.contentHash),
            deletedAt: null,
            committedAt: result.serverTime,
          });
        } else {
          const deleted = result.deletedAssets.find(
            (a) => a.assetType === mutation.assetType && a.assetId === mutation.assetId,
          );
          if (deleted) {
            writes.push({
              collection: mutation.collection,
              assetId: mutation.adapterAssetId,
              revision: toLegacyNumericRevision(result.revision),
              contentHash: null,
              deletedAt: mutation.deletedAt,
              committedAt: result.serverTime,
            });
          }
        }
      }

      return toLegacyNumericRevision(result.revision);
    } catch (error) {
      await cancelPreparedBatch(apiBase, spaceId, prepare);
      throw translateWriteError(error);
    }
  }

  public async discard(): Promise<void> {
    this.mutations = [];
    this.committed = true;
  }
}

// ============================================================================
// CloudflareSyncRemote
// ============================================================================

export interface CloudflareSyncRemoteOptions {
  readonly apiBase?: string;
  readonly spaceId?: string;
  // 以下选项保留以兼容 sync-host.ts 的调用方式，
  // cf-sync-v2 使用直接 HTTP fetch，不使用 Web Worker。
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
  readonly onRequestActivityChange?: (activity: {
    readonly activeRequestCount: number;
    readonly queuedRequestCount: number;
  }) => void;
  readonly workerClientFactory?: unknown;
}

export class CloudflareSyncRemote implements SyncRemote {
  public readonly localState: CloudflareSyncLocalState;
  private readonly apiBase: string;
  private readonly spaceId: string;

  public constructor(options: CloudflareSyncRemoteOptions = {}) {
    this.apiBase = (options.apiBase ?? resolveBackendApiBaseUrl()).replace(/\/$/, "");
    this.spaceId = options.spaceId?.trim() || "default";
    this.localState = new CloudflareSyncLocalState(this.apiBase, this.spaceId);
  }

  public async beginSession(
    context: SyncRemoteSessionContext,
  ): Promise<SyncRemoteSession> {
    return new CloudflareSyncRemoteSession(
      this.localState,
      context,
      this.apiBase,
    );
  }

  public async resetRemote(): Promise<void> {
    const state = await this.localState.readState();
    // 远端 reset：尝试创建新空间（若已存在则忽略），然后本地重置状态
    // 中的全部资产按 deletion 事务分批提交，确保 D1/R2 都走服务端删除状态机。
    let plan: CfV2PlanResponse;
    try {
      plan = await cfV2GetJson<CfV2PlanResponse>(
        this.apiBase,
        `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/plan`,
      );
    } catch (error) {
      if (!(error instanceof CfV2HttpError && error.status === 404)) {
        throw error;
      }
      await cfV2PostJson(this.apiBase, "/v1/sync/spaces", {
        spaceId: state.spaceId,
      });
      plan = {
        spaceId: state.spaceId,
        revision: "0",
        epoch: 0,
        assets: [],
        serverTime: new Date().toISOString(),
      };
    }

    let baseRevision = plan.revision;
    for (let offset = 0; offset < plan.assets.length; offset += 32) {
      const chunk = plan.assets.slice(offset, offset + 32);
      const prepare = await cfV2PostJson<CfV2PrepareResponse>(
        this.apiBase,
        `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/mutations`,
        {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "prepare",
          baseRevision,
          clientBatchId: createUuid(),
          objects: [],
          deletions: chunk.map((asset) => ({
            clientMutationId: createUuid(),
            assetType: asset.assetType,
            assetId: asset.assetId,
          })),
        },
      );
      try {
        const result = await commitPreparedBatch(
          this.apiBase,
          state.spaceId,
          prepare,
        );
        baseRevision = result.revision;
      } catch (error) {
        await cancelPreparedBatch(this.apiBase, state.spaceId, prepare);
        throw error;
      }
    }
    await this.localState.reset();
  }

  public async abortTransaction(): Promise<void> {
    const state = await this.localState.readState();
    await cfV2PostJson(
      this.apiBase,
      `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/transaction/abort`,
      {},
    );
  }

  public dispose(): void { /* no-op */ }
}

export function createCloudflareSyncRemote(
  options: CloudflareSyncRemoteOptions = {},
): SyncRemote {
  return new CloudflareSyncRemote(options);
}

// ============================================================================
// 工具函数
// ============================================================================

function toAdapterContentHash(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

// 旧主线程实现已经停用；该转换仅保持历史文件可类型检查，不参与生产 Worker 链路。
function toLegacyNumericRevision(revision: string): number {
  const numeric = Number(revision);
  return Number.isSafeInteger(numeric) ? numeric : 0;
}

function createAssetStateKey(collection: SyncRemoteCollection, assetId: string): string {
  return `${collection.adapterId}:${assetId}`;
}

function translateWriteError(error: unknown): unknown {
  if (error instanceof CfV2HttpError && error.status === 409) {
    const details = error.details;
    if (
      typeof details === "object"
      && details !== null
      && "status" in details
      && details.status === "conflict"
      && "conflicts" in details
      && Array.isArray(details.conflicts)
    ) {
      return new RemoteWriteConflictError(details.conflicts.map((conflict) => {
        const value = conflict as Record<string, unknown>;
        return {
          assetType: typeof value.assetType === "string" ? value.assetType : "",
          assetId: typeof value.assetId === "string" ? value.assetId : "",
          reason: typeof value.reason === "string" ? value.reason : "unknown",
          expectedRevision: typeof value.expectedRevision === "number"
            ? value.expectedRevision
            : null,
          actualRevision: typeof value.actualRevision === "number"
            ? value.actualRevision
            : null,
          expectedHash: typeof value.expectedHash === "string" ? value.expectedHash : null,
          actualHash: typeof value.actualHash === "string" ? value.actualHash : null,
        };
      }));
    }
  }
  return error;
}

