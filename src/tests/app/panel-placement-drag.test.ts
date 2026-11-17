import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelPlacementDrag } from "@/app/shell/shared/panel-placement-drag";
import { resolveRecipePlacementTarget } from "@/app/shell/recipe-tree/recipe-quick-actions";
import { createWorldDocument } from "@/domain/document/world-document";
import { type EditorHost } from "@/editor/editor-host";
import { createAppTestWorkspace, createEditorTestHost, getTestView } from "@/tests/helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

describe("dragging a device out of a panel onto the canvas", () => {
  let session: ReturnType<typeof createAppTestWorkspace>;
  let editor: EditorHost;
  let pointedElement: Element | null;

  beforeEach(async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    session = createAppTestWorkspace();
    editor = createEditorTestHost(session.workspace);
    await editor.internalDocuments.ready();
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
    getTestView(session.workspace).actions.setViewportClientRect({ left: 0, top: 0, width: 1000, height: 700 });
    const scene = document.createElement("main");
    scene.dataset.sceneId = session.app.mainCanvas.view.id;
    const surface = document.createElement("canvas");
    scene.append(surface);
    document.body.append(scene);
    pointedElement = surface;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => pointedElement });
  });

  afterEach(async () => {
    try {
      await editor.internalHistory.flush();
      await editor.internalDocuments.flush();
      await editor.internalDocuments.settleMaintenance();
    } finally {
      document.body.replaceChildren();
      Reflect.deleteProperty(document, "elementFromPoint");
      editor.dispose(); session.app.dispose(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    }
  });

  const recipeTarget = () => {
    const recipe = session.workspace.registry.queries.findRecipeDefinitionsByMachine("grinder_1")[0]!;
    return { recipe, target: resolveRecipePlacementTarget(session.app, recipe)! };
  };

  it("previews under the pointer once it is over the canvas and drops one machine set to the recipe", () => {
    const { recipe, target } = recipeTarget();
    const drag = new PanelPlacementDrag(session.app, target);

    drag.move(500, 350);
    expect(session.app.mainCanvas.state.activeTool).toBe("single-placement");
    expect(editor.state.collections.preview.length).toBe(1);

    drag.move(520, 360);
    drag.drop(520, 360, "mouse");

    const placed = editor.queries.listEntities().filter((entity) => entity.definitionId === "grinder_1");
    expect(placed).toHaveLength(1);
    expect(Object.values(placed[0]!.config.channelRecipes as Record<string, string>)).toContain(recipe.id);
    expect(session.app.mainCanvas.state.activeTool).toBe("select");
  });

  it("sets the recipe of a machine of the same type when the card is dropped on it", () => {
    const recipes = session.workspace.registry.queries.findRecipeDefinitionsByMachine("grinder_1");
    const first = resolveRecipePlacementTarget(session.app, recipes[0]!)!;
    const placeFirst = new PanelPlacementDrag(session.app, first);
    placeFirst.move(500, 350);
    placeFirst.move(520, 360);
    placeFirst.drop(520, 360, "mouse");
    const placed = editor.queries.listEntities().find((entity) => entity.definitionId === "grinder_1")!;

    const second = resolveRecipePlacementTarget(session.app, recipes[1]!)!;
    const retarget = new PanelPlacementDrag(session.app, second);
    retarget.move(500, 350);
    retarget.move(520, 360);
    retarget.drop(520, 360, "mouse");

    const grinders = editor.queries.listEntities().filter((entity) => entity.definitionId === "grinder_1");
    expect(grinders).toHaveLength(1);
    expect(Object.values(grinders[0]!.config.channelRecipes as Record<string, string>)).toContain(recipes[1]!.id);
    expect(grinders[0]!.id).toBe(placed.id);
    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(Object.values(editor.queries.getEntityById(placed.id)!.config.channelRecipes as Record<string, string>)).toContain(recipes[0]!.id);
  });

  it("cancels when released off the canvas", () => {
    const { target } = recipeTarget();
    const drag = new PanelPlacementDrag(session.app, target);

    drag.move(500, 350);
    pointedElement = document.body;
    drag.move(1200, 350);
    drag.drop(1200, 350, "mouse");

    expect(editor.queries.listEntities().some((entity) => entity.definitionId === "grinder_1")).toBe(false);
    expect(session.app.mainCanvas.state.activeTool).toBe("select");
  });

  it("does not enter placement while the pointer is still over a panel", () => {
    const { target } = recipeTarget();
    pointedElement = document.body;
    const drag = new PanelPlacementDrag(session.app, target);

    drag.move(500, 350);

    expect(session.app.mainCanvas.state.activeTool).toBe("select");
    drag.cancel();
  });
});
