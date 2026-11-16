import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { resolveLineEndSnapPlacements } from "@/app/canvas/line-end-chip";
import {
  placeConsumerAtLineEnd,
  resolveLineEndTarget,
  resolvePortDragHandles,
  startPortHandleDrag,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import type { GridPoint } from "@/domain/shared/grid";
import { LineEndChipOverlay } from "@/app/shell/canvas/line-end-chip-overlay";
import { thinPortDragHandles } from "@/app/shell/canvas/port-drag-handles";
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

let root: Root | null = null;

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
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

    placeConsumerAtLineEnd(appHost.mainCanvas, { deviceId: GRINDER_ID, config: null }, "mouse");

    const grinder = entities(appHost).find((entity) => entity.definitionId === GRINDER_ID);
    expect(grinder).toBeDefined();
    expect(inputOutsideCells(appHost, grinder!)).toContainEqual(end);
    expect(appHost.mainCanvas.state.runtime.lineEndChip).toBeNull();

    expect(appHost.workspace.editor!.actions.undoDocumentHistory()).toBe(true);
    expect(entities(appHost).some((entity) => entity.definitionId === GRINDER_ID)).toBe(false);
    expect(entities(appHost)).toHaveLength(beltCount + 1);
  });

  it("goes away on the next canvas tap or Escape, but survives panning across empty canvas", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);
    expect(appHost.mainCanvas.state.runtime.lineEndChip).not.toBeNull();

    const empty = { x: inside.x - delta.x * 10 - 8, y: inside.y - delta.y * 10 - 8 };
    penDrag(appHost, empty, [{ x: empty.x - 6, y: empty.y - 6 }]);
    expect(appHost.mainCanvas.state.runtime.lineEndChip).not.toBeNull();

    penTap(appHost, empty);
    expect(appHost.mainCanvas.state.runtime.lineEndChip).toBeNull();

    penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);
    appHost.gestureAdapter.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
    expect(appHost.mainCanvas.state.runtime.lineEndChip).toBeNull();
  });

  it("clears the chip once its line is undone, so the device popup is not held back", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<LineEndChipOverlay appHost={appHost} />));
    const { inside, delta } = furnaceBeltOutput(appHost);
    act(() => penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]));
    expect(appHost.mainCanvas.state.runtime.lineEndChip).not.toBeNull();

    act(() => { appHost.workspace.editor!.actions.undoDocumentHistory(); });

    expect(appHost.mainCanvas.state.runtime.lineEndChip).toBeNull();
  });

  it("no longer finds an open end once the line is undone", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);
    const chip = appHost.mainCanvas.state.runtime.lineEndChip!;
    const editor = appHost.workspace.editor!;
    expect(resolveLineEndTarget(appHost.mainCanvas, editor, chip.kind, chip.endCell)).not.toBeNull();

    editor.actions.undoDocumentHistory();

    expect(resolveLineEndTarget(appHost.mainCanvas, editor, chip.kind, chip.endCell)).toBeNull();
  });

  it("only snaps a machine by an input port that accepts the line's item", () => {
    const acceptOnly = (itemId: string) => ({ base: { kind: "item" as const, itemId }, exclude: [] });
    const port = (id: string, localCellX: number, itemId: string) => ({
      id, localCellX, localCellY: 0, edge: "NORTH" as const, acceptRule: acceptOnly(itemId), priorityGroup: 0, roundRobinSeed: 0,
    });
    const definition = {
      footprint: { width: 3, height: 3 },
      portGroups: [{ id: "in", kind: 1, isPipe: false, direction: "input" as const, ports: [port("centre", 1, "item_other"), port("side", 0, "item_iron_nugget")] }],
      portStorageBindings: [],
      recipeChannels: [],
    };

    const placements = resolveLineEndSnapPlacements({
      definition,
      kind: "belt",
      targetCell: { x: 10, y: 10 },
      flowEdge: "SOUTH",
      itemIds: ["item_iron_nugget"],
      resolveItemDomain: () => 1,
    });

    expect(placements[0]).toEqual({ position: { x: 10, y: 10 }, rotation: 0 });
    expect(placements).not.toContainEqual({ position: { x: 9, y: 10 }, rotation: 0 });
  });

  it("is offered after drawing a line out of a port with the belt tool as well", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    appHost.mainCanvas.actions.setActiveTool("logistics-placement");
    appHost.mainCanvas.state.runtime.logisticsPlacement.kind = "belt";

    penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);

    expect(appHost.mainCanvas.state.activeTool).toBe("logistics-placement");
    expect(appHost.mainCanvas.state.runtime.lineEndChip?.itemIds).toEqual(["item_iron_nugget"]);
  });

  it("stays out of the way when the line carries nothing it can name", async () => {
    const appHost = await createAppHost([furnace({ recipe: false })]);
    const { inside, delta } = furnaceBeltOutput(appHost);

    penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);

    expect(entities(appHost).length).toBeGreaterThan(1);
    expect(appHost.mainCanvas.state.runtime.lineEndChip).toBeNull();
  });
});

