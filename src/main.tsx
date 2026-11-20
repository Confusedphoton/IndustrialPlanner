import { createSceneSessionFactories } from "./editor/scene-session";
import { bindEditorViewToDocument, createDefaultWorldDocumentViewportSettings } from "./editor/document-viewport";
import { resolveEditorSceneSpace, resolveEditorPlacementGeometry } from "./editor/placement-space";
import { isDataMigrationComplete } from "@/shared/storage/data-migration-state";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { prepareLocalMigrationRecovery } from "@/shared/storage/local-migration-recovery";
import { createDataMigrationController, installDataMigrationController, isDataMigrationFrozen, notifyDataMigrationAbandoned } from "@/shared/data-migration";
import { prepareBlueprintLibraryMigration } from "@/shared/blueprint-library-migration";
import { prepareEditorDataMigration } from "./editor/data-migration";
import { prepareAppDataMigration } from "./app/data-migration";
import { DataMigrationOverlay } from "./app/migration/data-migration-overlay";

import { createAudioHost } from "./audio";
import { createScenePresentation, mountCanvasSceneView, createCanvasRenderDiagnosticSession } from "./app/canvas";
import { createEditableSceneSource } from "./editor/scene-source";
import { createSnapshotStore } from "./shared/snapshot/snapshot-store";
import { createDemandFrameDriver } from "./shared/timing/demand-frame-driver";
import { createPlaybackOwner } from "./shared/timing/playback-owner";
import type { SceneOverlay, SceneViewInput } from "./domain/document/scene-view-input";
import type { SimulationContract } from "./domain/simulation/simulation-contract";
import React from "react";
import ReactDOM from "react-dom/client";
import { reaction } from "mobx";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import { createAppHost, type AppHost } from "@/app/host/app-host";
import { createModuleBalancingSyncSources } from "@/app/module-balancing-sync-sources";
import { createSyncHost } from "@/sync";
import "@/styles/global.scss";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { createRegistryContract } from "./registry";
import { WorkspaceContract } from "./domain/document/workspace-contract";
import { createWorkspaceState } from "./domain/document/workspace-state";
import { createEditorHost } from "./editor/editor-host";
import { resolveViewportGridCellPixelSize } from "./editor/viewport-settings";
import { createRenderHost } from "./renderer/renderer-host";
import { createSimulationHost } from "./simulation/simulation-host";
import { initializeDebugLogging } from "@/shared/logging/debug-logging-runtime";
import { publishDebugModeEnabled } from "@/shared/logging/debug-mode-runtime";
import {
  DEFAULT_WORKBENCH_LOG_LEVEL,
  setLogLevel,
} from "@/shared/logging/logger";

declare global {
  interface Window {
    __industrialPlannerAppHost?: AppHost;
  }
}

