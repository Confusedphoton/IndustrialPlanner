import type { UiKey } from "@/shared/i18n";
import { makeAutoObservable } from "mobx";

import type { ScreenProfile } from "@/domain/app/types/screen-profile";
import type { AppTheme, AppThemeId } from "@/domain/app/types/theme";
import {
  EntityCollectionType,
} from "@/domain/editor/types/editor-types";
import type {
  MarqueeCollectionType,
} from "@/domain/editor/types/editor-types";
import type {
  ActiveTool,
  AppSettings,
  DarkPipeLinkToolState,
  RightDockTabId,
  ToolInfo,
  UiState,
  WorkbenchState,
} from "@/domain/app/types/app-types";
import type {
  ModuleBalancingCanvas,
  ModuleBalancingCustomModule,
  ModuleBalancingFolder,
  ModuleBalancingIOPort,
  ModuleBalancingStage,
  ModuleBalancingStageModuleEntry,
  ModuleBalancingState,
  ToolboxState,
  ToolboxWikiDesktopCategory,
  ToolboxWikiEntityGroupCategory,
  ToolboxWikiMobileCategory,
  ToolboxWikiMobileFilterOption,
  ToolboxWikiNavigationEntry,
  ToolboxWikiOpenedPage,
  ToolboxWikiState,
} from "@/app/toolbox-types";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import type { GridPoint, GridRotation } from "@/domain/shared/grid";
import type { LogisticsKind, LogisticsRouteOrder } from "@/domain/shared/logistics";
import type { UiGroup } from "@/domain/registry/types/entity-definition";
import type { AppLocale } from "@/domain/app";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";
import {
  isMobileOrTabletScreenProfile,
  resolveScreenProfileFromWindow,
} from "@/shared/browser/screen-profile";
import { DEFAULT_APP_THEME_ID, resolveAppTheme } from "../theme";
import type { LineEndChipState } from "@/app/canvas/line-end-chip";
import type { LineProbeState } from "@/app/canvas/line-probe";
import type { PortCombLanesState } from "@/app/canvas/line-comb";
import type { MarkingMenuState } from "@/app/canvas/marking-menu";

/** PC 布局下拖动左侧面板时的常规最窄宽度。 */
export const MIN_LEFT_DOCK_WIDTH = 320;
export const MAX_LEFT_DOCK_WIDTH = 600;
export const DEFAULT_LEFT_DOCK_WIDTH = 320;
export const DEFAULT_RIGHT_DOCK_WIDTH = 380;
/** 触屏布局（手机、平板与矮窗口）左侧面板的默认宽度，也是任何布局下保存宽度的下限。 */
export const MOBILE_LEFT_DOCK_WIDTH = 220;

export function clampLeftDockWidth(width: number): number {
  return Math.min(MAX_LEFT_DOCK_WIDTH, Math.max(MOBILE_LEFT_DOCK_WIDTH, Math.round(width)));
}

// mobile 和 tablet 默认使用窄左栏，宽度与 PC 分开保存，两种布局各自记住用户拖出的宽度。
export function resolveLeftDockWidthForScreenProfile(
  workbench: Pick<WorkbenchState, "leftDockWidth" | "touchLeftDockWidth">,
  screenProfile: Pick<ScreenProfile, "deviceClass">,
): number {
  return clampLeftDockWidth(isMobileOrTabletScreenProfile(screenProfile)
    ? workbench.touchLeftDockWidth
    : workbench.leftDockWidth);
}

/** 当前布局下拖动左侧面板时的常规最窄宽度。 */
export function resolveMinLeftDockWidthForScreenProfile(screenProfile: Pick<ScreenProfile, "deviceClass">): number {
  return isMobileOrTabletScreenProfile(screenProfile) ? MOBILE_LEFT_DOCK_WIDTH : MIN_LEFT_DOCK_WIDTH;
}

