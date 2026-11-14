import { YituliuSyncStatusDialog } from "./yituliu-sync-status-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { makeAutoObservable, runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type { V2MigrationController } from "@/app/migration";
import type { PwaController } from "@/app/pwa/pwa-controller";
import { PwaSettingsSection } from "@/app/pwa/pwa-settings-section";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { ActivityIconStrip } from "@/app/shell/shared/activity-icon-strip";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { MarkdownTutorialOverlay } from "@/app/shell/dialogs/markdown-tutorial-overlay";
import { KeyboardShortcutSettingsDialog } from "@/app/shell/dialogs/keyboard-shortcut-settings-dialog";
import { WebDavSyncStatusDialog } from "@/app/shell/dialogs/webdav-sync-status-dialog";
import { CloudflareSyncStatusDialog } from "@/app/shell/dialogs/cloudflare-sync-status-dialog";
import {
  type SettingsGroupId,
  type WorkbenchSettingDefinition,
  WORKBENCH_SETTINGS_GROUPS,
  WorkbenchSettingsDialogController,
} from "@/app/shell/state/settings-dialog-state";
import {
  ACTIVITY_DEFINITIONS,
  isActivityOngoing,
  normalizeSelectedActivityIds,
  resolveEffectiveActivityIds,
} from "@/shared/registry/activity-availability";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  clearAllStorageAndReload,
  estimateTotalStorageBytes,
  formatStorageBytesToMB,
} from "@/shared/storage";
import {
  activateSyncProvider,
  createWebDavSyncTargetKey,
  readSyncProviderActivation,
  requestSyncProvider,
} from "@/shared/storage/sync-provider-activation";

const SETTINGS_DIALOG_SECTION_SCROLL_OFFSET = 10;

const CONFIG_GUIDE_SETTING_DOC_FILES: ReadonlySet<string> = new Set([
  "game-use-blueprint-style-device-images.md",
  "game-show-device-names.md",
  "game-show-device-icons.md",
  "other-toolbox-show-all-activity-content.md",
  "game-use-inspector-panel.md",
  "game-arknights-selection-right-dock-sync.md",
  "game-arknights-inspector-open-on-second-click.md",
  "game-show-hotkeys.md",
  "game-always-show-grid-lines.md",
  "game-show-grass-background.md",
  "game-arknights-immediate-move.md",
  "game-arknights-copy-while-moving.md",
  "game-arknights-immediate-marquee.md",
  "game-arknights-allow-empty-logistics-endpoints.md",
  "game-arknights-auto-create-splitters-and-convergers.md",
  "other-debug-mode.md",
  "debug-show-fps.md",
  "debug-show-gesture-diagnostics-window.md",
]);