// 数据安全入口必须先于所有主机初始化和同步任务。
async function startWorkbench(): Promise<void> {
  const migrationVersion = `local-data-2:${BLUEPRINT_SCHEMA_VERSION}:${import.meta.env.VITE_APP_VERSION_CACHE_KEY}`;
  const reactRoot = ReactDOM.createRoot(document.getElementById("root")!);
  reactRoot.render(<DataMigrationOverlay />);
  const disposeStorageGeneration = await prepareLocalMigrationRecovery({
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    migrationVersion,
    buildId: import.meta.url,
    onInvalidated: () => {
      // navigation 使用既有 PWA network-first；同步触发 SW 更新但不等待后台页继续写入。
      void navigator.serviceWorker?.getRegistration().then(async registration => {
        await registration?.update();
        registration?.waiting?.postMessage({ type: "PWA_SKIP_WAITING" });
      }).catch(() => undefined);
      window.location.reload();
    },
    verifyCurrentBuild: async () => {
      const response = await fetch(window.location.href, { cache: "no-store", headers: { "X-IndustrialPlanner-Network-Only": "1" } });
      if (!response.ok) return false;
      const page = new DOMParser().parseFromString(await response.text(), "text/html");
      return Array.from(page.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
        .some(script => new URL(script.getAttribute("src")!, window.location.href).href === import.meta.url);
    },
  });
  if (import.meta.hot) import.meta.hot.dispose(disposeStorageGeneration);

  const registry = createRegistryContract();

  const workspace : WorkspaceContract = {
    state: createWorkspaceState(),
    registry: registry,
    app: null,
    audio: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  }

  const migration = createDataMigrationController(migrationVersion, [
    { label: "检查应用设置", prepare: version => prepareAppDataMigration(registry, version) },
    { label: "检查基地与编辑历史", prepare: version => prepareEditorDataMigration(registry, version) },
    { label: "检查蓝图库", prepare: prepareBlueprintLibraryMigration },
  ]);
  const disposeMigration = installDataMigrationController(migration);
  const freezeInput = (event: Event) => {
    if (!isDataMigrationFrozen() || event.target instanceof Element && event.target.closest('[aria-labelledby="data-migration-title"]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const inputEvents = ["pointerdown", "pointermove", "pointerup", "keydown", "keyup", "wheel", "touchstart", "touchmove", "drop", "click", "submit", "beforeinput", "paste"];
  for (const event of inputEvents) window.addEventListener(event, freezeInput, { capture: true, passive: false });
  if (import.meta.hot) import.meta.hot.dispose(() => {
    disposeMigration();
    for (const event of inputEvents) window.removeEventListener(event, freezeInput, true);
  });
  await migration.run();

  const sceneFactories = createSceneSessionFactories(registry);
  const mainView = sceneFactories.createView({ id: "workbench-main",
    initialViewport: createDefaultWorldDocumentViewportSettings(),
    bounds: { kind: "space", bounds: { minX: null, minY: null, maxX: null, maxY: null }, padding: 2 },
    getOperationAvailability: (operation) => workspace.editor?.queries.getOperationAvailability(operation)
      ?? { supported: true, enabled: true, reason: null },
  });
  let viewPersistence: ReturnType<typeof bindEditorViewToDocument> | null = null;
  const mainSceneReleases: (() => void)[] = [];
  const mainSceneAbort = new AbortController();
  let mainSceneDisposed = false;
  const retainMainScene = (release: () => void): void => {
    if (mainSceneDisposed) release(); else mainSceneReleases.push(release);
  };
  const disposeMainScene = (): void => {
    if (mainSceneDisposed) return;
    mainSceneDisposed = true;
    mainSceneAbort.abort();
    try { reactRoot.unmount(); } catch (error) { console.error("Workbench UI cleanup failed", error); }
    for (const release of mainSceneReleases.splice(0).reverse()) {
      try { release(); } catch (error) { console.error("Workbench scene cleanup failed", error); }
    }
    window.removeEventListener("pagehide", onMainScenePageHide);
  };
  const onMainScenePageHide = (event: PageTransitionEvent): void => { if (!event.persisted) disposeMainScene(); };
  window.addEventListener("pagehide", onMainScenePageHide);
  if (import.meta.hot) import.meta.hot.dispose(disposeMainScene);
  retainMainScene(() => mainView.dispose());
  let appHost: AppHost;
  try {
  appHost = createAppHost(workspace, { sceneFactories, mainView });
  retainMainScene(() => appHost.dispose());
  await appHost.regionalSettings.hydrate();
  mainSceneAbort.signal.throwIfAborted();
  if (import.meta.env.DEV) {
    window.__industrialPlannerAppHost = appHost;
  }
  initializeDebugLogging();
  retainMainScene(reaction(
    () => appHost.state.settings.debugMode,
    (enabled) => {
      publishDebugModeEnabled(enabled);
      setLogLevel(enabled ? "debug" : DEFAULT_WORKBENCH_LOG_LEVEL, {
        announce: enabled,
      });
    },
    { fireImmediately: true },
  ));
  const editorHost = createEditorHost(workspace, {
    beforeDocumentChange: () => viewPersistence?.flush(),
    captureOperationGuard: () => {
      const selection = appHost.mainCanvas.state.toolInfo.darkPipeLink;
      return () => selection === null || appHost.mainCanvas.state.toolInfo.darkPipeLink === selection;
    },
  });
  workspace.editor = editorHost;
  retainMainScene(() => editorHost.dispose());
  viewPersistence = bindEditorViewToDocument({ document: editorHost.document,
    documentWriter: editorHost.internalDocumentWriter, view: mainView,
    readSpace: () => resolveEditorSceneSpace(editorHost.services, editorHost.document.getSnapshot()),
  });
  retainMainScene(() => viewPersistence?.dispose());
  const renderHost = createRenderHost();
  workspace.render = renderHost;
  retainMainScene(() => renderHost.destroy());
  const simulationHost = createSimulationHost(workspace, {
    getPerfEnabled: () => appHost.internalState.settings.debugMode,
    getDebugDataEnabled: () => appHost.internalState.settings.debugMode
      && appHost.internalState.settings.debugSimulationWorkerDetailedReport,
    getActiveActivityIds: () => resolveEffectiveActivityIds({
      selectedActivityIds: appHost.internalState.settings.selectedActivityIds,
    }),
    getRegionalResourceSettings: (regionTag) =>
      appHost.regionalSettings.getRegionResources(regionTag),
  });

  retainMainScene(() => simulationHost.dispose());

  const mainSource = createEditableSceneSource("workbench", editorHost);
  retainMainScene(mainSource.dispose);
  const mainPresentation = createScenePresentation({ app: appHost, showBaseBoundary: true,
    readTools: () => ({ activeTool: appHost.mainCanvas.state.activeTool, moveKind: appHost.mainCanvas.state.moveKind, toolInfo: appHost.mainCanvas.state.toolInfo }) });
  retainMainScene(mainPresentation.dispose);
  const mainInput: SceneViewInput = { id: mainView.id, source: mainSource.source, camera: mainView,
    presentation: mainPresentation.snapshot, simulation: simulationHost, overlay: createSnapshotStore<SceneOverlay | null>(null) };
  const renderReady = mountCanvasSceneView({
    renderer: renderHost,
    input: mainInput,
    time: { kind: "advancing", clockId: "workbench-visual", initialTimeMs: 0 },
    signal: mainSceneAbort.signal,
    loadResourcesProgressively: true,
  }).then(binding => {
    retainMainScene(binding.dispose);
    mainSceneAbort.signal.throwIfAborted();
    appHost.mainCanvas.renderBinding = binding;
  });
  const syncReady = isDataMigrationComplete(migrationVersion).then(async complete => {
    mainSceneAbort.signal.throwIfAborted();
    if (!complete) {
      notifyDataMigrationAbandoned();
      return;
    }
    const syncHost = await createSyncHost(workspace, {
      assetSources: [
        ...createModuleBalancingSyncSources(appHost),
        appHost.regionalSettings.createSyncSource(),
      ],
    });
    retainMainScene(() => syncHost.dispose());
  });
  await Promise.all([renderReady, syncReady]);
  mainSceneAbort.signal.throwIfAborted();

  const mainDiagnostics = createCanvasRenderDiagnosticSession({ input: mainInput, simulation: simulationHost });
  retainMainScene(mainDiagnostics.destroy);
  retainMainScene(bindSimulationPlayback(simulationHost, "workbench-playback"));

  const audioHost = createAudioHost(workspace, {
    readEnabled: () => appHost.internalState.settings.gamePlayDeviceAudio,
    readViewport: () => mainView.state,
  });
  retainMainScene(() => audioHost.destroy());


  retainMainScene(reaction(
    () => JSON.stringify(appHost.internalState.settings.selectedActivityIds),
    () => {
      if (simulationHost.internalState.hasStarted) {
        void simulationHost.internalActions.refreshFromCurrentDocument();
      }
    },
  ));

  reactRoot.render(
    <React.StrictMode>
      <WorkbenchApp
        appHost={appHost}
      />
      <DataMigrationOverlay />
    </React.StrictMode>,
  );
  } catch (error) {
    disposeMainScene();
    throw error;
  }
}

async function startBlueprintEmbed(): Promise<void> {
  const [
    { BlueprintEmbed, BlueprintEmbedStatus },
    { createBlueprintEmbedBridge, applyBlueprintEmbedSettings, createEmbedWorldDocument, loadEmbedBlueprint, parseBlueprintEmbedOptions, resolveEmbedBlueprintBounds },
  ] = await Promise.all([import("./app/shell/blueprint-embed"), import("./app/embed")]);
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  const abort = new AbortController();
  const bridge = createBlueprintEmbedBridge();
  const releases: Array<() => void> = [];
  let disposed = false;
  let loading = true;
  let simulation: ReturnType<typeof createSimulationHost> | null = null;
  const timeout = setTimeout(() => abort.abort(new Error("蓝图加载超时，请重试。")), 30_000);
  const releaseHosts = () => {
    while (releases.length) {
      try { releases.pop()?.(); }
      catch (error) { console.error("Blueprint embed cleanup failed", error); }
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeout);
    abort.abort();
    bridge.dispose();
    window.removeEventListener("pagehide", pageHide);
    root.unmount();
    releaseHosts();
  };
  const pageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) dispose();
    else simulation?.actions.pause();
  };
  window.addEventListener("pagehide", pageHide);
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  root.render(<BlueprintEmbedStatus blank />);
  try {
    const options = parseBlueprintEmbedOptions(window.location.href);
    const blueprint = await loadEmbedBlueprint(options.blueprintUrl, abort.signal);
    clearTimeout(timeout);
    abort.signal.throwIfAborted();
    const registry = createRegistryContract();
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(), registry,
      app: null, editor: null, render: null, simulation: null,
      audio: null, sync: null,
    };
    const initialDocument = createEmbedWorldDocument(blueprint, registry, {
      width: window.innerWidth, height: window.innerHeight, gridCellPixelSize: resolveViewportGridCellPixelSize(1),
    });
    const sceneFactories = createSceneSessionFactories(registry);
    const embedView = sceneFactories.createView({ id: "embed-main",
      initialViewport: initialDocument.documentSettings.viewport ?? createDefaultWorldDocumentViewportSettings(),
      bounds: { kind: "content", content: resolveEmbedBlueprintBounds(blueprint, registry), padding: 3, maxAutoZoom: 2 },
      getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
    });
    releases.push(() => embedView.dispose());
    const app = createAppHost(workspace, { mode: "embed", mainView: embedView, sceneFactories });
    releases.push(() => app.dispose());
    applyBlueprintEmbedSettings(app, options);
    const editor = createEditorHost(workspace, {
      persistence: "memory", initialDocument,
      policy: {
        getOperationAvailability: operation => ({ supported: operation === "pan-viewport" || operation === "zoom-viewport",
          enabled: operation === "pan-viewport" || operation === "zoom-viewport", reason: null }),
        resolvePlacementAreaIds: entity => resolveEditorPlacementGeometry(workspace, initialDocument, entity).allowedAreaIds,
        validateTransition: () => ["嵌入蓝图为只读会话。"],
      },
      space: options.showBase ? undefined : { areas: [{ id: initialDocument.baseId,
        bounds: { minX: null, maxX: null, minY: null, maxY: null },
        outerRing: { top: 0, right: 0, bottom: 0, left: 0 } }] },
    });
    workspace.editor = editor;
    releases.push(() => editor.dispose());
    await editor.internalDocuments.ready();
    abort.signal.throwIfAborted();
    embedView.actions.setViewportClientRect({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    simulation = createSimulationHost(workspace, {
      getRegionalResourceSettings: region => app.regionalSettings.getRegionResources(region),
      getActiveActivityIds: () => resolveEffectiveActivityIds({ selectedActivityIds: [] }),
    });
    const simulationHost = simulation;
    releases.push(() => simulationHost.dispose());
    if (options.warmupSeconds > 0) {
      await simulation.actions.start();
      abort.signal.throwIfAborted();
      simulation.actions.pause();
      const rate = simulation.queries.getDocumentRuntimeStatus()?.standardTickRate;
      const warmupTicks = Math.ceil(options.warmupSeconds * (rate ?? NaN));
      if (!Number.isSafeInteger(warmupTicks) || warmupTicks <= 0) {
        throw Object.assign(new Error("预热秒数无法换算为有效的 tick 数。"), { code: "INVALID_PARAMETER" });
      }
      const result = await simulation.internalActions.syncToTick(warmupTicks);
      abort.signal.throwIfAborted();
      if (result.status !== "ready" || simulation.queries.getDocumentRuntimeStatus()?.tickNumber !== warmupTicks) {
        throw Object.assign(new Error("蓝图预热未能完成。"), { code: "SIMULATION_FAILED" });
      }
    }
    const render = createRenderHost();
    workspace.render = render;
    if (disposed) { render.destroy(); return; }
    releases.push(() => render.destroy());
    const source = sceneFactories.createReadonlySource({ id: "embed", document: editor.document.getSnapshot(),
      space: resolveEditorSceneSpace(editor.services, editor.document.getSnapshot()) });
    releases.push(source.dispose);
    const presentation = createScenePresentation({ app, showBaseBoundary: options.showBase,
      readTools: () => ({ activeTool: "select", moveKind: null, toolInfo: { marqueeType: "marquee", darkPipeLink: null } }) });
    releases.push(presentation.dispose);
    const renderView = await mountCanvasSceneView({ renderer: render,
      input: { id: embedView.id, source: source.source, camera: embedView, presentation: presentation.snapshot,
        simulation, overlay: createSnapshotStore<SceneOverlay | null>(null) },
      time: { kind: "advancing", clockId: "embed-visual", initialTimeMs: 0 }, signal: abort.signal });
    app.mainCanvas.renderBinding = renderView;
    releases.push(renderView.dispose);
    releases.push(bindSimulationPlayback(simulation, "embed-playback"));
    // 被动跟随已存在 SW 的版本切换，不注册、激活或更新 SW。
    try {
      const worker = navigator.serviceWorker;
      const reload = () => window.location.reload();
      worker?.addEventListener("controllerchange", reload);
      releases.push(() => worker?.removeEventListener("controllerchange", reload));
    } catch { /* 当前 iframe 禁用 Service Worker 时继续在线运行。 */ }
    const onReady = () => {
      if (disposed || !loading) return;
      loading = false;
      bridge.attach(app);
      if (options.autoplay) void bridge.play().catch(error => bridge.reportError(error));
    };
    root.render(<BlueprintEmbed appHost={app} onReady={onReady} />);
  } catch (error) {
    clearTimeout(timeout);
    releaseHosts();
    if (disposed) return;
    const failure = abort.signal.aborted && abort.signal.reason instanceof Error ? abort.signal.reason : error;
    bridge.reportError(failure);
    root.render(<BlueprintEmbedStatus error={failure instanceof Error ? failure.message : "蓝图加载失败。"} />);
  }
}

/** 播放 owner 与 Surface 数量和可见性无关；只有播放状态要求连续调度。 */
function bindSimulationPlayback(simulation: SimulationContract, clockId: string): () => void {
  const owner = createPlaybackOwner({ clockId, isPlaying: () => simulation.state.runningState === "start",
    advance: (deltaMs) => simulation.actions.advancePlaybackByDeltaMs(deltaMs) });
  const driver = createDemandFrameDriver({
    request: (callback) => requestAnimationFrame(callback), cancel: (id) => cancelAnimationFrame(id),
    needsFrame: () => simulation.state.runningState === "start",
    onFrame: (timeMs) => owner.update({ clockId, timeMs }),
  });
  const stop = reaction(() => simulation.state.runningState, () => { owner.resetBaseline(); driver.wake(); });
  const visibility = (): void => { owner.resetBaseline(); driver.wake(); };
  document.addEventListener("visibilitychange", visibility);
  driver.wake();
  return () => { driver.dispose(); stop(); owner.dispose(); document.removeEventListener("visibilitychange", visibility); };
}

// URL 分流早于工作台的数据恢复；两种模式共享同一份 Host 实现和静态资源。
void (new URLSearchParams(window.location.search).has("embed")
  ? startBlueprintEmbed() : startWorkbench()).catch((error: unknown) => {
  const root = document.getElementById("root");
  if (root !== null && !isDataMigrationFrozen()) {
    const message = document.createElement("p");
    message.textContent = error instanceof Error ? error.message : "无法安全读取本地数据，已停止写入。";
    const retry = document.createElement("button");
    retry.textContent = "重新加载";
    retry.onclick = () => window.location.reload();
    root.replaceChildren(message, retry);
  }
  window.addEventListener("online", () => window.location.reload(), { once: true });
  console.error("Workbench startup failed; stored data was retained.", error);
});
