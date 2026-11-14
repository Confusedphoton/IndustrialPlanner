import { completeYituliuCallback } from "@/shared/storage/yituliu-session";
import { CanvasNotices } from "./canvas/canvas-notices";
import { action, reaction, runInAction } from "mobx";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";
import { BottomStatusBar } from "@/app/shell/layout/bottom-status-bar";
import { CanvasToolRail } from "@/app/shell/canvas/canvas-tool-rail";
import { canvasToolRailState } from "@/app/shell/canvas/canvas-tool-rail-state";
import { fitCanvasViewportToBase } from "@/app/input/gesture/actions";
import { CanvasPanel } from "@/app/shell/canvas/canvas-panel";
import { CanvasFloatingToolbar } from "@/app/shell/canvas/canvas-floating-toolbar";
import { CanvasTopLeftCornerToolbar } from "@/app/shell/canvas/canvas-top-left-corner-toolbar";
import { CanvasRightDockToolbar } from "@/app/shell/canvas/canvas-right-dock-toolbar";
import { OverlapEntityMenu } from "@/app/shell/canvas/overlap-entity-menu";
import { QuickPlacePopup } from "@/app/shell/quick-place/quick-place-popup";
import { cleanupPlacementDraft } from "@/app/input";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { FullscreenToggleButton } from "@/app/shell/layout/fullscreen-toggle-button";
import { DebugLogDialog } from "@/app/shell/dialogs/debug-log-dialog";
import { FeedbackDialog } from "@/app/shell/dialogs/feedback-dialog";
import { BaseSelectDialog } from "@/app/shell/dialogs/base-select-dialog";
import { BlueprintFolderDialog } from "@/app/shell/dialogs/blueprint-folder-dialog";
import { BlueprintPreviewDialog } from "@/app/shell/dialogs/blueprint-preview-dialog";
import { HelpDialog } from "@/app/shell/dialogs/help-dialog";
import { InspectorDialog } from "@/app/shell/dialogs/inspector-dialog";
import { MobilePortraitGate } from "@/app/shell/layout/mobile-portrait-gate";
import { RecipePickerDialog } from "@/app/shell/dialogs/recipe-picker-dialog";
import { SaveBlueprintDialog } from "@/app/shell/dialogs/save-blueprint-dialog";
import { SettingsDialog } from "@/app/shell/dialogs/settings-dialog";
import { V2MigrationDialog } from "@/app/shell/dialogs/v2-migration-dialog";
import { WarehouseStatsDialog } from "@/app/shell/dialogs/warehouse-stats-dialog";
import { SyncConflictDialog } from "@/app/shell/dialogs/sync-conflict-dialog";
import { EncyclopediaPickerDialog } from "@/app/shell/encyclopedia/encyclopedia-picker-dialog";
import {
  ToolboxBottomDock,
  ToolboxDialog,
  resolveToolboxBottomDockGridHeight,
} from "@/app/shell/dialogs/toolbox-dialog";
import {
  TimelineBottomDock,
  TimelineDialog,
  resolveTimelineBottomDockGridHeight,
} from "@/app/shell/dialogs/timeline-dialog";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { PwaController } from "@/app/pwa/pwa-controller";
import { PwaGateway } from "@/app/pwa/pwa-gateway";
import { createAppTelemetryController } from "@/app/telemetry";
import LeftDock from "@/app/shell/layout/left-dock";
import { LeftToolbar } from "@/app/shell/layout/left-toolbar";
import { V2MigrationController } from "@/app/migration";
import { WorkbenchSettingsDialogController } from "@/app/shell/state/settings-dialog-state";
import { RightDock } from "@/app/shell/layout/right-dock";
import { RecipeTreeOverlay } from "@/app/shell/recipe-tree/recipe-tree-overlay";
import { DevicePopup } from "@/app/shell/canvas/device-popup";
import { recipeTreeOverlayState } from "@/app/shell/recipe-tree/recipe-tree-state";
import { SimulationControlButton, TimelineButton, TopBar } from "@/app/shell/layout/top-bar";
import {
  readSelectedSyncProvider,
  requestSyncProvider,
} from "@/shared/storage/sync-provider-activation";
import {
  SyncInitialSyncFeatureGate,
  SyncInitialSyncGate,
} from "@/app/shell/layout/sync-initial-sync-gate";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import {
  preventMiddleMousePointerDownBrowserBehavior,
  preventNativeBrowserEvent,
} from "@/app/shell/shared/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";
import {
  DARK_PIPE_LINK_TOOL,
  findDarkPipeSlotLinkForEntity,
  findRegionalDarkPipeLinkForEndpoint,
  listDarkPipeLinkCandidateEntityIds,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { DEFAULT_RIGHT_DOCK_WIDTH } from "@/app/state/state-impl";
import { resolveLeftDockWidthForScreenProfile } from "@/app/state/state-impl";
import { resolveDockLayoutBudget, resolveStackedRightColumn } from "@/app/shell/layout/dock-layout-budget";

const TOP_BAR_HEIGHT_PX = 48;
const BOTTOM_BAR_HEIGHT_PX = 28;
import { RECIPE_TREE_DOCK_MIN_WIDTH } from "@/app/shell/recipe-tree/recipe-tree-state";
import { isAppThemeId } from "@/app/theme";
import {
  FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED,
  publishDebugModeEnabled,
} from "@/shared/logging/debug-mode-runtime";
import {
  DEFAULT_WORKBENCH_LOG_LEVEL,
  setLogLevel,
} from "@/shared/logging/logger";
import {
  readBackendApiAddressOverride,
  writeBackendApiAddressOverride,
} from "@/shared/storage/backend-api-address";
import {
  isMobileOrTabletScreenProfile,
  isMobilePortraitScreenProfile,
  isTouchLandscapeScreenProfile,
  resetScreenProfileConsoleDiagnosticsForTest,
  resolveScreenProfileFromWindow,
} from "@/shared/browser/screen-profile";
import {
  resolveEffectiveCanvasTheme,
  resolveInCanvasThemeCssVariables,
} from "@/shared/theme/canvas-theme";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  loadChangelogIndexEntries,
  normalizeChangelogVersionText,
  resolveCurrentVersionChangelogKey,
} from "@/app/shell/dialogs/changelog-data";

