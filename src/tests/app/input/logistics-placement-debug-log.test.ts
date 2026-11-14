import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile, createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
const cleanups: Array<() => void> = [];
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions";

import type { GestureEvent } from "@/app/input/gesture/adapter";

import {
  createHypergryphLogisticsPlacementGestureModule,

} from "@/app/input/gesture/actions";



import type {

  LogisticsKind,
} from "@/domain/shared/logistics";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import {
  getLogLevel,
  setLogLevel,
  type LogLevel,
} from "@/shared/logging/logger";
import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("logistics placement debug logging", () => {
  let previousLogLevel: LogLevel;

  beforeEach(() => {
    previousLogLevel = getLogLevel();
    setLogLevel("debug");
  });

  afterEach(() => {
    for (const dispose of cleanups.splice(0).reverse()) dispose();
    setLogLevel(previousLogLevel);
    vi.restoreAllMocks();
  });

  it("logs that an empty pipe source is disabled when a left click cannot start placement", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { context, editor } = createContext({
      allowEmptySource: false,
      kind: LOGISTICS_KIND.pipe,
      hasDraft: false,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(mouseLeftTapEvent(), context)).toEqual({ status: "ignored" });
    expect(editor.actions.createLogisticsDraftStart).not.toHaveBeenCalled();
    expect(context.canvas.actions.showCanvasToast).toHaveBeenCalledWith("canvas.toast.pipeStart");
    expect(debugSpy).toHaveBeenCalledWith(
      "[industrial-planner:logistics-placement] "
        + "mouse-left-tap 起笔失败: empty-source-disallowed",
      expect.objectContaining({
        failureStage: "start",
        failureType: "起笔失败",
        failureReason: "empty-source-disallowed",
        kind: "pipe",
        gridPoint: { x: 6, y: 4 },
        pointerEntityId: null,
      }),
    );
  });

  it("logs the editor invalid reason when a left click cannot apply a belt draft", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const hasDraft = true;
    const { context, editor } = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      hasDraft,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(mouseLeftTapEvent(), context)).toEqual({ status: "handled" });
    expect(editor.actions.applyLogisticDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.runtime.logisticsPlacement.statusMessageKey).toBe(
      "overlap-existing-logistics",
    );
    expect(debugSpy).toHaveBeenCalledWith(
      "[industrial-planner:logistics-placement] "
        + "mouse-left-tap 落笔失败: overlap-existing-logistics",
      expect.objectContaining({
        failureStage: "apply",
        failureType: "落笔失败",
        failureReason: "overlap-existing-logistics",
        kind: "belt",
        invalidReason: "overlap-existing-logistics",
        canApply: false,
        cellCount: 1,
      }),
    );
  });

  it("logs that a long left press is not a logistics placement click", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { context, editor } = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      hasDraft: false,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(mouseLeftTapEvent(true), context)).toEqual({ status: "ignored" });
    expect(editor.actions.createLogisticsDraftStart).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      "[industrial-planner:logistics-placement] "
        + "mouse-left-tap 起笔失败: long-press-does-not-place-logistics",
      expect.objectContaining({
        failureStage: "start",
        failureType: "起笔失败",
        failureReason: "long-press-does-not-place-logistics",
        kind: "belt",
        position: { x: 6, y: 4 },
      }),
    );
  });

  it("switches route order through the configured rotate shortcut", () => {
    const { context, appHost } = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      hasDraft: false,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    const shortcutBindings = { [SHORTCUT_KEY.ROTATE]: "T" };
    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent("KeyR", "r"),
      shortcutBindings,
    })).toEqual({ status: "ignored" });
    expect(context.canvas.state.runtime.logisticsPlacement.routeOrder).toBe("vertical-first");
    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent("KeyT", "t"),
      shortcutBindings,
    })).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.logisticsPlacement.routeOrder).toBe("horizontal-first");
    expect(appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
  });

  it("shows logistics shortcuts from kind and placement phase", () => {
    const beltStart = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      hasDraft: false,
    });
    const pipeEnd = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.pipe,
      hasDraft: true,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(onEnterActiveToolEvent(), beltStart.context)).toEqual({
      status: "handled",
    });
    expect(beltStart.context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith([
      { operationId: "pan-viewport", presentation: "shortcut" },
      { operationId: "zoom-viewport", presentation: "shortcut" },
      { operationId: "confirm-logistics-start", presentation: "shortcut" },
      { operationId: "change-belt-route-priority", presentation: "shortcut" },
    ]);

    expect(module.handle(onEnterActiveToolEvent(), pipeEnd.context)).toEqual({
      status: "handled",
    });
    expect(pipeEnd.context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith([
      { operationId: "pan-viewport", presentation: "shortcut" },
      { operationId: "zoom-viewport", presentation: "shortcut" },
      { operationId: "confirm-logistics-end", presentation: "shortcut" },
      { operationId: "change-pipe-route-priority", presentation: "shortcut" },
    ]);
  });
});



function onEnterActiveToolEvent(): Extract<
  GestureEvent,
  { type: "on-enter-active-tool" }
> {
  return {
    type: "on-enter-active-tool",
    gestureId: "enter-logistics-placement",
    from: "select",
    to: "logistics-placement",
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}



function mouseLeftTapEvent(
  longPress = false,
): Extract<GestureEvent, { type: "mouse tap" }> {
  return {
    type: "mouse tap",
    gestureId: "mouse-left-tap-1",
    button: 0,
    buttons: 0,
    position: { x: 6, y: 4 },
    longPress,
    pointerEntity: null,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}

function keyDownEvent(code: string, key: string): Extract<GestureEvent, { type: "key down" }> {
  return {
    type: "key down",
    gestureId: `key-down-${code}`,
    code,
    key,
    keyCode: 0,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}



function createContext(options: { allowEmptySource: boolean; kind: LogisticsKind; hasDraft: boolean }) {
  const test = createCanvasTestSession({ activeTool: "logistics-placement",
    document: options.hasDraft ? createWorldDocumentFromBlueprint(loadBlueprintFromFile(
      "src/tests/fixtures/blueprints/collections/req048/logistics-debug-" + options.kind + ".schema7.json")) : undefined,
    viewport: { center: { x: 50, y: 50 }, gridSize: 1 / 16, displayRotation: 0 } });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
  test.app.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = options.allowEmptySource;
  test.app.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = false;
  const runtime = test.canvas.state.runtime.logisticsPlacement;
  runtime.kind = options.kind; runtime.pointerMode = "mouse"; runtime.routeOrder = "vertical-first";
  runtime.phase = options.hasDraft ? "drawing" : "idle"; runtime.isHoverPreview = false;
  if (options.hasDraft) {
    test.editor.actions.createLogisticsDraftStart({ kind: options.kind,
      source: { type: "empty-cell", gridPoint: { x: 6, y: 4 } } });
    expect(test.editor.queries.resolveLogisticsDraftState()).toMatchObject({
      canApply: false, invalidReason: "overlap-existing-logistics", cells: [expect.anything()],
    });
    runtime.headGridPoint = { x: 6, y: 4 };
  }
  vi.spyOn(test.editor.actions, "applyLogisticDraft");
  vi.spyOn(test.editor.actions, "createLogisticsDraftStart");
  vi.spyOn(test.canvas.actions, "showCanvasToast");
  vi.spyOn(test.canvas.actions, "showCanvasRightDockToolbar");
  vi.spyOn(test.app.internalActions, "isShortcutFor");
  return { context: test.context, editor: test.editor, appHost: test.app };
}