describe("drawing a line out of a port with a finger", () => {
  it("offers a handle beyond every free port and draws from it like a pen drag from the port", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const outside = { x: inside.x + delta.x, y: inside.y + delta.y };
    const handles = resolvePortDragHandles(appHost.mainCanvas, "furnace");
    const handle = handles.find((entry) => entry.cell.x === outside.x && entry.cell.y === outside.y);
    expect(handle?.source.type).toBe("device-port");
    expect(handles.length).toBeGreaterThan(1);

    const drag = startPortHandleDrag(appHost.mainCanvas, handle!.source)!;
    const end = { x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 };
    drag.move(clientCenter(appHost, outside));
    drag.move(clientCenter(appHost, end));
    drag.end(true);

    expect(entities(appHost).filter((entity) => entity.definitionId.startsWith("belt"))).toHaveLength(4);
    expect(appHost.mainCanvas.state.runtime.lineEndChip?.endCell).toEqual(end);
    expect(resolvePortDragHandles(appHost.mainCanvas, "furnace").some((entry) => entry.key === handle!.key)).toBe(false);
  });

  it("keeps one handle per side and port group when the cells are smaller than a handle", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const handles = resolvePortDragHandles(appHost.mainCanvas, "furnace");
    const sides = new Set(handles.map((handle) => handle.source.type === "device-port"
      ? `${handle.source.endpoint.portGroupId}:${handle.flowEdge}` : "line"));

    expect(thinPortDragHandles(handles, 16, 32)).toHaveLength(sides.size);
    expect(thinPortDragHandles(handles, 40, 32)).toHaveLength(handles.length);
  });

  it("continues a selected line from its open end", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    penDrag(appHost, inside, [{ x: inside.x + delta.x * 3, y: inside.y + delta.y * 3 }]);
    const last = entities(appHost).find((entity) => entity.position.x === inside.x + delta.x * 3 && entity.position.y === inside.y + delta.y * 3)!;

    const [handle] = resolvePortDragHandles(appHost.mainCanvas, last.id);
    expect(handle?.cell).toEqual({ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 });
    const drag = startPortHandleDrag(appHost.mainCanvas, handle!.source)!;
    drag.move(clientCenter(appHost, { x: inside.x + delta.x * 6, y: inside.y + delta.y * 6 }));
    drag.end(true);

    expect(entities(appHost).filter((entity) => entity.definitionId.startsWith("belt"))).toHaveLength(6);
  });

  it("stops drawing when canvas input is cancelled mid-drag", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const handle = resolvePortDragHandles(appHost.mainCanvas, "furnace")
      .find((entry) => entry.cell.x === inside.x + delta.x && entry.cell.y === inside.y + delta.y)!;

    const drag = startPortHandleDrag(appHost.mainCanvas, handle.source)!;
    drag.move(clientCenter(appHost, { x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }));
    appHost.mainCanvas.cancelInput();
    drag.move(clientCenter(appHost, { x: inside.x + delta.x * 6, y: inside.y + delta.y * 6 }));
    drag.end(true);

    expect(entities(appHost)).toHaveLength(1);
    expect(appHost.workspace.editor!.queries.resolveLogisticsDraftState()).toBeNull();
  });

  it("drops the draft when the drag is cancelled", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const handle = resolvePortDragHandles(appHost.mainCanvas, "furnace")
      .find((entry) => entry.cell.x === inside.x + delta.x && entry.cell.y === inside.y + delta.y)!;

    const drag = startPortHandleDrag(appHost.mainCanvas, handle.source)!;
    drag.move(clientCenter(appHost, { x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }));
    drag.end(false);

    expect(entities(appHost)).toHaveLength(1);
    expect(appHost.workspace.editor!.queries.resolveLogisticsDraftState()).toBeNull();
  });
});

describe("drawing a line toward the canvas edge", () => {
  it("pans the map while the line head is held at the edge and keeps extending the line", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const viewport = appHost.mainCanvas.view.state.clientRect;
    const start = clientCenter(appHost, inside);
    const edge = delta.y !== 0
      ? { x: start.x, y: delta.y > 0 ? viewport.top + viewport.height - 2 : viewport.top + 2 }
      : { x: delta.x > 0 ? viewport.left + viewport.width - 2 : viewport.left + 2, y: start.y };
    const centerBefore = { ...appHost.mainCanvas.view.state.center };

    const pointer = (position: { x: number; y: number }, buttons: number) => ({ pointerId: 7, pointerType: "pen", clientX: position.x,
      clientY: position.y, button: 0, buttons, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
    appHost.gestureAdapter.handlePointerDown(pointer(start, 1));
    appHost.gestureAdapter.handlePointerMove(pointer(clientCenter(appHost, { x: inside.x + delta.x * 3, y: inside.y + delta.y * 3 }), 1));
    appHost.gestureAdapter.handlePointerMove(pointer(edge, 1));
    appHost.gestureAdapter.advanceFrame(0);
    const beltsAtEdge = appHost.workspace.editor!.queries.resolveLogisticsDraftState()!.cells.length;
    for (let frame = 1; frame <= 30; frame += 1) appHost.mainCanvas.edgePan.advanceFrame(frame * 16);
    const beltsAfterPan = appHost.workspace.editor!.queries.resolveLogisticsDraftState()!.cells.length;
    appHost.gestureAdapter.handlePointerUp(pointer(edge, 0));

    expect(appHost.mainCanvas.view.state.center).not.toEqual(centerBefore);
    expect(beltsAfterPan).toBeGreaterThan(beltsAtEdge);
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

function clientCenter(appHost: AppHost, cell: GridPoint) {
  const rect = appHost.mainCanvas.view.queries.findClientRectForGridCell(cell)!;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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
