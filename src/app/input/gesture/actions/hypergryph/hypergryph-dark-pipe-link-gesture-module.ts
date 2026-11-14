import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import { runInAction } from "mobx";
import {
  DARK_PIPE_LINK_TOOL,
  findRegionalDarkPipeLinkForEndpoint,
  findDarkPipeSlotLinkForEntity,
  isDarkPipeDefinitionId,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";

import type { GestureMappingModule } from "../types";

export function createHypergryphDarkPipeLinkGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-dark-pipe-link-gesture",
    priority: 130,
    shortcutRoutes: [{
      id: "dark-pipe-link.cancel",
      actionId: "fixed.dark-pipe-link.cancel",
      binding: { kind: "fixed", value: "Esc" },
      scope: { inputLayers: ["canvas"], activeTools: ["dark-pipe-link"] },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        const state = context.canvas.state.toolInfo.darkPipeLink;
        if (state === null) return { status: "ignored" };
        exitDarkPipeLinkTool(context.canvas, state.returnTool);
        return { status: "handled" };
      },
    }],
    handle(event, context) {
      if (event.type === "on-exit-active-tool") {
        if (event.from !== DARK_PIPE_LINK_TOOL) {
          return { status: "ignored" };
        }

        context.canvas.state.toolInfo.darkPipeLink = null;
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== DARK_PIPE_LINK_TOOL) {
          return { status: "ignored" };
        }

        if (context.canvas.state.toolInfo.darkPipeLink === null) {
          context.canvas.actions.setActiveTool("select");
        }
        return { status: "handled" };
      }

      if (context.canvas.state.activeTool !== DARK_PIPE_LINK_TOOL) {
        return { status: "ignored" };
      }

      const state = context.canvas.state.toolInfo.darkPipeLink;
      if (state === null) {
        context.canvas.actions.setActiveTool("select");
        return { status: "handled" };
      }

      if (event.type === "mouse move") {
        const editor = context.canvas.editor;
        if (editor === null) return { status: "ignored" };

        const entity = editor.queries.findEntityAtClientPixelPoint(event.position, context.canvas.view.state);
        if (entity !== null && isDarkPipeDefinitionId(entity.definitionId)) {
          editor.actions.setHoverPoint(event.position, context.canvas.view.state);
        } else {
          editor.actions.clearHoverPoint();
        }
        return { status: "handled", consume: false };
      }


      if (event.type === "mouse tap") {
        if (event.button === 2) {
          exitDarkPipeLinkTool(context.canvas, state.returnTool);
          return { status: "handled" };
        }
        if (event.button !== 0) {
          return { status: "ignored" };
        }

        return handleDarkPipeTargetTap(context.canvas, event.pointerEntity?.id ?? null);
      }

      if (event.type === "touch tap") {
        return handleDarkPipeTargetTap(context.canvas, event.pointerEntity?.id ?? null);
      }

      return { status: "ignored" };
    },
  };
}

function handleDarkPipeTargetTap(
  canvas: CanvasInteractionController,
  targetEntityId: string | null,
) {
  const state = canvas.state.toolInfo.darkPipeLink;
  const editor = canvas.editor;
  if (state === null) {
    canvas.actions.setActiveTool("select");
    return { status: "handled" as const };
  }
  if (canvas.workbench.regionalSettings.darkPipeLinkSaving || editor === null || targetEntityId === null) {
    return { status: "handled" as const };
  }
  const document = editor.document.getSnapshot();
  const target = document.entities[targetEntityId];
  if (target === undefined || resolveDarkPipeRole(target.definitionId) !== (state.sourceRole === "inlet" ? "outlet" : "inlet")
    || findDarkPipeSlotLinkForEntity(document, targetEntityId) !== null
    || findRegionalDarkPipeLinkForEndpoint(editor.queries.getRegionalDarkPipeLinks(), { baseId: document.baseId, entityId: targetEntityId }) !== null) {
    return { status: "handled" as const };
  }
  if (document.baseId !== state.sourceBaseId || !state.candidateEntityIds.includes(targetEntityId)) {
    return { status: "handled" as const };
  }

  runInAction(() => {
    canvas.workbench.regionalSettings.darkPipeLinkSaving = true;
    canvas.workbench.regionalSettings.darkPipeLinkSaveFailed = false;
  });
  void editor.actions.createDarkPipeLink({
    sourceBaseId: state.sourceBaseId,
    sourceEntityId: state.sourceEntityId,
    targetBaseId: document.baseId,
    targetEntityId,
  }).then(created => {
    runInAction(() => {
      if (canvas.state.toolInfo.darkPipeLink !== state) return;
      canvas.workbench.regionalSettings.darkPipeLinkSaveFailed = !created;
      if (created) exitDarkPipeLinkTool(canvas, state.returnTool);
    });
  }).catch(() => {
    runInAction(() => {
      if (canvas.state.toolInfo.darkPipeLink === state) canvas.workbench.regionalSettings.darkPipeLinkSaveFailed = true;
    });
  }).finally(() => {
    runInAction(() => { canvas.workbench.regionalSettings.darkPipeLinkSaving = false; });
  });
  return { status: "handled" as const };
}


function exitDarkPipeLinkTool(
  canvas: CanvasInteractionController,
  returnTool: CanvasInteractionController["state"]["activeTool"],
): void {
  runInAction(() => {
    canvas.state.toolInfo.darkPipeLink = null;
    canvas.actions.setActiveTool(returnTool === DARK_PIPE_LINK_TOOL ? "select" : returnTool);
  });
}
