import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { GestureMappingModule } from "./types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "./shortcut-route-matching";

/**
 * T 键打开工具箱（单向，不关闭）。
 * 工具箱打开后，dialog shell 会拦截所有键盘事件，因此 T 键不会触发二次打开或关闭。
 */
export function createToolboxOpenGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "toolbox-open-shortcut",
    shortcutRoutes: [{
      id: "open-toolbox.canvas",
      actionId: SHORTCUT_KEY.OPEN_TOOLBOX,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.OPEN_TOOLBOX },
      scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
      triggerPolicy: { kind: "exact" },
      claimsBrowserDefault: true,
      handle(_event, context) {
        context.canvas.workbench.internalActions.openDialog("toolbox");
        return { status: "handled", consume: true };
      },
    }],
    handle() {
      return { status: "ignored" };
    },
  };
}
