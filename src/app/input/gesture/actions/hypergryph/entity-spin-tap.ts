import type { CanvasInteractionController } from "@/app/canvas";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import { rotateSelectionInPlace } from "./hypergryph-rotate-selection-gesture-module";

/**
 * 连点设备即旋转：记下最近一次落在设备上的点按（选中它、或刚把它放下/移到这里），
 * 下一次点按若按双击的时限与距离落在同一台设备上，就把它原地顺时针转 90°，继续连点继续转。
 */
interface EntityTap {
  readonly entityId: string;
  readonly atMs: number;
  readonly position: GesturePosition;
}

const lastEntityTaps = new WeakMap<CanvasInteractionController, EntityTap>();

export function recordEntityTap(canvas: CanvasInteractionController, entityId: string, position: GesturePosition): void {
  lastEntityTaps.set(canvas, { entityId, atMs: canvas.gestureAdapter.tapTimeMs(), position });
}

export function forgetEntityTap(canvas: CanvasInteractionController): void {
  lastEntityTaps.delete(canvas);
}

/** 这次点按紧接着上一次设备点按时返回那台设备，否则 null。 */
export function resolveRepeatTapEntityId(canvas: CanvasInteractionController, position: GesturePosition): string | null {
  const previous = lastEntityTaps.get(canvas);
  return previous !== undefined && canvas.gestureAdapter.isRepeatTap(previous, position) ? previous.entityId : null;
}

export function isEntitySpinTap(canvas: CanvasInteractionController, entityId: string, position: GesturePosition): boolean {
  return resolveRepeatTapEntityId(canvas, position) === entityId;
}

/** 旋转该设备：设为唯一选中后原地旋转，并记下这次点按供继续连点。 */
export function spinEntity(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  entityId: string,
  position: GesturePosition,
): void {
  const selection = editor.state.collections.selection;
  if (selection.length !== 1 || !selection.contains(entityId)) {
    editor.actions.clearCollection(EntityCollectionType.selection);
    editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  }
  rotateSelectionInPlace(canvas, editor);
  recordEntityTap(canvas, entityId, position);
}

/** 执行一次会落下设备的操作（放置或移动）；只落下一台时记下它，紧接着再点它就会旋转。 */
export function recordEntityLandedBy(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  position: GesturePosition,
  land: () => void,
): void {
  const before = new Set(Object.keys(editor.document.getSnapshot().entities));
  const movedIds = [...editor.state.collections.selection];
  land();
  const entities = editor.document.getSnapshot().entities;
  const landed = Object.keys(entities).filter((entityId) => !before.has(entityId));
  const candidates = landed.length > 0 ? landed : movedIds.filter((entityId) => entities[entityId] !== undefined);
  if (candidates.length === 1) {
    recordEntityTap(canvas, candidates[0]!, position);
  } else {
    forgetEntityTap(canvas);
  }
}
