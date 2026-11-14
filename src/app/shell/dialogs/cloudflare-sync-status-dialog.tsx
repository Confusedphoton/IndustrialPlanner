import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type {
  SyncInitialSyncStage,
  SyncPhase,
  SyncRunReason,
  SyncState,
  SyncTaskDirection,
  SyncTaskKind,
  SyncTaskPhase,
} from "@/domain/sync";
import type { UiKey } from "@/shared/i18n";
import {
  MAX_CLOUDFLARE_SPACE_NAME_LENGTH,
  readCloudflareSyncSettings,
  writeCloudflareSyncSettings,
  type CloudflareRemoteMode,
} from "@/shared/storage/cloudflare-sync-settings";
import {
  clearCloudflareOAuthSession,
  readCloudflareOAuthSession,
  subscribeToCloudflareOAuthSessionChanges,
  type CloudflareOAuthSession,
} from "@/shared/storage/cloudflare-oauth-session";
import {
  CloudflareOAuthLoginError,
  startCloudflareOAuthLogin,
} from "@/shared/storage/cloudflare-oauth-browser-flow";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";
import {
  activateSyncProvider,
  createCloudflareAccountSyncTargetKey,
  createCloudflareAnonymousSyncTargetKey,
  requestSyncProvider,
} from "@/shared/storage/sync-provider-activation";

import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "./settings-dialog.module.scss";

// CloudflareSyncStatusDialog — Cloudflare 同步专属状态弹窗。
//
// 与 WebDavSyncStatusDialog 的关键差异：
// - 无配置表单（URL 等复用 debug-backend-api-address-override）
// - 无并发数显示
// - 过滤掉 directory-maintenance 任务（Cloudflare 无目录概念）
// - 服务器端错误置顶醒目展示（role="alert"）
// - 显示小检查倒计时
// - 显示 interval-check 任务卡片
// 输入先保留为本地草稿，只有按下保存按钮后才写入设置并切换同步空间。

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 60_000;

const CLOUDFLARE_EXCLUDED_TASK_KINDS: ReadonlySet<SyncTaskKind> = new Set([
  "directory-maintenance",
]);

// 小检查任务放在任务列表的最前面
const TASK_ORDER: Record<SyncTaskKind, number> = {
  "update-check": 0,
  "canvas": 1,
  "blueprints": 2,
  "modules": 3,
  "toolbox": 4,
  "background-documents": 5,
  "directory-maintenance": 99,
};

function sortTasks<TTask extends { readonly kind: SyncTaskKind }>(tasks: readonly TTask[]): TTask[] {
  return [...tasks].sort((a, b) => (TASK_ORDER[a.kind] ?? 50) - (TASK_ORDER[b.kind] ?? 50));
}

