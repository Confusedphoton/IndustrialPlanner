import { CanvasInteractionController } from "../canvas";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { SceneSessionFactories } from "@/domain/document/scene-session";
import { WorkspaceContract } from "@/domain/document/workspace-contract";
import { AppContract } from "@/domain/app/app-contract";
import { AppActionImpl, AppInternalAction } from "../actions/action-impl";
import { createGestureAdapter, GestureAdapter } from "../input/gesture/adapter";
import {
  AppGestureModuleRegistrar,
  createGestureActionRouter,
  GestureActionRouter,
  type ShortcutInputLayer,
} from "../input/gesture/actions";
import {
  createGestureDiagnosticsStore,
  GestureDiagnosticsStore,
} from "../input/gesture/diagnostics";
import { KeyboardShortcutManager } from "../actions/keyboard-shortcut-manager";
import { hookLocalstorage } from "../state/storage-hook";
import {
  createUiStateReadWrite,
  isTimelineBottomDockActive,
  isToolboxBottomDockActive,
  UiStateReadWrite,
} from "../state/state-impl";
import { hookThemeApplicator } from "../theme/theme-applicator";
import { canvasToolRailState } from "../shell/canvas/canvas-tool-rail-state";
import { WorkbenchBlueprintFolderDialogController } from "../shell/state/blueprint-folder-dialog-state";
import { WorkbenchBlueprintPreviewController } from "../shell/state/blueprint-preview-dialog-state";
import { WorkbenchEncyclopediaPickerController } from "../shell/state/encyclopedia-picker-state";
import { WorkbenchSaveBlueprintDialogController } from "../shell/state/save-blueprint-dialog-state";
import { cleanupDiscardableV2LocalStorageBeforeV3Boot } from "../migration";
import { RegionalSettingsController } from "../regional-settings";
import { DefaultPortPriorityController } from "../port-priority";
import { regionalSimulationUiState } from "../state/regional-simulation-ui-state";

export interface AppHost extends AppContract {
  readonly mainCanvas: CanvasInteractionController;
  readonly sceneFactories: SceneSessionFactories;
  workspace: WorkspaceContract;
  gestureAdapter: GestureAdapter;
  gestureActionRouter: GestureActionRouter<AppHost>;
  gestureDiagnostics: GestureDiagnosticsStore;
  internalState: UiStateReadWrite;
  internalActions: AppInternalAction;
  blueprintFolderDialog: WorkbenchBlueprintFolderDialogController;
  blueprintPreview: WorkbenchBlueprintPreviewController;
  saveBlueprintDialog: WorkbenchSaveBlueprintDialogController;
  encyclopediaPicker: WorkbenchEncyclopediaPickerController;


  regionalSettings: RegionalSettingsController;
  portPriorityDefaults: DefaultPortPriorityController;
  dispose: () => void;
}


