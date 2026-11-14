import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";




import { createHypergryphEntityVariantSwitchGestureModule } from "@/app/input/gesture/actions";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";



import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphEntityVariantSwitchGestureModule", () => {
  it("switches a single selected device from the inspector action button", () => {
    const { context, editor } = createContext();
    const module = createHypergryphEntityVariantSwitchGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("canvas-floating-toolbar-button-switch-mode"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "selected-entity",
      "filling_pd_mc_1_liquid",
    );
  });

  it("switches from Tab only in select mode with the right Inspector panel", () => {
    const panel = createContext({ useInspectorPanel: true });
    const dialog = createContext({ useInspectorPanel: false });
    const marquee = createContext({ activeTool: "marquee", useInspectorPanel: true });
    const module = createHypergryphEntityVariantSwitchGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: panel.context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "handled" });
    expect(panel.editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "selected-entity",
      "filling_pd_mc_1_liquid",
    );

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: dialog.context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "ignored" });
    expect(dialog.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: marquee.context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "ignored" });
    expect(marquee.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });

  it("ignores non-switchable or multi-selected devices", () => {
    const nonSwitchable = createContext({
      selectedDefinitionId: "belt_straight_1x1",
    });
    const multi = createContext({
      activeTool: "marquee",
      selectionIds: ["selected-entity", "other-entity"],
    });
    const module = createHypergryphEntityVariantSwitchGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"),
        nonSwitchable.context,
      ),
    ).toEqual({ status: "ignored" });
    expect(nonSwitchable.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"),
        multi.context,
      ),
    ).toEqual({ status: "ignored" });
    expect(multi.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });
});

function createContext(options: { activeTool?: "select" | "marquee" | "move"; selectedDefinitionId?: string; selectionIds?: readonly string[]; useInspectorPanel?: boolean } = {}) {
  const variant = options.selectedDefinitionId === "belt_straight_1x1" ? "belt" : "device";
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-" + variant + ".schema7.json");
  const test = createCanvasTestSession({ document: createWorldDocumentFromBlueprint(blueprint), activeTool: options.activeTool }); cleanups.push(test.dispose);
  test.app.internalState.settings.gameUseInspectorPanel = options.useInspectorPanel ?? false;
  for (const entityId of options.selectionIds ?? ["selected-entity"]) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  vi.spyOn(test.editor.actions, "replaceEntityDefinition");
  return { context: test.context, editor: test.editor };
}







function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "ui-touch-tap-1",
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "ui-mouse-tap-1",
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function keyDownEvent(options: { code: string | null; key: string | null }) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: options.key === null ? null : options.key.toUpperCase().charCodeAt(0),
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

