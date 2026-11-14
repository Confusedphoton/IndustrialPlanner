import type {
  SyncConflictDecision,
  SyncSettings,
} from "./types/sync-types";

export interface SyncAction {
  updateSettings(patch: Partial<SyncSettings>): void;
  syncNow(): Promise<void>;
  resolveConflicts(decisions: readonly SyncConflictDecision[]): void;
  deleteRemoteData(): Promise<void>;
  abortCurrentTransaction(): Promise<void>;
}
