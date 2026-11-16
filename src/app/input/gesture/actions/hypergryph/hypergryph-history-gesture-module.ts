import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";

import type { GestureMappingModule } from "../types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "../shortcut-route-matching";

export function createHypergryphHistoryGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-history-gesture",
    shortcutRoutes: [
      {
        id: "history.undo",
        operation: "undo",
        actionId: SHORTCUT_KEY.UNDO,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.UNDO },
        scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          editor.actions.undoDocumentHistory();
          return { status: "handled", consume: true };
        },
      },
      {
        id: "history.redo",
        operation: "redo",
        actionId: SHORTCUT_KEY.REDO,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.REDO },
        scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          editor.actions.redoDocumentHistory();
          return { status: "handled", consume: true };
        },
      },
    ],
    // 单手持设备时没有键盘：两指轻点撤销，三指轻点重做。
    handle(event, context) {
      if (event.type !== "multi finger tap") {
        return { status: "ignored" };
      }
      const editor = context.canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }
      if (event.fingerCount === 2 && context.canvas.isOperationEnabled("undo")) {
        editor.actions.undoDocumentHistory();
        return { status: "handled" };
      }
      if (event.fingerCount === 3 && context.canvas.isOperationEnabled("redo")) {
        editor.actions.redoDocumentHistory();
        return { status: "handled" };
      }
      return { status: "ignored" };
    },
  };
}
