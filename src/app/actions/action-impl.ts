import type { CanvasInteractionController } from "../canvas";
import type { UiKey } from "@/shared/i18n";
import { action } from "mobx";

import type { AppAction } from "@/domain/app/app-action";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { ScreenProfile } from "@/domain/app/types/screen-profile";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { RightDockTabId } from "@/domain/app/types/app-types";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import type { AppLocale } from "@/domain/app";
import { lookupText } from "@/shared/i18n";
import { isMobileOrTabletScreenProfile } from "@/shared/browser/screen-profile";
import type { KeyboardShortcutManager, ShortcutEventModifiers } from "./keyboard-shortcut-manager";

import type { ActiveTool } from "@/domain/app/types/app-types";
import {
  type CanvasFloatingToolbarButtonId,
  type CanvasFloatingToolbarSize,
  type CanvasRightDockToolbarItemRequest,
  clampLeftDockWidth,
  clampTimelineBottomDockHeight,
  clampToolboxBottomDockHeight,
  createDefaultDialogStateForKey,
  DIALOG_KEYS,
  type DialogKey,
  HELP_DIALOG_TAB_IDS,
  resolveDefaultDialogTabId,
  TOOLBOX_DIALOG_TAB_IDS,
  type ActivePanel,
  type TimelineDockPreference,
  type ToolboxDockPreference,
  type UiStateReadWrite,
} from "../state/state-impl";


// DialogShell 默认最大尺寸（对应 dialog-shell.module.scss 中 .dialog-shell 的 width/height）
const DIALOG_DEFAULT_MAX_WIDTH = 980;
const DIALOG_DEFAULT_MAX_HEIGHT = 620;
// dialog-shell-header padding: 12px top + ~20px content + 12px bottom + 1px border ≈ 44px
const DIALOG_HEADER_HEIGHT = 44;
// 标题栏水平至少露出 1/3
const DIALOG_TITLE_BAR_MIN_VISIBLE_RATIO = 1 / 3;

/**
 * 根据对话框在视口中的实际屏幕坐标 clamp offset。
 * backdrop 使用 flex 居中，dialog 在此基础上叠加 transform: translate(offsetX, offsetY)。
 * 限制：
 * 1. 标题栏上下始终在屏幕内
 * 2. 标题栏宽度至少 1/3 可见
 */
function clampDialogOffset(
  offsetX: number,
  offsetY: number,
  effectiveWidth: number,
  effectiveHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const centerLeft = (viewportWidth - effectiveWidth) / 2;
  const centerTop = (viewportHeight - effectiveHeight) / 2;

  let actualLeft = centerLeft + offsetX;
  let actualTop = centerTop + offsetY;

  // 约束 1：标题栏高度始终在屏幕内
  actualTop = Math.max(0, Math.min(actualTop, viewportHeight - DIALOG_HEADER_HEIGHT));

  // 约束 2：标题栏至少 1/3 宽度可见
  const minLeft = (-1 + DIALOG_TITLE_BAR_MIN_VISIBLE_RATIO) * effectiveWidth;
  const maxLeft = viewportWidth - DIALOG_TITLE_BAR_MIN_VISIBLE_RATIO * effectiveWidth;
  actualLeft = Math.max(minLeft, Math.min(actualLeft, maxLeft));

  return { x: Math.round(actualLeft - centerLeft), y: Math.round(actualTop - centerTop) };
}