export interface AppSettingsReadWrite extends Omit<AppSettings, "regionalMultiBaseEnabled"> {
  locale: AppLocale;
  themeId: AppThemeId;
  hypergryphImmediateMove: boolean;
  hypergryphCopyWhileMoving: boolean;
  hypergryphImmediateMarquee: boolean;
  blueprintPlacementDefaultContinuous: boolean;
  hypergryphAllowEmptyLogisticsEndpoints: boolean;
  hypergryphAutoCreateSplittersAndConvergers: boolean;
  invertWheelZoom: boolean;
  /** 手写笔按鼠标精确输入处理（悬停预览、笔尖拖动、侧键右键、橡皮擦删除）；关闭时沿用触控手势。 */
  penPreciseInput: boolean;
  /** 试验：放置时按笔的倾斜方向设定手上设备的朝向。 */
  gameUseBlueprintStyleDeviceImages: boolean;
  gamePlayDeviceAnimations: boolean;
  gamePlayDeviceAudio: boolean;
  gameShowDeviceNames: boolean;
  gameShowDeviceIcons: boolean;
  gameShowHotkeys: boolean;
  collapseDeviceModes: boolean;
  gamePipeWallReflection: boolean;
  gameShowPipeExactFluidPosition: boolean;
  gameAlwaysShowGridLines: boolean;
  gameAlwaysShowPowerRange: boolean;
  selectedActivityIds: string[];
  toolboxShowAllActivityContent: boolean;
  showGrassBackground: boolean;
  showRegionAnnotations: boolean;
  debugDisableCargoEntryAnimation: boolean;
  debugShowFps: boolean;
  debugShowGestureDiagnosticsWindow: boolean;
  debugSimulationWorkerDetailedReport: boolean;
  debugForceFlattenBlueprintVersion: boolean;
  debugMode: boolean;
  virtualMousePointer: boolean;
}

export interface WorkbenchStateReadWrite extends WorkbenchState {
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  leftDockWidth: number;
  touchLeftDockWidth: number;
  topBarCollapsed: boolean;
  rightDockActiveTab: RightDockTabId;
  selectedPlacementVariantByCraftGroup: Record<string, string>;
  dialogState: DialogStateMapReadWrite;
  toolbox: ToolboxStateReadWrite;
  timelineDockPreference: TimelineDockPreference;
  timelineBottomDockCollapsed: boolean;
  timelineBottomDockHeight: number;
}

export interface ToolboxStateReadWrite extends ToolboxState {
  dockPreference: ToolboxDockPreference;
  bottomDockCollapsed: boolean;
  bottomDockHeight: number;
  wiki: ToolboxWikiStateReadWrite;
  moduleBalancing: ModuleBalancingStateReadWrite;
  moduleBalancingLibraryUi: ModuleBalancingLibraryUiStateReadWrite;
}

export interface ModuleBalancingLibraryUiStateReadWrite {
  expandedSections: {
    system: boolean;
    recommended: boolean;
    custom: boolean;
  };
  collapsedFolderIds: string[];
}

export interface ToolboxWikiStateReadWrite extends ToolboxWikiState {
  searchQuery: string;
  desktopCategory: ToolboxWikiDesktopCategory;
  mobileSelectedCategories: ToolboxWikiMobileFilterOption[];
  navigationStack: ToolboxWikiNavigationEntry[];
  openedPage: ToolboxWikiOpenedPage;
}

export interface ModuleBalancingStateReadWrite extends ModuleBalancingState {
  canvases: ModuleBalancingCanvasReadWrite[];
  canvasFolders: ModuleBalancingFolderReadWrite[];
  customModules: ModuleBalancingCustomModuleReadWrite[];
  folders: ModuleBalancingFolderReadWrite[];
  activeCanvasId: string | null;
}

export interface ModuleBalancingFolderReadWrite extends ModuleBalancingFolder {
  id: string;
  name: string;
}

export interface ModuleBalancingCanvasReadWrite extends ModuleBalancingCanvas {
  id: string;
  name: string;
  folderId: string | null;
  globalInputs: ModuleBalancingIOPortReadWrite[];
  stages: ModuleBalancingStageReadWrite[];
  warehouseCapacity: number | null;
}

