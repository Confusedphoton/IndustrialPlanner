import type { CanvasInteractionController } from "@/app/canvas";
import { trackPlacementEdgeFlick } from "@/app/canvas/placement-edge-flick";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";

import type { GestureMappingModule } from "../types";
import { holdDeviceForPlacement } from "./hypergryph-single-placement-gesture-module";
import { isPreviewBoundingBoxAtClientPoint, TOUCH_PREVIEW_HIT_SLOP_PX } from "./mobile-preview-bounds";

/** 一次最多铺出的设备数。 */
const MAX_ROW_LENGTH = 40;

interface PaintRowSession {
  readonly gestureId: string;
  readonly pointer: "mouse" | "touch";
  readonly keepInHand: boolean;
  /** 起笔时手上那台设备的预览（位置、朝向与配置）及其占地。 */
  readonly template: WorldEntity;
  readonly footprint: GridRect;
  readonly startCell: GridPoint;
  readonly flick: ReturnType<typeof trackPlacementEdgeFlick> | null;
  /** 当前预览的一排（数量与末端），未变化时不重建预览。 */
  rowKey: string;
}

/**
 * 刷一排：设备在手上时按住拖动，沿拖动的主方向按占地间距排出一排同样的设备（含配方与朝向），
 * 松开一次放下，形成一条撤销记录；与画传送带的手感一致。
 * 鼠标直接拖；笔与触控在连续放置模式下拖动，长按后的拖动用于旋转。
 */
export function createHypergryphPaintRowGestureModule(): GestureMappingModule<AppHost> {
  let session: PaintRowSession | null = null;

  return {
    id: "hypergryph-paint-row-gesture",
    // 先于放置模块接管放置工具中的拖动。
    priority: 160,
    cancel() {
      session = null;
    },
    handle(event, context) {
      const canvas = context.canvas;
      const editor = canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse dragstart":
          if (event.originButton !== 0 || (event.isPen && (event.longPress
            || (!canvas.state.runtime.singlePlacementContinuous && !event.modifiers.ctrl && !event.modifiers.shift)))) {
            return { status: "ignored" };
          }
          session = startSession(canvas, editor, {
            gestureId: event.gestureId,
            pointer: "mouse",
            flickEnabled: event.isPen === true,
            start: event.startPosition,
            keepInHand: event.isPen === true || event.modifiers.ctrl || event.modifiers.shift
              || canvas.state.runtime.singlePlacementContinuous,
          });
          if (session === null) {
            return { status: "ignored" };
          }
          session.flick?.track(event.position, canvas.gestureAdapter.tapTimeMs());
          updateRow(canvas, editor, session, event.position);
          return { status: "claimed" };

        case "touch dragstart":
          if (!canvas.state.runtime.singlePlacementContinuous || event.longPress || !isPreviewBoundingBoxAtClientPoint({
            editor,
            view: canvas.view,
            position: event.startPosition,
            hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
          })) {
            return { status: "ignored" };
          }
          session = startSession(canvas, editor, {
            gestureId: event.gestureId,
            pointer: "touch",
            flickEnabled: true,
            start: event.startPosition,
            keepInHand: canvas.state.runtime.singlePlacementContinuous,
          });
          if (session === null) {
            return { status: "ignored" };
          }
          session.flick?.track(event.position, canvas.gestureAdapter.tapTimeMs());
          updateRow(canvas, editor, session, event.position);
          return { status: "claimed" };

        case "mouse dragmove":
        case "touch dragmove":
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          session.flick?.track(event.position, canvas.gestureAdapter.tapTimeMs());
          updateRow(canvas, editor, session, event.position);
          return { status: "handled" };

        case "mouse dragend":
        case "touch dragend": {
          if (session === null || session.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          const finished = session;
          session = null;
          canvas.edgePan.stop();
          const release = event.reason === "release" ? event.position : null;
          if (release !== null && finished.flick?.releasedAtEdge(release, canvas.gestureAdapter.tapTimeMs(), canvas.unobstructedClientRect)) {
            editor.actions.cancelPlacementDraft();
            canvas.actions.setActiveTool("select");
          } else {
            finishRow(canvas, editor, finished, release);
          }
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

function startSession(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  options: { gestureId: string; pointer: "mouse" | "touch"; start: GesturePosition; keepInHand: boolean; flickEnabled: boolean },
): PaintRowSession | null {
  if (canvas.state.activeTool !== "single-placement" || editor.state.collections.preview.length !== 1) {
    return null;
  }
  const template = editor.queries.getEntityById(editor.state.collections.preview[0]!);
  const footprint = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
  const startCell = canvas.view.queries.findGridCellForClientPixelPoint(options.start);
  if (template === null || footprint === null || startCell === null) {
    return null;
  }
  return {
    gestureId: options.gestureId,
    pointer: options.pointer,
    keepInHand: options.keepInHand,
    template: { ...template, position: { ...template.position }, config: structuredClone(template.config) },
    footprint,
    startCell,
    flick: options.flickEnabled ? trackPlacementEdgeFlick(options.start, canvas.gestureAdapter.tapTimeMs()) : null,
    rowKey: "",
  };
}

/** 从起笔处到指针沿主方向按占地间距排出的设备位置。 */
export function resolvePaintRowPositions(options: {
  readonly origin: GridPoint;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly startCell: GridPoint;
  readonly pointerCell: GridPoint;
}): GridPoint[] {
  const dx = options.pointerCell.x - options.startCell.x;
  const dy = options.pointerCell.y - options.startCell.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const pitch = horizontal ? options.footprint.width : options.footprint.height;
  const delta = horizontal ? dx : dy;
  const count = Math.min(MAX_ROW_LENGTH, Math.floor(Math.abs(delta) / pitch) + 1);
  const step = Math.sign(delta) * pitch;
  return Array.from({ length: count }, (_, index) => ({
    x: options.origin.x + (horizontal ? index * step : 0),
    y: options.origin.y + (horizontal ? 0 : index * step),
  }));
}

function updateRow(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  session: PaintRowSession,
  position: GesturePosition,
): void {
  const pointerCell = canvas.view.queries.findGridCellForClientPixelPoint(position);
  if (pointerCell === null) {
    return;
  }
  const positions = resolvePaintRowPositions({
    origin: session.template.position,
    footprint: session.footprint,
    startCell: session.startCell,
    pointerCell,
  });
  canvas.edgePan.track(position, (next) => updateRow(canvas, editor, session, next));
  const end = positions.at(-1)!;
  const rowKey = `${positions.length}:${end.x},${end.y}`;
  if (rowKey === session.rowKey) {
    return;
  }
  session.rowKey = rowKey;
  editor.actions.createPositionedPlacementDraft(positions.map((cell) => ({
    definitionId: session.template.definitionId,
    position: cell,
    rotation: session.template.rotation,
    config: session.template.config,
  })));
}

function finishRow(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  session: PaintRowSession,
  releasePosition: GesturePosition | null,
): void {
  if (releasePosition !== null) {
    editor.actions.applyPlacementDraft();
  }
  const device = {
    deviceId: session.template.definitionId,
    config: session.template.config,
    rotation: session.template.rotation,
  };
  if (session.keepInHand || releasePosition === null) {
    // 设备仍在手上：重建单台预览，取消时回到起笔前的位置。
    holdDeviceForPlacement(canvas, device, {
      source: session.pointer,
      position: session.pointer === "mouse" ? releasePosition : null,
    });
    return;
  }
  editor.actions.cancelPlacementDraft();
  canvas.actions.setActiveTool("select");
}