export interface AppInternalAction {
  showCanvasToast: (messageKey: UiKey) => void;
  setCanvasAlert: (messageKey: UiKey | null) => void;
  toggleLeftDock: () => void;
  toggleRightDock: () => void;
  setRightDockOpen: (open: boolean, options?: { preserveSingleSelection?: boolean }) => void;
  toggleTopBarCollapsed: () => void;
  setRightDockActiveTab: (tabId: RightDockTabId) => void;
  openDialog: (request: string) => void;
  closeDialog: (dialogKey: string) => void;
  toggleDialogMaximized: (dialogKey: string) => void;
  setDialogTab: (dialogKey: string, tabId: string) => void;
  setDialogOffset: (dialogKey: string, offsetX: number, offsetY: number) => void;
  setDialogSize: (dialogKey: string, width: number | null, height: number | null) => void;
  setToolboxDockPreference: (preference: ToolboxDockPreference) => void;
  startNewProductionPlanning: () => void;
  setToolboxBottomDockCollapsed: (collapsed: boolean) => void;
  setToolboxBottomDockHeight: (height: number) => void;
  setTimelineDockPreference: (preference: TimelineDockPreference) => void;
  setTimelineBottomDockCollapsed: (collapsed: boolean) => void;
  setTimelineBottomDockHeight: (height: number) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setActiveTool: (activeTool: ActiveTool) => void;
  showCanvasFloatingToolbar: (
    buttonIds: readonly CanvasFloatingToolbarButtonId[],
    clientPixelPoint: ClientPixelPoint,
  ) => void;
  showCanvasFloatingToolbarForCollection: (
    buttonIds: readonly CanvasFloatingToolbarButtonId[],
    collectionType: EntityCollectionType,
  ) => boolean;
  moveCanvasFloatingToolbar: (clientPixelPoint: ClientPixelPoint) => void;
  alignCanvasFloatingToolbar: () => boolean;
  setCanvasFloatingToolbarSize: (size: CanvasFloatingToolbarSize | null) => void;
  hideCanvasFloatingToolbar: () => void;
  showCanvasRightDockToolbar: (
    items: readonly CanvasRightDockToolbarItemRequest[],
  ) => void;
  hideCanvasRightDockToolbar: () => void;
  setLeftDockWidth: (width: number) => void;
  setScreenProfile: (screenProfile: ScreenProfile) => void;
  setLocale: (locale: AppLocale) => void;
  getKeyboardShortcutFor: (key: string) => string;
  isShortcutFor: (
    key: string,
    code: string | null,
    eventKey?: string | null,
    modifiers?: ShortcutEventModifiers,
  ) => boolean;
  matchesAnyShortcut: (
    code: string | null,
    eventKey?: string | null,
    modifiers?: ShortcutEventModifiers,
  ) => boolean;
  setShortcutFor: (key: string, value: string) => void;
  resetAllShortcutsToDefaults: () => void;
}

export class AppActionImpl implements AppAction, AppInternalAction {



  public readonly showCanvasToast: AppInternalAction["showCanvasToast"] = (...args: Parameters<AppInternalAction["showCanvasToast"]>) => this.canvas.actions.showCanvasToast(...args);

  public readonly setCanvasAlert: AppInternalAction["setCanvasAlert"] = (...args: Parameters<AppInternalAction["setCanvasAlert"]>) => this.canvas.actions.setCanvasAlert(...args);

  public readonly dispose = (...args: []) => this.canvas.actions.dispose(...args);


  public constructor(
    private readonly internalState: UiStateReadWrite,
    private readonly workspace: WorkspaceContract,
    private readonly shortcutManager: KeyboardShortcutManager,
    private readonly canvas: CanvasInteractionController,
  ) {}

  public readonly translate: AppAction["translate"] = (key) => {
    const locale = this.internalState.settings.locale;

    return lookupText(locale, key) ?? key;
  };

  public readonly toggleLeftDock: AppInternalAction["toggleLeftDock"] = action(() => {
    this.setLeftDockOpen(!this.internalState.workbench.leftDockOpen);
  });

  public readonly toggleRightDock: AppInternalAction["toggleRightDock"] = action(() => {
    this.setRightDockOpen(!this.internalState.workbench.rightDockOpen);
  });

  public readonly setRightDockOpen: AppInternalAction["setRightDockOpen"] = action((open, options = {}) => {
    if (this.internalState.workbench.rightDockOpen === open) {
      return;
    }

    if (!open && !options.preserveSingleSelection) {
      this.clearSingleSelectionForRightDockClose();
    }

    this.internalState.workbench.rightDockOpen = open;
  });

  public readonly toggleTopBarCollapsed: AppInternalAction["toggleTopBarCollapsed"] = action(() => {
    this.internalState.workbench.topBarCollapsed = !this.internalState.workbench.topBarCollapsed;
  });

