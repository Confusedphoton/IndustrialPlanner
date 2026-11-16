import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { placeConsumerAtLineEnd } from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import type { GridPoint } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";
import { createAppTestHost, createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../../shared/fake-indexed-db";

const FURNACE_ID = "furnance_1";
const IRON_NUGGET_RECIPE_ID = "r_furnace_iron_nugget_from_iron_ore_basic";
const GRINDER_ID = "grinder_1";

const editors = new Set<ReturnType<typeof createEditorTestHost>>();

beforeEach(() => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
});

afterEach(async () => {
  try {
    for (const editor of editors) {
      await editor.internalHistory.flush();
      await editor.internalDocuments.flush();
      await editor.internalDocuments.settleMaintenance();
    }
  } finally {
    for (const editor of editors) editor.dispose();
    editors.clear();
  }
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("offering a consumer at the open end of a line dragged from a port", () => {
  it("offers the item the source device makes and snaps the chosen machine onto the end as one undo step", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const end = { x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 };

    penDrag(appHost, inside, [end]);

    const chip = appHost.mainCanvas.state.runtime.lineEndChip;
    expect(chip?.itemIds).toEqual(["item_iron_nugget"]);
    expect(chip?.endCell).toEqual(end);
    const beltCount = entities(appHost).length - 1;

    placeConsumerAtLineEnd(appHost.mainCanvas, { deviceId: GRINDER_ID, config: null });

    const grinder = entities(appHost).find((entity) => entity.definitionId === GRINDER_ID);
    expect(grinder).toBeDefined();
    expect(inputOutsideCells(appHost, grinder!)).toContainEqual(end);
    expect(appHost.mainCanvas.state.runtime.lineEndChip).toBeNull();

    expect(appHost.workspace.editor!.actions.undoDocumentHistory()).toBe(true);
    expect(entities(appHost).some((entity) => entity.definitionId === GRINDER_ID)).toBe(false);
    expect(entities(appHost)).toHaveLength(beltCount + 1);
  });

  it("goes away on the next canvas action", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);
    expect(appHost.mainCanvas.state.runtime.lineEndChip).not.toBeNull();

    penTap(appHost, { x: inside.x - delta.x * 10, y: inside.y - delta.y * 10 });

    expect(appHost.mainCanvas.state.runtime.lineEndChip).toBeNull();
  });

  it("stays out of the way when the line carries nothing it can name", async () => {
    const appHost = await createAppHost([furnace({ recipe: false })]);
    const { inside, delta } = furnaceBeltOutput(appHost);

    penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);

    expect(entities(appHost).length).toBeGreaterThan(1);
    expect(appHost.mainCanvas.state.runtime.lineEndChip).toBeNull();
  });
});

function furnace(options: { recipe: boolean }): WorldEntity {
  const definition = createRegistryContract().queries.findEntityDefinition(FURNACE_ID)!;
  const channelId = definition.recipeChannels.find((channel) => channel.type !== "consumption-channel")!.id;
  return {
    id: "furnace",
    definitionId: FURNACE_ID,
    position: { x: 30, y: 30 },
    rotation: 0,
    config: options.recipe ? { channelRecipes: { [channelId]: IRON_NUGGET_RECIPE_ID } } : {},
    tags: [],
  };
}

/** 熔炉第一个传送带输出端口的内侧格与朝外方向。 */
function furnaceBeltOutput(appHost: AppHost): { inside: GridPoint; delta: GridPoint } {
  const definition = appHost.workspace.registry.queries.findEntityDefinition(FURNACE_ID)!;
  const port = definition.portGroups.find((group) => group.direction === "output" && !group.isPipe)!.ports[0]!;
  const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: 0 });
  return { inside: { x: 30 + geometry.cell.x, y: 30 + geometry.cell.y }, delta: geometry.delta };
}

function inputOutsideCells(appHost: AppHost, entity: WorldEntity): GridPoint[] {
  const definition = appHost.workspace.registry.queries.findEntityDefinition(entity.definitionId)!;
  return definition.portGroups
    .filter((group) => group.direction !== "output" && !group.isPipe)
    .flatMap((group) => group.ports.map((port) => {
      const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
      return { x: entity.position.x + geometry.cell.x + geometry.delta.x, y: entity.position.y + geometry.cell.y + geometry.delta.y };
    }));
}

function entities(appHost: AppHost): WorldEntity[] {
  return Object.values(appHost.workspace.editor!.document.getSnapshot().entities);
}

async function createAppHost(initial: readonly WorldEntity[]): Promise<AppHost> {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null,
  };
  const editor = createEditorTestHost(workspace);
  editors.add(editor);
  await editor.internalDocuments.ready();
  editor.internalDocument.setSnapshot({
    ...createWorldDocument({ baseId: "wuling_protocol_core" }),
    entities: Object.fromEntries(initial.map((entity) => [entity.id, entity])),
    entityOrder: initial.map((entity) => entity.id),
  });
  const appHost = createAppTestHost(workspace);
  appHost.mainCanvas.view.actions.setViewportClientRect({ left: 0, top: 0, width: 1600, height: 1200 });
  appHost.mainCanvas.view.actions.focusOnBounds({ x: 32, y: 32, width: 0, height: 0 }, { durationMs: 0, gridSize: 1 });
  return appHost;
}

function pointer(appHost: AppHost, cell: GridPoint, buttons: number) {
  const rect = appHost.mainCanvas.view.queries.findClientRectForGridCell(cell)!;
  return { pointerId: 7, pointerType: "pen", clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    button: 0, buttons, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
}

function penDrag(appHost: AppHost, from: GridPoint, path: readonly GridPoint[]): void {
  appHost.gestureAdapter.handlePointerDown(pointer(appHost, from, 1));
  for (const cell of path) {
    appHost.gestureAdapter.handlePointerMove(pointer(appHost, cell, 1));
    appHost.gestureAdapter.advanceFrame(0);
  }
  appHost.gestureAdapter.handlePointerUp(pointer(appHost, path.at(-1)!, 0));
}

function penTap(appHost: AppHost, cell: GridPoint): void {
  appHost.gestureAdapter.handlePointerDown(pointer(appHost, cell, 1));
  appHost.gestureAdapter.handlePointerUp(pointer(appHost, cell, 0));
}