export interface ModuleBalancingStageReadWrite extends ModuleBalancingStage {
  id: string;
  name: string;
  entries: ModuleBalancingStageModuleEntryReadWrite[];
}

export interface ModuleBalancingCustomModuleReadWrite extends ModuleBalancingCustomModule {
  id: string;
  name: string;
  color: string;
  iconItemIds: string[];
  notes: string;
  folderId: string | null;
  inputs: ModuleBalancingIOPortReadWrite[];
  outputs: ModuleBalancingIOPortReadWrite[];
  sourceType: "custom";
}

export interface ModuleBalancingIOPortReadWrite extends ModuleBalancingIOPort {
  itemId: string;
  perMinute: number;
  infinite?: boolean;
}

export interface ModuleBalancingStageModuleEntryReadWrite extends ModuleBalancingStageModuleEntry {
  moduleId: string;
  quantity: number;
}

export const CANVAS_FLOATING_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-ok",
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-switch-mode",
  "canvas-floating-toolbar-button-move",
  "canvas-floating-toolbar-button-copy",
  "canvas-floating-toolbar-button-pick-up",
  "canvas-floating-toolbar-button-save-blueprint",
  "canvas-floating-toolbar-button-delete",
  "canvas-floating-toolbar-button-delete-many",
  "canvas-floating-toolbar-button-delete-upstream-segment",
  "canvas-floating-toolbar-button-delete-downstream-segment",
] as const;

export type CanvasFloatingToolbarButtonId = typeof CANVAS_FLOATING_TOOLBAR_BUTTON_IDS[number];

export const TOOLBOX_DIALOG_TAB_IDS = [
  "item-encyclopedia",
  "module-balancing",
] as const;

export type ToolboxDialogTabId = typeof TOOLBOX_DIALOG_TAB_IDS[number];
export const DEFAULT_TOOLBOX_DIALOG_TAB_ID: ToolboxDialogTabId = TOOLBOX_DIALOG_TAB_IDS[0];
export const TOOLBOX_DOCK_PREFERENCES = ["floating", "bottom"] as const;
export type ToolboxDockPreference = typeof TOOLBOX_DOCK_PREFERENCES[number];
export const DEFAULT_TOOLBOX_DOCK_PREFERENCE: ToolboxDockPreference = "floating";
export const MIN_TOOLBOX_BOTTOM_DOCK_HEIGHT = 220;
export const DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT = 320;
export const MAX_TOOLBOX_BOTTOM_DOCK_HEIGHT = 720;
export const COLLAPSED_TOOLBOX_BOTTOM_DOCK_HEIGHT = 44;
export const TIMELINE_DOCK_PREFERENCES = ["floating", "bottom"] as const;
export type TimelineDockPreference = typeof TIMELINE_DOCK_PREFERENCES[number];
export const DEFAULT_TIMELINE_DOCK_PREFERENCE: TimelineDockPreference = "floating";
export const MIN_TIMELINE_BOTTOM_DOCK_HEIGHT = 112;
export const DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT = 160;
export const MAX_TIMELINE_BOTTOM_DOCK_HEIGHT = 360;
export const COLLAPSED_TIMELINE_BOTTOM_DOCK_HEIGHT = 44;

export function isToolboxDockPreference(value: unknown): value is ToolboxDockPreference {
  return typeof value === "string"
    && TOOLBOX_DOCK_PREFERENCES.includes(value as ToolboxDockPreference);
}

export function clampToolboxBottomDockHeight(height: number): number {
  return Math.min(
    MAX_TOOLBOX_BOTTOM_DOCK_HEIGHT,
    Math.max(MIN_TOOLBOX_BOTTOM_DOCK_HEIGHT, Math.round(height)),
  );
}

export function isTimelineDockPreference(value: unknown): value is TimelineDockPreference {
  return typeof value === "string"
    && TIMELINE_DOCK_PREFERENCES.includes(value as TimelineDockPreference);
}

export function clampTimelineBottomDockHeight(height: number): number {
  return Math.min(
    MAX_TIMELINE_BOTTOM_DOCK_HEIGHT,
    Math.max(MIN_TIMELINE_BOTTOM_DOCK_HEIGHT, Math.round(height)),
  );
}

