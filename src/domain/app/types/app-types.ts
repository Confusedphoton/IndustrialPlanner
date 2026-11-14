import type { ScreenProfile } from "./screen-profile";
import type { AppTheme, AppThemeId } from "./theme";

export type AppLocale = "zh-CN" | "en-US";

export interface AppSettings {
  readonly locale: AppLocale;
  readonly themeId: AppThemeId;
  /** 用户为下一次受支持的仿真会话选择“同时运行所有基地”。 */
  readonly regionalMultiBaseEnabled: boolean;
  readonly hypergryphImmediateMove: boolean;
  readonly hypergryphCopyWhileMoving: boolean;
  readonly hypergryphImmediateMarquee: boolean;
  readonly blueprintPlacementDefaultContinuous: boolean;
  readonly hypergryphAllowEmptyLogisticsEndpoints: boolean;
  readonly hypergryphAutoCreateSplittersAndConvergers: boolean;
  readonly hypergryphSelectionRightDockSync: boolean;
  readonly hypergryphInspectorOpenOnSecondClick: boolean;
  readonly gameUseBlueprintStyleDeviceImages: boolean;
  readonly gamePlayDeviceAnimations: boolean;
  readonly gameShowDeviceNames: boolean;
  readonly gameShowDeviceIcons: boolean;
  readonly gameUseInspectorPanel: boolean;
  readonly gameShowHotkeys: boolean;
  readonly collapseDeviceModes: boolean;
  readonly gamePipeWallReflection: boolean;
  readonly gameShowPipeExactFluidPosition: boolean;
  readonly gameAlwaysShowGridLines: boolean;
  readonly gameAlwaysShowPowerRange: boolean;
  readonly showGrassBackground: boolean;
  readonly showRegionAnnotations: boolean;
  readonly debugDisableCargoEntryAnimation: boolean;
  readonly debugShowFps: boolean;
  readonly debugShowGestureDiagnosticsWindow: boolean;
  readonly debugMode: boolean;
  readonly virtualMousePointer: boolean;
}

// ToolboxWiki* / ModuleBalancing* / ToolboxState 类型已搬迁至 src/app/toolbox-types.ts

export type RightDockTabId = "selection";

export interface WorkbenchState {
  readonly leftDockOpen: boolean;
  readonly rightDockOpen: boolean;
  readonly leftDockWidth: number;
  readonly topBarCollapsed: boolean;
  readonly rightDockActiveTab: RightDockTabId;
  readonly selectedPlacementVariantByCraftGroup: Readonly<Record<string, string>>;
}

export type ActiveTool =
  | "select"
  | "move"
  | "marquee"
  | "blueprint-placement"
  | "single-placement"
  | "logistics-placement"
  | "dark-pipe-link"
  | "region-edit";

export interface DarkPipeLinkToolState {
  readonly sourceEntityId: string;
  readonly sourceRole: "inlet" | "outlet";
  readonly candidateEntityIds: readonly string[];
  readonly returnTool: ActiveTool;
}

export interface ToolInfo {
  readonly marqueeType: "marquee" | "reverse-marquee";
  readonly darkPipeLink: DarkPipeLinkToolState | null;
}

export interface UiState {
  readonly settings: AppSettings;
  readonly workbench: WorkbenchState;
  readonly screenProfile: ScreenProfile;
  readonly theme: AppTheme;



}
