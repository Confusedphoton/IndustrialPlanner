import { yituliuTargetKey } from "./yituliu-session";
import { resolveBackendApiBaseUrl } from "./backend-api-address";
import {
  applyIndexedDbStoreMutations,
  listFromIndexedDb,
  readFromIndexedDb,
  type IndexedDbStoreLocation,
} from "./browser-storage";
import { readCloudflareSyncSettings } from "./cloudflare-sync-settings";
import { readCloudflareOAuthSession } from "./cloudflare-oauth-session";
import {
  createCloudflareAccountSyncTargetKey,
  createCloudflareAnonymousSyncTargetKey,
  createWebDavSyncTargetKey,
  isSyncProviderTargetActive,
  readActiveSyncProvider,
} from "./sync-provider-activation";

const SYNC_DATABASE_NAME = "v3-industrial-planner";
// 同步连接设置 store：与 src/sync/storage/sync-connection-settings.ts 保持一致。
const SYNC_CONNECTION_SETTINGS_LOCATION = {
  databaseName: SYNC_DATABASE_NAME,
  storeName: "sync-connection-settings",
  key: "settings",
} as const;

export const CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME = "cloudflare-sync-tombstones";
export const WEBDAV_SYNC_TOMBSTONE_STORE_NAME = "webdav-sync-tombstones";

export type ActiveSyncProvider = "cloudflare" | "webdav" | "yituliu";

export interface SyncTombstone<TValue> {
  readonly assetId: string;
  readonly value: TValue;
  readonly deletedAt: string;
}

interface PersistedSyncTombstone {
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly adapterId: string;
  readonly assetId: string;
  readonly value: unknown;
  readonly deletedAt: string;
}

interface ActiveSyncTombstoneScope {
  readonly provider: ActiveSyncProvider;
  readonly scopeKey: string;
  readonly storeLocation: IndexedDbStoreLocation;
}

export async function listActiveSyncTombstones<TValue>(
  adapterId: string,
): Promise<SyncTombstone<TValue>[]> {
  const scope = await resolveActiveSyncTombstoneScope();
  if (scope === null) {
    return [];
  }

  const records = await listFromIndexedDb<unknown>(scope.storeLocation);

  return records.flatMap((record) => {
    const normalized = normalizePersistedSyncTombstone(record);
    return normalized !== null
      && normalized.scopeKey === scope.scopeKey
      && normalized.adapterId === adapterId
      ? [{
          assetId: normalized.assetId,
          value: normalized.value as TValue,
          deletedAt: normalized.deletedAt,
        }]
      : [];
  });
}

export async function writeActiveSyncTombstone<TValue>(options: {
  readonly adapterId: string;
  readonly assetId: string;
  readonly value: TValue;
  readonly deletedAt: string;
}): Promise<void> {
  const scope = await resolveActiveSyncTombstoneScope();
  if (scope === null) {
    return;
  }

  const record: PersistedSyncTombstone = {
    schemaVersion: 1,
    scopeKey: scope.scopeKey,
    adapterId: options.adapterId,
    assetId: options.assetId,
    value: options.value,
    deletedAt: options.deletedAt,
  };
  const saved = await applyIndexedDbStoreMutations(scope.storeLocation, [{
    type: "put",
    key: createTombstoneStorageKey(record),
    value: record,
  }]);

  if (!saved) {
    throw new Error("Failed to persist sync tombstone.");
  }
}

export async function clearActiveSyncTombstone(
  adapterId: string,
  assetId: string,
): Promise<void> {
  const scope = await resolveActiveSyncTombstoneScope();
  if (scope === null) {
    return;
  }

  const removed = await applyIndexedDbStoreMutations(scope.storeLocation, [{
    type: "delete",
    key: createTombstoneStorageKey({
      scopeKey: scope.scopeKey,
      adapterId,
      assetId,
    }),
  }]);

  if (!removed) {
    throw new Error("Failed to clear sync tombstone.");
  }
}

