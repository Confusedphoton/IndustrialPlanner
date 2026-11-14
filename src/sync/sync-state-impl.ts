import { makeAutoObservable } from "mobx";

import type {
  SyncConflictDecision,
  SyncPendingConflict,
  SyncSettings,
  SyncState,
  SyncStatus,
} from "@/domain/sync";
import type {
  SyncAdapterConflict,
} from "./engine/sync-adapters";
import type { SyncServiceStatus } from "./engine/sync-service";

const EMPTY_SETTINGS: SyncSettings = {
  enabled: false,
  url: "",
  username: "",
  password: "",
  maxConcurrentRequests: 4,
};

export class SyncStateImpl implements SyncState {
  public settings: SyncSettings = EMPTY_SETTINGS;
  public status: SyncServiceStatus & Pick<SyncStatus, "currentLocalRevision"> = {
    phase: "idle",
    saveState: "idle",
    currentLocalRevision: null,
    initialSyncStage: "ready",
    hasCompletedInitialFeatureSync: false,
    currentRunReason: null,
    activeRequestCount: 0,
    queuedRequestCount: 0,
    tasks: [],
    pendingLocalChangeCount: 0,
    saveError: null,
    lastUploadAt: null,
    lastDownloadAt: null,
    lastError: null,
    lastUpdateCheckAt: null,
    canvasLocked: false,
    lastResults: [],
  };

  public pendingConflict: SyncPendingConflict | null = null;

  private conflictResolver: ((
    decisions: readonly SyncConflictDecision[],
  ) => void) | null = null;

  public constructor() {
    makeAutoObservable<SyncStateImpl, "conflictResolver">(this, {
      conflictResolver: false,
    }, { autoBind: true });
  }

  public setStatus(status: SyncServiceStatus): void {
    this.status = {
      ...status,
      currentLocalRevision: this.status.currentLocalRevision,
    };
  }

  public setCurrentLocalRevision(revision: string | null): void {
    this.status = {
      ...this.status,
      currentLocalRevision: revision,
    };
  }

  public setSettings(settings: SyncSettings): void {
    this.settings = settings;
  }


  public beginConflictDiscovery(): void {
    this.pendingConflict = {
      phase: "discovering",
      items: this.pendingConflict?.items ?? [],
    };
  }

  public requestConflictResolutions(
    conflicts: readonly SyncAdapterConflict<unknown>[],
  ): Promise<readonly SyncConflictDecision[]> {
    if (!this.settings.enabled) {
      return Promise.resolve(conflicts.map((conflict) => ({
        adapterId: conflict.adapterId,
        assetId: conflict.assetId,
        resolution: "pause",
      })));
    }

    this.pendingConflict = {
      phase: "awaiting-resolution",
      items: conflicts.map((conflict) => ({
        adapterId: conflict.adapterId,
        assetId: conflict.assetId,
        kind: conflict.kind ?? "conflict",
        remoteUpdatedAt: conflict.remoteUpdatedAt,
        remoteUnavailableReason: conflict.remoteUnavailableReason,
      })),
    };

    return new Promise((resolve) => {
      this.conflictResolver = resolve;
    });
  }

  public resolveConflicts(
    decisions: readonly SyncConflictDecision[],
  ): void {
    if (
      this.pendingConflict === null
      || this.pendingConflict.phase !== "awaiting-resolution"
    ) {
      return;
    }

    if (decisions.some(decision => decision.resolution === "use-remote"
      && this.pendingConflict?.items.some(item => item.adapterId === decision.adapterId
        && item.assetId === decision.assetId && item.remoteUnavailableReason !== undefined))) return;

    this.pendingConflict = {
      ...this.pendingConflict,
      phase: "applying",
    };
    this.conflictResolver?.(decisions);
    this.conflictResolver = null;
  }

  public finishConflictWorkflow(): void {
    this.pendingConflict = null;
    this.conflictResolver = null;
  }

  public cancelConflictWorkflow(): void {
    if (
      this.pendingConflict !== null
      && this.pendingConflict.phase === "awaiting-resolution"
    ) {
      this.resolveConflicts(this.pendingConflict.items.map((item) => ({
        adapterId: item.adapterId,
        assetId: item.assetId,
        resolution: "pause",
      })));
    }
    this.finishConflictWorkflow();
  }
}