  public readonly setRightDockActiveTab: AppInternalAction["setRightDockActiveTab"] = action((tabId) => {
    if (this.internalState.workbench.rightDockActiveTab === tabId) {
      return;
    }

    this.internalState.workbench.rightDockActiveTab = tabId;
  });

  private clearSingleSelectionForRightDockClose(): void {
    if (
      this.canvas.state.activeTool !== "select"
    ) {
      return;
    }

    const editor = this.workspace.editor;
    if (editor === null || editor.state.collections.selection.length !== 1) {
      return;
    }

    editor.actions.clearCollection(EntityCollectionType.selection);
    this.hideCanvasFloatingToolbar();
  }

  public readonly openDialog: AppInternalAction["openDialog"] = action((request) => {
    const target = normalizeDialogRequest(request);

    if (target === null) {
      return;
    }

    if (target.dialogKey === "debug-log" && !this.internalState.settings.debugMode) {
      return;
    }

    const dialogState = this.ensureDialogState(target.dialogKey);

    // 兜底：窗口尺寸变化后 clamp
    if (!dialogState.maximized) {
      const effectiveWidth = Math.min(
        dialogState.width ?? Math.min(DIALOG_DEFAULT_MAX_WIDTH, window.innerWidth),
        window.innerWidth,
      );
      const effectiveHeight = Math.min(
        dialogState.height ?? Math.min(DIALOG_DEFAULT_MAX_HEIGHT, window.innerHeight),
        window.innerHeight,
      );
      const clamped = clampDialogOffset(
        dialogState.offsetX,
        dialogState.offsetY,
        effectiveWidth,
        effectiveHeight,
        window.innerWidth,
        window.innerHeight,
      );
      if (clamped.x !== dialogState.offsetX || clamped.y !== dialogState.offsetY) {
        console.debug(
          `[DialogOffset] open clamp ${target.dialogKey}: (${dialogState.offsetX}, ${dialogState.offsetY}) → (${clamped.x}, ${clamped.y})`,
        );
        dialogState.offsetX = clamped.x;
        dialogState.offsetY = clamped.y;
      }
    }

    dialogState.visible = true;

    if (target.dialogKey === "toolbox") {
      this.internalState.workbench.toolbox.bottomDockCollapsed = false;
      if (this.internalState.workbench.toolbox.dockPreference === "bottom") {
        this.internalState.workbench.dialogState.timeline.visible = false;
        this.workspace.simulation?.actions.disableTimeline();
      }
    }

    if (target.dialogKey === "timeline") {
      this.internalState.workbench.timelineBottomDockCollapsed = false;
      void this.workspace.simulation?.actions.enableTimeline();
      if (
        this.internalState.workbench.timelineDockPreference === "bottom"
        || this.internalState.screenProfile.deviceClass === "mobile"
      ) {
        this.internalState.workbench.dialogState.toolbox.visible = false;
      }
    }

    if (target.tabId !== null) {
      const nextTab = normalizeDialogTab(target.dialogKey, target.tabId);

      if (nextTab !== null) {
        dialogState.activeTab = nextTab;
      }
    } else if (dialogState.activeTab === null) {
      dialogState.activeTab = resolveDefaultDialogTabId(target.dialogKey);
    }
  });