export const TOOLBOX_WIKI_ENTITY_GROUP_CATEGORY_IDS = [
  "basicProduction",
  "advancedManufacturing",
  "agriculture",
  "beltLogistics",
  "pipeLogistics",
  "resourcePower",
  "warehouse",
] as const satisfies readonly ToolboxWikiEntityGroupCategory[];

export const TOOLBOX_WIKI_MOBILE_CATEGORY_IDS = [
  "item",
  "entity",
  ...TOOLBOX_WIKI_ENTITY_GROUP_CATEGORY_IDS,
] as const satisfies readonly ToolboxWikiMobileCategory[];

export const TOOLBOX_WIKI_MOBILE_FILTER_OPTION_IDS = [
  "excludeBottledLiquid",
  ...TOOLBOX_WIKI_MOBILE_CATEGORY_IDS,
] as const satisfies readonly ToolboxWikiMobileFilterOption[];

export const TOOLBOX_WIKI_DESKTOP_CATEGORY_IDS = [
  "all",
  ...TOOLBOX_WIKI_MOBILE_CATEGORY_IDS,
] as const satisfies readonly ToolboxWikiDesktopCategory[];

export function isToolboxWikiDesktopCategory(value: unknown): value is ToolboxWikiDesktopCategory {
  return typeof value === "string"
    && TOOLBOX_WIKI_DESKTOP_CATEGORY_IDS.includes(value as ToolboxWikiDesktopCategory);
}

export function isToolboxWikiMobileCategory(value: unknown): value is ToolboxWikiMobileCategory {
  return typeof value === "string"
    && TOOLBOX_WIKI_MOBILE_CATEGORY_IDS.includes(value as ToolboxWikiMobileCategory);
}

export function isToolboxWikiMobileFilterOption(value: unknown): value is ToolboxWikiMobileFilterOption {
  return typeof value === "string"
    && TOOLBOX_WIKI_MOBILE_FILTER_OPTION_IDS.includes(value as ToolboxWikiMobileFilterOption);
}

export function createDefaultToolboxWikiOpenedPage(): ToolboxWikiOpenedPage {
  return { kind: "browser" };
}

export const DEFAULT_MODULE_BALANCING_CANVAS_ID = "module-balancing-canvas-main";
export const DEFAULT_MODULE_BALANCING_STAGE_ID = "module-balancing-stage-1";

export function createDefaultModuleBalancingStage(): ModuleBalancingStageReadWrite {
  return {
    id: DEFAULT_MODULE_BALANCING_STAGE_ID,
    name: "Stage 1",
    entries: [],
  };
}

export function createDefaultModuleBalancingCanvas(): ModuleBalancingCanvasReadWrite {
  return {
    id: DEFAULT_MODULE_BALANCING_CANVAS_ID,
    name: "主基地配平",
    folderId: null,
    globalInputs: [],
    stages: [createDefaultModuleBalancingStage()],
    warehouseCapacity: null,
  };
}

export function createDefaultModuleBalancingState(): ModuleBalancingStateReadWrite {
  return {
    canvases: [createDefaultModuleBalancingCanvas()],
    canvasFolders: [],
    customModules: [],
    folders: [],
    activeCanvasId: DEFAULT_MODULE_BALANCING_CANVAS_ID,
  };
}

export function createDefaultModuleBalancingLibraryUiState(): ModuleBalancingLibraryUiStateReadWrite {
  return {
    expandedSections: {
      system: true,
      recommended: true,
      custom: true,
    },
    collapsedFolderIds: [],
  };
}

export const HELP_DIALOG_TAB_IDS = [
  "getting-started",
  "shortcuts",
  "feature-guide",
  "version",
] as const;

export type HelpDialogTabId = typeof HELP_DIALOG_TAB_IDS[number];
export const DEFAULT_HELP_DIALOG_TAB_ID: HelpDialogTabId = HELP_DIALOG_TAB_IDS[0];

export const RIGHT_DOCK_TAB_IDS = [
  "selection",
] as const satisfies readonly RightDockTabId[];

