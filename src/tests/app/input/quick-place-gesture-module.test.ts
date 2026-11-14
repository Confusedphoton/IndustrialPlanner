import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";

import type { GestureEvent } from "@/app/input/gesture/adapter";
import {
  createQuickPlaceGestureModule,
} from "@/app/input/gesture/actions";
import type { WorldEntity } from "@/domain/document/world-document";


describe("createQuickPlaceGestureModule", () => {
  it("registers the configurable open shortcut on canvas select", () => {
    const module = createQuickPlaceGestureModule();
    const route = module.shortcutRoutes?.find((candidate) => candidate.id === "quick-place.open");

    expect(route).toMatchObject({
      actionId: SHORTCUT_KEY.QUICK_PLACE,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.QUICK_PLACE },
      scope: { inputLayers: ["canvas"], activeTools: ["select"] },
      triggerPolicy: { kind: "exact" },
    });
  });

  it("opens quick place at blank canvas double tap position", () => {
    const mouseContext = createContext();
    const touchContext = createContext();
    const mouseModule = createQuickPlaceGestureModule();
    const touchModule = createQuickPlaceGestureModule();

    expect(mouseModule.handle(mouseDoubleTapEvent(111, 222), mouseContext.context)).toEqual({
      status: "handled",
      consume: true,
    });
    expect(mouseContext.context.canvas.state.runtime.quickPlace).toEqual({
      visible: true,
      anchor: { x: 111, y: 222 },
      searchQuery: "",
      openSource: "pointer",
      activeResultId: null,
    });

    expect(touchModule.handle(touchDoubleTapEvent(333, 444), touchContext.context)).toEqual({
      status: "handled",
      consume: true,
    });
    expect(touchContext.context.canvas.state.runtime.quickPlace).toEqual({
      visible: true,
      anchor: { x: 333, y: 444 },
      searchQuery: "",
      openSource: "pointer",
      activeResultId: null,
    });
  });

  it("ignores double tap on entities or with modifiers", () => {
    const onEntity = createContext();
    const withModifier = createContext();
    const module = createQuickPlaceGestureModule();

    expect(module.handle(
      mouseDoubleTapEvent(111, 222, { pointerEntity: entity("entity-1") }),
      onEntity.context,
    )).toEqual({ status: "ignored" });
    expect(onEntity.context.canvas.state.runtime.quickPlace.visible).toBe(false);

    expect(module.handle(
      touchDoubleTapEvent(333, 444, { modifiers: { ...emptyModifiers(), shift: true } }),
      withModifier.context,
    )).toEqual({ status: "ignored" });
    expect(withModifier.context.canvas.state.runtime.quickPlace.visible).toBe(false);
  });

  it("ignores double tap outside select mode, when disabled, or outside canvas grid", () => {
    const nonSelect = createContext({ activeTool: "move" });
    const disabled = createContext({ quickPlaceEnabled: false });
    const outsideGrid = createContext({ gridCell: null });

    for (const { context } of [nonSelect, disabled, outsideGrid]) {
      const module = createQuickPlaceGestureModule();

      expect(module.handle(mouseDoubleTapEvent(111, 222), context)).toEqual({
        status: "ignored",
      });
      expect(context.canvas.state.runtime.quickPlace.visible).toBe(false);
    }
  });


  it("registers Escape on the quick-place input layer and closes when leaving the active tool", () => {
    const { context } = createContext({
      quickPlace: {
        visible: true,
        anchor: { x: 40, y: 60 },
        searchQuery: "abc",
        openSource: "keyboard-shortcut",
        activeResultId: null,
      },
    });
    const module = createQuickPlaceGestureModule();
    const closeRoute = module.shortcutRoutes?.find((route) => route.id === "quick-place.close");

    expect(closeRoute).toMatchObject({
      binding: { kind: "fixed", value: "Esc" },
      scope: { inputLayers: ["quick-place"] },
    });

    context.canvas.state.runtime.quickPlace = {
      visible: true,
      anchor: { x: 80, y: 90 },
      searchQuery: "belt",
      openSource: "pointer",
      activeResultId: null,
    };

    expect(module.handle(exitActiveToolEvent(), context)).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.quickPlace).toEqual({
      visible: false,
      anchor: null,
      searchQuery: "",
      openSource: null,
      activeResultId: null,
    });
  });
});

function createContext(options: {
  activeTool?: "select" | "move"; quickPlaceEnabled?: boolean; gridCell?: { x: number; y: number } | null;
  quickPlace?: { visible: boolean; anchor: { x: number; y: number } | null; searchQuery: string;
    openSource: "keyboard-shortcut" | "pointer" | null; activeResultId: string | null };
} = {}) {
  const test = createCanvasTestSession({ activeTool: options.activeTool }); cleanups.push(test.dispose);
  test.app.internalState.settings.quickPlaceEnabled = options.quickPlaceEnabled ?? true;
  if (options.gridCell !== null) test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
  if (options.quickPlace) test.canvas.state.runtime.quickPlace = options.quickPlace;
  return { context: test.context };
}


function mouseDoubleTapEvent(
  x: number,
  y: number,
  options: {
    readonly pointerEntity?: WorldEntity | null;
    readonly modifiers?: ReturnType<typeof emptyModifiers>;
    readonly button?: number;
    readonly longPress?: boolean;
  } = {},
): GestureEvent {
  return {
    type: "mouse double tap",
    gestureId: "mouse-double-tap-1",
    button: options.button ?? 0,
    buttons: 0,
    position: { x, y },
    longPress: options.longPress ?? false,
    pointerEntity: options.pointerEntity ?? null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDoubleTapEvent(
  x: number,
  y: number,
  options: {
    readonly pointerEntity?: WorldEntity | null;
    readonly modifiers?: ReturnType<typeof emptyModifiers>;
    readonly longPress?: boolean;
  } = {},
): GestureEvent {
  return {
    type: "touch double tap",
    gestureId: "touch-double-tap-1",
    primaryId: 1,
    position: { x, y },
    longPress: options.longPress ?? false,
    pointerEntity: options.pointerEntity ?? null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function entity(id: string): WorldEntity {
  return {
    id,
    definitionId: "belt_straight_1x1",
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}


function exitActiveToolEvent(): GestureEvent {
  return {
    type: "on-exit-active-tool",
    gestureId: "exit-active-tool-1",
    from: "select",
    to: "move",
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}