interface SettingsDialogProps {
  appHost: AppHost;
  controller: WorkbenchSettingsDialogController;
  pwaController: PwaController;
  migrationController?: V2MigrationController;
}

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const SettingsDialog = observer(function SettingsDialog({
  appHost,
  controller,
  migrationController,
  pwaController,
}: SettingsDialogProps) {
  const t = appHost.actions.translate;
  const sync = appHost.workspace.sync;
  const syncActivation = readSyncProviderActivation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<SettingsGroupId, HTMLElement>());
  const dialogState = appHost.internalState.workbench.dialogState.settings;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  const effectiveActivityIds = resolveEffectiveActivityIds({ selectedActivityIds });
  const isOpen = dialogState.visible;
  const [settingGuideSettingId, setSettingGuideSettingId] = useState<string | null>(null);
  const hideGroupSidebar = appHost.state.screenProfile.deviceClass !== "desktop";
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isNonDesktop = appHost.state.screenProfile.deviceClass !== "desktop";
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const experimentalEnabled = controller.getValue("other-experimental-features") === true;

  const visibleGroups = useMemo(() => {
    return WORKBENCH_SETTINGS_GROUPS.filter((group) => {
      if (isNonDesktop && group.mobileHidden) return false;
      if (group.id === "experimental" && !experimentalEnabled) return false;

      return true;
    });
  }, [isNonDesktop, experimentalEnabled]);

  // 当实验性功能分组可见时，估算存储占用
  useEffect(() => {
    if (!isOpen || !experimentalEnabled) return;

    estimateTotalStorageBytes().then((bytes) => {
      setStorageBytes(bytes);
    }).catch(() => {
      setStorageBytes(null);
    });
  }, [isOpen, experimentalEnabled]);

  // 实验性功能关闭时，若当前选中该分组则回退到默认分组
  useEffect(() => {
    if (!isOpen || experimentalEnabled) return;
    if (controller.selectedGroupId === "experimental") {
      controller.selectGroup("system");
    }
  }, [isOpen, experimentalEnabled, controller]);
  const selectedSettingGuideSetting = settingGuideSettingId === null
    ? null
    : findWorkbenchSettingDefinition(settingGuideSettingId);

  const settingGuideDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  }), []);

  const handleClose = useCallback(() => {
    setSettingGuideSettingId(null);
    runInAction(() => {
      settingGuideDialogState.visible = false;
    });
    appHost.internalActions.closeDialog("settings");
  }, [appHost, settingGuideDialogState]);

  const handleOpenSettingGuide = useCallback((settingId: string) => {
    setSettingGuideSettingId(settingId);
    runInAction(() => {
      settingGuideDialogState.visible = true;
      settingGuideDialogState.maximized = false;
      settingGuideDialogState.offsetX = 0;
      settingGuideDialogState.offsetY = 0;
    });
  }, [settingGuideDialogState]);

  const handleCloseSettingGuide = useCallback(() => {
    runInAction(() => {
      settingGuideDialogState.visible = false;
    });
    setSettingGuideSettingId(null);
  }, [settingGuideDialogState]);

  const confirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const resetAllConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);


  const activityDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 520,
    height: null,
    activeTab: null,
  }), []);

  const keyboardShortcutDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 820,
    height: 680,
    activeTab: null,
  }), []);


  const experimentalFeaturesDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 460,
    height: null,
    activeTab: null,
  }), []);

  const deviceAnimationsWarningDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 460,
    height: null,
    activeTab: null,
  }), []);

  const clearStorageConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const clearStorageInputDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const webDavDeleteConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const webDavDeleteInputDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const webDavStatusDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 760,
    height: 620,
    activeTab: null,
  }), []);

  const [yituliuStatusVisible, setYituliuStatusVisible] = useState(false);

  const cloudflareStatusDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 760,
    height: 620,
    activeTab: null,
  }), []);

  const cfDeleteConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const cfDeleteInputDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const [clearStorageInputValue, setClearStorageInputValue] = useState("");

  const handleClearStorage = useCallback(() => {
    runInAction(() => {
      clearStorageConfirmDialogState.visible = true;
    });
  }, [clearStorageConfirmDialogState]);

  const handleClearStorageCancel = useCallback(() => {
    runInAction(() => {
      clearStorageConfirmDialogState.visible = false;
    });
  }, [clearStorageConfirmDialogState]);

  const handleClearStorageConfirm = useCallback(() => {
    runInAction(() => {
      clearStorageConfirmDialogState.visible = false;
      clearStorageInputDialogState.visible = true;
    });
    setClearStorageInputValue("");
  }, [clearStorageConfirmDialogState, clearStorageInputDialogState]);

  const handleClearStorageInputCancel = useCallback(() => {
    runInAction(() => {
      clearStorageInputDialogState.visible = false;
    });
    setClearStorageInputValue("");
  }, [clearStorageInputDialogState]);

  const handleClearStorageInputConfirm = useCallback(() => {
    clearAllStorageAndReload();
  }, []);

  const [webDavDeleteInputValue, setWebDavDeleteInputValue] = useState("");
  const [webDavDeleting, setWebDavDeleting] = useState(false);

  const [cfDeleteInputValue, setCfDeleteInputValue] = useState("");
  const [cfDeleting, setCfDeleting] = useState(false);
  const [cfAborting, setCfAborting] = useState(false);

  const handleWebDavDelete = useCallback(() => {
    runInAction(() => {
      webDavDeleteConfirmDialogState.visible = true;
    });
  }, [webDavDeleteConfirmDialogState]);

  const handleWebDavDeleteCancel = useCallback(() => {
    runInAction(() => {
      webDavDeleteConfirmDialogState.visible = false;
    });
  }, [webDavDeleteConfirmDialogState]);

  const handleWebDavDeleteConfirm = useCallback(() => {
    runInAction(() => {
      webDavDeleteConfirmDialogState.visible = false;
      webDavDeleteInputDialogState.visible = true;
    });
    setWebDavDeleteInputValue("");
  }, [webDavDeleteConfirmDialogState, webDavDeleteInputDialogState]);

  const handleWebDavDeleteInputCancel = useCallback(() => {
    runInAction(() => {
      webDavDeleteInputDialogState.visible = false;
    });
    setWebDavDeleteInputValue("");
  }, [webDavDeleteInputDialogState]);

  const handleWebDavDeleteInputConfirm = useCallback(async () => {
    runInAction(() => {
      webDavDeleteInputDialogState.visible = false;
    });
    setWebDavDeleting(true);
    try {
      await sync?.actions.deleteRemoteData();
    } catch {
      runInAction(() => {
        webDavDeleteInputDialogState.visible = true;
      });
      setWebDavDeleting(false);
      return;
    }

    runInAction(() => {
      webDavStatusDialogState.visible = false;
    });
    setWebDavDeleting(false);
  }, [sync, webDavDeleteInputDialogState, webDavStatusDialogState]);

  // -- Cloudflare 同步状态弹窗 handlers -- //

  const handleOpenCloudflareStatus = useCallback(() => {
    runInAction(() => {
      cloudflareStatusDialogState.visible = true;
    });
  }, [cloudflareStatusDialogState]);

  const handleCloseCloudflareStatus = useCallback(() => {
    runInAction(() => {
      cloudflareStatusDialogState.visible = false;
    });
  }, [cloudflareStatusDialogState]);

  const handleToggleCloudflareStatusMaximized = useCallback(() => {
    runInAction(() => {
      cloudflareStatusDialogState.maximized = !cloudflareStatusDialogState.maximized;
    });
  }, [cloudflareStatusDialogState]);

  const handleCloudflareStatusOffsetChange = useCallback((offsetX: number, offsetY: number) => {
    runInAction(() => {
      cloudflareStatusDialogState.offsetX = offsetX;
      cloudflareStatusDialogState.offsetY = offsetY;
    });
  }, [cloudflareStatusDialogState]);

  const handleCloudflareStatusResize = useCallback((width: number, height: number) => {
    runInAction(() => {
      cloudflareStatusDialogState.width = width;
      cloudflareStatusDialogState.height = height;
    });
  }, [cloudflareStatusDialogState]);

  // -- Cloudflare 删除远端数据 handlers -- //

  const handleCfDelete = useCallback(() => {
    runInAction(() => {
      cfDeleteConfirmDialogState.visible = true;
    });
  }, [cfDeleteConfirmDialogState]);

  const handleCfDeleteCancel = useCallback(() => {
    runInAction(() => {
      cfDeleteConfirmDialogState.visible = false;
    });
  }, [cfDeleteConfirmDialogState]);

  const handleCfDeleteConfirm = useCallback(() => {
    runInAction(() => {
      cfDeleteConfirmDialogState.visible = false;
      cfDeleteInputDialogState.visible = true;
    });
    setCfDeleteInputValue("");
  }, [cfDeleteConfirmDialogState, cfDeleteInputDialogState]);

  const handleCfDeleteInputCancel = useCallback(() => {
    runInAction(() => {
      cfDeleteInputDialogState.visible = false;
    });
    setCfDeleteInputValue("");
  }, [cfDeleteInputDialogState]);

  const handleCfDeleteInputConfirm = useCallback(async () => {
    runInAction(() => {
      cfDeleteInputDialogState.visible = false;
    });
    setCfDeleting(true);

    try {
      await sync?.actions.deleteRemoteData();
    } catch {
      runInAction(() => {
        cfDeleteInputDialogState.visible = true;
      });
      setCfDeleting(false);
      return;
    }

    runInAction(() => {
      cloudflareStatusDialogState.visible = false;
    });
    setCfDeleting(false);
  }, [sync, cfDeleteInputDialogState, cloudflareStatusDialogState]);

  const handleCfAbortCurrentTransaction = useCallback(async () => {
    setCfAborting(true);
    try {
      await sync?.actions.abortCurrentTransaction();
    } catch {
      // abort 失败静默处理，用户可重试
    } finally {
      setCfAborting(false);
    }
  }, [sync]);


  const handleOpenWebDavStatus = useCallback(() => {
    runInAction(() => {
      webDavStatusDialogState.visible = true;
    });
  }, [webDavStatusDialogState]);

  const handleCloseWebDavStatus = useCallback(() => {
    runInAction(() => {
      webDavStatusDialogState.visible = false;
    });
  }, [webDavStatusDialogState]);

  const handleToggleWebDavStatusMaximized = useCallback(() => {
    runInAction(() => {
      webDavStatusDialogState.maximized = !webDavStatusDialogState.maximized;
    });
  }, [webDavStatusDialogState]);

  const handleWebDavStatusOffsetChange = useCallback((offsetX: number, offsetY: number) => {
    runInAction(() => {
      webDavStatusDialogState.offsetX = offsetX;
      webDavStatusDialogState.offsetY = offsetY;
    });
  }, [webDavStatusDialogState]);

  const handleWebDavStatusResize = useCallback((width: number, height: number) => {
    runInAction(() => {
      webDavStatusDialogState.width = width;
      webDavStatusDialogState.height = height;
    });
  }, [webDavStatusDialogState]);

  const handleSelectSettingValue = useCallback((settingId: string, value: string) => {
    controller.updateSelectValue(settingId, value);
    if (settingId === "sync-provider") setYituliuStatusVisible(value === "yituliu");
    if (settingId !== "sync-provider") {
      return;
    }
    runInAction(() => {
      webDavStatusDialogState.visible = value === "webdav";
      cloudflareStatusDialogState.visible = value === "cloudflare";
    });
  }, [cloudflareStatusDialogState, controller, webDavStatusDialogState]);

  // 通过 fetch 发送 PROPFIND 请求验证 URL/用户名/密码是否可达。
  const handleWebDavTestConnection = useCallback(
    async (draft: { url: string; username: string; password: string }) => {
      const url = draft.url.trim().replace(/\/+$/, "");
      if (!url) {
        return false;
      }
      try {
        const headers: Record<string, string> = {
          Depth: "1",
        };
        if (draft.username || draft.password) {
          headers.Authorization = `Basic ${btoa(`${draft.username}:${draft.password}`)}`;
        }
        const response = await fetch(url, {
          method: "PROPFIND",
          headers,
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    [],
  );


  const clearStorageExpectedText = useMemo(
    () => appHost.state.settings.locale === "zh-CN"
      ? "确认清除所有存储的数据"
      : "Confirm to clear all stored data",
    [appHost.state.settings.locale],
  );

  const isClearStorageInputValid = clearStorageInputValue === clearStorageExpectedText;

  const webDavDeleteExpectedText = useMemo(
    () => appHost.state.settings.locale === "zh-CN"
      ? "删除服务器端所有保存内容"
      : "Delete all saved content on the server",
    [appHost.state.settings.locale],
  );

  const isWebDavDeleteInputValid = webDavDeleteInputValue === webDavDeleteExpectedText;

  const cfDeleteExpectedText = useMemo(
    () => appHost.state.settings.locale === "zh-CN"
      ? "删除"
      : "DELETE",
    [appHost.state.settings.locale],
  );

  const isCfDeleteInputValid = cfDeleteInputValue === cfDeleteExpectedText;

  const handleRequestToggleExperimentalFeatures = useCallback(() => {
    runInAction(() => {
      experimentalFeaturesDialogState.visible = true;
    });
  }, [experimentalFeaturesDialogState]);

  const handleExperimentalFeaturesCancel = useCallback(() => {
    runInAction(() => {
      experimentalFeaturesDialogState.visible = false;
    });
  }, [experimentalFeaturesDialogState]);

  const handleExperimentalFeaturesConfirm = useCallback(() => {
    controller.updateSwitchValue("other-experimental-features", true);
    runInAction(() => {
      experimentalFeaturesDialogState.visible = false;
    });
  }, [controller, experimentalFeaturesDialogState]);

  const handleRequestToggleDeviceAnimations = useCallback(() => {
    runInAction(() => {
      deviceAnimationsWarningDialogState.visible = true;
    });
  }, [deviceAnimationsWarningDialogState]);

  const handleDeviceAnimationsWarningCancel = useCallback(() => {
    runInAction(() => {
      deviceAnimationsWarningDialogState.visible = false;
    });
  }, [deviceAnimationsWarningDialogState]);

  const handleDeviceAnimationsWarningConfirm = useCallback(() => {
    controller.updateSwitchValue("game-play-device-animations", true);
    runInAction(() => {
      deviceAnimationsWarningDialogState.visible = false;
    });
  }, [controller, deviceAnimationsWarningDialogState]);


  const handleResetOperation = useCallback(() => {
    runInAction(() => {
      confirmDialogState.visible = true;
    });
  }, [confirmDialogState]);

  const handleResetConfirm = useCallback(() => {
    controller.resetArknightsOperation();
    runInAction(() => {
      confirmDialogState.visible = false;
    });
  }, [controller, confirmDialogState]);

  const handleResetCancel = useCallback(() => {
    runInAction(() => {
      confirmDialogState.visible = false;
    });
  }, [confirmDialogState]);

  const handleResetAllSettings = useCallback(() => {
    runInAction(() => {
      resetAllConfirmDialogState.visible = true;
    });
  }, [resetAllConfirmDialogState]);

  const handleResetAllConfirm = useCallback(() => {
    controller.resetAllSettings();
    runInAction(() => {
      resetAllConfirmDialogState.visible = false;
    });
  }, [controller, resetAllConfirmDialogState]);

  const handleResetAllCancel = useCallback(() => {
    runInAction(() => {
      resetAllConfirmDialogState.visible = false;
    });
  }, [resetAllConfirmDialogState]);


  const handleOpenActivityDialog = useCallback(() => {
    runInAction(() => {
      activityDialogState.visible = true;
    });
  }, [activityDialogState]);

  const handleOpenKeyboardShortcutDialog = useCallback(() => {
    runInAction(() => {
      keyboardShortcutDialogState.visible = true;
      keyboardShortcutDialogState.maximized = false;
      keyboardShortcutDialogState.offsetX = 0;
      keyboardShortcutDialogState.offsetY = 0;
    });
  }, [keyboardShortcutDialogState]);

  const handleCloseKeyboardShortcutDialog = useCallback(() => {
    runInAction(() => {
      keyboardShortcutDialogState.visible = false;
    });
  }, [keyboardShortcutDialogState]);

  const handleCloseActivityDialog = useCallback(() => {
    runInAction(() => {
      activityDialogState.visible = false;
    });
  }, [activityDialogState]);

  const handleToggleActivity = useCallback((activityId: string, selected: boolean) => {
    runInAction(() => {
      const selectedIds = new Set(normalizeSelectedActivityIds(appHost.internalState.settings.selectedActivityIds));
      if (selected) {
        selectedIds.add(activityId);
      } else {
        selectedIds.delete(activityId);
      }

      appHost.internalState.settings.selectedActivityIds = normalizeSelectedActivityIds([...selectedIds]);
    });
  }, [appHost]);


  useEffect(() => {
    if (isOpen) {
      return;
    }

    setSettingGuideSettingId(null);
    runInAction(() => {
      settingGuideDialogState.visible = false;
      keyboardShortcutDialogState.visible = false;
    });
  }, [isOpen, keyboardShortcutDialogState, settingGuideDialogState]);

  useEffect(() => {
    if (!isOpen || hideGroupSidebar) {
      return;
    }

    const contentElement = contentRef.current;
    const selectedSection = sectionRefs.current.get(controller.selectedGroupId);
    if (contentElement === null || selectedSection === undefined) {
      return;
    }

    scrollSettingsDialogContentToSection({
      contentElement,
      selectedSection,
    });
  }, [isOpen, controller.selectedGroupId, hideGroupSidebar]);

  if (!isOpen) {
    return null;
  }

  const selectedGroup = controller.selectedGroup;

  return (
    <>
    <DialogShell
      className="settings-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="settings"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("settings", offsetX, offsetY);
      }}
      onResize={(width, height) => {
        appHost.internalActions.setDialogSize("settings", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("settings");
      }}
      restoreTitle={t("dialog.restore")}
      title={t("settingsDialog.title")}
      titleId="settings-dialog-title"
    >
        <div
          className={cm(styles, hideGroupSidebar
            ? "settings-dialog-layout settings-dialog-layout-single-pane"
            : "settings-dialog-layout")}
        >
          {hideGroupSidebar ? null : (
            <aside className={cm(styles, "settings-dialog-sidebar")}>
              <div className={cm(styles, "settings-dialog-sidebar-title")}>{t("settingsDialog.groups")}</div>
              <div aria-label={t("settingsDialog.groups")} className={cm(styles, "settings-dialog-tree")} role="tree">
                {visibleGroups.map((group) => {
                  const isActive = group.id === selectedGroup.id;

                  return (
                    <button
                      aria-selected={isActive}
                      aria-controls={`settings-dialog-group-${group.id}`}
                      className={cm(styles, isActive
                        ? "settings-dialog-tree-button is-active"
                        : "settings-dialog-tree-button")}
                      key={group.id}
                      onClick={() => {
                        controller.selectGroup(group.id);
                      }}
                      role="treeitem"
                      type="button"
                    >
                      <span className={cm(styles, "settings-dialog-tree-label")}>{t(group.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}
          <div className={cm(styles, "settings-dialog-content")} ref={contentRef}>
            {visibleGroups.map((group) => (
              <section
                className={cm(styles, "settings-dialog-group-section")}
                id={`settings-dialog-group-${group.id}`}
                key={group.id}
                ref={(element) => {
                  if (element === null) {
                    sectionRefs.current.delete(group.id);

                    return;
                  }

                  sectionRefs.current.set(group.id, element);
                }}
              >
                <div className={cm(styles, "settings-dialog-group-header")}>
                  <h3>{t(group.labelKey)}</h3>
                  <p>{t(group.descriptionKey)}</p>
                </div>
                <div className={cm(styles, "settings-dialog-settings-list")}>
                  {group.id === "activity" ? (
                    <ActivitySettingsCard
                      t={t}
                      effectiveActivityIds={effectiveActivityIds}
                      onOpen={handleOpenActivityDialog}
                    />
                  ) : null}
                  {group.items.filter((setting) => !isNonDesktop || !setting.mobileHidden).flatMap((setting, index, _filtered) => {
                    const isEditable = controller.isSettingEditable(setting.id);
                    const isText = setting.kind === "text" || setting.kind === "password";
                    const isDebugGroup = group.id === "debug";
                    const settingLabel = resolveSettingLabel(setting, t);
                    const hasSettingGuide = CONFIG_GUIDE_SETTING_DOC_FILES.has(`${setting.id}.md`);

                    // 调试分组：调试模式关闭时隐藏除调试模式开关外的所有项
                    if (isDebugGroup && index > 0 && !controller.getValue("other-debug-mode")) {
                      return [];
                    }

                    const elements: React.ReactNode[] = [];


                    elements.push(
                      <article
                        aria-disabled={!isEditable}
                        className={cm(styles, [
                          "settings-dialog-setting-card",
                          isEditable ? "" : "is-disabled",
                          isText ? "is-text" : "",
                        ].filter(Boolean).join(" "))}
                        key={setting.id}
                        onClick={setting.kind === "switch" && isEditable ? (event) => {
                          // 开关项整张卡片都可点按，笔不必瞄准右侧的小开关。
                          const target = event.target as HTMLElement;
                          if (target.closest("button, a, label, input, select, textarea") !== null) {
                            return;
                          }
                          event.currentTarget.querySelector<HTMLInputElement>(`#setting-${setting.id}`)?.click();
                        } : undefined}
                      >
                        <div className={cm(styles, "settings-dialog-setting-copy")}>
                          <h4 className={cm(styles, "settings-dialog-setting-title")}>
                            <span>{settingLabel}</span>
                            {hasSettingGuide ? (
                              <SettingGuideButton
                                label={settingLabel}
                                onClick={() => handleOpenSettingGuide(setting.id)}
                                t={t}
                              />
                            ) : null}
                          </h4>
                          <p>{resolveSettingDescription(setting, t)}</p>
                        </div>
                        <div className={cm(styles, "settings-dialog-setting-control")}>
                          {renderSettingControl({
                            controller,
                            setting,
                            t,
                            isEditable,
                            onSelectValue: handleSelectSettingValue,
                            onRequestToggleDeviceAnimations: handleRequestToggleDeviceAnimations,
                            onRequestToggleExperimentalFeatures: handleRequestToggleExperimentalFeatures,
                          })}
                        </div>
                      </article>,
                    );

                    return elements;
                  })}
                </div>
                {group.id === "convenience-operation" && (
                  <>
                    <SettingsActionCard
                      buttonLabel={t("settingsAction.resetOperation")}
                      description={t("settingsAction.resetOperationDescription")}
                      onClick={handleResetOperation}
                      title={t("settingsAction.resetOperation")}
                    />
                  </>
                )}
                {group.id === "shortcuts" && (
                  <SettingsActionCard
                    buttonLabel={t("keyboardShortcutDialog.open")}
                    onClick={handleOpenKeyboardShortcutDialog}
                    title={t("keyboardShortcutDialog.title")}
                  />
                )}
                {group.id === "other" && (
                  <>
                    <SettingsActionCard
                      buttonLabel={t("settingsAction.resetAllSettings")}
                      description={t("settingsAction.resetAllSettingsConfirm")}
                      onClick={handleResetAllSettings}
                      title={t("settingsAction.resetAllSettings")}
                    />
                    <PwaSettingsSection appHost={appHost} hideHeader pwaController={pwaController} />
                  </>
                )}
                {group.id === "experimental" && (
                  <>
                    {controller.getValue("sync-provider") === "webdav" ? (
                      <WebDavSyncStatusCard
                        enabled={sync?.state.settings.enabled === true
                          && syncActivation.state === "active"
                          && syncActivation.provider === "webdav"}
                        onOpen={handleOpenWebDavStatus}
                        t={t}
                      />
                    ) : null}
                    {controller.getValue("sync-provider") === "cloudflare" ? (
                      <CloudflareSyncStatusCard
                        enabled={sync?.state.settings.enabled === true
                          && syncActivation.state === "active"
                          && syncActivation.provider === "cloudflare"}
                        onOpen={handleOpenCloudflareStatus}
                        t={t}
                      />
                    ) : null}
                    {controller.getValue("sync-provider") === "yituliu" ? (
                      <SettingsActionCard title={t("settingsOption.syncProvider.yituliu")} description={t("yituliu.scope")}
                        buttonLabel={t("cloudflareStatus.open")} onClick={() => setYituliuStatusVisible(true)} />
                    ) : null}
                    <StorageUsageCard
                      onClearStorage={handleClearStorage}
                      storageBytes={storageBytes}
                      t={t}
                    />
                  </>
                )}
                {group.id === "debug" && (
                  <>
                    {controller.getValue("other-debug-mode") === true
                      && migrationController !== undefined ? (
                        <V2MigrationSettingsCard controller={migrationController} />
                      ) : null}
                  </>
                )}
              </section>
            ))}
          </div>
        </div>
    </DialogShell>
    {confirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={confirmDialogState}
        confirmMessageKey="settingsAction.resetOperationConfirm"
        onCancel={handleResetCancel}
        onConfirm={handleResetConfirm}
        t={t}
        titleKey="settingsAction.resetOperation"
      />
    )}
    {resetAllConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={resetAllConfirmDialogState}
        confirmMessageKey="settingsAction.resetAllSettingsConfirm"
        onCancel={handleResetAllCancel}
        onConfirm={handleResetAllConfirm}
        t={t}
        titleKey="settingsAction.resetAllSettings"
      />
    )}
    {clearStorageConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={clearStorageConfirmDialogState}
        confirmMessageKey="settingsAction.experimental-clear-storage-confirm"
        onCancel={handleClearStorageCancel}
        onConfirm={handleClearStorageConfirm}
        t={t}
        titleKey="settingsAction.experimental-clear-storage"
      />
    )}
    {clearStorageInputDialogState.visible && (
      <ClearStorageInputDialog
        confirmDialogState={clearStorageInputDialogState}
        expectedText={clearStorageExpectedText}
        inputValue={clearStorageInputValue}
        isValid={isClearStorageInputValid}
        onCancel={handleClearStorageInputCancel}
        onChange={setClearStorageInputValue}
        onConfirm={handleClearStorageInputConfirm}
        t={t}
      />
    )}
    {webDavDeleteConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={webDavDeleteConfirmDialogState}
        confirmMessageKey="webDavConfig.deleteAllDataConfirm"
        onCancel={handleWebDavDeleteCancel}
        onConfirm={handleWebDavDeleteConfirm}
        t={t}
        titleKey="webDavConfig.deleteAllData"
      />
    )}
    {webDavDeleteInputDialogState.visible && (
      <ClearStorageInputDialog
        confirmButtonKey="syncConfig.deleteAllDataFinalConfirm"
        confirmDialogState={webDavDeleteInputDialogState}
        expectedText={webDavDeleteExpectedText}
        inputValue={webDavDeleteInputValue}
        isValid={isWebDavDeleteInputValid}
        onCancel={handleWebDavDeleteInputCancel}
        onChange={setWebDavDeleteInputValue}
        onConfirm={handleWebDavDeleteInputConfirm}
        promptKey="webDavConfig.deleteAllDataFinalPrompt"
        t={t}
        titleKey="webDavConfig.deleteAllDataFinalTitle"
      />
    )}
    {cfDeleteConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={cfDeleteConfirmDialogState}
        confirmMessageKey="cloudflareStatus.deleteAllDataConfirm"
        onCancel={handleCfDeleteCancel}
        onConfirm={handleCfDeleteConfirm}
        t={t}
        titleKey="cloudflareStatus.deleteAllData"
      />
    )}
    {cfDeleteInputDialogState.visible && (
      <ClearStorageInputDialog
        confirmButtonKey="syncConfig.deleteAllDataFinalConfirm"
        confirmDialogState={cfDeleteInputDialogState}
        expectedText={cfDeleteExpectedText}
        inputValue={cfDeleteInputValue}
        isValid={isCfDeleteInputValid}
        onCancel={handleCfDeleteInputCancel}
        onChange={setCfDeleteInputValue}
        onConfirm={handleCfDeleteInputConfirm}
        promptKey="cloudflareStatus.deleteAllDataFinalPrompt"
        t={t}
        titleKey="cloudflareStatus.deleteAllData"
      />
    )}
    {deviceAnimationsWarningDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={deviceAnimationsWarningDialogState}
        confirmLabelKey="settingsField.game-play-device-animations-warning-confirm"
        confirmMessageKey="settingsField.game-play-device-animations-warning-message"
        onCancel={handleDeviceAnimationsWarningCancel}
        onConfirm={handleDeviceAnimationsWarningConfirm}
        t={t}
        titleKey="settingsField.game-play-device-animations-warning-title"
      />
    )}
    {activityDialogState.visible && (
      <ActivitySelectionDialog
        activityDialogState={activityDialogState}
        effectiveActivityIds={effectiveActivityIds}
        onClose={handleCloseActivityDialog}
        onToggleActivity={handleToggleActivity}
        selectedActivityIds={selectedActivityIds}
        t={t}
      />
    )}
    <KeyboardShortcutSettingsDialog
      appHost={appHost}
      dialogState={keyboardShortcutDialogState}
      onClose={handleCloseKeyboardShortcutDialog}
    />
      {webDavStatusDialogState.visible && sync !== null ? (
        <WebDavSyncStatusDialog
        compactMobileLayout={isNonDesktop}
        deleting={webDavDeleting}
        dialogState={webDavStatusDialogState}
        onClose={handleCloseWebDavStatus}
        onDeleteAllData={handleWebDavDelete}
        onOffsetChange={handleWebDavStatusOffsetChange}
        onResize={handleWebDavStatusResize}
        onTestConnection={handleWebDavTestConnection}
        onToggleMaximized={handleToggleWebDavStatusMaximized}
        onUpdateSettings={async (patch) => {
          if (!requestSyncProvider("webdav")) {
            throw new Error("Failed to enter WebDAV setup mode.");
          }
          await sync.actions.updateSettings(patch);
          const nextSettings = {
            ...sync.state.settings,
            ...patch,
          };
          if (!activateSyncProvider(
            "webdav",
            createWebDavSyncTargetKey(nextSettings),
          )) {
            throw new Error("Failed to activate WebDAV sync.");
          }
        }}
        state={sync.state}
        t={t}
      />
    ) : null}
    {yituliuStatusVisible && sync !== null ? (
      <YituliuSyncStatusDialog sync={sync} compactMobileLayout={isNonDesktop} onClose={() => setYituliuStatusVisible(false)} t={t} />
    ) : null}
    {cloudflareStatusDialogState.visible && sync !== null ? (
      <CloudflareSyncStatusDialog
        aborting={cfAborting}
        compactMobileLayout={isNonDesktop}
        deleting={cfDeleting}
        dialogState={cloudflareStatusDialogState}
        onAbortCurrentTransaction={handleCfAbortCurrentTransaction}
        onClose={handleCloseCloudflareStatus}
        onDeleteAllData={handleCfDelete}
        onOffsetChange={handleCloudflareStatusOffsetChange}
        onResize={handleCloudflareStatusResize}
        onToggleMaximized={handleToggleCloudflareStatusMaximized}
        state={sync.state}
        t={t}
      />
    ) : null}
    {experimentalFeaturesDialogState.visible && (
      <DialogShell
        bodyClassName={cm(styles, "experimental-warning-dialog-body")}
        className="experimental-warning-dialog"
        closeTitle={t("action.close")}
        compactMobileLayout={isNonDesktop}
        dialogKey="experimental-features-warning"
        dialogState={experimentalFeaturesDialogState}
        maximizeTitle=""
        onClose={handleExperimentalFeaturesCancel}
        onToggleMaximized={() => {}}
        restoreTitle=""
        showMaximizeButton={false}
        title={t("settingsField.other-experimental-features-warning-title")}
        titleId="experimental-features-warning-title"
      >
        <div className={cm(styles, "experimental-warning-content")}>
          <p>{t("settingsField.other-experimental-features-warning-message")}</p>
          <div className={cm(styles, "experimental-warning-actions")}>
            <button
              className={cm(styles, "experimental-warning-cancel-btn")}
              onClick={handleExperimentalFeaturesCancel}
              type="button"
            >
              {t("action.cancel")}
            </button>
            <button
              className={cm(styles, "experimental-warning-confirm-btn")}
              onClick={handleExperimentalFeaturesConfirm}
              type="button"
            >
              {t("settingsField.other-experimental-features-warning-confirm")}
            </button>
          </div>
        </div>
      </DialogShell>
    )}
    {settingGuideDialogState.visible && selectedSettingGuideSetting !== null ? (
      <SettingGuideDialog
        compactMobileLayout={isMobileCompactLayout}
        dialogState={settingGuideDialogState}
        onClose={handleCloseSettingGuide}
        setting={selectedSettingGuideSetting}
        t={t}
      />
    ) : null}
    </>
  );
});

function SettingGuideButton({
  label,
  onClick,
  t,
}: {
  label: string;
  onClick: () => void;
  t: AppHost["actions"]["translate"];
}) {
  const buttonLabel = `${t("helpDialog.title")}: ${label}`;

  return (
    <button
      aria-label={buttonLabel}
      className={cm(styles, "settings-dialog-setting-help-button")}
      onClick={onClick}
      title={buttonLabel}
      type="button"
    >
      <WorkbenchIcon kind="help" />
      <span className={cm(styles, "sr-only")}>{buttonLabel}</span>
    </button>
  );
}

function SettingGuideDialog({
  compactMobileLayout,
  dialogState,
  onClose,
  setting,
  t,
}: {
  compactMobileLayout: boolean;
  dialogState: DialogStateReadWrite;
  onClose: () => void;
  setting: WorkbenchSettingDefinition;
  t: AppHost["actions"]["translate"];
}) {
  const title = resolveSettingLabel(setting, t);
  const path = createPublicAssetUrl(`help/config-guide/${setting.id}.md`);

  return (
    <MarkdownTutorialOverlay
      compactLayout={compactMobileLayout}
      dialogKey="settings-guide"
      onClose={onClose}
      path={path}
      title={title}
      visible={dialogState.visible}
    />
  );
}

function SettingsActionCard({
  buttonLabel,
  description,
  onClick,
  title,
}: {
  buttonLabel: string;
  description?: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <article className={cm(styles, "settings-dialog-setting-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>{title}</h4>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      <div className={cm(styles, "settings-dialog-setting-control")}>
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={onClick}
          type="button"
        >
          {buttonLabel}
        </button>
      </div>
    </article>
  );
}

function StorageUsageCard({
  onClearStorage,
  storageBytes,
  t,
}: {
  onClearStorage: () => void;
  storageBytes: number | null;
  t: AppHost["actions"]["translate"];
}) {
  return (
    <article className={cm(styles, "settings-dialog-setting-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>{t("settingsField.experimental-storage-usage")}</h4>
        <p>{t("settingsField.experimental-storage-usageDescription")}</p>
      </div>
      <div className={cm(styles, "settings-dialog-setting-control")}>
        <span className={cm(styles, "settings-dialog-storage-usage-value")}>
          {formatStorageBytesToMB(storageBytes)}
        </span>
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={onClearStorage}
          type="button"
        >
          {t("settingsAction.experimental-clear-storage")}
        </button>
      </div>
    </article>
  );
}

const WebDavSyncStatusCard = observer(function WebDavSyncStatusCard({
  enabled,
  onOpen,
  t,
}: {
  enabled: boolean;
  onOpen: () => void;
  t: AppHost["actions"]["translate"];
}) {
  return (
    <SettingsActionCard
      buttonLabel={t("webDavStatus.open")}
      description={t(enabled
        ? "settingsField.experimental-webdav-statusDescription"
        : "syncActivation.setupRequiredDescription")}
      onClick={onOpen}
      title={t("webDavConfig.title")}
    />
  );
});

const CloudflareSyncStatusCard = observer(function CloudflareSyncStatusCard({
  enabled,
  onOpen,
  t,
}: {
  enabled: boolean;
  onOpen: () => void;
  t: AppHost["actions"]["translate"];
}) {
  return (
    <SettingsActionCard
      buttonLabel={t("cloudflareStatus.open")}
      description={t(enabled
        ? "settingsField.experimental-webdav-statusDescription"
        : "syncActivation.setupRequiredDescription")}
      onClick={onOpen}
      title={t("cloudflareStatus.title")}
    />
  );
});


const V2MigrationSettingsCard = observer(function V2MigrationSettingsCard({
  controller,
}: {
  controller: V2MigrationController;
}) {
  const summary = controller.result ?? controller.migrationState.summary;
  const statusText = summary !== null && controller.migrationState.completedAt !== null
    ? `已迁移地图 ${summary.migratedMapCount} 个，蓝图 ${summary.migratedBlueprintCount} 个`
    : controller.detection.hasData
      ? `检测到 v2 地图 ${controller.detection.mapCount} 个，蓝图 ${controller.detection.blueprintCount} 个`
      : "未检测到可迁移的 v2 数据";

  return (
    <article className={cm(styles, "settings-dialog-setting-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>v2 数据迁移</h4>
        <p>{statusText}</p>
      </div>
      <div className={cm(styles, "settings-dialog-migration-control")}>
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={controller.openDialog}
          type="button"
        >
          打开迁移
        </button>
      </div>
    </article>
  );
});

function ActivitySettingsCard({
  effectiveActivityIds,
  onOpen,
  t,
}: {
  effectiveActivityIds: readonly string[];
  onOpen: () => void;
  // 活动卡片文案改走 i18n。
  t: AppHost["actions"]["translate"];
}) {
  return (
    <article className={cm(styles, "settings-dialog-setting-card settings-dialog-activity-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>{t("activityText.title")}</h4>
        <p>{t("activityText.effective")}</p>
      </div>
      <div className={cm(styles, "settings-dialog-activity-control")}>
        <ActivityIconStrip activityIds={effectiveActivityIds} />
        {effectiveActivityIds.length === 0 ? (
          <span className={cm(styles, "settings-dialog-activity-empty")}>{t("activityText.none")}</span>
        ) : null}
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={onOpen}
          type="button"
        >
          {t("activityText.load")}
        </button>
      </div>
    </article>
  );
}

function ActivitySelectionDialog({
  activityDialogState,
  effectiveActivityIds,
  onClose,
  onToggleActivity,
  selectedActivityIds,
  t,
}: {
  activityDialogState: DialogStateReadWrite;
  effectiveActivityIds: readonly string[];
  onClose: () => void;
  onToggleActivity: (activityId: string, selected: boolean) => void;
  selectedActivityIds: readonly string[];
  t: AppHost["actions"]["translate"];
}) {
  const selectedActivityIdSet = new Set(selectedActivityIds);
  const effectiveActivityIdSet = new Set(effectiveActivityIds);

  return (
    <DialogShell
      className="activity-selection-dialog"
      bodyClassName={cm(styles, "activity-selection-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="activity-selection"
      dialogState={activityDialogState}
      maximizeTitle=""
      onClose={onClose}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={t("activityText.load")}
      titleId="activity-selection-dialog-title"
    >
      <div className={cm(styles, "activity-selection-list")}>
        {ACTIVITY_DEFINITIONS.map((activity) => {
          const isSelected = selectedActivityIdSet.has(activity.id);
          const isEffective = effectiveActivityIdSet.has(activity.id);
          const isOngoing = isActivityOngoing(activity);

          return (
            <label
              className={cm(styles, `activity-selection-row${isSelected ? " is-selected" : ""}`)}
              key={activity.id}
            >
              <img
                alt=""
                draggable={false}
                src={createPublicAssetUrl(activity.banner)}
              />
              <span aria-hidden="true" className={cm(styles, "activity-selection-banner-tint")} />
              <span className={cm(styles, "activity-selection-row-controls")}>
                <input
                  checked={isSelected}
                  onChange={(event) => onToggleActivity(activity.id, event.currentTarget.checked)}
                  type="checkbox"
                />
                <span className={cm(styles, "activity-selection-row-copy")}>
                  <strong className={cm(styles, "sr-only")}>{activity.name}</strong>
                  <span>{formatActivityTimeRange(activity.startTime, activity.endTime, t)}</span>
                </span>
                <span className={cm(styles, "activity-selection-row-badges")}>
                  {isOngoing ? <span className={cm(styles, "activity-selection-badge")}>{t("activityText.ongoing")}</span> : null}
                  {isEffective ? <span className={cm(styles, "activity-selection-badge")}>{t("activityText.active")}</span> : null}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </DialogShell>
  );
}

function scrollSettingsDialogContentToSection(options: {
  contentElement: HTMLDivElement;
  selectedSection: HTMLElement;
}): void {
  const { contentElement, selectedSection } = options;
  const contentRect = contentElement.getBoundingClientRect();
  const sectionRect = selectedSection.getBoundingClientRect();
  const nextScrollTop = Math.max(
    0,
    contentElement.scrollTop + sectionRect.top - contentRect.top - SETTINGS_DIALOG_SECTION_SCROLL_OFFSET,
  );

  if (typeof contentElement.scrollTo === "function") {
    contentElement.scrollTo({ top: nextScrollTop });
    return;
  }

  contentElement.scrollTop = nextScrollTop;
}

function findWorkbenchSettingDefinition(settingId: string): WorkbenchSettingDefinition | null {
  for (const group of WORKBENCH_SETTINGS_GROUPS) {
    const setting = group.items.find((item) => item.id === settingId);
    if (setting !== undefined) {
      return setting;
    }
  }

  return null;
}

function resolveSettingLabel(
  setting: WorkbenchSettingDefinition,
  translate: AppHost["actions"]["translate"],
): string {
  if (typeof setting.labelText === "string") {
    return setting.labelText;
  }

  return setting.labelKey ? translate(setting.labelKey) : "";
}

function resolveSettingDescription(
  setting: WorkbenchSettingDefinition,
  translate: AppHost["actions"]["translate"],
): string {
  if (typeof setting.descriptionText === "string") {
    return setting.descriptionText;
  }

  return setting.descriptionKey ? translate(setting.descriptionKey) : "";
}

function renderSettingControl(options: {
  controller: WorkbenchSettingsDialogController;
  setting: WorkbenchSettingDefinition;
  t: AppHost["actions"]["translate"];
  isEditable: boolean;
  onSelectValue?: (settingId: string, value: string) => void;
  onRequestToggleDeviceAnimations?: () => void;
  onRequestToggleExperimentalFeatures?: () => void;
}) {
  const {
    controller,
    setting,
    t,
    isEditable,
    onSelectValue,
    onRequestToggleDeviceAnimations,
    onRequestToggleExperimentalFeatures,
  } = options;
  const value = controller.getValue(setting.id);

  if (setting.kind === "text" || setting.kind === "password") {
    return (
      <label className={cm(styles, "settings-dialog-text-shell")} htmlFor={`setting-${setting.id}`}>
        <input
          autoComplete="off"
          disabled={!isEditable}
          id={`setting-${setting.id}`}
          name={setting.id}
          onChange={(event) => {
            controller.updateTextValue(setting.id, event.target.value);
          }}
          placeholder={setting.placeholderText}
          type={setting.kind === "password" ? "password" : "text"}
          value={typeof value === "string" ? value : setting.defaultValue}
        />
      </label>
    );
  }

  if (setting.kind === "select") {
    return (
      <label className={cm(styles, "settings-dialog-field-shell")} htmlFor={`setting-${setting.id}`}>
        <select
          disabled={!isEditable}
          id={`setting-${setting.id}`}
          name={setting.id}
          onChange={(event) => {
            if (onSelectValue === undefined) {
              controller.updateSelectValue(setting.id, event.target.value);
              return;
            }
            onSelectValue(setting.id, event.target.value);
          }}
          value={typeof value === "string" ? value : setting.defaultValue}
        >
          {setting.options.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (setting.kind === "slider") {
    const numericValue = typeof value === "number" ? value : setting.defaultValue;

    return (
      <label className={cm(styles, "settings-dialog-slider-shell")} htmlFor={`setting-${setting.id}`}>
        <input
          disabled={!isEditable}
          id={`setting-${setting.id}`}
          max={setting.max}
          min={setting.min}
          name={setting.id}
          onChange={(event) => {
            controller.updateSliderValue(setting.id, Number(event.target.value));
          }}
          step={setting.step}
          type="range"
          value={numericValue}
        />
        <span className={cm(styles, "settings-dialog-slider-value")}>
          {numericValue}{setting.valueSuffix ?? ""}
        </span>
      </label>
    );
  }


  const checked = typeof value === "boolean" ? value : setting.defaultValue;

  return (
    <label
      className={cm(styles, isEditable
        ? "settings-dialog-switch-shell"
        : "settings-dialog-switch-shell is-disabled")}
      htmlFor={`setting-${setting.id}`}
    >
      <input
        checked={checked}
        disabled={!isEditable}
        id={`setting-${setting.id}`}
        name={setting.id}
        onChange={(event) => {
          if (setting.id === "other-experimental-features" && event.target.checked && onRequestToggleExperimentalFeatures) {
            onRequestToggleExperimentalFeatures();
            return;
          }
          if (setting.id === "game-play-device-animations" && event.target.checked && onRequestToggleDeviceAnimations) {
            onRequestToggleDeviceAnimations();
            return;
          }
          controller.updateSwitchValue(setting.id, event.target.checked);
        }}
        type="checkbox"
      />
      <span className={cm(styles, "settings-dialog-switch-track")} aria-hidden="true">
        <span className={cm(styles, "settings-dialog-switch-thumb")} />
      </span>
      <span className={cm(styles, "settings-dialog-switch-label")}>
        {t(checked ? "settingsOption.enabled" : "settingsOption.disabled")}
      </span>
    </label>
  );
}


function formatActivityTimeRange(
  startTime: number | undefined,
  endTime: number | undefined,
  t: AppHost["actions"]["translate"],
): string {
  const formatTime = (timestamp: number) => new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(timestamp);

  if (startTime !== undefined && endTime !== undefined) {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  }

  if (startTime !== undefined) {
    return `${formatTime(startTime)} ${t("activityText.from")}`;
  }

  if (endTime !== undefined) {
    return `${formatTime(endTime)} ${t("activityText.until")}`;
  }

  return t("activityText.permanent");
}

// ─── 重置确认对话框 ───

interface ConfirmResetDialogProps {
  confirmDialogState: DialogStateReadWrite;
  onCancel: () => void;
  onConfirm: () => void;
  t: AppHost["actions"]["translate"];
  titleKey?: string;
  confirmMessageKey?: string;
  confirmLabelKey?: string;
}

function ConfirmResetDialog({
  confirmDialogState,
  onCancel,
  onConfirm,
  t,
  titleKey,
  confirmMessageKey,
  confirmLabelKey,
}: ConfirmResetDialogProps) {
  const title = titleKey ? t(titleKey as Parameters<typeof t>[0]) : t("settingsAction.resetOperationAndShortcuts");
  const message = confirmMessageKey
    ? t(confirmMessageKey as Parameters<typeof t>[0])
    : t("settingsAction.resetOperationAndShortcutsConfirm");

  return (
    <DialogShell
      className="confirm-reset-dialog"
      bodyClassName={cm(styles, "confirm-reset-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="confirm-reset"
      dialogState={confirmDialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={title}
      titleId="confirm-reset-dialog-title"
    >
      <div className={cm(styles, "confirm-reset-content")}>
        <p>{message}</p>
        <div className={cm(styles, "confirm-reset-actions")}>
          <button
            className={cm(styles, "confirm-reset-cancel-btn")}
            onClick={onCancel}
            type="button"
          >
            {t("action.cancel")}
          </button>
          <button
            className={cm(styles, "confirm-reset-confirm-btn")}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabelKey === undefined
              ? t("action.confirm")
              : t(confirmLabelKey as Parameters<typeof t>[0])}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ─── 清空存储二次确认输入框 ───

interface ClearStorageInputDialogProps {
  confirmDialogState: DialogStateReadWrite;
  expectedText: string;
  inputValue: string;
  isValid: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  t: AppHost["actions"]["translate"];
  titleKey?: string;
  promptKey?: string;
  confirmButtonKey?: string;
}

function ClearStorageInputDialog({
  confirmDialogState,
  expectedText,
  inputValue,
  isValid,
  onCancel,
  onChange,
  onConfirm,
  t,
  titleKey,
  promptKey,
  confirmButtonKey,
}: ClearStorageInputDialogProps) {
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && isValid) {
      onConfirm();
    }
  }, [isValid, onConfirm]);

  return (
    <DialogShell
      className="clear-storage-input-dialog"
      bodyClassName={cm(styles, "confirm-reset-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="clear-storage-input"
      dialogState={confirmDialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={t(titleKey ?? "settingsAction.experimental-clear-storage-final-title")}
      titleId="clear-storage-input-dialog-title"
    >
      <div className={cm(styles, "confirm-reset-content")}>
        <p className={cm(styles, "clear-storage-input-prompt")}>
          {t(promptKey ?? "settingsAction.experimental-clear-storage-final-prompt")}
        </p>
        <p className={cm(styles, "clear-storage-input-expected")}>
          {expectedText}
        </p>
        <input
          autoFocus
          className={cm(styles, "clear-storage-input-field")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={expectedText}
          type="text"
          value={inputValue}
        />
        <div className={cm(styles, "confirm-reset-actions")}>
          <button
            className={cm(styles, "confirm-reset-cancel-btn")}
            onClick={onCancel}
            type="button"
          >
            {t("action.cancel")}
          </button>
          <button
            className={cm(styles, "confirm-reset-confirm-btn")}
            disabled={!isValid}
            onClick={onConfirm}
            type="button"
          >
            {t(confirmButtonKey ?? "settingsAction.experimental-clear-storage-final-confirm")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ─── 快捷键冲突对话框 ───