export const DEFAULT_RIGHT_DOCK_TAB_ID: RightDockTabId = RIGHT_DOCK_TAB_IDS[0];

export function isRightDockTabId(value: unknown): value is RightDockTabId {
  return typeof value === "string" && RIGHT_DOCK_TAB_IDS.includes(value as RightDockTabId);
}

export const DIALOG_KEYS = ["toolbox", "timeline", "help", "settings", "debug-log", "save-blueprint", "base-select", "warehouse-stats", "feedback"] as const;
export type DialogKey = typeof DIALOG_KEYS[number];

export interface DialogStateReadWrite {
  visible: boolean;
  maximized: boolean;
  offsetX: number;
  offsetY: number;
  width: number | null;
  height: number | null;
  activeTab: string | null;
}

export interface DialogStateMapReadWrite extends Record<string, DialogStateReadWrite | undefined> {
  toolbox: DialogStateReadWrite;
  timeline: DialogStateReadWrite;
  help: DialogStateReadWrite;
  settings: DialogStateReadWrite;
  "debug-log": DialogStateReadWrite | undefined;
  "save-blueprint": DialogStateReadWrite;
  "base-select": DialogStateReadWrite;
  "warehouse-stats": DialogStateReadWrite;
  feedback: DialogStateReadWrite;
}

export function resolveDefaultDialogTabId(dialogKey: string): string | null {
  if (dialogKey === "toolbox") {
    return DEFAULT_TOOLBOX_DIALOG_TAB_ID;
  }

  if (dialogKey === "help") {
    return DEFAULT_HELP_DIALOG_TAB_ID;
  }

  return null;
}

export function createDefaultDialogStateForKey(dialogKey: string): DialogStateReadWrite {
  return new DialogStateReadWriteImpl(resolveDefaultDialogTabId(dialogKey));
}

export interface CanvasFloatingToolbarSize {
  readonly width: number;
  readonly height: number;
}

export interface CanvasFloatingToolbarStateReadWrite {
  visible: boolean;
  buttonIds: CanvasFloatingToolbarButtonId[];
  anchor: ClientPixelPoint | null;
  attachedCollection: EntityCollectionType | null;
  measuredSize: CanvasFloatingToolbarSize | null;
}




export interface CanvasRuntimeStateReadWrite {

  canvasToastKey: UiKey | null;
  canvasAlertKey: UiKey | null;

  /** 笔尖处打开的环形标记菜单；未打开时为 null。 */
  markingMenu: MarkingMenuState | null;
  /** 从端口拖出的物流线末端仍开放时的「+ 设备」提示；没有时为 null。 */
  lineEndChip: LineEndChipState | null;
  lineProbe: LineProbeState | null;
  portComb: PortCombLanesState | null;
  moveAnchor: GridPoint | null;
  moveEnterFrom: ActiveTool | null;
  movePointerMode: "mouse" | "touch" | null;
  placementAnchor: GridPoint | null;
  blueprintPlacementRecord: BlueprintLibraryRecord | null;
  blueprintPlacementPointerMode: "mouse" | "touch" | null;
  blueprintPlacementRotationSteps: number;
  blueprintPlacementContinuous: boolean;
  blueprintPlacementFromCopy: boolean;
  singlePlacementDeviceId: string | null;
  /** 单设备放置附带的初始配置（如配方树“放置并设定配方”），随放置界面清理。 */
  singlePlacementConfig: Readonly<Record<string, unknown>> | null;
  /** 单设备放置时放下即链接的仓库物品（从规划里的原料卡片拖出的仓库取货口），随放置界面清理。 */
  singlePlacementWarehouseItemId: string | null;
  /** 单设备放置的初始朝向（物流设备快捷插入时对齐光标下的传送带/管道）。 */
  singlePlacementRotation: GridRotation | null;
  singlePlacementPointerMode: "mouse" | "touch" | null;
  singlePlacementContinuous: boolean;
  selectingPlacementGroup: PlacementGroup | null;
  logisticsPlacement: LogisticsPlacementRuntimeStateReadWrite;
  marqueeAnchor: GridPoint | null;
  canvasFloatingToolbar: CanvasFloatingToolbarStateReadWrite;
}

