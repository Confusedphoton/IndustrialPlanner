

import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions";
import type { AppHost } from "@/app/host";
import type { GestureMappingModule, GestureActionContext } from "../types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "../shortcut-route-matching";

type PanDirection = "up" | "down" | "left" | "right";
const PAN_DIRECTION_SHORTCUTS: ReadonlyArray<readonly [ShortcutKeyId, PanDirection]> = [
  [SHORTCUT_KEY.PAN_VIEWPORT_UP, "up"], [SHORTCUT_KEY.PAN_VIEWPORT_DOWN, "down"],
  [SHORTCUT_KEY.PAN_VIEWPORT_LEFT, "left"], [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, "right"],
];

/** 屏幕每轴 1280 px/s；Shift 倍速。时间由画布 owner 传入，失焦/卸载立即取消。 */
export function createHypergryphKeyboardViewportPanModule(): GestureMappingModule<AppHost> {
  const pressed = new Map<string, PanDirection>();
  let lastTimeMs: number | null = null;
  const cancel = (): void => { pressed.clear(); lastTimeMs = null; };
  const prune = (context: GestureActionContext<AppHost>): void => {
    for (const code of pressed.keys()) if (!context.keyboard.pressedKeys.has(code)) pressed.delete(code);
    if (pressed.size === 0) lastTimeMs = null;
  };
  return {
    id: "hypergryph-keyboard-viewport-pan",
    cancel,
    needsFrame: () => pressed.size > 0,
    advanceFrame(timeMs, context) {
      prune(context);
      const availability = context.canvas.getOperationAvailability("pan-viewport");
      if (pressed.size === 0 || !availability.supported || !availability.enabled) { cancel(); return; }
      if (!Number.isFinite(timeMs) || timeMs < 0 || (lastTimeMs !== null && timeMs <= lastTimeMs)) return;
      const elapsed = lastTimeMs === null ? 0 : timeMs - lastTimeMs;
      lastTimeMs = timeMs;
      const speed = 1280 * (context.keyboard.modifiers.shift ? 2 : 1);
      const directions = new Set(pressed.values());
      const dx = Number(directions.has("left")) - Number(directions.has("right"));
      const dy = Number(directions.has("up")) - Number(directions.has("down"));
      if (elapsed > 0 && (dx !== 0 || dy !== 0)) context.canvas.view.actions.moveViewportByClientPixelVector({
        startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: dx * speed * elapsed / 1000, y: dy * speed * elapsed / 1000 },
      });
    },
    shortcutRoutes: PAN_DIRECTION_SHORTCUTS.map(([shortcutId, direction]) => ({
      id: "viewport-pan." + direction, actionId: shortcutId,
      operation: "pan-viewport",
      binding: { kind: "configurable" as const, shortcutId },
      scope: { inputLayers: ["canvas"] as const, activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
      triggerPolicy: { kind: "allow-additional-modifiers" as const, modifiers: ["shift"] as const },
      events: ["key down", "key up"] as const, claimsBrowserDefault: true,
      handle(event, context) {
        const code = event.code ?? event.key;
        if (code === null) return { status: "ignored" };
        if (event.type === "key up") { pressed.delete(code); prune(context); return { status: "handled" }; }
        const availability = context.canvas.getOperationAvailability("pan-viewport");
        if (!availability.supported || !availability.enabled) return { status: "ignored" };
        pressed.set(code, direction);
        return { status: "handled" };
      },
    })),
    handle(event, context) {
      if (event.type === "key up") prune(context);
      return { status: "ignored" };
    },
  };
}
