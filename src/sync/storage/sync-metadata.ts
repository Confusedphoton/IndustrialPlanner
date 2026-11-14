import {
  readFromLocalStorage,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

export const SYNC_METADATA_LOCAL_STORAGE_KEY = "v3-sync-metadata";

interface SyncMetadataState {
  readonly contentHashes: Record<string, string>;
  readonly remoteRevisions: Record<string, number>;
  readonly remoteEtags: Record<string, string>;
}

const EMPTY_METADATA: SyncMetadataState = {
  contentHashes: {},
  remoteRevisions: {},
  remoteEtags: {},
};

export function readLastSyncedContentHash(assetKey: string): string | null {
  return readSyncMetadataState().contentHashes[assetKey] ?? null;
}

export function writeLastSyncedContentHash(assetKey: string, contentHash: string): string {
  const state = readSyncMetadataState();
  saveToLocalStorage<SyncMetadataState>(SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: {
      ...state.contentHashes,
      [assetKey]: contentHash,
    },
    remoteRevisions: state.remoteRevisions,
    remoteEtags: state.remoteEtags,
  });

  return contentHash;
}

export function clearLastSyncedContentHash(assetKey: string): void {
  const state = readSyncMetadataState();
  const { [assetKey]: _removed, ...contentHashes } = state.contentHashes;

  saveToLocalStorage<SyncMetadataState>(SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes,
    remoteRevisions: state.remoteRevisions,
    remoteEtags: state.remoteEtags,
  });
}

export function readLastSeenRemoteRevision(remoteStateKey: string): number | null {
  return readSyncMetadataState().remoteRevisions[remoteStateKey] ?? null;
}

export function writeLastSeenRemoteRevision(
  remoteStateKey: string,
  revision: number,
): number {
  const state = readSyncMetadataState();
  saveToLocalStorage<SyncMetadataState>(SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: state.contentHashes,
    remoteRevisions: {
      ...state.remoteRevisions,
      [remoteStateKey]: revision,
    },
    remoteEtags: state.remoteEtags,
  });

  return revision;
}

export function clearLastSeenRemoteRevision(remoteStateKey: string): void {
  const state = readSyncMetadataState();
  const { [remoteStateKey]: _removed, ...remoteRevisions } = state.remoteRevisions;

  saveToLocalStorage<SyncMetadataState>(SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: state.contentHashes,
    remoteRevisions,
    remoteEtags: state.remoteEtags,
  });
}

export function readLastSeenRemoteEtag(remoteStateKey: string): string | null {
  return readSyncMetadataState().remoteEtags[remoteStateKey] ?? null;
}

export function writeLastSeenRemoteEtag(
  remoteStateKey: string,
  etag: string,
): string {
  const state = readSyncMetadataState();
  saveToLocalStorage<SyncMetadataState>(SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: state.contentHashes,
    remoteRevisions: state.remoteRevisions,
    remoteEtags: {
      ...state.remoteEtags,
      [remoteStateKey]: etag,
    },
  });

  return etag;
}

export function clearLastSeenRemoteEtag(remoteStateKey: string): void {
  const state = readSyncMetadataState();
  const { [remoteStateKey]: _removed, ...remoteEtags } = state.remoteEtags;

  saveToLocalStorage<SyncMetadataState>(SYNC_METADATA_LOCAL_STORAGE_KEY, {
    contentHashes: state.contentHashes,
    remoteRevisions: state.remoteRevisions,
    remoteEtags,
  });
}

export function clearSyncMetadata(): void {
  try {
    globalThis.localStorage?.removeItem(SYNC_METADATA_LOCAL_STORAGE_KEY);
  } catch (error) {
    throw new Error("Failed to clear sync metadata.", { cause: error });
  }
}

function readSyncMetadataState(): SyncMetadataState {
  const rawState = readFromLocalStorage<unknown>(SYNC_METADATA_LOCAL_STORAGE_KEY);

  if (!isRecord(rawState)) {
    return EMPTY_METADATA;
  }

  const contentHashes = Object.fromEntries(
    Object.entries(
      isRecord(rawState.contentHashes) ? rawState.contentHashes : {},
    ).flatMap(([assetKey, contentHash]) => {
      if (typeof contentHash !== "string") {
        return [];
      }

      return [[assetKey, contentHash]];
    }),
  );
  const remoteRevisions = Object.fromEntries(
    Object.entries(
      isRecord(rawState.remoteRevisions) ? rawState.remoteRevisions : {},
    ).flatMap(([remoteStateKey, revision]) =>
      typeof revision === "number"
      && Number.isSafeInteger(revision)
      && revision >= 0
        ? [[remoteStateKey, revision]]
        : []
    ),
  );
  const remoteEtags = Object.fromEntries(
    Object.entries(
      isRecord(rawState.remoteEtags) ? rawState.remoteEtags : {},
    ).flatMap(([remoteStateKey, etag]) =>
      typeof etag === "string" && etag.length > 0
        ? [[remoteStateKey, etag]]
        : []
    ),
  );

  return { contentHashes, remoteRevisions, remoteEtags };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