export interface RuntimeStateReadWrite {
/** 配方树转换出的模块草稿，等模块平衡打开编辑器后取走。 */
pendingCustomModuleDraft: ModuleBalancingCustomModule | null;
activePanel: ActivePanel;
}

export interface LogisticsPlacementRuntimeStateReadWrite {
  kind: LogisticsKind | null;
  shortcutPlacementGroup: "beltLogistics" | "pipeLogistics" | null;
  pointerMode: "mouse" | "touch" | null;
  phase: "idle" | "waiting-touch-device-exit" | "drawing" | "snapped-target";
  isHoverPreview: boolean;
  routeOrder: LogisticsRouteOrder;
  sourceEntityId: string | null;
  targetEntityId: string | null;
  anchorGridPoint: GridPoint | null;
  headGridPoint: GridPoint | null;
  lastPreviewGridPoint: GridPoint | null;
  lastMousePosition: ClientPixelPoint | null;
  statusMessageKey: string | null;
}

export interface ToolInfoReadWrite extends ToolInfo {
  marqueeType: MarqueeCollectionType;
  darkPipeLink: (DarkPipeLinkToolState & { readonly sourceBaseId: string }) | null;
}

const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export type ActivePanel =
  | "placement"
  | "region"
  | "blueprint"
  | "base"
  | "simulation"
  | null;
export type PlacementGroup = Exclude<UiGroup, "hidden">;

export interface UiStateReadWrite extends Omit<UiState, "settings"> {
  /// settings存储用户显式在设置页面配置的设置，这里面所有的内容都要持久化
  settings: AppSettingsReadWrite;
  /// workbenchState存储用户没有显式配置，但是仍然需要存储的状态，比如dock的开合状态等等。
  workbench: WorkbenchStateReadWrite;
  /// screenProfile 是当前 browser viewport / device profile 的公共 UI 运行态，不进入持久化。
  screenProfile: ScreenProfile;


  /// runtimeState存储一些不需要持久化的状态，比如当前打开的panel是什么等等，每次页面刷新时，这些状态都会被重置回默认值。
  /// runtimeState 不进Contract，这是纯私有的状态。
  runtime: RuntimeStateReadWrite;
}

export function canUseWorkbenchBottomDock(
  screenProfile: Pick<ScreenProfile, "deviceClass">,
): boolean {
  return screenProfile.deviceClass === "desktop" || screenProfile.deviceClass === "tablet";
}

export function isToolboxBottomDockActive(
  state: Pick<UiStateReadWrite, "screenProfile" | "workbench">,
): boolean {
  return state.workbench.dialogState.toolbox.visible
    && state.workbench.toolbox.dockPreference === "bottom"
    && canUseWorkbenchBottomDock(state.screenProfile);
}

export function isTimelineBottomDockActive(
  state: Pick<UiStateReadWrite, "screenProfile" | "workbench">,
): boolean {
  return state.workbench.dialogState.timeline.visible
    && (
      state.screenProfile.deviceClass === "mobile"
      || (
        state.workbench.timelineDockPreference === "bottom"
        && canUseWorkbenchBottomDock(state.screenProfile)
      )
    );
}

