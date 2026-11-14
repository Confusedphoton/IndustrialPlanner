
import { comparer, reaction } from "mobx";
import type { WorldDocument, WorldDocumentViewportSettings } from "@/domain/document/world-document";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { EditorViewState } from "@/domain/editor/editor-view-state";
import type { SceneBounds, SceneSpace } from "@/domain/shared/scene-space";
import type { SceneSnapshotSource } from "@/domain/shared/scene-snapshot";
import type { GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveBaseBuiltinEntities, type BaseDefinition } from "@/domain/registry/types/base-definition";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import type { EditorDocumentWriter } from "./history";
import { clampViewportGridSize, DEFAULT_VIEWPORT_GRID_SIZE } from "./viewport-settings";

/** 保存/恢复的缩放下限低于交互缩放下限：矮画布里“显示整个基地”可能缩到 0.5 以下，重新打开时应保持；实际缩放仍由视图按当前画布夹紧。 */
const PERSISTED_VIEWPORT_GRID_SIZE_MINIMUM = 0.1;

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
    gridSize: "gridSize" in value && typeof value.gridSize === "number" ? clampViewportGridSize(value.gridSize, PERSISTED_VIEWPORT_GRID_SIZE_MINIMUM) : DEFAULT_VIEWPORT_GRID_SIZE,
    displayRotation: rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0,
  };
}

/** 文档实体与基地内置实体（如核心）占地的外包矩形；都没有时为 null。 */
export function resolveWorldDocumentContentBounds(document: WorldDocument, registry: {
  readonly entityDefinitions: readonly EntityDefinition[]; readonly baseDefinitions: readonly BaseDefinition[];
}): GridRect | null {
  const entities = [...resolveBaseBuiltinEntities({ baseDefinitions: registry.baseDefinitions, baseId: document.baseId }),
    ...Object.values(document.entities)];
  const definitions = new Map(registry.entityDefinitions.map(definition => [definition.id, definition]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const entity of entities) {
    const definition = definitions.get(entity.definitionId);
    if (definition === undefined) continue;
    const rect = resolveEntityGridRect({ entity, definition });
    minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width); maxY = Math.max(maxY, rect.y + rect.height);
  }
  return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function applyWorldDocumentViewportSettings(options: {
  document: WorldDocument; view: EditorViewContract; space: SceneSpace; contentBounds?: GridRect | null;
}): void {
  const baseBounds = resolveBaseOuterBounds(options.space);
  // 没有保存过视口的文档首次打开时对准已有内容（新基地即核心），没有内容时对准基地中心，而不是坐标原点。
  const firstCenter = options.contentBounds == null
    ? resolveSceneBoundsCenter(baseBounds)
    : { x: options.contentBounds.x + options.contentBounds.width / 2, y: options.contentBounds.y + options.contentBounds.height / 2 };
  const saved = normalizeWorldDocumentViewportSettings(options.document.documentSettings.viewport)
    ?? { ...createDefaultWorldDocumentViewportSettings(), center: firstCenter };
  options.view.actions.setBoundsPolicy({ kind: "space", padding: 2,
    bounds: baseBounds ?? { minX: null, minY: null, maxX: null, maxY: null } });
  options.view.actions.setViewportDisplayRotation(saved.displayRotation);
  options.view.actions.focusOnBounds({ x: saved.center.x - 0.5, y: saved.center.y - 0.5, width: 1, height: 1 },
    { durationMs: 0, gridSize: saved.gridSize });
}

function resolveSceneBoundsCenter(bounds: SceneBounds | null): { x: number; y: number } {
  if (bounds === null || bounds.minX === null || bounds.maxX === null || bounds.minY === null || bounds.maxY === null) {
    return { x: 0, y: 0 };
  }
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

export function withWorldDocumentViewportSettings(document: WorldDocument, viewport: EditorViewState): WorldDocument {
  const next = { center: { ...viewport.center }, gridSize: clampViewportGridSize(viewport.gridSize, PERSISTED_VIEWPORT_GRID_SIZE_MINIMUM), displayRotation: viewport.displayRotation };
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
  view: EditorViewContract; readSpace(): SceneSpace; readContentBounds?(document: WorldDocument): GridRect | null;
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
    try { applyWorldDocumentViewportSettings({ document, view: options.view, space: options.readSpace(),
      contentBounds: options.readContentBounds?.(document) }); }
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
