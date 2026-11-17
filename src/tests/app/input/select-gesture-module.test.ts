import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";




import { createHypergryphSelectGestureModule } from "@/app/input/gesture/actions";


import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";
import type { WorldEntity } from "@/domain/document/world-document";
import type { ActiveTool } from "@/domain/app/types/app-types";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";


describe("createHypergryphSelectGestureModule", () => {
  it("opens the overlap entity menu before selecting an entity from a stacked cell", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      overlapEntityMenu,
    } = createOverlapSelectContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-overlap-1",
        button: 0,
        buttons: 0,
        position: { x: 0, y: 0 },
        longPress: false,
        pointerEntity: entity("top-entity", "pipe_straight_1x1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(overlapEntityMenu.visible).toBe(true);
    expect(overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "top-entity",
      "bottom-entity",
    ]);
    expect(addToCollection).not.toHaveBeenCalled();

    overlapEntityMenu.select("bottom-entity");

    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "bottom-entity",
    });
  });

  it("clears the selection collection before selecting a different clicked entity, leaving the right dock alone", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      setRightDockActiveTab,
      showCanvasFloatingToolbarForCollection,
      toggleRightDock,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-1",
    });
    expect(setRightDockActiveTab).not.toHaveBeenCalled();
    expect(toggleRightDock).not.toHaveBeenCalled();
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
  });

  it("clears the current selection when the clicked entity is the only selected entity", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
      hideCanvasFloatingToolbar,
      setRightDockActiveTab,
      toggleRightDock,
    } = createContext("select", ["entity-1"]);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-keep-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).not.toHaveBeenCalled();
    expect(setRightDockActiveTab).not.toHaveBeenCalled();
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(toggleRightDock).not.toHaveBeenCalled();
  });

  it("closes the right dock when deselecting the only selected entity by clicking it again", () => {
    const {
      context,
      clearCollection,
      hideCanvasFloatingToolbar,
      toggleRightDock,
    } = createContext("select", ["entity-1"], true);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-clear-dock-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(toggleRightDock).toHaveBeenCalledTimes(1);
  });

  it("closes the right dock on deselect", () => {
    const {
      context,
      clearCollection,
      toggleRightDock,
    } = createContext("select", ["entity-1"], true);
    const module = createHypergryphSelectGestureModule();

    const clearResult = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-no-sync-clear-1",
        button: 2,
        buttons: 0,
        position: { x: 24, y: 16 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(clearResult).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(toggleRightDock).toHaveBeenCalledTimes(1);
  });

  it("keeps the current selection when the clicked entity is already part of a multi-selection", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
      hideCanvasFloatingToolbar,
    } = createContext("select", ["entity-1", "entity-2"]);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-keep-multi-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).not.toHaveBeenCalled();
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-1",
    });
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("clears the selection collection before selecting a different tapped entity", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "touch tap",
        gestureId: "touch-select-1",
        primaryId: 3,
        position: { x: 72, y: 40 },
        longPress: false,
        pointerEntity: entity("entity-2"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-2",
    });
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
  });

  it.each([
    "belt_straight_1x1",
    "pipe_turn_cw_1x1",
  ])("does not reopen a floating toolbar for strict logistics selections (%s)", (definitionId) => {
    const {
      context,
      showCanvasFloatingToolbarForCollection,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: `mouse-select-strict-${definitionId}`,
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-strict", definitionId),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
  });

  it("clears the selection collection on right click in select mode", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      hideCanvasFloatingToolbar,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-clear-1",
        button: 2,
        buttons: 0,
        position: { x: 24, y: 16 },
        longPress: false,
        pointerEntity: entity("entity-3"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("ignores select taps when no entity is under the pointer", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
      hideCanvasFloatingToolbar,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const mouseResult = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-ignored-1",
        button: 0,
        buttons: 0,
        position: { x: 12, y: 8 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const touchResult = module.handle(
      {
        type: "touch tap",
        gestureId: "touch-select-ignored-1",
        primaryId: 4,
        position: { x: 12, y: 8 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(mouseResult).toEqual({ status: "ignored" });
    expect(touchResult).toEqual({ status: "ignored" });
    expect(addToCollection).not.toHaveBeenCalled();
    expect(clearCollection).not.toHaveBeenCalled();
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("only selects entities while select mode is active", () => {
    const module = createHypergryphSelectGestureModule();
    const moveContext = createContext("move").context;

    expect(
      module.handle(
        {
          type: "mouse tap",
          gestureId: "mouse-select-ignored-2",
          button: 0,
          buttons: 0,
          position: { x: 12, y: 8 },
          longPress: false,
          pointerEntity: entity("entity-4"),
          modifiers: emptyModifiers(),
          sourceEvent: null,
        },
        moveContext,
      ),
    ).toEqual({ status: "ignored" });
  });

  it("switches back to select when the select tool button is tapped", () => {
    const { context, setActiveTool } = createContext("move");
    const module = createHypergryphSelectGestureModule();

    const mouseResult = module.handle(
      {
        type: "ui-button-mouse-tap",
        gestureId: "select-tool-button-mouse-1",
        button: 0,
        uiButtonId: "placement-tool-select",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const touchResult = module.handle(
      {
        type: "ui-button-touch-tap",
        gestureId: "select-tool-button-touch-1",
        uiButtonId: "placement-tool-select",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(mouseResult).toEqual({ status: "handled" });
    expect(touchResult).toEqual({ status: "handled" });
    expect(setActiveTool).toHaveBeenNthCalledWith(1, "select");
    expect(setActiveTool).toHaveBeenNthCalledWith(2, "select");
  });

  it("ignores non-primary or unrelated select tool button taps", () => {
    const { context, setActiveTool } = createContext("move");
    const module = createHypergryphSelectGestureModule();

    expect(
      module.handle(
        {
          type: "ui-button-mouse-tap",
          gestureId: "select-tool-button-ignore-1",
          button: 2,
          uiButtonId: "placement-tool-select",
          modifiers: emptyModifiers(),
          sourceEvent: null,
        },
        context,
      ),
    ).toEqual({ status: "ignored" });

    expect(
      module.handle(
        {
          type: "ui-button-touch-tap",
          gestureId: "select-tool-button-ignore-2",
          uiButtonId: "placement-tool-delete",
          modifiers: emptyModifiers(),
          sourceEvent: null,
        },
        context,
      ),
    ).toEqual({ status: "ignored" });

    expect(setActiveTool).not.toHaveBeenCalled();
  });

  it("returns to select mode when the hardcoded Escape key is pressed", () => {
    const { context, isShortcutFor, setActiveTool } = createContext("logistics-placement");
    const module = createHypergryphSelectGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({
        code: "Escape",
        key: "Escape",
      }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(isShortcutFor).not.toHaveBeenCalled();
    expect(setActiveTool).toHaveBeenCalledWith("select");
  });

  it("ignores non-matching return-select shortcut keys", () => {
    const { context, setActiveTool } = createContext("single-placement");
    const module = createHypergryphSelectGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    })).toEqual({ status: "ignored" });
    expect(setActiveTool).not.toHaveBeenCalled();
  });

  it("clears any floating toolbar when another tool returns to select with a preserved selection", () => {
    const {
      context,
      hideCanvasFloatingToolbar,
    } = createToolbarFallbackContext({
      activeTool: "move",
      selectedEntities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/select-gesture-module/scene-01-variant-1.schema7.json")),
    });
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "on-enter-active-tool",
        gestureId: "enter-select-tool-1",
        from: "move",
        to: "select",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("still clears any floating toolbar when another tool returns to select with an empty selection", () => {
    const {
      context,
      hideCanvasFloatingToolbar,
    } = createToolbarFallbackContext({
      activeTool: "move",
      selectedEntities: [],
    });
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "on-enter-active-tool",
        gestureId: "enter-select-tool-empty-1",
        from: "move",
        to: "select",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("hides the select toolbar when leaving select mode", () => {
    const { context, hideCanvasFloatingToolbar } = createContext("select", ["entity-1"]);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "on-exit-active-tool",
        gestureId: "exit-select-tool-1",
        from: "select",
        to: "move",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });
});

function createContext(activeTool: ActiveTool = "select", selectedEntityIds: readonly string[] = [], rightDockOpen = false) {
  const test = createCanvasTestSession({ activeTool, document: createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/select-input.schema7.json")) }); cleanups.push(test.dispose);
  test.app.internalState.workbench.rightDockOpen = rightDockOpen;
  for (const entityId of selectedEntityIds) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  return { context: test.context,
    addToCollection: vi.spyOn(test.editor.actions, "addToCollection"), clearCollection: vi.spyOn(test.editor.actions, "clearCollection"),
    showCanvasFloatingToolbarForCollection: vi.spyOn(test.canvas.actions, "showCanvasFloatingToolbarForCollection"),
    hideCanvasFloatingToolbar: vi.spyOn(test.canvas.actions, "hideCanvasFloatingToolbar"), setActiveTool: vi.spyOn(test.canvas.actions, "setActiveTool"),
    isShortcutFor: vi.spyOn(test.app.internalActions, "isShortcutFor"), openDialog: vi.spyOn(test.app.internalActions, "openDialog"),
    setRightDockActiveTab: vi.spyOn(test.app.internalActions, "setRightDockActiveTab"), toggleRightDock: vi.spyOn(test.app.internalActions, "toggleRightDock") };
}

function createOverlapSelectContext() {
  const test = createCanvasTestSession({ document: createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/select-gesture-module/scene-02-variant-1.schema7.json")),
    viewport: { center: { x: 50, y: 50 }, gridSize: 1 / 16, displayRotation: 0 } }); cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
  return { context: test.context, addToCollection: vi.spyOn(test.editor.actions, "addToCollection"),
    clearCollection: vi.spyOn(test.editor.actions, "clearCollection"), overlapEntityMenu: test.canvas.overlapEntityMenu };
}

function entity(id: string, definitionId = "filling_pd_mc_1"): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}



function keyDownEvent(options: {
  code: string;
  key: string;
}) {
  return {
    type: "key down" as const,
    gestureId: "key-select-tool-shortcut-1",
    code: options.code,
    key: options.key,
    keyCode: 0,
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

function createToolbarFallbackContext(options: { activeTool: ActiveTool; selectedEntities: readonly WorldEntity[] }) {
  return createContext(options.activeTool, options.selectedEntities.map(entity => entity.id));
}