const CHANGELOG_READ_STATE_KEY = "industrial-planner-changelog-read-state";
const LEGACY_LAST_READ_VERSION_KEY = "industrial-planner-changelog-last-read-version";

interface ChangelogReadState {
  version: string;
  changelogKey: string;
}


function normalizeStoredChangelogVersion(version: string): string {
  return normalizeChangelogVersionText(version) ?? version;
}

function isChangelogReadState(value: unknown): value is ChangelogReadState {
  return typeof value === "object"
    && value !== null
    && typeof (value as ChangelogReadState).version === "string"
    && typeof (value as ChangelogReadState).changelogKey === "string";
}

function readChangelogReadState(): ChangelogReadState | null {
  const rawState = localStorage.getItem(CHANGELOG_READ_STATE_KEY);

  if (rawState !== null) {
    try {
      const parsed: unknown = JSON.parse(rawState);

      if (isChangelogReadState(parsed)) {
        return {
          version: normalizeStoredChangelogVersion(parsed.version),
          changelogKey: parsed.changelogKey,
        };
      }
    } catch {
      // 损坏的结构化状态会回退到旧版已读版本。
    }
  }

  const legacyVersion = localStorage.getItem(LEGACY_LAST_READ_VERSION_KEY);

  if (legacyVersion === null || legacyVersion.length === 0) {
    return null;
  }

  return {
    version: normalizeStoredChangelogVersion(legacyVersion),
    changelogKey: "",
  };
}

function writeChangelogReadState(state: ChangelogReadState): void {
  localStorage.setItem(CHANGELOG_READ_STATE_KEY, JSON.stringify(state));
  localStorage.setItem(LEGACY_LAST_READ_VERSION_KEY, state.version);
}