  public readonly closeDialog: AppInternalAction["closeDialog"] = action((dialogKey) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (normalizedDialogKey === null) {
      return;
    }

    this.ensureDialogState(normalizedDialogKey).visible = false;
    if (normalizedDialogKey === "timeline") {
      this.workspace.simulation?.actions.disableTimeline();
    }
  });

  public readonly toggleDialogMaximized: AppInternalAction["toggleDialogMaximized"] = action((dialogKey) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (normalizedDialogKey === null) {
      return;
    }

    const dialogState = this.ensureDialogState(normalizedDialogKey);

    if (!dialogState.visible) {
      return;
    }

    dialogState.maximized = !dialogState.maximized;
  });

  public readonly setDialogTab: AppInternalAction["setDialogTab"] = action((dialogKey, tabId) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (normalizedDialogKey === null) {
      return;
    }

    const nextTab = normalizeDialogTab(normalizedDialogKey, tabId);

    if (nextTab === null) {
      return;
    }

    const dialogState = this.ensureDialogState(normalizedDialogKey);

    if (dialogState.activeTab === nextTab) {
      return;
    }

    dialogState.activeTab = nextTab;
  });

  public readonly setDialogOffset: AppInternalAction["setDialogOffset"] = action((dialogKey, offsetX, offsetY) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (
      normalizedDialogKey === null
      || !Number.isFinite(offsetX)
      || !Number.isFinite(offsetY)
    ) {
      return;
    }

    const dialogState = this.ensureDialogState(normalizedDialogKey);

    const effectiveWidth = Math.min(
      dialogState.width ?? Math.min(DIALOG_DEFAULT_MAX_WIDTH, window.innerWidth),
      window.innerWidth,
    );
    const effectiveHeight = Math.min(
      dialogState.height ?? Math.min(DIALOG_DEFAULT_MAX_HEIGHT, window.innerHeight),
      window.innerHeight,
    );
    const clamped = clampDialogOffset(
      Math.round(offsetX),
      Math.round(offsetY),
      effectiveWidth,
      effectiveHeight,
      window.innerWidth,
      window.innerHeight,
    );
    const prevOffsetX = dialogState.offsetX;
    const prevOffsetY = dialogState.offsetY;
    dialogState.offsetX = clamped.x;
    dialogState.offsetY = clamped.y;
    if (prevOffsetX !== clamped.x || prevOffsetY !== clamped.y) {
      console.debug(
        `[DialogOffset] set ${normalizedDialogKey} offset: (${prevOffsetX}, ${prevOffsetY}) → (${clamped.x}, ${clamped.y})`,
      );
    }
  });

  public readonly setDialogSize: AppInternalAction["setDialogSize"] = action((dialogKey, width, height) => {
    const normalizedDialogKey = normalizeDialogKey(dialogKey);

    if (normalizedDialogKey === null) {
      return;
    }

    const dialogState = this.ensureDialogState(normalizedDialogKey);

    if (width !== null && (!Number.isFinite(width) || width <= 0)) {
      return;
    }

    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      return;
    }

    dialogState.width = width === null ? null : Math.round(width);
    dialogState.height = height === null ? null : Math.round(height);
  });

  public readonly setToolboxDockPreference: AppInternalAction["setToolboxDockPreference"] = action((preference) => {
    if (this.internalState.workbench.toolbox.dockPreference === preference) {
      return;
    }

    this.internalState.workbench.toolbox.dockPreference = preference;
    this.internalState.workbench.toolbox.bottomDockCollapsed = false;

    if (preference === "bottom") {
      this.internalState.workbench.dialogState.toolbox.maximized = false;
      this.internalState.workbench.dialogState.timeline.visible = false;
      this.workspace.simulation?.actions.disableTimeline();
    }
  });

  public readonly startNewProductionPlanning: AppInternalAction["startNewProductionPlanning"] = action(() => {
    this.internalState.runtime.productionPlanningNewSessionRequested = true;
    this.setDialogTab("toolbox", "production-planning");
    this.setToolboxBottomDockCollapsed(false);
    this.openDialog("toolbox");
  });

  public readonly setToolboxBottomDockCollapsed: AppInternalAction["setToolboxBottomDockCollapsed"] = action((collapsed) => {
    if (this.internalState.workbench.toolbox.bottomDockCollapsed === collapsed) {
      return;
    }

    this.internalState.workbench.toolbox.bottomDockCollapsed = collapsed;
  });

  public readonly setToolboxBottomDockHeight: AppInternalAction["setToolboxBottomDockHeight"] = action((height) => {
    if (!Number.isFinite(height)) {
      return;
    }

    this.internalState.workbench.toolbox.bottomDockHeight = clampToolboxBottomDockHeight(height);
  });

  public readonly setTimelineDockPreference: AppInternalAction["setTimelineDockPreference"] = action((preference) => {
    if (this.internalState.workbench.timelineDockPreference === preference) {
      return;
    }

    this.internalState.workbench.timelineDockPreference = preference;
    this.internalState.workbench.timelineBottomDockCollapsed = false;

    if (preference === "bottom") {
      this.internalState.workbench.dialogState.timeline.maximized = false;
      this.internalState.workbench.dialogState.toolbox.visible = false;
    }
  });

  public readonly setTimelineBottomDockCollapsed: AppInternalAction["setTimelineBottomDockCollapsed"] = action((collapsed) => {
    if (this.internalState.workbench.timelineBottomDockCollapsed === collapsed) {
      return;
    }

    this.internalState.workbench.timelineBottomDockCollapsed = collapsed;
  });

  public readonly setTimelineBottomDockHeight: AppInternalAction["setTimelineBottomDockHeight"] = action((height) => {
    if (!Number.isFinite(height)) {
      return;
    }

    this.internalState.workbench.timelineBottomDockHeight = clampTimelineBottomDockHeight(height);
  });

  public readonly setActivePanel: AppInternalAction["setActivePanel"] = action((panel) => {
    this.internalState.runtime.activePanel = panel;

    if (panel !== null) {
      this.setLeftDockOpen(true);
    }
  });
  public readonly setActiveTool: AppInternalAction["setActiveTool"] = (...args: Parameters<AppInternalAction["setActiveTool"]>) => this.canvas.actions.setActiveTool(...args);

  public readonly showCanvasFloatingToolbar: AppInternalAction["showCanvasFloatingToolbar"] = (...args: Parameters<AppInternalAction["showCanvasFloatingToolbar"]>) => this.canvas.actions.showCanvasFloatingToolbar(...args);

  public readonly showCanvasFloatingToolbarForCollection: AppInternalAction["showCanvasFloatingToolbarForCollection"] = (...args: Parameters<AppInternalAction["showCanvasFloatingToolbarForCollection"]>) => this.canvas.actions.showCanvasFloatingToolbarForCollection(...args);

  public readonly moveCanvasFloatingToolbar: AppInternalAction["moveCanvasFloatingToolbar"] = (...args: Parameters<AppInternalAction["moveCanvasFloatingToolbar"]>) => this.canvas.actions.moveCanvasFloatingToolbar(...args);

  public readonly alignCanvasFloatingToolbar: AppInternalAction["alignCanvasFloatingToolbar"] = (...args: Parameters<AppInternalAction["alignCanvasFloatingToolbar"]>) => this.canvas.actions.alignCanvasFloatingToolbar(...args);

  public readonly setCanvasFloatingToolbarSize: AppInternalAction["setCanvasFloatingToolbarSize"] = (...args: Parameters<AppInternalAction["setCanvasFloatingToolbarSize"]>) => this.canvas.actions.setCanvasFloatingToolbarSize(...args);

  public readonly hideCanvasFloatingToolbar: AppInternalAction["hideCanvasFloatingToolbar"] = (...args: Parameters<AppInternalAction["hideCanvasFloatingToolbar"]>) => this.canvas.actions.hideCanvasFloatingToolbar(...args);

  public readonly showCanvasRightDockToolbar: AppInternalAction["showCanvasRightDockToolbar"] = (...args: Parameters<AppInternalAction["showCanvasRightDockToolbar"]>) => this.canvas.actions.showCanvasRightDockToolbar(...args);

  public readonly hideCanvasRightDockToolbar: AppInternalAction["hideCanvasRightDockToolbar"] = (...args: Parameters<AppInternalAction["hideCanvasRightDockToolbar"]>) => this.canvas.actions.hideCanvasRightDockToolbar(...args);




  public readonly setLeftDockWidth: AppInternalAction["setLeftDockWidth"] = action((width) => {
    if (isMobileOrTabletScreenProfile(this.internalState.screenProfile)) {
      this.internalState.workbench.touchLeftDockWidth = clampLeftDockWidth(width);
    } else {
      this.internalState.workbench.leftDockWidth = clampLeftDockWidth(width);
    }
  });

  public readonly setScreenProfile: AppInternalAction["setScreenProfile"] = action((screenProfile) => {
    if (areScreenProfilesEqual(this.internalState.screenProfile, screenProfile)) {
      return;
    }

    this.internalState.screenProfile = screenProfile;
  });

  public readonly setLocale: AppInternalAction["setLocale"] = action((locale) => {
    if (this.internalState.settings.locale === locale) {
      return;
    }

    this.internalState.settings.locale = locale;
  });

  public readonly getKeyboardShortcutFor: AppInternalAction["getKeyboardShortcutFor"] = (key) => {
    return this.shortcutManager.getKeyboardShortcutFor(key);
  };

  public readonly isShortcutFor: AppInternalAction["isShortcutFor"] = (
    key,
    code,
    eventKey,
    modifiers,
  ) => {
    return this.shortcutManager.isShortcutFor(key, code, eventKey, modifiers);
  };

  public readonly matchesAnyShortcut: AppInternalAction["matchesAnyShortcut"] = (
    code,
    eventKey,
    modifiers,
  ) => {
    return this.shortcutManager.matchesAnyShortcut(code, eventKey, modifiers);
  };

  public readonly setShortcutFor: AppInternalAction["setShortcutFor"] = (key, value) => {
    this.shortcutManager.setShortcutFor(key, value);
  };

  public readonly resetAllShortcutsToDefaults: AppInternalAction["resetAllShortcutsToDefaults"] = () => {
    this.shortcutManager.resetAllShortcutsToDefaults();
  };

  private setLeftDockOpen(nextOpen: boolean): void {
    if (this.internalState.workbench.leftDockOpen === nextOpen) {
      return;
    }

    this.internalState.workbench.leftDockOpen = nextOpen;
  }

  private ensureDialogState(dialogKey: DialogKey) {
    this.internalState.workbench.dialogState[dialogKey] ??= createDefaultDialogStateForKey(dialogKey);

    return this.internalState.workbench.dialogState[dialogKey] as NonNullable<
      UiStateReadWrite["workbench"]["dialogState"][DialogKey]
    >;
  }
}