export function createAppHost(
  workspace: WorkspaceContract,
  options: { mode?: "workbench" | "embed"; mainView: EditorViewContract; sceneFactories: SceneSessionFactories },
): AppHost {
  const embedded = options.mode === "embed";
  if (!embedded) regionalSimulationUiState.loadPersisted();
  const disposers: Array<() => void> = [];
  const internalState = createUiStateReadWrite();
  const portPriorityDefaults = new DefaultPortPriorityController(workspace.registry);
  const regionalSettings = new RegionalSettingsController(workspace.registry);
  const host = {
    workspace,
    internalState,
    mainCanvas: new CanvasInteractionController({ view: options.mainView, registry: workspace.registry, readEditor: () => workspace.editor, readWorkbench: () => host, workbenchActions: !embedded,
      readViewportObstruction: () => ({
        left: canvasToolRailState.side === "left" ? canvasToolRailState.width : 0,
        right: canvasToolRailState.side === "right" ? canvasToolRailState.width : 0,
      }) }),
    sceneFactories: options.sceneFactories,
  } as AppHost;
  const publicSettings = new Proxy(internalState.settings, {
    get(target, property, receiver) {
      if (property === "regionalMultiBaseEnabled") {
        return !embedded && regionalSimulationUiState.experimentalEnabled
          && regionalSettings.multiBaseEnabled;
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return property === "regionalMultiBaseEnabled" || Reflect.has(target, property);
    },
    ownKeys(target) {
      return [...Reflect.ownKeys(target), "regionalMultiBaseEnabled"];
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === "regionalMultiBaseEnabled") {
        return {
          configurable: true,
          enumerable: true,
          value: !embedded && regionalSimulationUiState.experimentalEnabled
            && regionalSettings.multiBaseEnabled,
          writable: false,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  }) as unknown as AppContract["state"]["settings"];
  const publicState: AppContract["state"] = {
    get settings() {
      return publicSettings;
    },
    get workbench() {
      return internalState.workbench;
    },
    get screenProfile() {
      return internalState.screenProfile;
    },
    get theme() {
      return internalState.theme;
    },



  };
  const gestureAdapter = createGestureAdapter(host.mainCanvas, {
    onFrameDemand: () => host.mainCanvas.wakeInput(),
    onCancel: () => host.mainCanvas.cancelInput(),
    onAcquireInput: () => host.mainCanvas.acquireInput(),
    queryPenPreciseInput: () => internalState.settings.penPreciseInput,
  });
  host.mainCanvas.attachGestureAdapter(gestureAdapter);
  const gestureDiagnostics = createGestureDiagnosticsStore();
  const blueprintFolderDialog = new WorkbenchBlueprintFolderDialogController();
  const blueprintPreview = new WorkbenchBlueprintPreviewController();
  const saveBlueprintDialog = new WorkbenchSaveBlueprintDialogController(
    internalState.workbench.dialogState["save-blueprint"],
  );


  const encyclopediaPicker = new WorkbenchEncyclopediaPickerController(
    () => internalState.workbench.toolbox.wiki,
    embedded ? "memory" : "browser",
  );
  const gestureActionRouter = createGestureActionRouter<AppHost>({
    gestureAdapter,
    workspace,
    getAppHost: () => host,
    getCanvas: () => host.mainCanvas,
    getShortcutBinding: (shortcutId) => host.internalActions.getKeyboardShortcutFor(shortcutId),
    getShortcutInputLayer: (_event, context) => resolveShortcutInputLayer(context.appHost),
    getActiveTool: (context) => context.canvas.state.activeTool,
  });

  host.mainCanvas.attachGestureRouter(gestureActionRouter);

  // 将 router 的长按查询能力回注到 gestureAdapter，由 adapter 在显示长按圆圈前询问
  gestureAdapter["adapterOptions"].queryLongPressAcceptance = (
    gridHasEntity: boolean,
  ) => gestureActionRouter.queryLongPressAcceptance(gridHasEntity);

  // 先组装 host 的基础部分（state 必须就绪，shortcutManager 构造时需要读）
  Object.assign(host, {
    state: publicState,
    workspace,
    gestureAdapter,
    gestureActionRouter,
    gestureDiagnostics,
    internalState,
    blueprintFolderDialog,
    blueprintPreview,
    saveBlueprintDialog,

    regionalSettings,
    portPriorityDefaults,
    encyclopediaPicker,
  });

  const shortcutManager = new KeyboardShortcutManager(host, { persistence: embedded ? "memory" : "browser" });
  if (!embedded) disposers.push(shortcutManager.hookPersistence());
  disposers.push(() => shortcutManager.dispose());

  const actionImpl = new AppActionImpl(internalState, workspace, shortcutManager, host.mainCanvas);
  const internalActions: AppInternalAction = {
    showCanvasToast: actionImpl.showCanvasToast,
    setCanvasAlert: actionImpl.setCanvasAlert,
    toggleLeftDock: actionImpl.toggleLeftDock,
    toggleRightDock: actionImpl.toggleRightDock,
    setRightDockOpen: actionImpl.setRightDockOpen,
    toggleTopBarCollapsed: actionImpl.toggleTopBarCollapsed,
    setRightDockActiveTab: actionImpl.setRightDockActiveTab,
    openDialog: actionImpl.openDialog,
    closeDialog: actionImpl.closeDialog,
    toggleDialogMaximized: actionImpl.toggleDialogMaximized,
    setDialogTab: actionImpl.setDialogTab,
    setDialogOffset: actionImpl.setDialogOffset,
    setDialogSize: actionImpl.setDialogSize,
    setToolboxDockPreference: actionImpl.setToolboxDockPreference,
    openCustomModuleDraft: actionImpl.openCustomModuleDraft,
    setToolboxBottomDockCollapsed: actionImpl.setToolboxBottomDockCollapsed,
    setToolboxBottomDockHeight: actionImpl.setToolboxBottomDockHeight,
    setTimelineDockPreference: actionImpl.setTimelineDockPreference,
    setTimelineBottomDockCollapsed: actionImpl.setTimelineBottomDockCollapsed,
    setTimelineBottomDockHeight: actionImpl.setTimelineBottomDockHeight,
    setActivePanel: actionImpl.setActivePanel,
    setActiveTool: actionImpl.setActiveTool,
    showCanvasFloatingToolbar: actionImpl.showCanvasFloatingToolbar,
    showCanvasFloatingToolbarForCollection: actionImpl.showCanvasFloatingToolbarForCollection,
    moveCanvasFloatingToolbar: actionImpl.moveCanvasFloatingToolbar,
    alignCanvasFloatingToolbar: actionImpl.alignCanvasFloatingToolbar,
    setCanvasFloatingToolbarSize: actionImpl.setCanvasFloatingToolbarSize,
    hideCanvasFloatingToolbar: actionImpl.hideCanvasFloatingToolbar,
    setLeftDockWidth: actionImpl.setLeftDockWidth,
    setScreenProfile: actionImpl.setScreenProfile,
    setLocale: actionImpl.setLocale,
    getKeyboardShortcutFor: actionImpl.getKeyboardShortcutFor,
    isShortcutFor: actionImpl.isShortcutFor,
    matchesAnyShortcut: actionImpl.matchesAnyShortcut,
    setShortcutFor: actionImpl.setShortcutFor,
    resetAllShortcutsToDefaults: actionImpl.resetAllShortcutsToDefaults,
  };
  const actions: AppContract["actions"] = {
    translate: actionImpl.translate,
  };

  Object.assign(host, {
    internalActions,
    dispose: () => {
      blueprintFolderDialog.close();
      blueprintPreview.close();
      saveBlueprintDialog.close();
      host.mainCanvas.dispose();
      portPriorityDefaults.dispose();
      encyclopediaPicker.dispose();
      actionImpl.dispose();
      gestureActionRouter.dispose();
      gestureAdapter.dispose();
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
    queries: {},
    actions,
  });

  workspace.app = host;
  const gestureModuleRegistrar = new AppGestureModuleRegistrar({
    canvas: host.mainCanvas,
    readOnly: embedded,
    router: gestureActionRouter,
    gestureDiagnostics,
  });
  disposers.push(() => {
    gestureModuleRegistrar.dispose();
  });
  disposers.push(gestureAdapter.subscribeKeyboardSnapshot((snapshot) => {
    gestureDiagnostics.setKeyboardSnapshot(snapshot);
  }));
  if (!embedded) {
    cleanupDiscardableV2LocalStorageBeforeV3Boot();
    disposers.push(hookLocalstorage(host));
  }
  disposers.push(hookThemeApplicator(host));

  return host;
}

function resolveShortcutInputLayer(appHost: AppHost): ShortcutInputLayer {
  const toolboxBottomDockActive = isToolboxBottomDockActive(appHost.internalState);
  const timelineBottomDockActive = isTimelineBottomDockActive(appHost.internalState);
  const visibleDialogIds = Object.entries(appHost.internalState.workbench.dialogState)
    .filter(([dialogId, dialogState]) => (
      dialogState?.visible === true
      && !(dialogId === "toolbox" && toolboxBottomDockActive)
      && !(dialogId === "timeline" && timelineBottomDockActive)
    ))
    .map(([dialogId]) => dialogId);
  if (visibleDialogIds.length > 0) {
    return "dialog";
  }
  if (appHost.mainCanvas.overlapEntityMenu.visible) {
    return "overlap-entity-menu";
  }
  return "canvas";
}
