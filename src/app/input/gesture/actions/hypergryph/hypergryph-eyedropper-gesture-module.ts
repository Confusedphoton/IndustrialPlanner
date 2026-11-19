import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";

import type { GestureMappingModule } from "../types";
import {
  dragPlacementFromPanel,
  dropPlacementFromPanel,
  holdDeviceForPlacement,
} from "./hypergryph-single-placement-gesture-module";

export const PICK_UP_BUTTON_ID = "canvas-floating-toolbar-button-pick-up";

/** 只属于基地内置设备的配置，拿起复制时不带走。 */
const BUILTIN_ONLY_CONFIG_KEYS = ["warehouseBusSeed"] as const;

/**
 * 吸管：把画布上已放置的设备“拿到手上”——同型号，连同配方等配置与朝向——继续放置。
 *
 * - 笔杆键点按设备（选择或放置工具中）：拿起该设备；点在空处仍是原来的清除选择 / 放下工具。
 * - 笔杆键按住设备拖动（选择工具中）：拖出一台复制品，松开放下，设备留在手上。
 * - 触控：选中设备后点操作条上的「再放一台」。
 */
export function createHypergryphEyedropperGestureModule(): GestureMappingModule<AppHost> {
  let drag: { readonly gestureId: string; readonly deviceId: string } | null = null;

  return {
    id: "hypergryph-eyedropper-gesture",
    // 先于选择（100）与放置模块判定笔杆键点按。
    priority: 210,
    cancel() {
      drag = null;
    },
    handle(event, context) {
      const canvas = context.canvas;
      const editor = canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }
      const tool = canvas.state.activeTool;

      switch (event.type) {
        case "touch tap":
          if (tool !== "select" || !event.longPress || !canvas.isOperationEnabled("confirm-placement")) return { status: "ignored" };
          return event.pointerEntity !== null && pickUpEntity(canvas, event.pointerEntity, {
            source: "touch", position: event.position,
          }) ? { status: "handled" } : { status: "ignored" };

        case "mouse tap": {
          const holdToLift = tool === "select" && event.isPen && event.button === 0 && event.longPress;
          if ((!holdToLift && event.button !== 2) || (tool !== "select" && tool !== "single-placement")) {
            return { status: "ignored" };
          }
          const entity = findPlacedEntityAt(canvas, editor, event.position);
          if (entity === null) {
            return { status: "ignored" };
          }
          pickUpEntity(canvas, entity, { source: "mouse", position: event.position });
          return { status: "handled" };
        }

        case "mouse dragstart": {
          if (event.originButton !== 2 || tool !== "select") {
            return { status: "ignored" };
          }
          const entity = findPlacedEntityAt(canvas, editor, event.startPosition);
          if (entity === null || !pickUpEntity(canvas, entity, { source: "mouse", position: event.position })) {
            return { status: "ignored" };
          }
          drag = { gestureId: event.gestureId, deviceId: entity.definitionId };
          dragPlacementFromPanel(canvas, drag.deviceId, event.position);
          return { status: "claimed" };
        }

        case "mouse dragmove":
          if (drag === null || drag.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          dragPlacementFromPanel(canvas, drag.deviceId, event.position);
          return { status: "handled" };

        case "mouse dragend":
          if (drag === null || drag.gestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          drag = null;
          dropPlacementFromPanel(canvas, event.reason === "release" ? event.position : null, true);
          return { status: "handled" };

        case "ui-button-touch-tap":
        case "ui-button-mouse-tap": {
          if (event.uiButtonId !== PICK_UP_BUTTON_ID || tool !== "select") {
            return { status: "ignored" };
          }
          const selection = editor.state.collections.selection;
          const entity = selection.length === 1 ? editor.queries.getEntityById(selection[0]!) : null;
          if (entity === null) {
            return { status: "ignored" };
          }
          editor.actions.clearCollection(EntityCollectionType.selection);
          canvas.actions.hideCanvasFloatingToolbar();
          pickUpEntity(canvas, entity, { source: event.type === "ui-button-touch-tap" ? "touch" : "mouse" });
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

/** 把该设备的型号、配置与朝向交到手上。 */
export function pickUpEntity(
  canvas: CanvasInteractionController,
  entity: WorldEntity,
  options: { readonly source: "mouse" | "touch"; readonly position?: GesturePosition | null },
): boolean {
  const config: Record<string, unknown> = structuredClone(entity.config);
  for (const key of BUILTIN_ONLY_CONFIG_KEYS) {
    delete config[key];
  }
  return holdDeviceForPlacement(canvas, { deviceId: entity.definitionId, config, rotation: entity.rotation }, options);
}

/** 指针下已放置的设备（不含正在放置的预览）。 */
function findPlacedEntityAt(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  position: GesturePosition,
): WorldEntity | null {
  const cell = canvas.view.queries.findGridCellForClientPixelPoint(position);
  if (cell === null) {
    return null;
  }
  const preview = editor.state.collections.preview;
  const entities = editor.queries.listEntities();
  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = entities[index]!;
    if (preview.contains(entity.id)) continue;
    const definition = canvas.registry.queries.findEntityDefinition(entity.definitionId);
    if (definition === null) continue;
    const rect = resolveEntityGridRect({ entity, definition });
    if (cell.x >= rect.x && cell.x < rect.x + rect.width && cell.y >= rect.y && cell.y < rect.y + rect.height) {
      return entity;
    }
  }
  return null;
}