function normalizeDialogRequest(request: string): { dialogKey: DialogKey; tabId: string | null } | null {
  const [rawDialogKey = "", ...tabParts] = request.split(":");
  const dialogKey = normalizeDialogKey(rawDialogKey);

  if (dialogKey === null) {
    return null;
  }

  const rawTabId = tabParts.join(":").trim();

  return {
    dialogKey,
    tabId: rawTabId === "" ? null : rawTabId,
  };
}

function normalizeDialogKey(dialogKey: string): DialogKey | null {
  const trimmedDialogKey = dialogKey.trim();

  return DIALOG_KEYS.includes(trimmedDialogKey as DialogKey)
    ? trimmedDialogKey as DialogKey
    : null;
}

function normalizeDialogTab(dialogKey: DialogKey, tabId: string): string | null {
  if (dialogKey === "toolbox") {
    return normalizeToolboxDialogTab(tabId);
  }

  if (dialogKey === "help") {
    return normalizeHelpDialogTab(tabId);
  }

  return null;
}

function areScreenProfilesEqual(left: ScreenProfile, right: ScreenProfile): boolean {
  return (
    left.viewportWidth === right.viewportWidth
    && left.viewportHeight === right.viewportHeight
    && left.devicePixelRatio === right.devicePixelRatio
    && left.deviceClass === right.deviceClass
    && left.screenShape === right.screenShape
    && left.aspectRatio === right.aspectRatio
    && left.hasTouch === right.hasTouch
  );
}











function normalizeHelpDialogTab(tabId: string): string | null {
  const knownTabs = new Set<string>(HELP_DIALOG_TAB_IDS);

  return knownTabs.has(tabId) ? tabId : null;
}

function normalizeToolboxDialogTab(tabId: string): string | null {
  const knownTabs = new Set<string>(TOOLBOX_DIALOG_TAB_IDS);

  return knownTabs.has(tabId) ? tabId : null;
}