export async function clearActiveSyncTombstones(
  adapterId: string,
  assetIds: readonly string[],
): Promise<void> {
  const scope = await resolveActiveSyncTombstoneScope();
  if (scope === null || assetIds.length === 0) {
    return;
  }

  const removed = await applyIndexedDbStoreMutations(
    scope.storeLocation,
    assetIds.map((assetId) => ({
      type: "delete" as const,
      key: createTombstoneStorageKey({
        scopeKey: scope.scopeKey,
        adapterId,
        assetId,
      }),
    })),
  );

  if (!removed) {
    throw new Error("Failed to clear sync tombstones.");
  }
}

export async function clearActiveSyncTombstoneScope(): Promise<void> {
  const scope = await resolveActiveSyncTombstoneScope();
  if (scope === null) {
    return;
  }

  const records = await listFromIndexedDb<unknown>(scope.storeLocation);
  const keys = records.flatMap((record) => {
    const normalized = normalizePersistedSyncTombstone(record);
    return normalized !== null && normalized.scopeKey === scope.scopeKey
      ? [createTombstoneStorageKey(normalized)]
      : [];
  });
  const removed = await applyIndexedDbStoreMutations(
    scope.storeLocation,
    keys.map((key) => ({ type: "delete" as const, key })),
  );

  if (!removed) {
    throw new Error("Failed to clear local sync tombstone scope.");
  }
}

async function resolveActiveSyncTombstoneScope(): Promise<ActiveSyncTombstoneScope | null> {
  const provider = readActiveSyncProvider();
  if (provider === null) {
    return null;
  }

  if (provider === "yituliu") {
    const target = yituliuTargetKey();
    if (target === null || !isSyncProviderTargetActive("yituliu", target)) return null;
    return { provider, scopeKey: target, storeLocation: { databaseName: SYNC_DATABASE_NAME, storeName: "yituliu-sync-tombstones" } };
  }

  if (provider === "cloudflare") {
    const settings = await readCloudflareSyncSettings();
    const session = settings.remoteMode === "account"
      ? readCloudflareOAuthSession()
      : null;
    if (settings.remoteMode === "account" && session === null) {
      return null;
    }
    const targetKey = session === null
      ? createCloudflareAnonymousSyncTargetKey({
          apiBaseUrl: resolveBackendApiBaseUrl(),
          spaceId: settings.spaceName,
        })
      : createCloudflareAccountSyncTargetKey({
          apiBaseUrl: session.apiBaseUrl,
          accountId: session.account.accountId,
          spaceId: session.spaceId,
        });
    if (!isSyncProviderTargetActive("cloudflare", targetKey)) {
      return null;
    }
    return {
      provider,
      scopeKey: [
        resolveBackendApiBaseUrl().replace(/\/$/, ""),
        session?.spaceId ?? settings.spaceName,
      ].join("\u0000"),
      storeLocation: {
        databaseName: SYNC_DATABASE_NAME,
        storeName: CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME,
      },
    };
  }

  const rawSettings = await readFromIndexedDb<unknown>(
    SYNC_CONNECTION_SETTINGS_LOCATION,
  );
  const settings = isRecord(rawSettings) ? rawSettings : {};
  const url = typeof settings.url === "string" ? settings.url.trim() : "";
  const username = typeof settings.username === "string"
    ? settings.username.trim()
    : "";
  if (!isSyncProviderTargetActive(
    "webdav",
    createWebDavSyncTargetKey({ url, username }),
  )) {
    return null;
  }

  return {
    provider,
    scopeKey: `${url}\u0000${username}`,
    storeLocation: {
      databaseName: SYNC_DATABASE_NAME,
      storeName: WEBDAV_SYNC_TOMBSTONE_STORE_NAME,
    },
  };
}


function createTombstoneStorageKey(options: {
  readonly scopeKey: string;
  readonly adapterId: string;
  readonly assetId: string;
}): string {
  return `${options.scopeKey}\u0000${options.adapterId}\u0000${options.assetId}`;
}

function normalizePersistedSyncTombstone(value: unknown): PersistedSyncTombstone | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.scopeKey !== "string"
    || typeof value.adapterId !== "string"
    || typeof value.assetId !== "string"
    || typeof value.deletedAt !== "string"
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    scopeKey: value.scopeKey,
    adapterId: value.adapterId,
    assetId: value.assetId,
    value: value.value,
    deletedAt: value.deletedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