export const WorkbenchApp = observer(function WorkbenchApp({
  appHost,
}: {
  appHost: AppHost;
}) {
  const t = appHost.actions.translate;
  const [pwaController] = useState(() => new PwaController({
    readEnabled: () => appHost.state.settings.gamePlayDeviceAnimations,
    writeEnabled: action((value) => {
      if (appHost.internalState.settings.gamePlayDeviceAnimations === value) {
        return;
      }

      appHost.internalState.settings.gamePlayDeviceAnimations = value;
    }),
  }));
  const [migrationController] = useState(() => new V2MigrationController());
  const [settingsDialog] = useState(() => new WorkbenchSettingsDialogController({
    externalBindings: {
      "system-language": {
        readValue: () => appHost.state.settings.locale,
        writeValue: (value) => {
          if (value === "zh-CN" || value === "en-US") {
            appHost.internalActions.setLocale(value);
          }
        },
      },
      "system-theme": {
        readValue: () => appHost.state.settings.themeId,
        writeValue: action((value) => {
          if (!isAppThemeId(value)) {
            return;
          }

          if (appHost.internalState.settings.themeId === value) {
            return;
          }

          appHost.internalState.settings.themeId = value;
        }),
      },
      "game-arknights-immediate-move": {
        readValue: () => appHost.state.settings.hypergryphImmediateMove,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphImmediateMove === value) {
            return;
          }

          appHost.internalState.settings.hypergryphImmediateMove = value;
        }),
      },
      "game-invert-wheel-zoom": {
        readValue: () => appHost.internalState.settings.invertWheelZoom,
        writeValue: action((value) => {
          if (typeof value === "boolean") {
            appHost.internalState.settings.invertWheelZoom = value;
          }
        }),
      },
      "game-pen-precise-input": {
        readValue: () => appHost.internalState.settings.penPreciseInput,
        writeValue: action((value) => {
          if (typeof value === "boolean") {
            appHost.internalState.settings.penPreciseInput = value;
          }
        }),
      },
      "game-quick-place": {
        readValue: () => appHost.internalState.settings.quickPlaceEnabled,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.quickPlaceEnabled === value) {
            return;
          }

          appHost.internalState.settings.quickPlaceEnabled = value;
          if (!value) {
            appHost.mainCanvas.state.runtime.quickPlace.visible = false;
            appHost.mainCanvas.state.runtime.quickPlace.anchor = null;
            appHost.mainCanvas.state.runtime.quickPlace.searchQuery = "";
            appHost.mainCanvas.state.runtime.quickPlace.openSource = null;
          }
        }),
      },
      "game-arknights-copy-while-moving": {
        readValue: () => appHost.state.settings.hypergryphCopyWhileMoving,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphCopyWhileMoving === value) {
            return;
          }

          appHost.internalState.settings.hypergryphCopyWhileMoving = value;
        }),
      },
      "game-blueprint-placement-default-continuous": {
        readValue: () => appHost.state.settings.blueprintPlacementDefaultContinuous,
        writeValue: action((value) => {
          if (typeof value === "boolean") {
            appHost.internalState.settings.blueprintPlacementDefaultContinuous = value;
          }
        }),
      },
      "game-arknights-immediate-marquee": {
        readValue: () => appHost.state.settings.hypergryphImmediateMarquee,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphImmediateMarquee === value) {
            return;
          }

          appHost.internalState.settings.hypergryphImmediateMarquee = value;
        }),
      },
      "game-arknights-allow-empty-logistics-endpoints": {
        readValue: () => appHost.state.settings.hypergryphAllowEmptyLogisticsEndpoints,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints === value) {
            return;
          }

          appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = value;
        }),
      },
      "game-arknights-auto-create-splitters-and-convergers": {
        readValue: () => appHost.state.settings.hypergryphAutoCreateSplittersAndConvergers,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (
            appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers === value
          ) {
            return;
          }

          appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = value;
        }),
      },
      "game-arknights-selection-right-dock-sync": {
        readValue: () => appHost.state.settings.hypergryphSelectionRightDockSync,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphSelectionRightDockSync === value) {
            return;
          }

          appHost.internalState.settings.hypergryphSelectionRightDockSync = value;
        }),
      },
      "game-arknights-inspector-open-on-second-click": {
        readValue: () => appHost.state.settings.hypergryphInspectorOpenOnSecondClick,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphInspectorOpenOnSecondClick === value) {
            return;
          }

          appHost.internalState.settings.hypergryphInspectorOpenOnSecondClick = value;
        }),
      },
      "game-show-hotkeys": {
        readValue: () => appHost.state.settings.gameShowHotkeys,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameShowHotkeys === value) {
            return;
          }

          appHost.internalState.settings.gameShowHotkeys = value;
        }),
      },
      "game-collapse-device-modes": {
        readValue: () => appHost.state.settings.collapseDeviceModes,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.collapseDeviceModes === value) {
            return;
          }

          appHost.internalState.settings.collapseDeviceModes = value;
        }),
      },
      "game-pipe-wall-reflection": {
        readValue: () => appHost.state.settings.gamePipeWallReflection,
        writeValue: action((value) => {
          if (typeof value === "boolean") appHost.internalState.settings.gamePipeWallReflection = value;
        }),
      },
      "game-show-pipe-exact-fluid-position": {
        readValue: () => appHost.state.settings.gameShowPipeExactFluidPosition,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameShowPipeExactFluidPosition === value) {
            return;
          }

          appHost.internalState.settings.gameShowPipeExactFluidPosition = value;
        }),
      },
      "game-show-device-names": {
        readValue: () => appHost.state.settings.gameShowDeviceNames,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameShowDeviceNames === value) {
            return;
          }

          appHost.internalState.settings.gameShowDeviceNames = value;
        }),
      },
      "game-show-device-icons": {
        readValue: () => appHost.state.settings.gameShowDeviceIcons,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseBlueprintStyleDeviceImages) {
            if (!appHost.internalState.settings.gameShowDeviceIcons) {
              appHost.internalState.settings.gameShowDeviceIcons = true;
            }

            return;
          }

          if (appHost.internalState.settings.gameShowDeviceIcons === value) {
            return;
          }

          appHost.internalState.settings.gameShowDeviceIcons = value;
        }),
      },
      "game-use-blueprint-style-device-images": {
        readValue: () => appHost.state.settings.gameUseBlueprintStyleDeviceImages,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          const shouldEnforceLinkedSettings = value
            && (
              !appHost.internalState.settings.gameAlwaysShowGridLines
              || appHost.internalState.settings.showGrassBackground
              || !appHost.internalState.settings.gameShowDeviceIcons
            );

          if (appHost.internalState.settings.gameUseBlueprintStyleDeviceImages === value
            && !shouldEnforceLinkedSettings) {
            return;
          }

          appHost.internalState.settings.gameUseBlueprintStyleDeviceImages = value;

          if (value) {
            appHost.internalState.settings.gameAlwaysShowGridLines = true;
            appHost.internalState.settings.showGrassBackground = false;
            appHost.internalState.settings.gameShowDeviceIcons = true;
          }
        }),
      },
      "game-play-device-animations": {
        readValue: () => pwaController.deviceAnimationsSettingValue,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          pwaController.setDeviceAnimationsEnabled(value);
        }),
      },
      "game-play-device-audio": {
        readValue: () => appHost.internalState.settings.gamePlayDeviceAudio,
        writeValue: action((value) => {
          if (typeof value === "boolean") appHost.internalState.settings.gamePlayDeviceAudio = value;
        }),
      },
      "game-use-inspector-panel": {
        readValue: () => appHost.state.settings.gameUseInspectorPanel,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseInspectorPanel === value) {
            return;
          }

          appHost.internalState.settings.gameUseInspectorPanel = value;
        }),
      },
      "game-always-show-grid-lines": {
        readValue: () => appHost.state.settings.gameAlwaysShowGridLines,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseBlueprintStyleDeviceImages) {
            if (!appHost.internalState.settings.gameAlwaysShowGridLines) {
              appHost.internalState.settings.gameAlwaysShowGridLines = true;
            }

            return;
          }

          if (appHost.internalState.settings.gameAlwaysShowGridLines === value) {
            return;
          }

          appHost.internalState.settings.gameAlwaysShowGridLines = value;
        }),
      },
      "game-always-show-power-range": {
        readValue: () => appHost.state.settings.gameAlwaysShowPowerRange,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameAlwaysShowPowerRange === value) {
            return;
          }

          appHost.internalState.settings.gameAlwaysShowPowerRange = value;
        }),
      },
      "game-show-grass-background": {
        readValue: () => appHost.state.settings.showGrassBackground,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseBlueprintStyleDeviceImages) {
            if (appHost.internalState.settings.showGrassBackground) {
              appHost.internalState.settings.showGrassBackground = false;
            }

            return;
          }

          if (appHost.internalState.settings.showGrassBackground === value) {
            return;
          }

          appHost.internalState.settings.showGrassBackground = value;
        }),
      },
      "game-show-region-annotations": {
        readValue: () => appHost.state.settings.showRegionAnnotations,
        writeValue: action((value) => {
          if (typeof value !== "boolean"
            || appHost.internalState.settings.showRegionAnnotations === value) {
            return;
          }

          appHost.internalState.settings.showRegionAnnotations = value;
          if (!value) {
            appHost.workspace.editor?.actions.resetRegionInteraction();
            if (appHost.mainCanvas.state.activeTool === "region-edit") {
              appHost.internalActions.setActiveTool("select");
            }
            if (appHost.internalState.runtime.activePanel === "region") {
              appHost.internalActions.setActivePanel("placement");
            }
          }
        }),
      },
      "debug-disable-cargo-entry-animation": {
        readValue: () => appHost.state.settings.debugDisableCargoEntryAnimation,
        writeValue: action((value) => {
          if (typeof value === "boolean") {
            appHost.internalState.settings.debugDisableCargoEntryAnimation = value;
          }
        }),
      },
      "debug-show-fps": {
        readValue: () => appHost.state.settings.debugShowFps,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.debugShowFps === value) {
            return;
          }

          appHost.internalState.settings.debugShowFps = value;
        }),
      },
      "debug-show-gesture-diagnostics-window": {
        readValue: () => appHost.state.settings.debugShowGestureDiagnosticsWindow,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.debugShowGestureDiagnosticsWindow === value) {
            return;
          }

          appHost.internalState.settings.debugShowGestureDiagnosticsWindow = value;
        }),
      },
      "debug-simulation-worker-detailed-report": {
        readValue: () => appHost.internalState.settings.debugSimulationWorkerDetailedReport,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.debugSimulationWorkerDetailedReport === value) {
            return;
          }

          appHost.internalState.settings.debugSimulationWorkerDetailedReport = value;
        }),
      },
      "debug-force-flatten-blueprint-version": {
        readValue: () => FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED
          && appHost.internalState.settings.debugForceFlattenBlueprintVersion,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          appHost.internalState.settings.debugForceFlattenBlueprintVersion =
            FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED && value;
        }),
      },
      "debug-backend-api-address-override": {
        readValue: () => readBackendApiAddressOverride(),
        writeValue: (value) => {
          if (typeof value === "string") {
            writeBackendApiAddressOverride(value);
          }
        },
      },
      "other-debug-mode": {
        readValue: () => appHost.state.settings.debugMode,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.debugMode === value) {
            return;
          }

          appHost.internalState.settings.debugMode = value;

          // 关闭调试模式时，同步关闭级联子选项
          if (!value) {
            appHost.internalState.settings.debugDisableCargoEntryAnimation = false;
            appHost.internalState.settings.debugShowFps = false;
            appHost.internalState.settings.debugShowGestureDiagnosticsWindow = false;
            appHost.internalState.settings.debugSimulationWorkerDetailedReport = false;
            appHost.internalState.settings.debugForceFlattenBlueprintVersion = false;
            appHost.internalState.settings.virtualMousePointer = false;
          }
        }),
      },

      "experimental-virtual-mouse-pointer": {
        readValue: () => appHost.state.settings.virtualMousePointer,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.virtualMousePointer === value) {
            return;
          }

          appHost.internalState.settings.virtualMousePointer = value;
        }),
      },
      "sync-provider": {
        readValue: () => readSelectedSyncProvider(),
        writeValue: action((value) => {
          requestSyncProvider(
            value === "webdav" || value === "cloudflare" || value === "yituliu" ? value : "none",
          );
          appHost.workspace.sync?.actions.updateSettings({});
        }),
      },
      "other-toolbox-show-all-activity-content": {
        readValue: () => appHost.internalState.settings.toolboxShowAllActivityContent,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.toolboxShowAllActivityContent === value) {
            return;
          }

          appHost.internalState.settings.toolboxShowAllActivityContent = value;
        }),
      },
    },
  }));
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const rightDockOpen = appHost.state.workbench.rightDockOpen;
  const useInspectorPanel = appHost.state.settings.gameUseInspectorPanel;
  const leftDockWidth = appHost.state.workbench.leftDockWidth;
  const topBarCollapsed = appHost.state.workbench.topBarCollapsed;
  const screenProfile = appHost.state.screenProfile;
  const activeTool = appHost.mainCanvas.state.activeTool;
  const canvasFloatingToolbar = appHost.mainCanvas.state.runtime.canvasFloatingToolbar;
  const canvasRightDockToolbar = appHost.mainCanvas.state.runtime.canvasRightDockToolbar;
  const canvasTopLeftCornerToolbar = appHost.mainCanvas.state.runtime.canvasTopLeftCornerToolbar;
  const canvasTopLeftCornerToolbarKey = `${canvasTopLeftCornerToolbar.buttonIds.join("|")}::${canvasTopLeftCornerToolbar.initialOffButtonIds.join("|")}`;
  const inspectorDialogState = appHost.internalState.workbench.dialogState.inspector;
  const timelineBottomDockGridHeight = resolveTimelineBottomDockGridHeight(appHost);
  const showTimelineBottomDock = timelineBottomDockGridHeight > 0;
  const toolboxBottomDockGridHeight = showTimelineBottomDock
    ? 0
    : resolveToolboxBottomDockGridHeight(appHost);
  const showToolboxBottomDock = toolboxBottomDockGridHeight > 0;
  const bottomDockGridHeight = showTimelineBottomDock
    ? timelineBottomDockGridHeight
    : toolboxBottomDockGridHeight;
  const selectionCount = appHost.workspace.editor?.state.collections.selection.length ?? 0;
  const openInspectorOnSecondClick = appHost.state.settings.hypergryphInspectorOpenOnSecondClick;
  const isTouchLandscape = isTouchLandscapeScreenProfile(screenProfile);
  const isTouchLayout = isMobileOrTabletScreenProfile(screenProfile);
  const isCompactLeftToolbar = isTouchLayout;
  const effectiveLeftDockWidth = resolveLeftDockWidthForScreenProfile(leftDockWidth, screenProfile);
  const showFloatingTopBarControls = isTouchLandscape && topBarCollapsed;
  const showBottomStatusBar = !showFloatingTopBarControls;
  const showMobilePortraitGate = isMobilePortraitScreenProfile(screenProfile);
  const showRightDock = useInspectorPanel && rightDockOpen;
  const leftToolbarWidth = isCompactLeftToolbar ? 51 : 68;
  const dockLayoutBudget = resolveDockLayoutBudget({
    viewportWidth: screenProfile.viewportWidth,
    leftToolbarWidth,
    leftDockWidth: leftDockOpen ? effectiveLeftDockWidth : 0,
    rightDockWidth: showRightDock ? DEFAULT_RIGHT_DOCK_WIDTH : 0,
    recipeDockWidth: recipeTreeOverlayState.dockLayoutWidth === 0 ? 0 : recipeTreeOverlayState.dockWidth,
    recipeDockMinWidth: RECIPE_TREE_DOCK_MIN_WIDTH,
    canvasReservedWidth: canvasToolRailState.width,
  });
  useEffect(() => {
    recipeTreeOverlayState.setDockWidthLimit(dockLayoutBudget.recipeDockMaxWidth);
  }, [dockLayoutBudget.recipeDockMaxWidth]);
  useEffect(() => {
    recipeTreeOverlayState.setStacked(dockLayoutBudget.stackRightDocks);
  }, [dockLayoutBudget.stackRightDocks]);
  // 右侧面板布局变化（打开、叠放、宽度变化）落定后，若选中的设备被挡住，平移让它避开面板与工具条重新可见。
  const rightLayoutSignature = `${dockLayoutBudget.rightDockWidth}|${dockLayoutBudget.recipeDockWidth}|${dockLayoutBudget.stackRightDocks}`;
  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const selection = appHost.workspace.editor?.state.collections.selection ?? [];
        const entityId = selection.length === 1 ? selection[0] : undefined;
        if (entityId === undefined) return;
        appHost.mainCanvas.keepEntityInView(entityId, {
          left: canvasToolRailState.side === "left" ? canvasToolRailState.width : 0,
          right: canvasToolRailState.side === "right" ? canvasToolRailState.width : 0,
        });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [appHost, rightLayoutSignature]);
  // 没有保存过视口的文档（新建或从未平移缩放过）首次显示时，等画布有了尺寸再把整个基地放进避开工具条的区域。
  useEffect(() => {
    const editor = appHost.workspace.editor;
    if (editor === null) return;
    const handledDocumentKeys = new Set<string>();
    let pendingDocumentKey: string | null = null;
    const fitPending = (): void => {
      const rect = appHost.mainCanvas.view.state.clientRect;
      if (pendingDocumentKey === null || rect.width <= 0 || rect.height <= 0) return;
      pendingDocumentKey = null;
      fitCanvasViewportToBase(appHost.mainCanvas, {
        left: canvasToolRailState.side === "left" ? canvasToolRailState.width : 0,
        right: canvasToolRailState.side === "right" ? canvasToolRailState.width : 0,
      });
    };
    const stopDocument = editor.document.subscribe((snapshot) => {
      if (handledDocumentKeys.has(snapshot.documentKey)) return;
      handledDocumentKeys.add(snapshot.documentKey);
      pendingDocumentKey = snapshot.documentSettings.viewport === undefined ? snapshot.documentKey : null;
      fitPending();
    });
    const stopRect = reaction(
      () => [appHost.mainCanvas.view.state.clientRect.width, appHost.mainCanvas.view.state.clientRect.height],
      fitPending,
    );
    return () => {
      stopDocument();
      stopRect();
    };
  }, [appHost]);
  const locale = appHost.state.settings.locale;
  useEffect(() => {
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
  }, [locale]);
  const stackedRightColumn = dockLayoutBudget.stackRightDocks
    ? resolveStackedRightColumn({
      columnHeight: screenProfile.viewportHeight
        - (showFloatingTopBarControls ? 0 : TOP_BAR_HEIGHT_PX)
        - (showBottomStatusBar ? BOTTOM_BAR_HEIGHT_PX : 0)
        - bottomDockGridHeight,
      recipeExtraHeight: bottomDockGridHeight,
      recipeRatio: recipeTreeOverlayState.stackRatio,
      inspectorEmpty: selectionCount === 0,
      focus: recipeTreeOverlayState.stackFocus,
    })
    : null;
  // 选中新的设备时，若右栏只能展开一栏，切到属性面板。
  const firstSelectedId = appHost.workspace.editor?.state.collections.selection[0] ?? null;
  useEffect(() => {
    if (firstSelectedId !== null) {
      recipeTreeOverlayState.setStackFocus("inspector");
    }
  }, [firstSelectedId]);
  const canKeepInspectorDialogOpen = !useInspectorPanel
    && (activeTool === "select" || activeTool === "dark-pipe-link")
    && selectionCount === 1
    && appHost.mainCanvas.state.toolInfo.darkPipeLink === null;
  const shouldAutoOpenInspectorDialog = canKeepInspectorDialogOpen && !openInspectorOnSecondClick;
  const floatingOpenRightDockLabel = `${t("action.open")} ${t("topBar.rightPanel")}`;
  const prevUseInspectorPanelRef = useRef(useInspectorPanel);
  const hasVisibleDialogShell =
    isAnyDialogShellVisible(appHost, { showTimelineBottomDock, showToolboxBottomDock })
    || migrationController.dialogState.visible;
  const effectiveCanvasTheme = resolveEffectiveCanvasTheme(
    appHost.state.theme,
    appHost.state.settings.gameUseBlueprintStyleDeviceImages,
    appHost.state.settings.showGrassBackground,
  );

  useEffect(() => {
    const unlock = (event: Event) => {
      if (event.isTrusted) appHost.workspace.audio?.actions.unlock();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("click", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("click", unlock);
    };
  }, [appHost]);
  useEffect(() => {
    void completeYituliuCallback().catch(() => {
      // 回调窗口关闭后，由发起窗口展示登录失败，避免记录授权码或令牌。
    });
  }, []);

  useEffect(() => pwaController.bindDeviceAudio(() => appHost.internalState.settings.gamePlayDeviceAudio), [appHost, pwaController]);

  useEffect(() => {
    migrationController.initialize();
  }, [migrationController]);

  useEffect(() => {
    const editor = appHost.workspace.editor;
    if (editor === null) return;
    return appHost.portPriorityDefaults.bind(editor);
  }, [appHost]);



  useEffect(() => {
    const editor = appHost.workspace.editor;
    if (editor === null) return;
    let currentBaseId = editor.document.getSnapshot().baseId;
    return editor.document.subscribe((document) => {
      if (document.baseId === currentBaseId) return;
      currentBaseId = document.baseId;
      if (appHost.mainCanvas.state.activeTool === "single-placement") {
        const deviceId = appHost.mainCanvas.state.runtime.singlePlacementDeviceId;
        const definition = appHost.workspace.registry.entityDefinitions.find((entry) => entry.id === deviceId);
        if (definition === undefined || !canPlaceEntityDefinitionInCurrentBase(appHost.mainCanvas, definition)) {
          cleanupPlacementDraft(appHost.mainCanvas);
          appHost.internalActions.setActiveTool("select");
        }
      }
      const selection = appHost.mainCanvas.state.toolInfo.darkPipeLink;
      if (selection === null) return;

      const sourceBase = appHost.workspace.registry.baseDefinitions.find(
        (base) => base.id === selection.sourceBaseId,
      );
      const targetBase = appHost.workspace.registry.baseDefinitions.find(
        (base) => base.id === document.baseId,
      );
      if (
        sourceBase === undefined
        || targetBase === undefined
        || sourceBase.id !== targetBase.id
      ) {
        appHost.internalActions.setActiveTool(
          selection.returnTool === DARK_PIPE_LINK_TOOL ? "select" : selection.returnTool,
        );
        return;
      }

      const sourceEntity = document.entities[selection.sourceEntityId];
      if (document.baseId === selection.sourceBaseId && sourceEntity === undefined) {
        appHost.internalActions.setActiveTool("select");
        return;
      }
      const candidateEntityIds = sourceEntity !== undefined && document.baseId === selection.sourceBaseId
        ? listDarkPipeLinkCandidateEntityIds({ document, sourceEntity })
        : document.entityOrder.filter((entityId) => {
            const entity = document.entities[entityId];
            return entity !== undefined
              && resolveDarkPipeRole(entity.definitionId) === (selection.sourceRole === "inlet" ? "outlet" : "inlet")
              && findDarkPipeSlotLinkForEntity(document, entityId) === null
              && findRegionalDarkPipeLinkForEndpoint(editor.queries.getRegionalDarkPipeLinks(), { baseId: document.baseId, entityId }) === null;
          });
      runInAction(() => {
        appHost.mainCanvas.state.toolInfo.darkPipeLink = { ...selection, candidateEntityIds };
      });
    });
  }, [appHost]);

  useEffect(() => {
    const telemetryController = createAppTelemetryController({
      readScreenProfile: () => appHost.state.screenProfile,
    });

    return () => {
      telemetryController.dispose();
    };
  }, [appHost]);

  // 版本检测：新版本自动弹出帮助对话框并切换到"版本更新"tab
  useEffect(() => {
    const currentVersionText = (window as { __APP_VERSION__?: string }).__APP_VERSION__;

    if (currentVersionText === undefined || currentVersionText === "0.0.0-dev") {
      return;
    }

    const currentVersion = normalizeChangelogVersionText(currentVersionText);

    if (currentVersion === null) {
      return;
    }

    const currentVersionKey = currentVersion;
    let lastReadState: ChangelogReadState | null;

    try {
      lastReadState = readChangelogReadState();
    } catch {
      return;
    }

    let cancelled = false;

    async function checkChangelogAnnouncement() {
      try {
        const entries = await loadChangelogIndexEntries();

        if (cancelled) {
          return;
        }

        const currentChangelogKey = resolveCurrentVersionChangelogKey(entries, currentVersionText);

        if (currentChangelogKey === null) {
          return;
        }

        const versionChanged = lastReadState?.version !== currentVersionKey;
        const changelogChanged = lastReadState?.changelogKey !== currentChangelogKey;

        if (!versionChanged || !changelogChanged) {
          return;
        }

        // 记录已读版本
        try {
          writeChangelogReadState({
            version: currentVersionKey,
            changelogKey: currentChangelogKey,
          });
        } catch {
          // 静默忽略
        }

        if (screenProfile.deviceClass !== "mobile") {
          // 计算 80% 屏幕宽高
          const width = Math.floor(window.innerWidth * 0.8);
          const height = Math.floor(window.innerHeight * 0.8);

          appHost.internalActions.setDialogSize("help", width, height);
        }

        appHost.internalActions.setDialogTab("help", "version");
        appHost.internalActions.openDialog("help");
      } catch {
        // 更新日志索引不可用时不自动弹出，避免误判为已读。
      }
    }

    void checkChangelogAnnouncement();

    return () => {
      cancelled = true;
    };
  }, [appHost, screenProfile.deviceClass]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleViewportChange = () => {
      appHost.internalActions.setScreenProfile(resolveScreenProfileFromWindow());
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    handleViewportChange();

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
    };
  }, [appHost]);


  useEffect(() => {
    publishDebugModeEnabled(appHost.state.settings.debugMode);
    if (!appHost.state.settings.debugMode) {
      setLogLevel(DEFAULT_WORKBENCH_LOG_LEVEL);
      if (appHost.internalState.workbench.dialogState["debug-log"]?.visible) {
        appHost.internalActions.closeDialog("debug-log");
      }
      return;
    }

    setLogLevel("debug", { announce: true });

    // 调试模式刚启用时重放一次初始 profile，确保它进入持久化日志。
    resetScreenProfileConsoleDiagnosticsForTest();
    resolveScreenProfileFromWindow();
  }, [appHost, appHost.state.settings.debugMode]);


  useEffect(() => {
    if (!hasVisibleDialogShell) {
      return;
    }

    appHost.gestureAdapter.handleBlur();
  }, [appHost, hasVisibleDialogShell]);

  useEffect(() => {

    const handleWindowKeyDown = (event: KeyboardEvent) => {

      const inspectorDialogState = appHost.internalState.workbench.dialogState.inspector;
      const isInspectorDialogVisible = inspectorDialogState?.visible === true;
      if (hasVisibleDialogShell && !isInspectorDialogVisible) {
        return;
      }


      if (isEditableKeyboardTarget(event)) {
        return;
      }

      if (appHost.gestureAdapter.handleKeyDown(event) && event.cancelable) {
        event.preventDefault();
        return;
      }

      // 即使 gesture module 未消费，只要匹配任意已配置快捷键就拦截浏览器默认行为
      // （例如 Ctrl+S 在非多选状态下仍应阻止浏览器保存网页对话框）
      // 订正（2026-08-30）：匹配范围收敛为当前输入层和 activeTool 中声明按键所有权的 Route。
      if (event.cancelable && appHost.gestureActionRouter.claimsBrowserDefaultForKeyboardEvent({
        type: "key down",
        code: event.code,
        key: event.key,
        keyCode: event.keyCode,
        modifiers: {
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          meta: event.metaKey,
        },
        sourceEvent: event,
      })) {
        event.preventDefault();
      }
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      const inspectorDialogState = appHost.internalState.workbench.dialogState.inspector;
      if (hasVisibleDialogShell && inspectorDialogState?.visible !== true) {
        return;
      }

      if (isEditableKeyboardTarget(event)) {
        return;
      }

      if (appHost.gestureAdapter.handleKeyUp(event) && event.cancelable) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("keyup", handleWindowKeyUp);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("keyup", handleWindowKeyUp);
    };
  }, [appHost, hasVisibleDialogShell]);

  useEffect(() => {
    const prev = prevUseInspectorPanelRef.current;
    prevUseInspectorPanelRef.current = useInspectorPanel;

    if (useInspectorPanel) {
      if (inspectorDialogState.visible) {
        appHost.internalActions.closeDialog("inspector");
      }

      return;
    }

    if (rightDockOpen) {
      // 初始渲染时 rightDockOpen 默认 true，此时应保留选中以允许 auto-open inspector。
      // 用户主动关掉"使用面板"时，清除选中，避免"有选中但无 inspector"的中间态。
      appHost.internalActions.setRightDockOpen(false, { preserveSingleSelection: !prev });
    }
  }, [appHost, inspectorDialogState.visible, rightDockOpen, useInspectorPanel]);

  useEffect(() => {
    if (useInspectorPanel) {
      return;
    }

    if (shouldAutoOpenInspectorDialog) {
      if (!inspectorDialogState.visible) {
        appHost.internalActions.openDialog("inspector");
      }

      return;
    }

    if (!canKeepInspectorDialogOpen && inspectorDialogState.visible) {
      appHost.internalActions.closeDialog("inspector");
    }
  }, [
    appHost,
    canKeepInspectorDialogOpen,
    inspectorDialogState.visible,
    shouldAutoOpenInspectorDialog,
    useInspectorPanel,
  ]);


  const workbenchStyle = {
    ...resolveInCanvasThemeCssVariables(effectiveCanvasTheme),
    "--left-toolbar-width": `${leftToolbarWidth}px`,
    "--left-dock-width": `${dockLayoutBudget.leftDockWidth}px`,
    "--right-dock-width": `${dockLayoutBudget.rightDockWidth}px`,
    // 配方树停靠栏占用最右侧一列。
    "--recipe-dock-width": `${dockLayoutBudget.recipeDockWidth}px`,
    "--right-stack-top": `${1 - (stackedRightColumn?.mode === "split" ? stackedRightColumn.recipeRatio : 0.5)}fr`,
    "--right-stack-bottom": `${stackedRightColumn?.mode === "split" ? stackedRightColumn.recipeRatio : 0.5}fr`,
    "--canvas-tool-rail-width": canvasToolRailState.side === "left" ? `${canvasToolRailState.width}px` : "0px",
    "--canvas-tool-rail-right-width": canvasToolRailState.side === "right" ? `${canvasToolRailState.width}px` : "0px",
    "--top-bar-height": showFloatingTopBarControls ? "0px" : `${TOP_BAR_HEIGHT_PX}px`,
    "--bottom-bar-height": showBottomStatusBar ? `${BOTTOM_BAR_HEIGHT_PX}px` : "0px",
    "--toolbox-bottom-dock-height": `${bottomDockGridHeight}px`,
    "--canvas-bottom-obstruction-height": "calc(var(--bottom-bar-height, 28px) + var(--toolbox-bottom-dock-height, 0px))",
  } as CSSProperties;

  return (
    <div
      className={cm(styles, [
        "workbench",
        stackedRightColumn === null ? "" : "is-right-stacked",
        stackedRightColumn?.mode === "single" ? `is-stack-${stackedRightColumn.expanded}-only` : "",
      ].filter(Boolean).join(" "))}
      onAuxClick={preventNativeBrowserEvent}
      onContextMenu={preventNativeBrowserEvent}
      onDragStart={preventNativeBrowserEvent}
      onPointerDownCapture={preventMiddleMousePointerDownBrowserBehavior}
      style={workbenchStyle}
    >
      <OverlayStackProvider suspendBackground={appHost.mainCanvas.suspend}>
        <TopBar
          appHost={appHost}
          isStandalone={pwaController.standalone}
          onFullscreenActionFailure={pwaController.openFullscreenNotice}
        />
        <LeftToolbar appHost={appHost} compact={isCompactLeftToolbar} />
        <LeftDock appHost={appHost} hidden={!leftDockOpen} />
        {leftDockOpen
          && (appHost.internalState.runtime.activePanel ?? "placement") === "blueprint"
          && appHost.workspace.sync !== null ? (
            <SyncInitialSyncFeatureGate
              className="sync-initial-sync-feature-gate-left-dock"
              feature="blueprints"
              state={appHost.workspace.sync.state}
              translate={appHost.actions.translate}
            />
          ) : null}
        <CanvasPanel appHost={appHost} />
        <CanvasNotices
          state={appHost.mainCanvas.state.runtime}
          translate={appHost.actions.translate}
          screenProfile={appHost.state.screenProfile}
        />
        {showFloatingTopBarControls ? (
          <div className={cm(styles, "workbench-floating-top-bar-controls")}>
            <SimulationControlButton
              appHost={appHost}
              className={cm(styles, "workbench-floating-top-bar-button")}
            />
            <TimelineButton
              appHost={appHost}
              className={cm(styles, "workbench-floating-top-bar-button")}
            />
            <FullscreenToggleButton
              appHost={appHost}
              className={cm(
                styles,
                "workbench-floating-top-bar-button workbench-floating-fullscreen-button",
              )}
              isStandalone={pwaController.standalone}
              onFullscreenActionFailure={pwaController.openFullscreenNotice}
            />
            {useInspectorPanel && !rightDockOpen ? (
              <button
                aria-label={floatingOpenRightDockLabel}
                className={cm(
                  styles,
                  "workbench-floating-top-bar-button workbench-floating-right-dock-button",
                )}
                onClick={appHost.internalActions.toggleRightDock}
                title={floatingOpenRightDockLabel}
                type="button"
              >
                <span className={cm(styles, "top-bar-toggle-icon")}>
                  <WorkbenchIcon kind="panel-right-open" />
                </span>
                <span className={cm(styles, "sr-only")}>
                  {floatingOpenRightDockLabel}
                </span>
              </button>
            ) : null}
            <button
              aria-label={`${t("action.expand")} ${t("topBar.controls")}`}
              className={cm(
                styles,
                "workbench-floating-top-bar-button workbench-floating-top-bar-toggle",
              )}
              onClick={appHost.internalActions.toggleTopBarCollapsed}
              title={`${t("action.expand")} ${t("topBar.controls")}`}
              type="button"
            >
              <span className={cm(styles, "top-bar-toggle-icon")}>
                <WorkbenchIcon kind="panel-top-open" />
              </span>
              <span className={cm(styles, "sr-only")}>
                {`${t("action.expand")} ${t("topBar.controls")}`}
              </span>
            </button>
          </div>
        ) : null}
        <OverlapEntityMenu appHost={appHost} />
        <DevicePopup appHost={appHost} />
        <QuickPlacePopup appHost={appHost} />
        <CanvasToolRail appHost={appHost} />
        {canvasTopLeftCornerToolbar.visible && canvasTopLeftCornerToolbar.buttonIds.length > 0 ? (
          <CanvasTopLeftCornerToolbar
            canvas={appHost.mainCanvas}
            buttonIds={canvasTopLeftCornerToolbar.buttonIds}
            initialOffButtonIds={canvasTopLeftCornerToolbar.initialOffButtonIds}
            key={canvasTopLeftCornerToolbarKey}
          />
        ) : null}
        {canvasFloatingToolbar.visible && canvasFloatingToolbar.anchor !== null && canvasFloatingToolbar.buttonIds.length > 0 ? (
          <CanvasFloatingToolbar
            anchor={canvasFloatingToolbar.anchor}
            canvas={appHost.mainCanvas}
            buttonIds={canvasFloatingToolbar.buttonIds}
          />
        ) : null}
        {canvasRightDockToolbar.visible && canvasRightDockToolbar.items.length > 0 ? (
          <CanvasRightDockToolbar
            canvas={appHost.mainCanvas}
            items={canvasRightDockToolbar.items}
          />
        ) : null}
        {showRightDock ? <RightDock appHost={appHost} /> : null}
        <RecipeTreeOverlay appHost={appHost} />
        {showToolboxBottomDock ? <ToolboxBottomDock appHost={appHost} /> : null}
        {showTimelineBottomDock ? <TimelineBottomDock appHost={appHost} /> : null}
        {showBottomStatusBar ? <BottomStatusBar appHost={appHost} /> : null}
        {appHost.state.settings.debugMode ? <DebugLogDialog appHost={appHost} /> : null}
        <BaseSelectDialog appHost={appHost} />
        <BlueprintFolderDialog appHost={appHost} controller={appHost.blueprintFolderDialog} />
        <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
        <InspectorDialog appHost={appHost} />
        <SaveBlueprintDialog appHost={appHost} />
        <ToolboxDialog appHost={appHost} />
        <TimelineDialog appHost={appHost} />
        <WarehouseStatsDialog appHost={appHost} />
        <EncyclopediaPickerDialog appHost={appHost} />
        <RecipePickerDialog appHost={appHost} />
        <HelpDialog appHost={appHost} />
        <FeedbackDialog appHost={appHost} />
        <SettingsDialog
          appHost={appHost}
          controller={settingsDialog}
          migrationController={migrationController}
          pwaController={pwaController}
        />
        <V2MigrationDialog appHost={appHost} controller={migrationController} />
        <PwaGateway appHost={appHost} pwaController={pwaController} />
        {appHost.workspace.sync === null ? null : (
          <SyncInitialSyncGate
            sync={appHost.workspace.sync}
            translate={appHost.actions.translate}
          />
        )}
        {appHost.workspace.sync === null ? null : (
          <SyncConflictDialog
            appHost={appHost}
            compactMobileLayout={appHost.state.screenProfile.deviceClass !== "desktop"}
            onStopSync={() => {
              requestSyncProvider("none");
              appHost.workspace.sync?.actions.updateSettings({});
            }}
            sync={appHost.workspace.sync}
            t={appHost.actions.translate}
          />
        )}
        {showMobilePortraitGate ? (
          <MobilePortraitGate
            appHost={appHost}
            isStandalone={pwaController.standalone}
            onFullscreenActionFailure={pwaController.openFullscreenNotice}
          />
        ) : null}
      </OverlayStackProvider>
    </div>
  );
});

