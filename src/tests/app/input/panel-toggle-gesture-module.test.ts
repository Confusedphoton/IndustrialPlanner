import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";




import {
  createPanelToggleGestureModule,
} from "@/app/input/gesture/actions";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";



describe("createPanelToggleGestureModule", () => {
  it("opens and switches to the target panel when left dock is closed", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: false,
      activePanel: "placement",
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyL", key: "l" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("blueprint");
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
  });

  it("switches panel without collapsing when left dock is open and target differs", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "placement",
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyK", key: "k" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("base");
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
  });

  it("collapses left dock when target panel is already active", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "base",
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyK", key: "k" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.toggleLeftDock).toHaveBeenCalledTimes(1);
    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
  });

  it("treats null activePanel as placement to match toolbar behavior", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: null,
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyP", key: "p" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.toggleLeftDock).toHaveBeenCalledTimes(1);
    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
  });

  it("supports key fallback when code is unavailable", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: false,
      activePanel: "placement",
    });
    const module = createPanelToggleGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: null, key: "L" }),
    });

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("blueprint");
  });

  it("ignores non-target keys, modifier keys, and non-keydown events", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "placement",
    });
    const module = createPanelToggleGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyM", key: "m" }),
    })).toEqual({ status: "ignored" });
    expect(
      handleKeyboardShortcutThroughRouter({
        module,
        context,
        event: keyDownEvent({
          code: "KeyP",
          key: "p",
          modifiers: { alt: false, ctrl: true, meta: false, shift: false },
        }),
      }),
    ).toEqual({ status: "ignored" });
    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyUpEvent({ code: "KeyP", key: "p" }),
    })).toEqual({ status: "ignored" });

    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
  });
});

function createContext(options: { leftDockOpen: boolean; activePanel: "placement" | "blueprint" | "base" | "simulation" | null }) {
  const test = createCanvasTestSession(); cleanups.push(test.dispose);
  test.app.internalState.workbench.leftDockOpen = options.leftDockOpen;
  test.app.internalState.runtime.activePanel = options.activePanel;
  const internalActions = { setActivePanel: vi.spyOn(test.app.internalActions, "setActivePanel"),
    toggleLeftDock: vi.spyOn(test.app.internalActions, "toggleLeftDock"), isShortcutFor: vi.spyOn(test.app.internalActions, "isShortcutFor") };
  return { context: test.context, internalActions };
}

function keyDownEvent(options: {
  code: string | null;
  key: string | null;
  modifiers?: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
}) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function keyUpEvent(options: { code: string | null; key: string | null }) {
  return {
    type: "key up" as const,
    gestureId: "key-up-1",
    code: options.code,
    key: options.key,
    keyCode: null,
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

