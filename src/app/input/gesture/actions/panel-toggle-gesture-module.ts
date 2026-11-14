import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { GestureMappingModule } from "./types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "./shortcut-route-matching";

const TOGGLE_KEY_TO_PANEL = {
  [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "placement",
  [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "blueprint",
  [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]: "history",
  [SHORTCUT_KEY.TOGGLE_BASE_PANEL]: "base",
} as const;

export function createPanelToggleGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "panel-toggle-shortcut",
    shortcutRoutes: (Object.entries(TOGGLE_KEY_TO_PANEL) as Array<[
      ShortcutKeyId,
      "placement" | "blueprint" | "history" | "base",
    ]>).map(([shortcutId, panel]) => ({
      id: `toggle-panel.${panel}`,
      actionId: shortcutId,
      binding: { kind: "configurable" as const, shortcutId },
      scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
      triggerPolicy: { kind: "exact" as const },
      claimsBrowserDefault: true,
      handle: (_event, context) => togglePanel(context.canvas, panel),
    })),
    handle() {
      return { status: "ignored" };
    },
  };
}

/*
function resolveTargetPanel(
  internalActions: AppHost["internalActions"],
  code: string | null,
  key: string | null,
  modifiers: {
    readonly alt: boolean;
    readonly ctrl: boolean;
    readonly meta: boolean;
    readonly shift: boolean;
  },
): "placement" | "blueprint" | "history" | "base" | null {
  for (const [shortcutKeyId, panel] of Object.entries(TOGGLE_KEY_TO_PANEL)) {
    if (
      internalActions.isShortcutFor(
        shortcutKeyId,
        code,
        key?.trim() ?? null,
        modifiers,
      )
    ) {
      return panel;
    }
  }
  return null;
}
*/
function togglePanel(
  canvas: CanvasInteractionController,
  targetPanel: "placement" | "blueprint" | "history" | "base",
) {
  const leftDockOpen = canvas.workbench.state.workbench.leftDockOpen;
  const activePanel = canvas.workbench.internalState.runtime.activePanel ?? "placement";
  if (leftDockOpen && activePanel === targetPanel) {
    canvas.workbench.internalActions.toggleLeftDock();
    return { status: "handled" as const, consume: true };
  }

  canvas.workbench.internalActions.setActivePanel(targetPanel);
  return { status: "handled" as const, consume: true };
}