function isAnyDialogShellVisible(
  appHost: AppHost,
  options: { showTimelineBottomDock: boolean; showToolboxBottomDock: boolean },
): boolean {
  return Object.entries(appHost.internalState.workbench.dialogState).some(
    ([dialogKey, dialogState]) => {
      if (dialogKey === "debug-log" && !appHost.state.settings.debugMode) {
        return false;
      }

      if (dialogKey === "toolbox" && options.showToolboxBottomDock) {
        return false;
      }

      if (dialogKey === "timeline" && options.showTimelineBottomDock) {
        return false;
      }

      return dialogState?.visible === true;
    },
  )
    || appHost.encyclopediaPicker.dialogState.visible
    || appHost.recipePicker.dialogState.visible
    || appHost.blueprintFolderDialog.dialogState.visible
    || appHost.blueprintPreview.dialogState.visible;
}

function isEditableKeyboardTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }

  const tagName = target.tagName?.toLowerCase() ?? '';

  if (tagName === 'input' || tagName === 'textarea') {
    return true;
  }

  if ((target as HTMLElement).isContentEditable === true) {
    return true;
  }

  if (typeof (target as HTMLElement).closest === 'function') {
    return (target as HTMLElement).closest(
      "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']",
    ) !== null;
  }

  return false;
}
