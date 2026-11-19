import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recipeTreeOverlayState } from "@/app/shell/recipe-tree/recipe-tree-state";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createRegistryContract } from "@/registry";
import { createAppTestHost, createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "@/tests/shared/fake-indexed-db";

const lane: WorldEntity[] = [
  { id: "refiner", definitionId: "furnance_1", position: { x: 20, y: 20 }, rotation: 90,
    config: { channelRecipes: { ch1: "r_furnace_iron_nugget_from_iron_ore_basic" } }, tags: [] },
  { id: "belt", definitionId: "belt_straight_1x1", position: { x: 23, y: 21 }, rotation: 90, config: {}, tags: [] },
  { id: "shredder", definitionId: "grinder_1", position: { x: 24, y: 20 }, rotation: 90,
    config: { channelRecipes: { ch1: "r_crusher_iron_powder_from_iron_nugget_basic" } }, tags: [] },
];
let editorHost: ReturnType<typeof createEditorTestHost>;
let app: ReturnType<typeof createAppTestHost>;

beforeEach(() => vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()));
afterEach(async () => {
  for (const pin of recipeTreeOverlayState.pins) recipeTreeOverlayState.removePin(pin.id);
  try {
    await editorHost.internalHistory.flush();
    await editorHost.internalDocuments.flush();
    await editorHost.internalDocuments.settleMaintenance();
  } finally {
    app.dispose();
    editorHost.dispose();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});

it("previews the pinned plan's complete lanes and copies the selected machines, recipes and belt in one undo step", async () => {
  pinThreeLanes();
  await setup();
  const pen = pointer("pen");

  pen.down(21, 21);
  pen.move(21, 25);
  expect(editorHost.state.collections.preview).toHaveLength(6);
  expect(editorHost.document.getSnapshot().entityOrder).toHaveLength(3);
  pen.up(21, 27);

  const copies = Object.values(editorHost.document.getSnapshot().entities).filter((entity) => !lane.some(({ id }) => entity.id === id));
  expect(copies.map(({ definitionId, position, rotation, config }) => ({ definitionId, position, rotation, config }))).toEqual(
    [6, 12].flatMap((offset) => lane.map(({ definitionId, position, rotation, config }) => ({
      definitionId, position: { x: position.x, y: position.y + offset }, rotation, config,
    }))),
  );
  app.mainCanvas.undoRepeatLane();
  expect(editorHost.document.getSnapshot().entityOrder).toEqual(["refiner", "belt", "shredder"]);
});

it("uses one copy without a matching plan and accepts a finger drag", async () => {
  await setup();
  const finger = pointer("touch");
  finger.down(21, 21);
  finger.move(30, 21);
  finger.up(30, 21);
  expect(Object.values(editorHost.document.getSnapshot().entities)
    .filter((entity) => entity.id !== "refiner" && entity.definitionId === "furnance_1")
    .map((entity) => entity.position)).toEqual([{ x: 29, y: 20 }]);
  expect(editorHost.document.getSnapshot().entityOrder).toHaveLength(6);
});

it("leaves the whole batch unplaced when only the last copy is blocked, and clears a cancelled preview", async () => {
  pinThreeLanes();
  await setup([{ ...lane[0]!, id: "blocker", definitionId: "grinder_1", position: { x: 20, y: 32 }, config: { channelRecipes: { ch1: "r_crusher_originium_powder_basic" } } }]);
  const pen = pointer("pen");
  pen.down(21, 21);
  pen.move(21, 27);
  pen.up(21, 27);
  expect(editorHost.document.getSnapshot().entityOrder).toEqual(["refiner", "belt", "shredder", "blocker"]);
  expect(editorHost.state.collections.preview).toHaveLength(0);

  pen.down(21, 21);
  pen.move(21, 26);
  expect(editorHost.state.collections.preview.length).toBeGreaterThan(0);
  pen.cancel(21, 26);
  expect(editorHost.state.collections.preview).toHaveLength(0);
  expect(editorHost.document.getSnapshot().entityOrder).toEqual(["refiner", "belt", "shredder", "blocker"]);
});

function pinThreeLanes() {
  recipeTreeOverlayState.addPin("item_iron_powder");
  recipeTreeOverlayState.updatePin(recipeTreeOverlayState.pins[0]!.id, { perMinute: 90 });
}

async function setup(extras: WorldEntity[] = []) {
  const workspace = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null,
  };
  editorHost = createEditorTestHost(workspace);
  await editorHost.internalDocuments.ready();
  const entities = [...lane, ...extras];
  editorHost.internalDocument.setSnapshot({
    ...createWorldDocument({ baseId: "wuling_protocol_core" }),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  });
  app = createAppTestHost(workspace);
  app.mainCanvas.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1600, height: 1200 });
  app.mainCanvas.view.actions.focusOnBounds({ x: 26, y: 26, width: 0, height: 0 }, { durationMs: 0, gridSize: 1 });
  app.mainCanvas.actions.setActiveTool("marquee");
  for (const entity of lane) editorHost.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: entity.id });
}

function pointer(pointerType: "pen" | "touch") {
  const adapter = app.gestureAdapter;
  const at = (x: number, y: number, buttons: number) => {
    const rect = app.mainCanvas.view.queries.findClientRectForGridCell({ x, y })!;
    return { pointerId: 7, pointerType, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      button: 0, buttons, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  };
  return {
    down: (x: number, y: number) => adapter.handlePointerDown(at(x, y, 1)),
    move(x: number, y: number) {
      adapter.handlePointerMove(at(x, y, 1));
      adapter.advanceFrame(0);
    },
    up: (x: number, y: number) => adapter.handlePointerUp(at(x, y, 0)),
    cancel: (x: number, y: number) => adapter.handlePointerCancel(at(x, y, 0)),
  };
}
