import { YituliuSyncRemote } from "./clients/yituliu";
import { readYituliuSession, yituliuTargetKey, subscribeToYituliuSession } from "@/shared/storage/yituliu-session";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { normalizeBlueprintStorageEntry } from "@/shared/storage/blueprint-storage";
import { createSnapshotSelector } from "@/shared/snapshot/snapshot-selector";
import { selectDocumentContent, sameDocumentRemoteContent } from "@/shared/snapshot/world-document-selection";
import type {
  SyncAssetEntry,
  SyncAssetSource,
  SyncConflictResolution,
  SyncContract,
  SyncInitialSyncStage,
  SyncTaskKind,
} from "@/domain/sync";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import { createUuid } from "@/domain/shared/uuid";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import {
  applyBlueprintSyncEntry,
  listBlueprintSyncEntries,
  type BlueprintFolderRecord,
  type BlueprintRecord,
} from "@/shared/storage/blueprint-storage";
import {
  loadPlannerState,
  normalizePlannerPersistedState,
  savePlannerState,
  type PlannerPersistedState,
} from "@/shared/storage/planner-storage";
import {
  deleteWorldDocument,
  listLatestWorldDocumentsByBase,
  listWorldDocuments,
  normalizeWorldDocument,
  readWorldDocument,
  writeWorldDocument,
} from "@/shared/storage/world-document-storage";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
import type { SnapshotChangeContext } from "@/shared/snapshot/snapshot-store";

import {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  type SyncAdapterConflict,
  type SyncAdapter,
} from "./engine/sync-adapters";
import {
  createSyncService,
  type SyncInitialPlan,
  type SyncLocalChange,
  type SyncMaintenanceTask,
  type SyncService,
} from "./engine/sync-service";
import {
  readSyncConnectionSettings,
  subscribeToSyncConnectionSettingsChanges,
  writeSyncConnectionSettings,
} from "./storage/sync-connection-settings";
import {
  readSyncProvider,
  writeSyncProvider,
} from "./sync-providers";
import {
  activateSyncProvider,
  createCloudflareAccountSyncTargetKey,
  createCloudflareAnonymousSyncTargetKey,
  createWebDavSyncTargetKey,
  hasPersistedSyncProviderActivation,
  isSyncProviderTargetActive,
  readActiveSyncProvider,
  readSyncProviderActivation,
  subscribeToSyncProviderActivationChanges,
} from "@/shared/storage/sync-provider-activation";
import { SyncStateImpl } from "./sync-state-impl";
import { createWebDavWorkerStorageClient } from "./clients/webdav/webdav-worker-client";
import { createWebDavSyncRemote } from "./clients/webdav/webdav-remote";
import {
  CloudflareV2WorkerClient,
  createCloudflareSyncRemote,
  initializeCloudflareSpaceSettings,
  readCloudflareV2LocalRevision,
} from "./clients/cloudflare";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";
import {
  clearCloudflareOAuthSession,
  readCloudflareOAuthSession,
  subscribeToCloudflareOAuthSessionChanges,
  type CloudflareOAuthSession,
} from "@/shared/storage/cloudflare-oauth-session";
import {
  clearCloudflareSyncSettings,
  resolveCloudflareSpaceId,
  subscribeToCloudflareSyncSettingsChanges,
  writeCloudflareSyncSettings,
  type CloudflareSyncSettings,
} from "@/shared/storage/cloudflare-sync-settings";

export interface SyncHostOptions {
  readonly assetSources?: readonly SyncAssetSource[];
}

export interface SyncHost extends SyncContract {
  dispose(): void;
}

type ResolveInteractiveConflict = <TValue>(
  conflict: SyncAdapterConflict<TValue>,
) => Promise<SyncConflictResolution>;

/**
 * 从 provider 选择 + URL 派生 enabled。
 * 兼容旧用户：若 provider 未设置但旧 enabled=true 且 URL 非空，
 * 自动迁移 provider→"webdav"。
 */
function deriveEnabled(
  settings: { readonly url: string; readonly username: string },
  cloudflareTargetKey: string | null,
  oldEnabled?: boolean,
): boolean {
  const yituliuTarget = yituliuTargetKey();
  if (yituliuTarget !== null && isSyncProviderTargetActive("yituliu", yituliuTarget)) return true;
  const webDavTargetKey = createWebDavSyncTargetKey(settings);
  if (
    settings.url.trim() !== ""
    && isSyncProviderTargetActive("webdav", webDavTargetKey)
  ) {
    return true;
  }
  if (
    cloudflareTargetKey !== null
    && resolveBackendApiBaseUrl().trim() !== ""
    && isSyncProviderTargetActive("cloudflare", cloudflareTargetKey)
  ) {
    return true;
  }
  if (
    !hasPersistedSyncProviderActivation()
    && readSyncProvider() === "none"
    && oldEnabled === true
    && settings.url.trim() !== ""
  ) {
    return activateSyncProvider("webdav", webDavTargetKey);
  }
  return false;
}