export const CloudflareSyncStatusDialog = observer(function CloudflareSyncStatusDialog({
  aborting,
  compactMobileLayout,
  deleting,
  dialogState,
  onAbortCurrentTransaction,
  onClose,
  onDeleteAllData,
  onOffsetChange,
  onResize,
  onToggleMaximized,
  state,
  t,
}: {
  aborting: boolean;
  compactMobileLayout: boolean;
  deleting: boolean;
  dialogState: DialogStateReadWrite;
  onAbortCurrentTransaction: () => void;
  onClose: () => void;
  onDeleteAllData: () => void;
  onOffsetChange: (offsetX: number, offsetY: number) => void;
  onResize: (width: number, height: number) => void;
  onToggleMaximized: () => void;
  state: SyncState;
  t: AppHost["actions"]["translate"];
}) {
  const status = state.status;
  const [savedSpaceName, setSavedSpaceName] = useState("");
  const [savedRemoteMode, setSavedRemoteMode] = useState<CloudflareRemoteMode>(
    "anonymous",
  );
  const [draftSpaceName, setDraftSpaceName] = useState("");
  const [loadingSpaceName, setLoadingSpaceName] = useState(true);
  const [savingSpaceName, setSavingSpaceName] = useState(false);
  const [spaceNameSaveFailed, setSpaceNameSaveFailed] = useState(false);
  const [oauthSession, setOAuthSession] = useState<CloudflareOAuthSession | null>(
    () => readCloudflareOAuthSession(),
  );
  const [oauthPopupBlocked, setOAuthPopupBlocked] = useState(false);
  const [oauthLoginInProgress, setOAuthLoginInProgress] = useState(false);
  const [oauthLoginFailed, setOAuthLoginFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const applySession = (session: CloudflareOAuthSession | null) => {
      if (!active) {
        return;
      }
      setOAuthSession(session);
    };
    void readCloudflareSyncSettings().then((settings) => {
      if (!active) {
        return;
      }
      setSavedSpaceName(settings.spaceName);
      setSavedRemoteMode(settings.remoteMode);
      setDraftSpaceName(settings.spaceName);
      setLoadingSpaceName(false);
      applySession(readCloudflareOAuthSession());
    });
    const unsubscribe = subscribeToCloudflareOAuthSessionChanges(applySession);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const normalizedDraftSpaceName = draftSpaceName.trim();
  const spaceNameIsDirty = normalizedDraftSpaceName !== savedSpaceName;
  const anonymousTargetIsActive = state.settings.enabled
    && savedRemoteMode === "anonymous"
    && !spaceNameIsDirty;
  const canSaveSpaceName = !loadingSpaceName
    && !savingSpaceName
    && !oauthLoginInProgress
    && normalizedDraftSpaceName !== ""
    && !anonymousTargetIsActive;
  const handleSaveSpaceName = async () => {
    if (!canSaveSpaceName) {
      return;
    }

    setSavingSpaceName(true);
    setSpaceNameSaveFailed(false);
    try {
      if (!requestSyncProvider("cloudflare")) {
        throw new Error("Failed to enter Cloudflare setup mode.");
      }
      const settings = await writeCloudflareSyncSettings({
        spaceName: normalizedDraftSpaceName,
        remoteMode: "anonymous",
      });
      if (!activateSyncProvider(
        "cloudflare",
        createCloudflareAnonymousSyncTargetKey({
          apiBaseUrl: resolveBackendApiBaseUrl(),
          spaceId: settings.spaceName,
        }),
      )) {
        throw new Error("Failed to activate Cloudflare anonymous sync.");
      }
      setSavedSpaceName(settings.spaceName);
      setSavedRemoteMode(settings.remoteMode);
      setDraftSpaceName(settings.spaceName);
    } catch {
      setSpaceNameSaveFailed(true);
    } finally {
      setSavingSpaceName(false);
    }
  };
  const handleActivateAccountSession = async (
    session: CloudflareOAuthSession,
  ): Promise<void> => {
    if (!requestSyncProvider("cloudflare")) {
      throw new Error("Failed to enter Cloudflare setup mode.");
    }
    const settings = await readCloudflareSyncSettings();
    const accountSettings = await writeCloudflareSyncSettings({
      ...settings,
      remoteMode: "account",
    });
    if (!activateSyncProvider(
      "cloudflare",
      createCloudflareAccountSyncTargetKey({
        apiBaseUrl: session.apiBaseUrl,
        accountId: session.account.accountId,
        spaceId: session.spaceId,
      }),
    )) {
      throw new Error("Failed to activate Cloudflare account sync.");
    }
    setSavedRemoteMode(accountSettings.remoteMode);
  };
  const handleOpenOAuth = () => {
    if (oauthLoginInProgress) {
      return;
    }
    setOAuthPopupBlocked(false);
    setOAuthLoginFailed(false);
    setOAuthLoginInProgress(true);
    if (!requestSyncProvider("cloudflare")) {
      setOAuthLoginFailed(true);
      setOAuthLoginInProgress(false);
      return;
    }
    void startCloudflareOAuthLogin()
      .then(handleActivateAccountSession)
      .catch((error: unknown) => {
        if (
          error instanceof CloudflareOAuthLoginError
          && error.code === "popup_blocked"
        ) {
          setOAuthPopupBlocked(true);
          return;
        }
        setOAuthLoginFailed(true);
      })
      .finally(() => setOAuthLoginInProgress(false));
  };

  const filteredTasks = useMemo(
    () => sortTasks(status.tasks.filter((task) => !CLOUDFLARE_EXCLUDED_TASK_KINDS.has(task.kind))),
    [status.tasks],
  );

  // 倒计时 — 每秒更新
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const updateCheckCountdown = useMemo(() => {
    if (status.lastUpdateCheckAt === null) return null;
    const last = new Date(status.lastUpdateCheckAt).getTime();
    const next = last + DEFAULT_UPDATE_CHECK_INTERVAL_MS;
    const remaining = Math.max(0, next - now);
    if (remaining <= 0) return "...";
    return formatDuration(remaining);
  }, [status.lastUpdateCheckAt, now]);

  return (
    <DialogShell
      bodyClassName={cm(styles, "sync-status-dialog-body")}
      className="cloudflare-sync-status-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={compactMobileLayout}
      dialogKey="cloudflare-sync-status"
      dialogState={dialogState}
      maximizeTitle={t("dialog.maximize")}
      onClose={onClose}
      onOffsetChange={onOffsetChange}
      onResize={onResize}
      onToggleMaximized={onToggleMaximized}
      restoreTitle={t("dialog.restore")}
      title={t("cloudflareStatus.title")}
      titleId="cloudflare-sync-status-dialog-title"
    >
      <div
        aria-live="polite"
        className={cm(styles, "sync-status-content")}
        data-cloudflare-sync-status-dialog
      >
        {state.settings.enabled ? null : (
          <section
            className={cm(styles, "sync-status-section", "cloudflare-server-error")}
            data-sync-setup-required
            role="status"
          >
            <strong>{t("syncActivation.setupRequired")}</strong>
            <span>{t("syncActivation.cloudflareSetupRequiredDescription")}</span>
          </section>
        )}
        <section
          className={cm(styles, "sync-status-section", "sync-config-section")}
        >
          <h3>{t("cloudflareStatus.accountSettings")}</h3>
          <div className={cm(styles, "cloudflare-account-card")}>
            {oauthSession === null ? (
              <>
                <p data-cloudflare-oauth-description>
                  {t(savedRemoteMode === "account"
                    ? "cloudflareStatus.loginRequiredDescription"
                    : "cloudflareStatus.loginDescription")}
                </p>
                <button
                  className={cm(styles, "cloudflare-account-primary-btn")}
                  data-cloudflare-oauth-login
                  disabled={savingSpaceName || oauthLoginInProgress}
                  onClick={handleOpenOAuth}
                  type="button"
                >
                  {t(oauthLoginInProgress
                    ? "cloudflareStatus.loginInProgress"
                    : savedRemoteMode === "account"
                      ? "cloudflareStatus.relogin"
                      : "cloudflareStatus.login")}
                </button>
                {oauthPopupBlocked ? (
                  <span
                    className={cm(styles, "sync-config-test-result", "is-failed")}
                    role="alert"
                  >
                    {t("cloudflareStatus.popupBlocked")}
                  </span>
                ) : null}
                {oauthLoginFailed ? (
                  <span
                    className={cm(styles, "sync-config-test-result", "is-failed")}
                    role="alert"
                  >
                    {t("cloudflareStatus.loginFailed")}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <div className={cm(styles, "cloudflare-account-identity")}>
                  <span>{t("cloudflareStatus.loggedInAs")}</span>
                  <strong data-cloudflare-oauth-username>
                    {oauthSession.account.username}
                  </strong>
                </div>
                <button
                  className={cm(styles, "cloudflare-account-secondary-btn")}
                  data-cloudflare-oauth-logout
                  onClick={clearCloudflareOAuthSession}
                  type="button"
                >
                  {t("cloudflareStatus.logout")}
                </button>
                <button
                  className={cm(styles, "cloudflare-account-primary-btn")}
                  data-cloudflare-account-activate
                  disabled={savingSpaceName || oauthLoginInProgress || (state.settings.enabled && savedRemoteMode === "account")}
                  onClick={() => {
                    setOAuthLoginFailed(false);
                    setOAuthLoginInProgress(true);
                    void handleActivateAccountSession(oauthSession)
                      .catch(() => {
                        setOAuthLoginFailed(true);
                      })
                      .finally(() => setOAuthLoginInProgress(false));
                  }}
                  type="button"
                >
                  {t(oauthLoginInProgress
                    ? "syncActivation.activating"
                    : state.settings.enabled && savedRemoteMode === "account"
                      ? "syncActivation.enabled"
                      : "cloudflareStatus.useAccountAndEnable")}
                </button>
                {oauthLoginFailed ? (
                  <span
                    className={cm(styles, "sync-config-test-result", "is-failed")}
                    role="alert"
                  >
                    {t("syncActivation.activateFailed")}
                  </span>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section
          className={cm(styles, "sync-status-section", "sync-config-section")}
        >
          <h3>{t("cloudflareStatus.spaceSettings")}</h3>
          <div className={cm(styles, "sync-config-form")}>
            <label className={cm(styles, "sync-config-field")}>
              <span>{t("cloudflareStatus.spaceName")}</span>
              <input
                data-cloudflare-space-name-input
                disabled={loadingSpaceName || savingSpaceName || oauthLoginInProgress}
                maxLength={MAX_CLOUDFLARE_SPACE_NAME_LENGTH}
                onChange={(event) => {
                  setDraftSpaceName(event.target.value);
                  setSpaceNameSaveFailed(false);
                }}
                type="text"
                value={draftSpaceName}
              />
              <small>{t("cloudflareStatus.spaceNameDescription")}</small>
            </label>
          </div>
          <div className={cm(styles, "sync-config-actions")}>
            {spaceNameSaveFailed ? (
              <span
                className={cm(styles, "sync-config-test-result", "is-failed")}
                role="alert"
              >
                {t("cloudflareStatus.spaceNameSaveFailed")}
              </span>
            ) : null}
            <div className={cm(styles, "sync-config-buttons")}>
              <button
                className={cm(
                  styles,
                  "sync-apply-settings-btn",
                  spaceNameIsDirty ? "is-dirty" : "is-clean",
                )}
                data-cloudflare-space-name-save
                disabled={!canSaveSpaceName}
                onClick={() => void handleSaveSpaceName()}
                type="button"
              >
                {t(savingSpaceName
                  ? "cloudflareStatus.savingSpaceName"
                  : anonymousTargetIsActive
                    ? "syncActivation.enabled"
                    : "cloudflareStatus.useSpaceAndEnable")}
              </button>
            </div>
          </div>
        </section>

        {/* 服务器端错误 — 置顶醒目展示 */}
        {status.lastError === null ? null : (
          <section
            className={cm(styles, "sync-status-section", "cloudflare-server-error")}
            role="alert"
          >
            <h3>{t("syncStatus.lastError")}</h3>
            <div className={cm(styles, "sync-status-error")}>
              <span>{status.lastError}</span>
            </div>
          </section>
        )}

        {/* 概览 — 使用 Cloudflare 专用 label */}
        <section className={cm(styles, "sync-status-section")}>
          <h3>{t("syncStatus.overview")}</h3>
          <dl className={cm(styles, "sync-status-summary-grid")}>
            <StatusValue
              label={t("cloudflareStatus.syncEnabled")}
              value={t(state.settings.enabled
                ? "syncStatus.enabled"
                : "syncStatus.disabled")}
            />
            <StatusValue
              label={t("cloudflareStatus.currentVersion")}
              value={state.status.currentLocalRevision
                ?? t("settingsOption.none")}
            />
            <StatusValue
              label={t("cloudflareStatus.phase")}
              value={t(resolvePhaseKey(status.phase))}
            />
            <StatusValue
              label={t("syncStatus.currentRunReason")}
              value={status.currentRunReason === null
                ? t("settingsOption.none")
                : t(resolveRunReasonKey(status.currentRunReason))}
            />
            <StatusValue
              label={t("syncStatus.initialStage")}
              value={t(resolveStageKey(status.initialSyncStage))}
            />
            <StatusValue
              label={t("syncStatus.pendingLocalChanges")}
              value={String(status.pendingLocalChangeCount)}
            />
            <StatusValue
              label={t("syncStatus.lastUpload")}
              value={formatNullableTime(
                status.lastUploadAt,
                t("settingsOption.none"),
              )}
            />
            <StatusValue
              label={t("syncStatus.lastDownload")}
              value={formatNullableTime(
                status.lastDownloadAt,
                t("settingsOption.none"),
              )}
            />
            {/* 小检查倒计时 */}
            {updateCheckCountdown === null ? null : (
              <StatusValue
                label={t("cloudflareStatus.updateCheckCountdown")}
                value={updateCheckCountdown}
              />
            )}
          </dl>
        </section>

        {/* 网络 — 不含并发数 */}
        <section className={cm(styles, "sync-status-section")}>
          <h3>{t("syncStatus.network")}</h3>
          <dl className={cm(styles, "sync-status-network-grid")}>
            <StatusValue
              label={t("syncStatus.activeRequests")}
              value={String(status.activeRequestCount)}
            />
            <StatusValue
              label={t("syncStatus.queuedRequests")}
              value={String(status.queuedRequestCount)}
            />
          </dl>
        </section>

        {/* 任务 — 含 interval-check，按顺序排列 */}
        <section className={cm(styles, "sync-status-section")}>
          <h3>{t("syncStatus.tasks")}</h3>
          <div className={cm(styles, "sync-task-list")}>
            {filteredTasks.map((task) => (
              <article
                className={cm(
                  styles,
                  `sync-task-card is-${task.phase}`,
                )}
                data-sync-task-direction={task.direction ?? "none"}
                data-sync-task-kind={task.kind}
                data-sync-task-phase={task.phase}
                key={task.kind}
              >
                <header>
                  <strong>{t(resolveTaskKindKey(task.kind))}</strong>
                  <span>
                    {task.direction === null
                      ? t(resolveTaskPhaseKey(task.phase))
                      : `${t(resolveTaskPhaseKey(task.phase))} (${t(resolveTaskDirectionKey(task.direction))})`}
                  </span>
                </header>
                <div className={cm(styles, "sync-task-metadata")}>
                  <span>
                    {t("syncStatus.taskProgress")
                      .replace("{completed}", String(task.completedUnitCount))
                      .replace("{total}", String(task.totalUnitCount))}
                  </span>
                  <span>
                    {t("syncStatus.taskLastStarted").replace(
                      "{time}",
                      formatNullableTime(
                        task.lastStartedAt,
                        t("settingsOption.none"),
                      ),
                    )}
                  </span>
                  <span>
                    {t("syncStatus.taskLastFinished").replace(
                      "{time}",
                      formatNullableTime(
                        task.lastFinishedAt,
                        t("settingsOption.none"),
                      ),
                    )}
                  </span>
                  {task.lastError === null ? null : (
                    <span className={cm(styles, "sync-task-error")}>
                      {task.lastError}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 删除远端数据 */}
        <section
          className={cm(styles, "sync-status-section", "sync-delete-section")}
          hidden={!state.settings.enabled}
        >
          {deleting ? (
            <div className={cm(styles, "sync-delete-progress")}>
              {t("syncConfig.deleteAllDataDeleting")}
            </div>
          ) : (
            <button
              className={cm(styles, "sync-delete-all-btn")}
              onClick={onDeleteAllData}
              type="button"
            >
              {t("cloudflareStatus.deleteAllData")}
            </button>
          )}
        </section>

        {/* 立即结束当前事务 */}
        <section
          className={cm(styles, "sync-status-section", "sync-delete-section")}
          hidden={!state.settings.enabled}
        >
          {aborting ? (
            <div className={cm(styles, "sync-delete-progress")}>
              {t("cloudflareStatus.abortingTransaction")}
            </div>
          ) : (
            <button
              className={cm(styles, "sync-delete-all-btn")}
              onClick={onAbortCurrentTransaction}
              type="button"
            >
              {t("cloudflareStatus.abortCurrentTransaction")}
            </button>
          )}
        </section>
      </div>
    </DialogShell>
  );
});

function StatusValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function resolvePhaseKey(phase: SyncPhase): UiKey {
  if (phase === "uploading") {
    return "settingsField.experimental-sync-status-uploading";
  }
  if (phase === "downloading") {
    return "settingsField.experimental-sync-status-downloading";
  }
  if (phase === "error") {
    return "settingsField.experimental-sync-status-error";
  }

  return "settingsField.experimental-sync-status-idle";
}

function resolveRunReasonKey(reason: SyncRunReason): UiKey {
  return `syncStatus.runReason.${reason}`;
}

function resolveStageKey(stage: SyncInitialSyncStage): UiKey {
  return `syncStatus.stage.${stage}`;
}

function resolveTaskKindKey(kind: SyncTaskKind): UiKey {
  return `syncStatus.task.${kind}`;
}

function resolveTaskPhaseKey(phase: SyncTaskPhase): UiKey {
  return `syncStatus.taskPhase.${phase}`;
}

function resolveTaskDirectionKey(direction: SyncTaskDirection): UiKey {
  return direction === "upload"
    ? "settingsField.experimental-sync-status-uploading"
    : "settingsField.experimental-sync-status-downloading";
}

function formatNullableTime(value: string | null, fallback: string): string {
  return value === null ? fallback : new Date(value).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}
