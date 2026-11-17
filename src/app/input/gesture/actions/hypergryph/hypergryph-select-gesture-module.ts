import type { AppHost } from "@/app/host/app-host";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureMappingModule } from "../types";
import { cancelBlueprintPlacement } from "./hypergryph-blueprint-placement-gesture-module";
import { openOverlapEntityMenuIfNeeded } from "./overlap-entity-candidates";
import { isEntitySpinTap, recordEntityTap, spinEntity } from "./entity-spin-tap";

export function createHypergryphSelectGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-select-gesture",
    priority: 100,
    shortcutRoutes: [{
      id: "active-tool.cancel-to-select",
      actionId: "fixed.active-tool.cancel-to-select",
      binding: { kind: "fixed", value: "Esc" },
      scope: {
        inputLayers: ["canvas"],
        activeTools: [
          "select",
          "move",
          "marquee",
          "blueprint-placement",
          "single-placement",
          "logistics-placement",
          "region-edit",
        ],
      },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        if (context.canvas.state.activeTool === "select") {
          const editor = context.canvas.editor;
          if (editor === null || editor.state.collections.selection.length === 0) {
            return { status: "ignored" };
          }
          editor.actions.clearCollection(EntityCollectionType.selection);
          context.canvas.actions.hideCanvasFloatingToolbar();
          return { status: "handled" };
        }
        if (context.canvas.state.activeTool === "blueprint-placement" && context.canvas.editor !== null) {
          cancelBlueprintPlacement(context.canvas, context.canvas.editor);
          return { status: "handled" };
        }
        context.canvas.actions.setActiveTool("select");
        return { status: "handled" };
      },
    }],
    handle(event, context) {

      if (event.type === "ui-button-touch-tap" || event.type === "ui-button-mouse-tap") {
        if (event.uiButtonId !== "placement-tool-select") {
          return { status: "ignored" };
        }

        if (event.type === "ui-button-mouse-tap" && event.button !== 0) {
          return { status: "ignored" };
        }

        context.canvas.actions.setActiveTool("select");
        return { status: "handled" };
      }

      if (event.type === "on-exit-active-tool") {
        if (event.from !== "select" || event.to === "select") {
          return { status: "ignored" };
        }

        context.canvas.actions.hideCanvasFloatingToolbar();
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "select") {
          return { status: "ignored" };
        }

        context.canvas.actions.hideCanvasFloatingToolbar();
        return { status: "handled" };
      }

      const editor = context.canvas.editor;
      if (editor === null || context.canvas.state.activeTool !== "select") {
        return { status: "ignored" };
      }

      const selectEntity = (options: {
        entityId: string;
        definitionId: string;
      }) => {
        const selection = editor.state.collections.selection;

        // 再点一下已选中的设备即取消选择；完整属性从设备卡片的“更多”打开。
        if (selection.length === 1 && selection.contains(options.entityId)) {
          clearSelection();
          return;
        }

        if (!selection.contains(options.entityId)) {
          editor.actions.clearCollection(EntityCollectionType.selection);
        }

        editor.actions.addToCollection({
          collectionType: EntityCollectionType.selection,
          entityId: options.entityId,
        });
      };

      const clearSelection = () => {
        editor.actions.clearCollection(EntityCollectionType.selection);
        context.canvas.actions.hideCanvasFloatingToolbar();

        if (context.canvas.canUseWorkbenchActions && context.canvas.workbench.internalState.workbench.rightDockOpen) {
          context.canvas.workbench.internalActions.toggleRightDock();
        }
      };

      switch (event.type) {
        case "mouse move": {
          if (editor.state.collections.selection.length === 0) {
            editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          } else {
            editor.actions.clearHoverPoint();
          }
          return { status: "handled", consume: false };
        }

        case "mouse tap":
          if (event.button === 2) {
            clearSelection();
            return { status: "handled" };
          }

          if (event.button !== 0 || event.pointerEntity === null) {
            return { status: "ignored" };
          }

          if (isEntitySpinTap(context.canvas, event.pointerEntity.id, event.position)) {
            spinEntity(context.canvas, editor, event.pointerEntity.id, event.position);
            return { status: "handled" };
          }
          recordEntityTap(context.canvas, event.pointerEntity.id, event.position);

          if (
            openOverlapEntityMenuIfNeeded({
              canvas: context.canvas,
              editor,
              position: event.position,
              pointerEntity: event.pointerEntity,
              onSelect: (entity) => {
                selectEntity({
                  entityId: entity.id,
                  definitionId: entity.definitionId,
                });
              },
            })
          ) {
            return { status: "handled" };
          }

          selectEntity({
            entityId: event.pointerEntity.id,
            definitionId: event.pointerEntity.definitionId,
          });
          return { status: "handled" };

        case "touch tap":
          if (event.pointerEntity === null) {
            return { status: "ignored" };
          }

          if (isEntitySpinTap(context.canvas, event.pointerEntity.id, event.position)) {
            spinEntity(context.canvas, editor, event.pointerEntity.id, event.position);
            return { status: "handled" };
          }
          recordEntityTap(context.canvas, event.pointerEntity.id, event.position);

          if (
            openOverlapEntityMenuIfNeeded({
              canvas: context.canvas,
              editor,
              position: event.position,
              pointerEntity: event.pointerEntity,
              onSelect: (entity) => {
                selectEntity({
                  entityId: entity.id,
                  definitionId: entity.definitionId,
                });
              },
            })
          ) {
            return { status: "handled" };
          }

          selectEntity({
            entityId: event.pointerEntity.id,
            definitionId: event.pointerEntity.definitionId,
          });
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}