class WorkbenchStateReadWriteImpl implements WorkbenchStateReadWrite {
  leftDockOpen = false;
  rightDockOpen = false;
  leftDockWidth = DEFAULT_LEFT_DOCK_WIDTH;
  touchLeftDockWidth = MOBILE_LEFT_DOCK_WIDTH;
  topBarCollapsed = false;
  rightDockActiveTab = DEFAULT_RIGHT_DOCK_TAB_ID;
  selectedPlacementVariantByCraftGroup: Record<string, string> = {};
  dialogState: DialogStateMapReadWrite = {
    toolbox: createDefaultDialogStateForKey("toolbox"),
    timeline: createDefaultDialogStateForKey("timeline"),
    help: createDefaultDialogStateForKey("help"),
    settings: createDefaultDialogStateForKey("settings"),
    "debug-log": undefined,
    "save-blueprint": createDefaultDialogStateForKey("save-blueprint"),
    "base-select": createDefaultDialogStateForKey("base-select"),
    "warehouse-stats": createDefaultDialogStateForKey("warehouse-stats"),
    feedback: createDefaultDialogStateForKey("feedback"),
  };
  toolbox: ToolboxStateReadWrite = new ToolboxStateReadWriteImpl();
  timelineDockPreference: TimelineDockPreference = DEFAULT_TIMELINE_DOCK_PREFERENCE;
  timelineBottomDockCollapsed = false;
  timelineBottomDockHeight = DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class ToolboxStateReadWriteImpl implements ToolboxStateReadWrite {
  dockPreference: ToolboxDockPreference = DEFAULT_TOOLBOX_DOCK_PREFERENCE;
  bottomDockCollapsed = false;
  bottomDockHeight = DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT;
  wiki: ToolboxWikiStateReadWrite = new ToolboxWikiStateReadWriteImpl();
  moduleBalancing: ModuleBalancingStateReadWrite = createDefaultModuleBalancingState();
  moduleBalancingLibraryUi: ModuleBalancingLibraryUiStateReadWrite = createDefaultModuleBalancingLibraryUiState();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class ToolboxWikiStateReadWriteImpl implements ToolboxWikiStateReadWrite {
  searchQuery = "";
  desktopCategory: ToolboxWikiDesktopCategory = "all";
  mobileSelectedCategories: ToolboxWikiMobileFilterOption[] = ["excludeBottledLiquid"];
  navigationStack: ToolboxWikiNavigationEntry[] = [];
  openedPage: ToolboxWikiOpenedPage = createDefaultToolboxWikiOpenedPage();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class DialogStateReadWriteImpl implements DialogStateReadWrite {
  visible = false;
  maximized = false;
  offsetX = 0;
  offsetY = 0;
  width: number | null = null;
  height: number | null = null;
  activeTab: string | null;

  public constructor(activeTab: string | null) {
    this.activeTab = activeTab;
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class CanvasFloatingToolbarStateReadWriteImpl implements CanvasFloatingToolbarStateReadWrite {
  visible = false;
  buttonIds: CanvasFloatingToolbarButtonId[] = [];
  anchor: ClientPixelPoint | null = null;
  attachedCollection: EntityCollectionType | null = null;
  measuredSize: CanvasFloatingToolbarSize | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class LogisticsPlacementRuntimeStateReadWriteImpl implements LogisticsPlacementRuntimeStateReadWrite {
  kind: LogisticsKind | null = null;
  shortcutPlacementGroup: "beltLogistics" | "pipeLogistics" | null = null;
  pointerMode: "mouse" | "touch" | null = null;
  phase: "idle" | "waiting-touch-device-exit" | "drawing" | "snapped-target" = "idle";
  isHoverPreview = false;
  routeOrder: LogisticsRouteOrder = "vertical-first";
  sourceEntityId: string | null = null;
  targetEntityId: string | null = null;
  anchorGridPoint: GridPoint | null = null;
  headGridPoint: GridPoint | null = null;
  lastPreviewGridPoint: GridPoint | null = null;
  lastMousePosition: ClientPixelPoint | null = null;
  statusMessageKey: string | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}


class CanvasRuntimeStateReadWriteImpl implements CanvasRuntimeStateReadWrite {

  canvasToastKey: UiKey | null = null;
  canvasAlertKey: UiKey | null = null;

  markingMenu: MarkingMenuState | null = null;
  lineEndChip: LineEndChipState | null = null;
  lineProbe: LineProbeState | null = null;
  portComb: PortCombLanesState | null = null;
  moveAnchor: GridPoint | null = null;
  moveEnterFrom: ActiveTool | null = null;
  movePointerMode: "mouse" | "touch" | null = null;
  placementAnchor: GridPoint | null = null;
  blueprintPlacementRecord: BlueprintLibraryRecord | null = null;
  blueprintPlacementPointerMode: "mouse" | "touch" | null = null;
  blueprintPlacementRotationSteps = 0;
  blueprintPlacementContinuous = false;
  blueprintPlacementFromCopy = false;
  singlePlacementDeviceId: string | null = null;
  singlePlacementConfig: Readonly<Record<string, unknown>> | null = null;
  singlePlacementWarehouseItemId: string | null = null;
  singlePlacementRotation: GridRotation | null = null;
  singlePlacementPointerMode: "mouse" | "touch" | null = null;
  singlePlacementContinuous = false;
  selectingPlacementGroup: PlacementGroup | null = null;
  logisticsPlacement: LogisticsPlacementRuntimeStateReadWrite = new LogisticsPlacementRuntimeStateReadWriteImpl();
  marqueeAnchor: GridPoint | null = null;
  canvasFloatingToolbar: CanvasFloatingToolbarStateReadWrite = new CanvasFloatingToolbarStateReadWriteImpl();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class RuntimeStateReadWriteImpl implements RuntimeStateReadWrite {
pendingCustomModuleDraft: ModuleBalancingCustomModule | null = null;
activePanel: ActivePanel = null;
public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class ToolInfoReadWriteImpl implements ToolInfoReadWrite {
  marqueeType: MarqueeCollectionType = EntityCollectionType.marquee;
  darkPipeLink: ToolInfoReadWrite["darkPipeLink"] = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export class UiStateReadWriteImpl implements UiStateReadWrite {
  settings: AppSettingsReadWrite = {
    locale: DEFAULT_APP_LOCALE,
    themeId: DEFAULT_APP_THEME_ID,
    hypergryphImmediateMove: true,
    hypergryphCopyWhileMoving: false,
    hypergryphImmediateMarquee: false,
    blueprintPlacementDefaultContinuous: true,
    hypergryphAllowEmptyLogisticsEndpoints: false,
    hypergryphAutoCreateSplittersAndConvergers: true,
    invertWheelZoom: false,
    penPreciseInput: true,
    gameUseBlueprintStyleDeviceImages: false,
    gamePlayDeviceAnimations: false,
    gamePlayDeviceAudio: false,
    gameShowDeviceNames: true,
    gameShowDeviceIcons: false,
    gameShowHotkeys: false,
    collapseDeviceModes: true,
    gamePipeWallReflection: false,
    gameShowPipeExactFluidPosition: false,
    gameAlwaysShowGridLines: true,
    gameAlwaysShowPowerRange: false,
    selectedActivityIds: [],
    toolboxShowAllActivityContent: true,
    showGrassBackground: false,
    showRegionAnnotations: false,
    debugDisableCargoEntryAnimation: false,
    debugShowFps: false,
    debugShowGestureDiagnosticsWindow: false,
    debugSimulationWorkerDetailedReport: false,
    debugForceFlattenBlueprintVersion: false,
    debugMode: false,
    virtualMousePointer: false,
  };

  workbench: WorkbenchStateReadWrite = new WorkbenchStateReadWriteImpl();
  screenProfile: ScreenProfile = resolveScreenProfileFromWindow();


  runtime: RuntimeStateReadWrite = new RuntimeStateReadWriteImpl();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public get theme(): AppTheme {
    return resolveAppTheme(this.settings.themeId);
  }

}

export function createUiStateReadWrite(): UiStateReadWrite {
  return new UiStateReadWriteImpl();
}

/** 每个 CanvasInteractionController 创建自己的工具、拖动与提示状态。 */
export class CanvasInteractionStateReadWriteImpl {
  activeTool: ActiveTool = "select";
  toolInfo: ToolInfoReadWrite = new ToolInfoReadWriteImpl();
  runtime: CanvasRuntimeStateReadWrite = new CanvasRuntimeStateReadWriteImpl();
  constructor() { makeAutoObservable(this, {}, { autoBind: true }); }
  public get moveKind(): "ordinary" | "batch" | null {
    if (this.activeTool !== "move") {
      return null;
    }

    return this.runtime.moveEnterFrom === "marquee" ? "batch" : "ordinary";
  }
}
