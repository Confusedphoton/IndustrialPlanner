
import { comparer, reaction } from "mobx";
import type { WorldDocument, WorldDocumentViewportSettings } from "@/domain/document/world-document";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { EditorViewState } from "@/domain/editor/editor-view-state";
import type { SceneSpace } from "@/domain/shared/scene-space";
import type { SceneSnapshotSource } from "@/domain/shared/scene-snapshot";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";
import type { EditorDocumentWriter } from "./history";
import { clampViewportGridSize, DEFAULT_VIEWPORT_GRID_SIZE } from "./viewport-settings";

export function createDefaultWorldDocumentViewportSettings(): WorldDocumentViewportSettings {
  return { center: { x: 0, y: 0 }, gridSize: DEFAULT_VIEWPORT_GRID_SIZE, displayRotation: 0 };
}

export function normalizeWorldDocumentViewportSettings(value: unknown): WorldDocumentViewportSettings | null {
  if (typeof value !== "object" || value === null || !("center" in value)
    || typeof value.center !== "object" || value.center === null
    || !("x" in value.center) || !("y" in value.center)
    || typeof value.center.x !== "number" || typeof value.center.y !== "number"
    || !Number.isFinite(value.center.x) || !Number.isFinite(value.center.y)) return null;
  const rotation = "displayRotation" in value ? value.displayRotation : 0;
  return {
    center: { x: value.center.x, y: value.center.y },
    gridSize: "gridSize" in value && typeof value.gridSize === "number" ? clampViewportGridSize(value.gridSize) : DEFAULT_VIEWPORT_GRID_SIZE,
    displayRotation: rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0,
  };
}

export function applyWorldDocumentViewportSettings(options: {
  document: WorldDocument; view: EditorViewContract; space: SceneSpace;
}): void {
  const saved = normalizeWorldDocumentViewportSettings(options.document.documentSettings.viewport)
    ?? createDefaultWorldDocumentViewportSettings();
  options.view.actions.setBoundsPolicy({ kind: "space", padding: 2,
    bounds: resolveBaseOuterBounds(options.space) ?? { minX: null, minY: null, maxX: null, maxY: null } });
  options.view.actions.setViewportDisplayRotation(saved.displayRotation);
  options.view.actions.focusOnBounds({ x: saved.center.x - 0.5, y: saved.center.y - 0.5, width: 1, height: 1 },
    { durationMs: 0, gridSize: saved.gridSize });
}

export function withWorldDocumentViewportSettings(document: WorldDocument, viewport: EditorViewState): WorldDocument {
  const next = { center: { ...viewport.center }, gridSize: clampViewportGridSize(viewport.gridSize), displayRotation: viewport.displayRotation };
  const current = normalizeWorldDocumentViewportSettings(document.documentSettings.viewport);
  if (current !== null && comparer.structural(current, next)) return document;
  return { ...document, documentSettings: { ...document.documentSettings, viewport: next } };
}

export function persistWorldDocumentViewportSettings(options: {
  document: SceneSnapshotSource<WorldDocument>; documentWriter: EditorDocumentWriter; view: EditorViewContract;
}): void {
  const current = options.document.getSnapshot();
  const next = withWorldDocumentViewportSettings(current, options.view.state);
  if (next !== current) options.documentWriter.setSnapshot(next, { mode: "silent" });
}

/** 由组合根仅为主 View 显式创建；临时视图没有存储资格或页面监听。 */
export function bindEditorViewToDocument(options: {
  document: SceneSnapshotSource<WorldDocument>; documentWriter: EditorDocumentWriter;
  view: EditorViewContract; readSpace(): SceneSpace;
}): { flush(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let restoring = false;
  let documentKey: string | null = null;
  const flush = (): void => {
    if (timer === null || disposed) return;
    clearTimeout(timer);
    timer = null;
    persistWorldDocumentViewportSettings(options);
  };
  const stopDocument = options.document.subscribe((document) => {
    if (documentKey === document.documentKey) return;
    // 组合根把 flush 接到 Editor 的 beforeDocumentChange，旧文档在切换前已保存。
    documentKey = document.documentKey;
    restoring = true;
    try { applyWorldDocumentViewportSettings({ document, view: options.view, space: options.readSpace() }); }
    finally { restoring = false; }
  });
  const stopView = reaction(() => [options.view.state.center.x, options.view.state.center.y,
    options.view.state.gridSize, options.view.state.displayRotation], () => {
    if (!restoring && !disposed && timer === null) timer = setTimeout(flush, 1000);
  }, { equals: comparer.structural });
  const onVisibilityChange = (): void => { if (globalThis.document?.visibilityState === "hidden") flush(); };
  globalThis.addEventListener?.("pagehide", flush);
  globalThis.document?.addEventListener("visibilitychange", onVisibilityChange);
  return { flush, dispose: () => {
    if (disposed) return;
    flush(); disposed = true;
    stopDocument(); stopView();
    globalThis.removeEventListener?.("pagehide", flush);
    globalThis.document?.removeEventListener("visibilitychange", onVisibilityChange);
  } };
}