export async function createSyncHost(
  workspace: WorkspaceContract,
  options: SyncHostOptions,
): Promise<SyncHost> {
  const state = new SyncStateImpl();
  const disposers: Array<() => void> = [];
  let currentCloudflareSession = readCloudflareOAuthSession();
  // Cloudflare transport 归 SyncHost 所有；单轮 SyncRemote dispose 不终止正在后台执行的上传。
  // 延迟创建避免未选择 Cloudflare 时加载或初始化对应 Worker。
  let cloudflareWorkerClient: CloudflareV2WorkerClient | null = null;
  const getCloudflareWorkerClient = (): CloudflareV2WorkerClient => {
    cloudflareWorkerClient ??= new CloudflareV2WorkerClient({
      onAuthenticationFailure: () => {
        if (currentCloudflareSession !== null) {
          clearCloudflareOAuthSession();
        }
      },
    });
    return cloudflareWorkerClient;
  };
  const disposeCloudflareWorkerClient = (): void => {
    cloudflareWorkerClient?.dispose();
    cloudflareWorkerClient = null;
  };
  let localNotificationScheduled = false;
  let syncStarted = false;
  let directoryTreeReadyKey: string | null = null;
  const lastEditorDocumentHashByBaseId = new Map(
    Array.from(
      (await listLatestWorldDocumentsByBase({})).values(),
      (document) => [
        document.baseId,
        createStableJsonHash(createWorldDocumentRemoteValue(document)),
      ] as const,
    ),
  );
  const activationAtStartup = readSyncProviderActivation();
  let currentCloudflareSettings = await initializeCloudflareSpaceSettings({
    apiBase: resolveBackendApiBaseUrl(),
    cloudflareProviderSelected: activationAtStartup.state === "active"
      && activationAtStartup.provider === "cloudflare"
      && activationAtStartup.confirmedTargetKey === null,
  });
  if (
    !hasPersistedSyncProviderActivation()
    && readActiveSyncProvider() === "cloudflare"
    && currentCloudflareSession !== null
    && currentCloudflareSettings.remoteMode === "anonymous"
  ) {
    currentCloudflareSettings = await writeCloudflareSyncSettings({
      ...currentCloudflareSettings,
      remoteMode: "account",
    });
  }
  let suppressCloudflareSettingsSync = false;
  const resolveCloudflareTargetKey = (
    settings: CloudflareSyncSettings = currentCloudflareSettings,
    session: CloudflareOAuthSession | null = currentCloudflareSession,
  ): string | null => {
    if (settings.remoteMode === "account") {
      return session === null
        || session.apiBaseUrl !== resolveBackendApiBaseUrl()
        ? null
        : createCloudflareAccountSyncTargetKey({
            apiBaseUrl: session.apiBaseUrl,
            accountId: session.account.accountId,
            spaceId: session.spaceId,
          });
    }
    return settings.spaceName.trim() === ""
      ? null
      : createCloudflareAnonymousSyncTargetKey({
          apiBaseUrl: resolveBackendApiBaseUrl(),
          spaceId: settings.spaceName,
        });
  };
  const getCloudflareTarget = (
    settings: CloudflareSyncSettings = currentCloudflareSettings,
    session: CloudflareOAuthSession | null = currentCloudflareSession,
  ) => {
    if (settings.remoteMode === "account") {
      if (
        session === null
        || session.apiBaseUrl !== resolveBackendApiBaseUrl()
      ) {
        throw new Error("Cloudflare account login is required.");
      }
      return {
        spaceId: session.spaceId,
        accessToken: session.accessToken,
        targetKey: createCloudflareAccountSyncTargetKey({
          apiBaseUrl: session.apiBaseUrl,
          accountId: session.account.accountId,
          spaceId: session.spaceId,
        }),
      };
    }
    return {
      spaceId: resolveCloudflareSpaceId(settings),
      accessToken: null,
      targetKey: createCloudflareAnonymousSyncTargetKey({
        apiBaseUrl: resolveBackendApiBaseUrl(),
        spaceId: resolveCloudflareSpaceId(settings),
      }),
    };
  };
  let localRevisionTargetKey: string | null = null;
  let localRevisionRefreshGeneration = 0;
  const refreshCurrentLocalRevision = async (): Promise<void> => {
    const generation = ++localRevisionRefreshGeneration;
    if (readActiveSyncProvider() !== "cloudflare") {
      localRevisionTargetKey = null;
      state.setCurrentLocalRevision(null);
      return;
    }

    let target: ReturnType<typeof getCloudflareTarget>;
    try {
      target = getCloudflareTarget();
    } catch {
      localRevisionTargetKey = null;
      state.setCurrentLocalRevision(null);
      return;
    }

    if (localRevisionTargetKey !== target.targetKey) {
      localRevisionTargetKey = target.targetKey;
      state.setCurrentLocalRevision(null);
    }

    try {
      const revision = await readCloudflareV2LocalRevision(
        resolveBackendApiBaseUrl(),
        target.spaceId,
      );
      if (
        generation === localRevisionRefreshGeneration
        && readActiveSyncProvider() === "cloudflare"
        && resolveCloudflareTargetKey() === target.targetKey
      ) {
        state.setCurrentLocalRevision(revision);
      }
    } catch {
      // 本地 revision 读取失败不影响同步；目标切换时已清空旧目标的展示值。
    }
  };
  let currentSettings = await readSyncConnectionSettings();
  // 从 sync provider + URL 派生 enabled 标志，兼容旧用户自动迁移
  // deriveEnabled 内部会在旧用户首次访问时将 provider 写为 "webdav"
  currentSettings = {
    ...currentSettings,
    enabled: deriveEnabled(
      currentSettings,
      resolveCloudflareTargetKey(),
      currentSettings.enabled,
    ),
  };
  const initialActivation = readSyncProviderActivation();
  if (
    initialActivation.state === "active"
    && initialActivation.confirmedTargetKey === null
  ) {
    const legacyTargetKey = initialActivation.provider === "webdav"
      ? currentSettings.url.trim() === ""
        ? null
        : createWebDavSyncTargetKey(currentSettings)
      : resolveCloudflareTargetKey();
    if (legacyTargetKey !== null) {
      activateSyncProvider(initialActivation.provider, legacyTargetKey);
    }
  }
  let notifyConflictDetected = (
    _conflict: SyncAdapterConflict<unknown>,
  ): void => {};
  const pendingLocalChanges = new Map<string, Set<string> | null>();

  const notifyLocalChange = (change: SyncLocalChange) => {
    if (!isAdapterReadyForLocalChanges(
      state.status.initialSyncStage,
      change.adapterId,
      externalSources,
    )) {
      return;
    }

    const currentAssetIds = pendingLocalChanges.get(change.adapterId);
    if (change.assetId === undefined) {
      pendingLocalChanges.set(change.adapterId, null);
    } else if (currentAssetIds !== null) {
      const nextAssetIds = currentAssetIds ?? new Set<string>();
      nextAssetIds.add(change.assetId);
      pendingLocalChanges.set(change.adapterId, nextAssetIds);
    }
    if (localNotificationScheduled) {
      return;
    }
    localNotificationScheduled = true;
    globalThis.queueMicrotask(() => {
      localNotificationScheduled = false;

      for (const [adapterId, assetIds] of pendingLocalChanges) {
        if (assetIds === null) {
          service.notifyLocalChange({ adapterId });
          continue;
        }

        for (const assetId of assetIds) {
          service.notifyLocalChange({ adapterId, assetId });
        }
      }
      pendingLocalChanges.clear();
    });
  };

  const externalSources = options.assetSources ?? [];
  const resolveInteractiveConflict: ResolveInteractiveConflict = async (
    conflict,
  ) => {
    notifyConflictDetected(conflict);
    return "pause";
  };
  const adapters: SyncAdapter[] = [
    createFullNoRevisionAdapter<PlannerPersistedState>({
      id: "production-planning",
      remotePath: "assets/planner-state.json",
      readLocal: async () => await loadPlannerState(),
      writeLocal: async (value) => {
        await savePlannerState(value, { origin: "remote-sync" });
      },
      normalizeRemote: normalizePlannerPersistedState,
      resolveConflict: resolveInteractiveConflict,
    }),
    createFullWithRevisionAdapter<BlueprintRecord>({
      id: "blueprints",
      recoverUnavailableRemote: true,
      isRemoteVersionUnsupported: isUnsupportedDocumentSchema,
      normalizeRemote: (value) => {
        const entry = normalizeBlueprintStorageEntry(value);
        return entry?.kind === "blueprint" ? entry : null;
      },
      indexPath: "assets/blueprints/index.json",
      entryPath: (blueprintId) => `assets/blueprints/${blueprintId}.json`,
      listLocal: async () => await listBlueprintSyncEntries<BlueprintRecord>("blueprint"),
      writeLocal: async (entry) => {
        await applyBlueprintSyncEntry(entry, { origin: "remote-sync" });
      },
      resolveConflict: resolveInteractiveConflict,
    }),
    createFullWithRevisionAdapter<BlueprintFolderRecord>({
      id: "blueprint-folders",
      recoverUnavailableRemote: true,
      isRemoteVersionUnsupported: isUnsupportedDocumentSchema,
      normalizeRemote: (value) => {
        const entry = normalizeBlueprintStorageEntry(value);
        return entry?.kind === "folder" ? entry : null;
      },
      indexPath: "assets/blueprint-folders/index.json",
      entryPath: (folderId) => `assets/blueprint-folders/${folderId}.json`,
      listLocal: async () => await listBlueprintSyncEntries<BlueprintFolderRecord>("folder"),
      writeLocal: async (entry) => {
        await applyBlueprintSyncEntry(entry, { origin: "remote-sync" });
      },
      resolveConflict: resolveInteractiveConflict,
    }),
    ...externalSources.map((source) => createAdapterFromSource(
      source,
      resolveInteractiveConflict,
    )),
    createWorldDocumentAdapter(
      workspace,
      resolveInteractiveConflict,
      (baseId, document) => {
        if (document === null) {
          lastEditorDocumentHashByBaseId.delete(baseId);
          return;
        }
        recordWorldDocumentProjectionChange(
          lastEditorDocumentHashByBaseId,
          document,
        );
      },
    ),
  ];

  state.setSettings(currentSettings);
  const service:  SyncService = createSyncService({
    readSettings: () => currentSettings,
    validateSettings: (settings) => {
      const provider = readActiveSyncProvider();
      if (provider === "yituliu") return readYituliuSession() === null ? "一图流登录已失效" : null;
      if (provider === "cloudflare") {
        if (resolveBackendApiBaseUrl().trim() === "") {
          return "Cloudflare backend URL is empty";
        }
        return currentCloudflareSettings.remoteMode === "account"
          && (
            currentCloudflareSession === null
            || currentCloudflareSession.apiBaseUrl !== resolveBackendApiBaseUrl()
          )
          ? "Cloudflare account login is required"
          : null;
      }
      return settings.url.trim() === "" ? "Sync URL is empty" : null;
    },
    createRemote: (
      settings,
      onRequestActivityChange,
      requestOptions,
    ) => {
      const provider = readActiveSyncProvider();
      if (provider === "yituliu") return new YituliuSyncRemote();
      if (provider === "cloudflare") {
        const target = getCloudflareTarget();
        return createCloudflareSyncRemote({
          apiBase: resolveBackendApiBaseUrl(),
          spaceId: target.spaceId,
          ...(target.accessToken === null
            ? {}
            : { accessToken: target.accessToken }),
          workerClient: getCloudflareWorkerClient(),
          maxConcurrentRequests: settings.maxConcurrentRequests,
          onRequestActivityChange,
          ...(requestOptions.requestTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: requestOptions.requestTimeoutMs }),
        });
      }
      return createWebDavSyncRemote({
        client: createWebDavWorkerStorageClient({
          baseUrl: settings.url,
          username: settings.username,
          password: settings.password,
          maxConcurrentRequests: settings.maxConcurrentRequests,
          onRequestActivityChange,
          ...(requestOptions.requestTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: requestOptions.requestTimeoutMs }),
        }),
      });
    },
    adapters,
    createInitialSyncPlan: () => createInitialSyncPlan(workspace, externalSources),
    maintenanceTasks: createMaintenanceTasks({
      collections: adapters.map((adapter) => adapter.collection),
      getDirectoryTreeReadyKey: () => directoryTreeReadyKey,
      setDirectoryTreeReadyKey: (key) => {
        directoryTreeReadyKey = key;
      },
    }),
    resolveAdapterTaskKind: (adapterId) =>
      resolveAdapterTaskKind(adapterId, externalSources),
    canRunInterval: () =>
      typeof document === "undefined" || document.visibilityState === "visible",
    beforeSync: async (session) => {
      // 首次同步时侦查远端状态，决定 UI 显示"上传中"还是"下载中"
      if (
        state.status.phase === "downloading"
        && (state.status.currentRunReason === "startup" || state.status.currentRunReason === "foreground")
      ) {
        try {
          const allCollections = adapters.map((a) => a.collection);
          await session.prefetchIndexes(allCollections);
          // 读取第一个集合的 index 判断远端是否为空
          let remoteHasContent = false;
          for (const collection of allCollections) {
            const index = await session.readIndex(collection);
            if (Object.keys(index.entries).length > 0) {
              remoteHasContent = true;
              break;
            }
          }
          if (!remoteHasContent) {
            state.setStatus({
              ...state.status,
              phase: "uploading",
            });
          }
        } catch {
          // 侦查失败不阻塞同步，保留 downloading 显示
        }
      }
    },
    afterSync: () => {
    },
    onStatusChange: (nextStatus) => {
      state.setStatus(nextStatus);
      if (
        nextStatus.currentRunReason === null
        && (nextStatus.phase === "idle" || nextStatus.phase === "error")
      ) {
        void refreshCurrentLocalRevision();
      }
    },
    onConflictDiscoveryStart: state.beginConflictDiscovery,
    resolveConflicts: state.requestConflictResolutions,
    onConflictWorkflowFinished: state.finishConflictWorkflow,
  });
  await refreshCurrentLocalRevision();
  notifyConflictDetected = service.notifyConflictDetected;

  const actions: SyncContract["actions"] = {
    updateSettings: async (patch) => {
      const wasEnabled = currentSettings.enabled;
      const merged = { ...currentSettings, ...patch };
      // enabled 由 provider + URL 派生，忽略 patch 中的 enabled
      merged.enabled = deriveEnabled(
        merged,
        resolveCloudflareTargetKey(),
        wasEnabled ? undefined : currentSettings.enabled,
      );
      currentSettings = await writeSyncConnectionSettings(merged);
      state.setSettings(currentSettings);
    },
    syncNow: async () => {
      await service.syncNow(
        state.status.initialSyncStage === "ready" ? "manual" : "foreground",
      );
    },
    resolveConflicts: state.resolveConflicts,
    deleteRemoteData: async () => {
      const provider = readActiveSyncProvider();
      if (provider === null) {
        return;
      }
      const settings = currentSettings;
      const cloudflareSettings = currentCloudflareSettings;
      if (provider === "webdav" && settings.url.trim() === "") {
        throw new Error("Cannot delete WebDAV data because the sync URL is empty.");
      }
      service.stop();
      try {
        const cloudflareTarget = provider === "cloudflare"
          ? getCloudflareTarget(cloudflareSettings)
          : null;
        const remote = provider === "yituliu" ? new YituliuSyncRemote() : cloudflareTarget !== null
          ? createCloudflareSyncRemote({
              apiBase: resolveBackendApiBaseUrl(),
              spaceId: cloudflareTarget.spaceId,
              ...(cloudflareTarget.accessToken === null
                ? {}
                : { accessToken: cloudflareTarget.accessToken }),
              workerClient: getCloudflareWorkerClient(),
              maxConcurrentRequests: settings.maxConcurrentRequests,
            })
          : createWebDavSyncRemote({
              client: createWebDavWorkerStorageClient({
                baseUrl: settings.url,
                username: settings.username,
                password: settings.password,
                maxConcurrentRequests: settings.maxConcurrentRequests,
              }),
            });
        try {
          await remote.resetRemote?.();
        } finally {
          remote.dispose?.();
        }

        if (provider === "cloudflare") {
          suppressCloudflareSettingsSync = true;
          try {
            await clearCloudflareSyncSettings();
            currentCloudflareSettings = {
              spaceName: "",
              remoteMode: "anonymous",
            };
          } finally {
            suppressCloudflareSettingsSync = false;
          }
        }

        // 只有远端确认 reset 成功后才关闭 provider，避免先改 provider 导致删到另一个后端。
        writeSyncProvider("none");
        currentSettings = await writeSyncConnectionSettings({
          ...currentSettings,
          enabled: false,
        });
        state.setSettings(currentSettings);
      } finally {
        if (syncStarted && currentSettings.enabled) {
          service.start();
        }
      }
    },
    abortCurrentTransaction: async () => {
      const provider = readActiveSyncProvider();
      if (provider !== "cloudflare") {
        return;
      }
      const settings = currentSettings;
      const cloudflareSettings = currentCloudflareSettings;
      service.stop();
      try {
        const cloudflareTarget = getCloudflareTarget(cloudflareSettings);
        const remote = createCloudflareSyncRemote({
          apiBase: resolveBackendApiBaseUrl(),
          spaceId: cloudflareTarget.spaceId,
          ...(cloudflareTarget.accessToken === null
            ? {}
            : { accessToken: cloudflareTarget.accessToken }),
          workerClient: getCloudflareWorkerClient(),
          maxConcurrentRequests: settings.maxConcurrentRequests,
        });
        try {
          await remote.abortTransaction?.();
        } finally {
          remote.dispose?.();
        }
      } finally {
        if (syncStarted && currentSettings.enabled) {
          service.start();
        }
      }
    },
  };
  const host: SyncHost = {
    state,
    actions,
    queries: {},
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
      state.cancelConflictWorkflow();
      service.stop();
      disposeCloudflareWorkerClient();
      if (workspace.sync === host) {
        workspace.sync = null;
      }
    },
  };

  workspace.sync = host;
  disposers.push(subscribeToStorageChanges((event) => {
    if (event.origin === "remote-sync") {
      return;
    }

    if (event.assetType === "world-document") {
      const currentDocument = workspace.editor?.document.getSnapshot();
      if (currentDocument?.documentKey === event.assetId) {
        const nextEditorDocumentHash = createStableJsonHash(
          createWorldDocumentRemoteValue(currentDocument),
        );
        if (!recordWorldDocumentProjectionHashChange(
          lastEditorDocumentHashByBaseId,
          currentDocument.baseId,
          nextEditorDocumentHash,
        )) {
          return;
        }
        notifyLocalChange({
          adapterId: "world-documents",
          assetId: currentDocument.baseId,
        });
        return;
      }
      notifyLocalChange({
        adapterId: "world-documents",
      });
    } else if (event.assetType === "production-planning") {
      notifyLocalChange({ adapterId: "production-planning" });
    } else if (event.assetType === "blueprint") {
      notifyLocalChange({
        adapterId: "blueprints",
        assetId: event.assetId,
      });
    } else if (event.assetType === "blueprint-folder") {
      notifyLocalChange({
        adapterId: "blueprint-folders",
        assetId: event.assetId,
      });
    }
  }));
  for (const source of externalSources) {
    disposers.push(source.subscribe(() => {
      notifyLocalChange({ adapterId: source.id });
    }));
  }
  const editorDocument = workspace.editor?.document;
  if (editorDocument !== undefined) {
    let editorDocumentHydrated = false;
    disposers.push(createSnapshotSelector(editorDocument, selectDocumentContent, sameDocumentRemoteContent).subscribe((
      documentSnapshot,
      changeContext?: SnapshotChangeContext,
    ) => {
      const nextEditorDocumentHash = createStableJsonHash(
        createWorldDocumentRemoteValue(documentSnapshot),
      );
      if (!editorDocumentHydrated) {
        editorDocumentHydrated = true;
        recordWorldDocumentProjectionHashChange(
          lastEditorDocumentHashByBaseId,
          documentSnapshot.baseId,
          nextEditorDocumentHash,
        );
        syncStarted = true;
        if (currentSettings.enabled) {
          service.start();
        }
        return;
      }

      // 已存在且内容未变的基地切换只更新当前指针；新基地与真实内容变化仍会入队。
      if (!recordWorldDocumentProjectionHashChange(
        lastEditorDocumentHashByBaseId,
        documentSnapshot.baseId,
        nextEditorDocumentHash,
      )) {
        return;
      }
      if (changeContext?.origin === "remote-sync") {
        return;
      }
      notifyLocalChange({
        adapterId: "world-documents",
        assetId: documentSnapshot.baseId,
      });
    }));
  } else {
    syncStarted = true;
    if (currentSettings.enabled) {
      service.start();
    }
  }
  disposers.push(subscribeToSyncConnectionSettingsChanges((settings) => {
    currentSettings = settings;
    const wasEnabled = state.settings.enabled;
    state.setSettings(settings);
    if (!settings.enabled && state.pendingConflict !== null) {
      state.cancelConflictWorkflow();
    }
    if (!settings.enabled) {
      service.stop();
      disposeCloudflareWorkerClient();
    }
    if (!settings.enabled && !syncStarted) {
      state.setStatus({
        ...state.status,
        phase: "idle",
        initialSyncStage: "ready",
      });
    }
    if (!settings.enabled) {
      void service.syncNow("settings-change");
      return;
    }
    if (syncStarted) {
      if (!wasEnabled) {
        service.start();
      } else {
        void service.syncNow("settings-change");
      }
    }
  }));
  let derivedSettingsRefresh = Promise.resolve();
  const refreshDerivedEnabled = (): Promise<void> => {
    const refresh = async (): Promise<void> => {
      const enabled = deriveEnabled(
        currentSettings,
        resolveCloudflareTargetKey(),
      );
      if (enabled === currentSettings.enabled) {
        return;
      }
      currentSettings = await writeSyncConnectionSettings({
        ...currentSettings,
        enabled,
      });
    };
    derivedSettingsRefresh = derivedSettingsRefresh.then(refresh, refresh);
    return derivedSettingsRefresh;
  };
  let yituliuSessionId = readYituliuSession()?.id;
  disposers.push(subscribeToYituliuSession(() => {
    const nextId = readYituliuSession()?.id;
    if (nextId === yituliuSessionId) return;
    yituliuSessionId = nextId;
    if (readActiveSyncProvider() !== "yituliu") return;
    service.stop();
    void refreshDerivedEnabled().then(() => {
      if (syncStarted && currentSettings.enabled) service.start();
    }).catch(() => { /* 持久化失败时保持停止，等待用户重试。 */ });
  }));
  disposers.push(subscribeToSyncProviderActivationChanges(() => {
    service.stop();
    disposeCloudflareWorkerClient();
    void refreshDerivedEnabled()
      .then(() => {
        if (syncStarted && currentSettings.enabled) {
          service.start();
        }
      })
      .catch(() => {
        // 激活状态已安全落盘；enabled 持久化失败时保持当前运行态停止，等待下次设置刷新。
      });
  }));
  disposers.push(subscribeToCloudflareSyncSettingsChanges((settings) => {
    currentCloudflareSettings = settings;
    if (!suppressCloudflareSettingsSync) {
      void refreshDerivedEnabled().catch(() => {
        // 配置写入成功但 enabled 刷新失败时不主动启动同步。
      });
    }
  }));
  disposers.push(subscribeToCloudflareOAuthSessionChanges((session) => {
    const unchanged = session?.accessToken === currentCloudflareSession?.accessToken
      && session?.spaceId === currentCloudflareSession?.spaceId;
    if (unchanged) {
      return;
    }
    currentCloudflareSession = session;
    service.stop();
    disposeCloudflareWorkerClient();
    void refreshDerivedEnabled()
      .then(() => {
        if (syncStarted && currentSettings.enabled) {
          service.start();
        }
      })
      .catch(() => {
        // session 变化后默认保持停止；后续显式配置或 focus 会再次刷新。
      });
  }));
  if (typeof document !== "undefined") {
    const handleVisibilityChange = () => {
      if (!syncStarted || !currentSettings.enabled) {
        return;
      }
      if (document.visibilityState === "visible") {
        void service.syncNow("foreground");
        return;
      }
      if (document.visibilityState === "hidden") {
        // 切后台时若本地变更仍处于 5s 空闲去抖期，立即启动后台上传，
        // 避免主线程定时器被后台节流推迟。
        service.flushPendingChanges();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    disposers.push(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  }

  return host;
}

function isAdapterReadyForLocalChanges(
  initialSyncStage: SyncInitialSyncStage,
  adapterId: string,
  externalSources: readonly SyncAssetSource[],
): boolean {
  if (initialSyncStage === "ready") {
    return true;
  }
  if (adapterId === "world-documents") {
    return initialSyncStage !== "canvas";
  }
  if (adapterId === "blueprints" || adapterId === "blueprint-folders") {
    return initialSyncStage === "modules" || initialSyncStage === "toolbox";
  }
  if (externalSources.some((source) => source.id === adapterId)) {
    return initialSyncStage === "toolbox";
  }

  return false;
}

function createMaintenanceTasks(options: {
  readonly collections: readonly SyncAdapter["collection"][];
  readonly getDirectoryTreeReadyKey: () => string | null;
  readonly setDirectoryTreeReadyKey: (key: string) => void;
}): readonly SyncMaintenanceTask[] {
  return [
    {
      kind: "directory-maintenance",
      run: async (client, settings) => {
        const directoryTreeKey = `${settings.url.trim()}\u0000${settings.username}`;
        if (options.getDirectoryTreeReadyKey() === directoryTreeKey) {
          return;
        }

        await client.prepareCollections?.(options.collections);
        options.setDirectoryTreeReadyKey(directoryTreeKey);
      },
    },
  ];
}

function resolveAdapterTaskKind(
  adapterId: string,
  externalSources: readonly SyncAssetSource[],
): SyncTaskKind {
  if (adapterId === "blueprints" || adapterId === "blueprint-folders") {
    return "blueprints";
  }
  if (adapterId === "production-planning") {
    return "toolbox";
  }
  if (externalSources.some((source) => source.id === adapterId)) {
    return "modules";
  }

  return "canvas";
}

function createInitialSyncPlan(
  workspace: WorkspaceContract,
  externalSources: readonly SyncAssetSource[],
): SyncInitialPlan {
  const currentBaseId = workspace.editor?.document.getSnapshot().baseId;
  const currentDocumentRequest = currentBaseId === undefined
    ? []
    : [{
      adapterId: "world-documents",
      scope: { includeAssetIds: [currentBaseId] },
    }];

  return {
    batches: [
      {
        stage: "canvas",
        requests: currentDocumentRequest,
      },
      {
        stage: "blueprints",
        requests: [
          { adapterId: "blueprints" },
          { adapterId: "blueprint-folders" },
        ],
      },
      {
        stage: "modules",
        requests: externalSources.map((source) => ({
          adapterId: source.id,
        })),
      },
      {
        stage: "toolbox",
        requests: [{ adapterId: "production-planning" }],
      },
    ],
    backgroundRequests: [{
      adapterId: "world-documents",
      scope: currentBaseId === undefined
        ? undefined
        : { excludeAssetIds: [currentBaseId] },
    }],
  };
}

function createAdapterFromSource(
  source: SyncAssetSource,
  resolveConflict: ResolveInteractiveConflict,
): SyncAdapter {
  const sharedOptions = {
    id: source.id,
    indexPath: source.indexPath,
    listLocal: source.listLocal,
    writeLocal: async (entry: SyncAssetEntry) => {
      await source.writeLocal(entry);
    },
    isRemoteVersionUnsupported: source.isRemoteVersionUnsupported,
    normalizeRemote: source.normalizeRemote,
    resolveConflict,
  };

  if (source.mode === "patch-with-revision") {
    return createPatchCollectionWithRevisionAdapter({
      ...sharedOptions,
      directoryPath: source.remotePath,
    });
  }

  return createFullWithRevisionAdapter({
    ...sharedOptions,
    entryPath: source.remotePath,
  });
}

function createWorldDocumentAdapter(
  workspace: WorkspaceContract,
  resolveConflict: ResolveInteractiveConflict,
  onSynchronizedDocumentChange: (
    baseId: string,
    document: WorldDocument | null,
  ) => void,
): SyncAdapter {
  return createPatchCollectionWithRevisionAdapter<WorldDocument>({
    id: "world-documents",
    recoverUnavailableRemote: true,
    isRemoteVersionUnsupported: isUnsupportedDocumentSchema,
    indexPath: "documents/by-base/index.json",
    directoryPath: (baseId) => `documents/by-base/${encodeURIComponent(baseId)}`,
    deleteRemoteOnlyOnUseLocal: (baseId) => !workspace.registry.baseDefinitions.some(
      (definition) => definition.id === baseId,
    ),
    listLocal: async (scope) => {
      const editor = workspace.editor;
      const documentsByBase = new Map<string, WorldDocument>();
      if (editor === null) {
        for (const [baseId, document] of await listLatestWorldDocumentsByBase({})) documentsByBase.set(baseId, document);
      } else {
        const summaries = await editor.queries.listBaseDocumentSummaries();
        const baseIds = summaries.filter((summary) => summary.documentKey !== null
          && (scope?.includeAssetIds === undefined || scope.includeAssetIds.includes(summary.baseId)))
          .map((summary) => summary.baseId);
        for (const document of await editor.queries.readLatestBaseDocuments(baseIds)) documentsByBase.set(document.baseId, document);
      }

      return Array.from(documentsByBase.values()).flatMap((document) =>
        scope?.includeAssetIds !== undefined
        && !scope.includeAssetIds.includes(document.baseId)
          ? []
          : [{
            id: document.baseId,
            value: createWorldDocumentRemoteValue(document),
            deletedAt: null,
          }]
      );
    },
    writeLocal: async (entry) => {
      const editor = workspace.editor;
      // 删除该基地（entry.id 为远端资产 baseId）在本机的全部文档副本。
      // 触发场景：远端墓碑下载、以及冲突弹框中上传条目被决议为“用远端”（放弃本地新增）。
      // 原实现忽略 deletedAt，墓碑落地只推进 touch 不删本地，导致“已同步但本地仍在”的假象。
      if (entry.deletedAt !== null) {
        if (editor !== null) {
          await editor.actions.removeSynchronizedBaseDocument(entry.id);
        } else {
          const documents = await listWorldDocuments();
          for (const document of documents) {
            if (document.baseId === entry.id) {
              await deleteWorldDocument(document.documentKey);
            }
          }
        }
        onSynchronizedDocumentChange(entry.id, null);
        return;
      }

      const existingDocument = editor !== null
        ? (await editor.queries.readLatestBaseDocuments([entry.id]))[0] ?? null
        : (await listLatestWorldDocumentsByBase({})).get(entry.id) ?? await readWorldDocument(entry.id);
      const localValue = preserveLocalWorldDocumentIdentity(
        {
          ...entry.value,
          baseId: entry.id,
          documentKey: entry.id,
        },
        existingDocument,
      );
      if (editor !== null) await editor.actions.applySynchronizedDocument(localValue);
      else await writeWorldDocument(localValue);
      onSynchronizedDocumentChange(entry.id, localValue);
    },
    normalizeRemote: (value) => {
      const document = normalizeWorldDocument(value);

      return document === null
        ? null
        : createWorldDocumentRemoteValue(document);
    },
    resolveConflict,
  });
}

export function createWorldDocumentRemoteValue(
  document: WorldDocument,
): WorldDocument {
  return {
    ...document,
    documentKey: document.baseId,
    documentSettings: {
      ...document.documentSettings,
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
        displayRotation: 0,
      },
    },
  };
}

/**
 * 记录基地文档的同步投影并返回内容是否相对该基地上次记录发生变化。
 * 不同基地互不比较，因此纯导航不会制造本地上传意图。
 */
export function recordWorldDocumentProjectionChange(
  hashesByBaseId: Map<string, string>,
  document: WorldDocument,
): boolean {
  return recordWorldDocumentProjectionHashChange(
    hashesByBaseId,
    document.baseId,
    createStableJsonHash(createWorldDocumentRemoteValue(document)),
  );
}

function recordWorldDocumentProjectionHashChange(
  hashesByBaseId: Map<string, string>,
  baseId: string,
  nextHash: string,
): boolean {
  const changed = hashesByBaseId.get(baseId) !== nextHash;
  hashesByBaseId.set(baseId, nextHash);
  return changed;
}

export function preserveLocalWorldDocumentIdentity(
  remoteDocument: WorldDocument,
  localDocument: WorldDocument | null | undefined,
): WorldDocument {
  return {
    ...remoteDocument,
    documentKey: localDocument?.documentKey ?? createUuid(),
    // 远端视口只是占位值（视口属于本机浏览状态）；本机没有保存过视口时不采用它，首次打开对准基地中心。
    documentSettings: {
      ...remoteDocument.documentSettings,
      viewport: localDocument?.documentSettings.viewport,
    },
  };
}



function isUnsupportedDocumentSchema(value: unknown): boolean {
  return typeof value === "object" && value !== null && "schemaVersion" in value
    && typeof value.schemaVersion === "number" && value.schemaVersion > BLUEPRINT_SCHEMA_VERSION;
}
