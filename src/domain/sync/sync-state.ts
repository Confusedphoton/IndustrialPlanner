import type {
  SyncPendingConflict,
  SyncSettings,
  SyncStatus,
} from "./types/sync-types";

export interface SyncState {
  readonly settings: SyncSettings;
  readonly status: SyncStatus;
  readonly pendingConflict: SyncPendingConflict | null;
}
