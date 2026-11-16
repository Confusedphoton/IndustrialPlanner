import type { CanvasInteractionController } from "@/app/canvas";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { runInAction } from "mobx";
import { canPlaceEntityDefinitionInBase } from "@/app/placement-zone-availability";
import {
  QUICK_PLACE_SLOT_SHORTCUTS,
  buildQuickPlaceDeviceEntries,
  filterQuickPlaceDeviceEntries,
  normalizeQuickPlaceFavorites,
  triggerQuickPlaceDeviceSelection,
} from "@/app/quick-place";
import type {
  GestureActionContext,
  GestureMappingModule,
  KeyboardGestureEvent,
  ShortcutActionRoute,
} from "./types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "./shortcut-route-matching";

export function createQuickPlaceGestureModule(): GestureMappingModule<AppHost> {
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "quick-place-shortcut",
    shortcutRoutes: [
      {
        id: "quick-place.close",
        actionId: "fixed.quick-place.close",
        binding: { kind: "fixed", value: "Esc" },
        scope: { inputLayers: ["quick-place"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        handle(_event, context) {
          closeQuickPlace(context.canvas);
          return { status: "handled", consume: true };
        },
      },
      {
        id: "quick-place.open",
        operation: "quick-place",
        actionId: SHORTCUT_KEY.QUICK_PLACE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.QUICK_PLACE },
        scope: { inputLayers: ["canvas"], activeTools: ["select"] },
        triggerPolicy: { kind: "exact" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          return tryOpenQuickPlaceAt(context, lastMousePosition, "keyboard-shortcut")
            ? { status: "handled", consume: true }
            : { status: "ignored" };
        },
      },
      ...QUICK_PLACE_SLOT_SHORTCUTS.map<ShortcutActionRoute<AppHost>>((shortcut, shortcutIndex) => ({
        id: `quick-place.favorite-${shortcutIndex}`,
        operation: "quick-place",
        actionId: `fixed.quick-place.favorite-${shortcutIndex}`,
        binding: { kind: "fixed" as const, value: shortcut },
        scope: { inputLayers: ["quick-place"] as const, activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" as const },
        handle: (event, context) => selectQuickPlaceFavorite(context, shortcutIndex, event),
      })),
      {
        id: "quick-place.result-next",
        operation: "quick-place",
        actionId: "fixed.quick-place.result-next",
        binding: { kind: "fixed", value: "ArrowDown" },
        scope: { inputLayers: ["quick-place"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        handle(event, context) {
          return moveQuickPlaceActiveResult(context, event, 1);
        },
      },
      {
        id: "quick-place.result-previous",
        operation: "quick-place",
        actionId: "fixed.quick-place.result-previous",
        binding: { kind: "fixed", value: "ArrowUp" },
        scope: { inputLayers: ["quick-place"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        handle(event, context) {
          return moveQuickPlaceActiveResult(context, event, -1);
        },
      },
      {
        id: "quick-place.confirm",
        operation: "quick-place",
        actionId: "fixed.quick-place.confirm",
        binding: { kind: "fixed", value: "Enter" },
        scope: { inputLayers: ["quick-place"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        handle(event, context) {
          return confirmQuickPlaceActiveResult(context, event);
        },
      },
    ],
    handle(event, context) {
      if (event.type === "mouse move") {
        lastMousePosition = event.position;
        return { status: "ignored" };
      }

      if (event.type === "on-exit-active-tool") {
        if (context.canvas.state.runtime.quickPlace.visible) {
          closeQuickPlace(context.canvas);
          return { status: "handled" };
        }

        return { status: "ignored" };
      }

      if (event.type === "mouse double tap" || event.type === "touch double tap") {
        if (
          event.pointerEntity !== null
          || event.longPress
          || hasActiveModifier(event.modifiers)
          || (event.type === "mouse double tap" && event.button !== 0)
        ) {
          return { status: "ignored" };
        }

        if (tryOpenQuickPlaceAt(context, event.position, "pointer")) {
          return { status: "handled", consume: true };
        }

        return { status: "ignored" };
      }

      return { status: "ignored" };
    },
  };
}

function tryOpenQuickPlaceAt(
  context: GestureActionContext<AppHost>,
  position: GesturePosition | null,
  openSource: "keyboard-shortcut" | "pointer",
): boolean {
  if (
    context.canvas.state.activeTool !== "select"
    || !context.canvas.workbench.internalState.settings.quickPlaceEnabled
  ) {
    return false;
  }

  const editor = context.canvas.editor;
  if (
    editor === null
    || position === null
    || context.canvas.view.queries.findGridCellForClientPixelPoint(position) === null
  ) {
    return false;
  }

  openQuickPlace(context.canvas, position, openSource);
  return true;
}

export function openQuickPlace(
  canvas: CanvasInteractionController,
  anchor: GesturePosition,
  openSource: "keyboard-shortcut" | "pointer",
): void {
  runInAction(() => {
    canvas.state.runtime.quickPlace.visible = true;
    canvas.state.runtime.quickPlace.anchor = anchor;
    canvas.state.runtime.quickPlace.searchQuery = "";
    canvas.state.runtime.quickPlace.openSource = openSource;
    canvas.state.runtime.quickPlace.activeResultId = null;
  });
}

function closeQuickPlace(canvas: CanvasInteractionController): void {
  runInAction(() => {
    canvas.state.runtime.quickPlace.visible = false;
    canvas.state.runtime.quickPlace.anchor = null;
    canvas.state.runtime.quickPlace.searchQuery = "";
    canvas.state.runtime.quickPlace.openSource = null;
    canvas.state.runtime.quickPlace.activeResultId = null;
  });
}

function selectQuickPlaceFavorite(
  context: GestureActionContext<AppHost>,
  shortcutIndex: number,
  event: KeyboardGestureEvent,
) {
  const entries = buildCurrentQuickPlaceEntries(context);
  const favorites = normalizeQuickPlaceFavorites(
    context.canvas.workbench.internalState.workbench.quickPlaceFavoriteEntityIds,
    new Set(entries.map((entry) => entry.id)),
  );
  const deviceId = favorites[shortcutIndex];
  if (deviceId === null || deviceId === undefined) {
    return { status: "ignored" as const };
  }

  selectQuickPlaceDevice(context.canvas, deviceId, event);
  return { status: "handled" as const, consume: true };
}

function moveQuickPlaceActiveResult(
  context: GestureActionContext<AppHost>,
  event: KeyboardGestureEvent,
  delta: -1 | 1,
) {
  if (!isQuickPlaceSearchKeyboardEvent(event)) {
    return { status: "ignored" as const };
  }

  const entries = filterQuickPlaceDeviceEntries(
    buildCurrentQuickPlaceEntries(context),
    context.canvas.state.runtime.quickPlace.searchQuery,
    context.canvas.state.runtime.quickPlace.category,
  );
  if (entries.length === 0) {
    return { status: "ignored" as const };
  }

  const currentId = context.canvas.state.runtime.quickPlace.activeResultId;
  const currentIndex = currentId === null
    ? -1
    : entries.findIndex((entry) => entry.id === currentId);
  const nextIndex = currentIndex < 0
    ? (delta > 0 ? 0 : entries.length - 1)
    : Math.min(entries.length - 1, Math.max(0, currentIndex + delta));
  runInAction(() => {
    context.canvas.state.runtime.quickPlace.activeResultId = entries[nextIndex]?.id ?? null;
  });
  return { status: "handled" as const, consume: true };
}

function confirmQuickPlaceActiveResult(
  context: GestureActionContext<AppHost>,
  event: KeyboardGestureEvent,
) {
  if (!isQuickPlaceSearchKeyboardEvent(event)) {
    return { status: "ignored" as const };
  }

  const entries = filterQuickPlaceDeviceEntries(
    buildCurrentQuickPlaceEntries(context),
    context.canvas.state.runtime.quickPlace.searchQuery,
    context.canvas.state.runtime.quickPlace.category,
  );
  const activeResultId = context.canvas.state.runtime.quickPlace.activeResultId;
  const entry = activeResultId === null
    ? entries[0]
    : entries.find((candidate) => candidate.id === activeResultId) ?? entries[0];
  if (entry === undefined) {
    return { status: "ignored" as const };
  }

  selectQuickPlaceDevice(context.canvas, entry.id, event);
  return { status: "handled" as const, consume: true };
}

function buildCurrentQuickPlaceEntries(context: GestureActionContext<AppHost>) {
  const currentBaseId = context.canvas.editor?.document.getSnapshot().baseId ?? null;
  return buildQuickPlaceDeviceEntries({
    definitions: context.canvas.registry.entityDefinitions,
    translate: context.canvas.workbench.actions.translate,
    canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(
      context.canvas.workbench,
      definition,
      currentBaseId,
    ),
  });
}

function selectQuickPlaceDevice(
  canvas: CanvasInteractionController,
  deviceId: string,
  event: KeyboardGestureEvent,
): void {
  closeQuickPlace(canvas);
  triggerQuickPlaceDeviceSelection({
    appHost: canvas,
    deviceId,
    source: "mouse",
    button: 0,
    altKey: event.modifiers.alt,
    ctrlKey: event.modifiers.ctrl,
    metaKey: event.modifiers.meta,
    shiftKey: event.modifiers.shift,
    sourceEvent: event.sourceEvent,
  });
}

function isQuickPlaceSearchKeyboardEvent(event: KeyboardGestureEvent): boolean {
  const sourceEvent = event.sourceEvent as {
    readonly isComposing?: boolean;
    readonly target?: { readonly tagName?: string };
  } | null;

  return sourceEvent?.isComposing !== true
    && sourceEvent?.target?.tagName?.toLowerCase() === "input";
}

function hasActiveModifier(modifiers: {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}): boolean {
  return modifiers.alt || modifiers.ctrl || modifiers.meta || modifiers.shift;
}
