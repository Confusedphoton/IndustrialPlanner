import type { AppHost } from "@/app/host/app-host";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureMappingModule } from "../types";
import { cancelBlueprintPlacement } from "./hypergryph-blueprint-placement-gesture-module";
import { openOverlapEntityMenuIfNeeded } from "./overlap-entity-candidates";

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
          context.canvas.actions.hideCanvasRightDockToolbar();
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

      const revealInspector = () => {
        if (!context.canvas.canUseWorkbenchActions || !context.canvas.isOperationEnabled("open-inspector")) return;
        const selection = editor.state.collections.selection;
        if (selection.length === 1) {
          context.canvas.workbench.workspace.audio?.actions.playDeviceInspector(selection[0]!);
        }
        if (context.canvas.workbench.state.settings.gameUseInspectorPanel) {
          context.canvas.workbench.internalActions.setRightDockActiveTab("selection");
          if (!context.canvas.workbench.internalState.workbench.rightDockOpen) {
            context.canvas.workbench.internalActions.toggleRightDock();
          }
          return;
        }

        context.canvas.workbench.internalActions.openDialog("inspector");
      };

      const selectEntity = (options: {
        entityId: string;
        definitionId: string;
      }) => {
        const selection = editor.state.collections.selection;
        const openInspectorOnSecondClick =
          context.canvas.workbench.state.settings.hypergryphInspectorOpenOnSecondClick;

        if (selection.length === 1 && selection.contains(options.entityId)) {
          if (openInspectorOnSecondClick) {
            revealInspector();
            return;
          }

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

        if (
          context.canvas.canUseWorkbenchActions && context.canvas.workbench.state.settings.gameUseInspectorPanel
          && context.canvas.workbench.state.settings.hypergryphSelectionRightDockSync
          && !openInspectorOnSecondClick
        ) {
          context.canvas.workbench.internalActions.setRightDockActiveTab("selection");
          if (!context.canvas.workbench.internalState.workbench.rightDockOpen) {
            context.canvas.workbench.internalActions.toggleRightDock();
          }
        }
      };

      const clearSelection = () => {
        editor.actions.clearCollection(EntityCollectionType.selection);
        context.canvas.actions.hideCanvasFloatingToolbar();

        if (
          context.canvas.canUseWorkbenchActions && context.canvas.workbench.state.settings.gameUseInspectorPanel
          && context.canvas.workbench.internalState.workbench.rightDockOpen
        ) {
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
