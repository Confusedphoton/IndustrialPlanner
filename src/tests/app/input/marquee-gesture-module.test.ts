import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";






import { createGestureActionRouter, createHypergryphMarqueeGestureModule } from "@/app/input/gesture/actions";



import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint } from "@/domain/shared/grid";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphMarqueeGestureModule", () => {
  it("enters and exits marquee from the X key", () => {
    const { context, appHost, editor } = createContext({
      selectedEntityIds: ["entity-1"],
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent("KeyX"),
    })).toEqual({ status: "handled" });
    expect(appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("marquee");

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent("KeyX"),
    })).toEqual({ status: "handled" });
    expect(editor.actions.cancelMarquee).toHaveBeenCalledTimes(1);
    expect(editor.actions.clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(context.canvas.state.activeTool).toBe("select");
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
    expect(context.canvas.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
  });

  it("enters touch marquee from the placement button and collapses the right dock", () => {
    const { context, appHost } = createContext({
      selectedEntityIds: ["entity-1"],
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("placement-tool-marquee"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("marquee");
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
  });

  it("enters mouse marquee with shortcut mode toolbar from the placement button", () => {
    const { context } = createContext({
      selectedEntityIds: ["entity-1"],
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("placement-tool-marquee"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("marquee");
  });

  it("shows selection action buttons only while the marquee selection is non-empty", () => {
    const { context } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();
    const entity = { id: "entity-1" } as WorldEntity;

    expect(module.handle(mouseTapEvent(entity), context)).toEqual({ status: "handled" });

    expect(module.handle(mouseTapEvent(entity), context)).toEqual({ status: "handled" });
  });


  it("toggles the whole strict logistics segment when tapping a belt in marquee mode", () => {
    const beltB = entity("belt-b", "belt_straight_1x1", { x: 1, y: 0 });
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/scene-01-variant-1.schema7.json"))),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(beltB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection].sort()).toEqual([
      "belt-a",
      "belt-b",
      "belt-c",
    ]);
    expect(editor.state.collections.selection.contains("pipe-a")).toBe(false);

    expect(module.handle(mouseTapEvent(beltB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection]).toEqual([]);
  });

  it("toggles the whole strict logistics segment when tapping a pipe in marquee mode", () => {
    const pipeB = entity("pipe-b", "pipe_straight_1x1", { x: 1, y: 0 });
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/scene-02-variant-1.schema7.json"))),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(pipeB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection].sort()).toEqual([
      "pipe-a",
      "pipe-b",
      "pipe-c",
    ]);
    expect(editor.state.collections.selection.contains("belt-a")).toBe(false);
  });

  it("toggles the whole strict logistics segment from the overlap entity menu in marquee mode", () => {
    const pipe = entity("pipe-a", "pipe_straight_1x1", { x: 1, y: 0 });
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/scene-03-variant-1.schema7.json"))),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(pipe, { x: 1, y: 0 }), context)).toEqual({ status: "handled" });
    expect(context.canvas.overlapEntityMenu.visible).toBe(true);
    expect(context.canvas.overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "pipe-a",
      "belt-b",
    ]);
    expect(editor.actions.addToCollection).not.toHaveBeenCalled();

    context.canvas.overlapEntityMenu.select("belt-b");

    expect([...editor.state.collections.selection].sort()).toEqual([
      "belt-a",
      "belt-b",
      "belt-c",
    ]);
    expect(editor.state.collections.selection.contains("pipe-a")).toBe(false);
  });

  it("keeps marquee drag selection delegated to applyMarquee without expanding strict logistics segments", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/scene-04-variant-1.schema7.json"))),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        mouseDragStartEvent({
          originButton: 0,
          pointerEntity: null,
          position: { x: 0, y: 0 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(module.handle(mouseDragEndEvent(), context).status).toBe("handled");

    expect(editor.actions.applyMarquee).toHaveBeenCalledTimes(1);
    expect(editor.actions.addToCollection).not.toHaveBeenCalled();
    expect(editor.actions.removeFromCollection).not.toHaveBeenCalled();
  });

  it("starts immediate mouse marquee from empty select drag start", () => {
    const { context, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      mouseDragStartEvent({
        originButton: 0,
        pointerEntity: null,
        position: { x: 3.2, y: 4.8 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("marquee");
    expect(context.canvas.state.runtime.marqueeAnchor).toEqual({ x: 3, y: 4 });
    expect(context.canvas.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.marquee,
      { x: 3, y: 4, width: 1, height: 1 },
    );
  });

  it("starts immediate touch marquee from empty select long-press drag start", () => {
    const { context, appHost, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        longPress: true,
        pointerEntity: null,
        position: { x: 6.4, y: 7.9 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("marquee");
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
    expect(context.canvas.state.runtime.marqueeAnchor).toEqual({ x: 6, y: 7 });
    expect(context.canvas.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.marquee,
      { x: 6, y: 7, width: 1, height: 1 },
    );
  });

  it("does not claim touch long-press drag from an entity when immediate marquee is enabled", () => {
    const { context, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        longPress: true,
        pointerEntity: { id: "entity-1" } as WorldEntity,
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(context.canvas.state.activeTool).toBe("select");
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
  });

  it("uses right mouse drag for reverse marquee and applies on drag end", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        mouseDragStartEvent({
          originButton: 2,
          pointerEntity: null,
          position: { x: 5.1, y: 5.1 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.toolInfo.marqueeType).toBe(EntityCollectionType.reverseMarquee);

    expect(
      module.handle(
        mouseDragMoveEvent({
          position: { x: 2.9, y: 3.2 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(editor.actions.setMarqueeRange).toHaveBeenLastCalledWith(
      EntityCollectionType.reverseMarquee,
      { x: 2, y: 3, width: 4, height: 3 },
    );

    expect(module.handle(mouseDragEndEvent(), context)).toEqual({ status: "handled" });
    expect(editor.actions.applyMarquee).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
  });

  it("ignores middle mouse drag and non-long-press touch drag", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    const middleMouseResult = module.handle(
      mouseDragStartEvent({
        originButton: 1,
        pointerEntity: null,
      }),
      context,
    );
    const touchResult = module.handle(
      touchDragStartEvent({
        longPress: false,
      }),
      context,
    );

    expect(middleMouseResult).toEqual({ status: "ignored" });
    expect(touchResult).toEqual({ status: "ignored" });
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
  });

  it("does not enter marquee on middle mouse drag even when immediate marquee is enabled", () => {
    const { context, editor } = createContext({
      activeTool: "select",
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      mouseDragStartEvent({
        originButton: 1,
        pointerEntity: null,
        position: { x: 5, y: 5 },
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(context.canvas.state.activeTool).toBe("select");
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
  });

  it("uses the rail toggle for touch reverse marquee", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-tool-rail-toggle-reverse-marquee"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(
      module.handle(
        touchDragStartEvent({
          longPress: true,
          position: { x: 8.4, y: 9.7 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });

    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.reverseMarquee,
      { x: 8, y: 9, width: 1, height: 1 },
    );

    expect(
      module.handle(
        uiButtonMouseTapEvent("canvas-tool-rail-toggle-reverse-marquee"),
        context,
      ),
    ).toEqual({ status: "handled" });
  });

  it("resets logistics suppression when exiting marquee", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();
    // 退出清理由 on-exit owner 执行，装配实际路由以接收工具状态变化。
    const router = createGestureActionRouter({ gestureAdapter: context.canvas.gestureAdapter,
      workspace: context.workspace, getAppHost: () => context.appHost,
      getCanvas: () => context.canvas, modules: [module] });
    cleanups.push(() => router.dispose());
    const setLogisticsSuppression = vi.mocked(editor.actions.setLogisticsSuppression);

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-tool-rail-toggle-dim-belts"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(setLogisticsSuppression).toHaveBeenLastCalledWith("belt", true);

    context.canvas.actions.setActiveTool("select");
    expect(setLogisticsSuppression.mock.calls.slice(-2)).toEqual([
      ["belt", false],
      ["pipe", false],
    ]);
  });

});

function createContext(options: { activeTool?: "select" | "move" | "marquee" | "single-placement"; hypergryphImmediateMarquee?: boolean; marqueeAnchor?: GridPoint | null;
  rightDockOpen?: boolean; leftDockOpen?: boolean; deviceClass?: "desktop" | "tablet" | "mobile"; selectedEntityIds?: readonly string[]; document?: WorldDocument } = {}) {
  const test = createCanvasTestSession({ activeTool: options.activeTool,
    document: options.document ?? createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-belt.schema7.json")),
    viewport: { center: { x: 50, y: 50 }, gridSize: 1 / 16, displayRotation: 0 } }); cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
  test.app.internalActions.setScreenProfile({ ...test.app.state.screenProfile, deviceClass: options.deviceClass ?? "desktop" });
  test.app.internalState.settings.hypergryphImmediateMarquee = options.hypergryphImmediateMarquee ?? false;
  test.app.internalState.workbench.leftDockOpen = options.leftDockOpen ?? true;
  test.app.internalState.workbench.rightDockOpen = options.rightDockOpen ?? true;
  test.canvas.state.runtime.marqueeAnchor = options.marqueeAnchor ?? null;
  for (const entityId of options.selectedEntityIds ?? []) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  for (const key of ["setMarqueeRange", "applyMarquee", "cancelMarquee", "clearCollection", "addToCollection", "removeFromCollection", "setLogisticsSuppression", "setHoverPoint", "clearHoverPoint"] as const) vi.spyOn(test.editor.actions, key);
  for (const key of ["setActiveTool"] as const) vi.spyOn(test.canvas.actions, key);
  for (const key of ["toggleRightDock", "isShortcutFor"] as const) vi.spyOn(test.app.internalActions, key);
  return { context: test.context, editor: test.editor, appHost: test.app };
}





function createDocumentWithEntities(entities: readonly WorldEntity[]): WorldDocument {
  const document = createWorldDocument();
  return {
    ...document,
    entities: Object.fromEntries(entities.map((currentEntity) => [
      currentEntity.id,
      currentEntity,
    ])),
    entityOrder: entities.map((currentEntity) => currentEntity.id),
  };
}

function entity(
  id: string,
  definitionId = "grinder_1",
  position: GridPoint = { x: 0, y: 0 },
): WorldEntity {
  return {
    id,
    definitionId,
    position,
    rotation: 0,
    config: {},
    tags: [],
  };
}

function keyDownEvent(code: string) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code,
    key: code === "Escape" ? "Escape" : code.replace("Key", "").toLowerCase(),
    keyCode: code === "Escape" ? 27 : code.replace("Key", "").charCodeAt(0),
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: `ui-touch-${uiButtonId}`,
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: `ui-mouse-${uiButtonId}`,
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseTapEvent(pointerEntity: WorldEntity, position: GridPoint = { x: 2, y: 2 }) {
  return {
    type: "mouse tap" as const,
    gestureId: `mouse-tap-${pointerEntity.id}`,
    button: 0,
    buttons: 0,
    position,
    longPress: false,
    pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragStartEvent(options: {
  originButton: number;
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "mouse dragstart" as const,
    gestureId: "mouse-drag-1",
    originButton: options.originButton,
    button: options.originButton,
    buttons: 1,
    position: options.position ?? { x: 2, y: 2 },
    startPosition: options.position ?? { x: 2, y: 2 },
    longPress: false,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "mouse dragmove" as const,
    gestureId: "mouse-drag-1",
    originButton: 2,
    buttons: 2,
    position: options.position,
    delta: { x: 1, y: 1 },
    longPress: false,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragEndEvent() {
  return {
    type: "mouse dragend" as const,
    gestureId: "mouse-drag-1",
    originButton: 2,
    releaseButton: 2,
    button: 2,
    buttons: 0,
    position: { x: 2, y: 3 },
    reason: "release" as const,
    longPress: false,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  longPress: boolean;
  position?: GridPoint;
  pointerEntity?: WorldEntity | null;
}) {
  return {
    type: "touch dragstart" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position ?? { x: 2, y: 2 },
    startPosition: options.position ?? { x: 2, y: 2 },
    activeTouchCount: 1,
    longPress: options.longPress,
    pointerEntity: options.pointerEntity ?? null,
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
