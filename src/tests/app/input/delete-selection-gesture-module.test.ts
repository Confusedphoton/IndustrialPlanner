import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";




import { createHypergryphDeleteSelectionGestureModule } from "@/app/input/gesture/actions";

import type { ActiveTool } from "@/domain/app/types/app-types";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphDeleteSelectionGestureModule", () => {
  it("deletes the current selection from the delete-device shortcut and hides selection toolbars", () => {
    const {
      context,
      deleteCollection,
      hideCanvasFloatingToolbar,
      isShortcutFor,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyF", key: "f" }),
    });

    expect(result).toEqual({ status: "handled" });
    expect(isShortcutFor).not.toHaveBeenCalled();
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("deletes the current selection from the floating delete button", () => {
    const {
      context,
      deleteCollection,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
  });

  it("deletes the current selection from the rail delete button", () => {
    const {
      context,
      deleteCollection,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("canvas-tool-rail-selection-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
  });

  it("deletes the current selection from the rail during marquee without hiding the floating toolbar", () => {
    const {
      context,
      deleteCollection,
      hideCanvasFloatingToolbar,
    } = createContext({ activeTool: "marquee" });
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-tool-rail-selection-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("handles batch delete from the floating toolbar via removeTransportComponent", () => {
    const {
      context,
      removeTransportComponent,
      hideCanvasFloatingToolbar,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete-many"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(removeTransportComponent).toHaveBeenCalledTimes(1);
    expect(removeTransportComponent).toHaveBeenCalledWith("entity-1");
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("handles batch delete from the floating toolbar for multiple selections", () => {
    const {
      context,
      removeTransportComponent,
    } = createContext({ selectedEntityIds: ["entity-a", "entity-b", "entity-c"] });
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete-many"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(removeTransportComponent).toHaveBeenCalledTimes(3);
    expect(removeTransportComponent).toHaveBeenCalledWith("entity-a");
    expect(removeTransportComponent).toHaveBeenCalledWith("entity-b");
    expect(removeTransportComponent).toHaveBeenCalledWith("entity-c");
  });

  it("ignores batch delete when selection is empty", () => {
    const {
      context,
      removeTransportComponent,
    } = createContext({ selectedEntityIds: [] });
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete-many"),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(removeTransportComponent).not.toHaveBeenCalled();
  });

  it("only responds while select or marquee mode and selection exists", () => {
    const module = createHypergryphDeleteSelectionGestureModule();
    const moveContext = createContext({ activeTool: "move" }).context;
    const emptySelectionContext = createContext({ selectedEntityIds: [] }).context;

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: moveContext,
      event: keyDownEvent({ code: "KeyF", key: "f" }),
    })).toEqual({ status: "ignored" });
    expect(
      handleKeyboardShortcutThroughRouter({
        module,
        context: emptySelectionContext,
        event: keyDownEvent({ code: "KeyF", key: "f" }),
      }),
    ).toEqual({ status: "ignored" });
  });
});

function createContext(options: { activeTool?: ActiveTool; selectedEntityIds?: readonly string[] } = {}) {
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-belt.schema7.json");
  const test = createCanvasTestSession({ document: createWorldDocumentFromBlueprint(blueprint), activeTool: options.activeTool }); cleanups.push(test.dispose);
  for (const entityId of options.selectedEntityIds ?? ["entity-1"]) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  return { context: test.context,
    deleteCollection: vi.spyOn(test.editor.actions, "deleteCollection"), removeTransportComponent: vi.spyOn(test.editor.actions, "removeTransportComponent"),
    hideCanvasFloatingToolbar: vi.spyOn(test.canvas.actions, "hideCanvasFloatingToolbar"),
    isShortcutFor: vi.spyOn(test.app.internalActions, "isShortcutFor") };
}




function keyDownEvent(options: {
  code: string;
  key: string;
}) {
  return {
    type: "key down" as const,
    gestureId: "key-delete-selection-1",
    code: options.code,
    key: options.key,
    keyCode: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: `ui-button-touch-${uiButtonId}`,
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: `ui-button-mouse-${uiButtonId}`,
    uiButtonId,
    button: 0,
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
