import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { resolveLineEndSnapPlacements } from "@/app/canvas/line-end-chip";
import { configuredRecipeIds, resolveRecipeItemRatePerMinute, traceLine } from "@/app/canvas/line-trace";
import {
  closeLineEndChip,
  placeConsumerAtLineEnd,
  resolveLineEndTarget,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import type { GridPoint } from "@/domain/shared/grid";
import { LineEndChipOverlay, resolveObviousConsumer } from "@/app/shell/canvas/line-end-chip-overlay";
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

  it("lays a stub out of the new machine's product output and moves the chip there, so the line can be chained", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const end = { x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 };
    penDrag(appHost, inside, [end]);
    const before = entities(appHost).length;

    placeConsumerAtLineEnd(appHost.mainCanvas, {
      deviceId: GRINDER_ID,
      config: { channelRecipes: { default: "r_crusher_iron_powder_from_iron_nugget_basic" } },
    }, "mouse");

    // 粉碎机与它输出口外的一格线一起放下，提示移到这一格，列出消费铁粉的设备。
    expect(entities(appHost)).toHaveLength(before + 2);
    const chip = appHost.mainCanvas.state.runtime.lineEndChip;
    expect(chip?.itemIds).toEqual(["item_iron_powder"]);
    expect(entities(appHost).some((entity) => entity.position.x === chip!.endCell.x && entity.position.y === chip!.endCell.y
      && entity.definitionId.startsWith("belt"))).toBe(true);

    expect(appHost.workspace.editor!.actions.undoDocumentHistory()).toBe(true);
    expect(entities(appHost)).toHaveLength(before);
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

describe("offering the obvious machine in one tap", () => {
  const consumer = (key: string, todo: { placed: number; needed: number } | null) => ({ key, todo });

  it("picks the single machine the pinned plan still needs, or the only machine there is", () => {
    expect(resolveObviousConsumer([consumer("forge", { placed: 0, needed: 1 }), consumer("shredder", null)])?.key).toBe("forge");
    expect(resolveObviousConsumer([consumer("only", null)])?.key).toBe("only");
  });

  it("asks when there is a real choice", () => {
    expect(resolveObviousConsumer([consumer("a", null), consumer("b", null)])).toBeNull();
    expect(resolveObviousConsumer([consumer("a", { placed: 0, needed: 1 }), consumer("b", { placed: 1, needed: 3 })])).toBeNull();
    expect(resolveObviousConsumer([consumer("done", { placed: 1, needed: 1 }), consumer("other", null)])).toBeNull();
  });
});

describe("drawing a line out of a port with a finger", () => {
  it("draws from a port straight away, like the pen, without selecting the machine first", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const end = { x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 };
    const center = { ...appHost.mainCanvas.view.state.center };

    fingerDrag(appHost, inside, [end]);

    expect(entities(appHost).filter((entity) => entity.definitionId.startsWith("belt"))).toHaveLength(4);
    expect(appHost.mainCanvas.view.state.center).toEqual(center);
    expect(appHost.mainCanvas.state.runtime.lineEndChip?.endCell).toEqual(end);
  });

  it("continues a line from its open end", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const end = { x: inside.x + delta.x * 3, y: inside.y + delta.y * 3 };
    fingerDrag(appHost, inside, [end]);

    fingerDrag(appHost, end, [{ x: inside.x + delta.x * 6, y: inside.y + delta.y * 6 }]);

    expect(entities(appHost).filter((entity) => entity.definitionId.startsWith("belt"))).toHaveLength(6);
  });

  it("drops the line when the tool changes or input is cancelled mid-drag", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const touch = (cell: GridPoint, buttons: number) => ({ ...pointer(appHost, cell, buttons), pointerType: "touch", pointerId: 11 });
    const midway = { x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 };

    appHost.gestureAdapter.handlePointerDown(touch(inside, 1));
    appHost.gestureAdapter.handlePointerMove(touch(midway, 1));
    appHost.gestureAdapter.advanceFrame(0);
    appHost.mainCanvas.actions.setActiveTool("marquee");
    appHost.gestureAdapter.handlePointerMove(touch({ x: midway.x + delta.x, y: midway.y + delta.y }, 1));
    appHost.gestureAdapter.advanceFrame(0);
    appHost.gestureAdapter.handlePointerUp(touch(midway, 0));
    expect(entities(appHost)).toHaveLength(1);

    appHost.mainCanvas.actions.setActiveTool("select");
    appHost.gestureAdapter.handlePointerDown(touch(inside, 1));
    appHost.gestureAdapter.handlePointerMove(touch(midway, 1));
    appHost.gestureAdapter.advanceFrame(0);
    appHost.mainCanvas.cancelInput();
    appHost.gestureAdapter.handlePointerUp(touch(midway, 0));
    expect(entities(appHost)).toHaveLength(1);
    expect(appHost.workspace.editor!.queries.resolveLogisticsDraftState()).toBeNull();
  });

  it("pans instead of drawing when the finger starts on a port but heads into the machine", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const center = { ...appHost.mainCanvas.view.state.center };

    fingerDrag(appHost, inside, [{ x: inside.x - delta.x * 5, y: inside.y - delta.y * 5 }]);

    expect(entities(appHost)).toHaveLength(1);
    expect(appHost.mainCanvas.view.state.center).not.toEqual(center);
  });

  it("pans instead of drawing from a port that already has a line", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    fingerDrag(appHost, inside, [{ x: inside.x + delta.x * 3, y: inside.y + delta.y * 3 }]);
    const before = entities(appHost).length;

    fingerDrag(appHost, inside, [{ x: inside.x + delta.x * 6, y: inside.y + delta.y * 6 }]);

    expect(entities(appHost)).toHaveLength(before);
  });

  it("still pans when the drag starts inside the machine rather than on a port", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const center = { ...appHost.mainCanvas.view.state.center };

    fingerDrag(appHost, { x: 31, y: 31 }, [{ x: 36, y: 36 }]);

    expect(entities(appHost)).toHaveLength(1);
    expect(appHost.mainCanvas.view.state.center).not.toEqual(center);
  });
});

describe("drawing several lines in one stroke", () => {
  it("lays a parallel line from every free output the stroke sweeps along before leaving the machine", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const definition = appHost.workspace.registry.queries.findEntityDefinition(FURNACE_ID)!;
    const outputs = definition.portGroups.find((group) => group.direction === "output" && !group.isPipe)!.ports
      .map((port) => resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: 0 }))
      .map((geometry) => ({ inside: { x: 30 + geometry.cell.x, y: 30 + geometry.cell.y }, delta: geometry.delta }))
      .sort((left, right) => left.inside.x - right.inside.x || left.inside.y - right.inside.y);
    const [first, , last] = outputs;
    const { delta } = first!;

    // 沿设备边从第一个口划到第三个口，再向外拉四格。
    penDrag(appHost, first!.inside, [outputs[1]!.inside, last!.inside, ...[1, 2, 3, 4].map((step) => ({
      x: last!.inside.x + delta.x * step, y: last!.inside.y + delta.y * step,
    }))]);

    const belts = entities(appHost).filter((entity) => entity.definitionId.startsWith("belt"));
    expect(belts).toHaveLength(12);
    for (const { inside } of outputs) {
      for (const step of [1, 2, 3, 4]) {
        expect(belts.some((belt) => belt.position.x === inside.x + delta.x * step && belt.position.y === inside.y + delta.y * step)).toBe(true);
      }
    }
    expect(appHost.mainCanvas.state.runtime.portComb).toBeNull();
  });

  it("still draws a single line when the stroke leaves the machine straight away", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);

    expect(entities(appHost).filter((entity) => entity.definitionId.startsWith("belt"))).toHaveLength(4);
  });
});

describe("reading a line under the pen", () => {
  it("traces the line to the machine feeding it and reads that machine's output rate", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const end = { x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 };
    penDrag(appHost, inside, [end]);
    closeLineEndChip(appHost.mainCanvas);

    const trace = traceLine(appHost.workspace.editor!, appHost.workspace.registry.queries, "belt", end)!;
    expect(trace.cells).toHaveLength(4);
    expect(trace.cells[0]!.cell).toEqual({ x: inside.x + delta.x, y: inside.y + delta.y });
    expect(trace.source?.entity.id).toBe("furnace");
    expect(trace.sink).toBeNull();
    const recipe = appHost.workspace.registry.queries.findRecipeDefinition(IRON_NUGGET_RECIPE_ID)!;
    const perMinute = recipe.outputs.find((flow) => flow.itemId === "item_iron_nugget")!.amount * 60 / recipe.durationSeconds;
    const recipeIds = configuredRecipeIds(trace.source!.entity);
    expect(resolveRecipeItemRatePerMinute(appHost.workspace.registry, recipeIds, ["item_iron_nugget"], "output")).toBeCloseTo(perMinute);
    // 不产出该物品的配方不算速率。
    expect(resolveRecipeItemRatePerMinute(appHost.workspace.registry, recipeIds, ["item_iron_powder"], "output")).toBeNull();

    // 悬停在线上即记下读数位置，离开线就收起。
    appHost.gestureAdapter.handlePointerMove(pointer(appHost, end, 0));
    appHost.gestureAdapter.advanceFrame(0);
    expect(appHost.mainCanvas.state.runtime.lineProbe).toMatchObject({ kind: "belt", cell: end });
    appHost.gestureAdapter.handlePointerMove(pointer(appHost, { x: end.x + 6, y: end.y + 6 }, 0));
    appHost.gestureAdapter.advanceFrame(0);
    expect(appHost.mainCanvas.state.runtime.lineProbe).toBeNull();
  });

  it("follows the line across a bridge where another line crosses it", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const { inside, delta } = furnaceBeltOutput(appHost);
    const end = { x: inside.x + delta.x * 6, y: inside.y + delta.y * 6 };
    penDrag(appHost, inside, [end]);
    // 一条垂直的线从第三格横穿过去，交叉处生成桥接器。
    const side = { x: delta.y, y: delta.x };
    const crossing = { x: inside.x + delta.x * 3, y: inside.y + delta.y * 3 };
    const editor = appHost.workspace.editor!;
    editor.actions.createLogisticsDraftStart({ kind: "belt", source: { type: "empty-cell", gridPoint: { x: crossing.x - side.x * 3, y: crossing.y - side.y * 3 } } });
    editor.actions.moveLogisticEnd({ pointerGridPoint: { x: crossing.x + side.x * 3, y: crossing.y + side.y * 3 }, routeMode: { type: "freehand" } });
    editor.actions.applyLogisticDraft();
    expect(appHost.workspace.registry.queries.resolveLogisticsRole(
      editor.queries.findDevicePortAtGridPoint(crossing) === null ? "" : editor.queries.getEntityById(editor.queries.findDevicePortAtGridPoint(crossing)!.endpoint.entityId)!.definitionId,
    )).toBe("connector");

    const trace = traceLine(editor, appHost.workspace.registry.queries, "belt", end)!;
    expect(trace.source?.entity.id).toBe("furnace");
    expect(trace.cells.some((entry) => entry.cell.x === crossing.x && entry.cell.y === crossing.y)).toBe(true);
  });

  it("does not follow a parallel line that is not joined to it", async () => {
    const appHost = await createAppHost([furnace({ recipe: true })]);
    const definition = appHost.workspace.registry.queries.findEntityDefinition(FURNACE_ID)!;
    const ports = definition.portGroups.find((group) => group.direction === "output" && !group.isPipe)!.ports;
    const insides = ports.slice(0, 2).map((port) => {
      const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: 0 });
      return { inside: { x: 30 + geometry.cell.x, y: 30 + geometry.cell.y }, delta: geometry.delta };
    });
    for (const { inside, delta } of insides) {
      penDrag(appHost, inside, [{ x: inside.x + delta.x * 4, y: inside.y + delta.y * 4 }]);
    }

    const [first] = insides;
    const trace = traceLine(appHost.workspace.editor!, appHost.workspace.registry.queries, "belt",
      { x: first!.inside.x + first!.delta.x * 2, y: first!.inside.y + first!.delta.y * 2 })!;
    expect(trace.cells).toHaveLength(4);
    expect(new Set(trace.cells.map((entry) => entry.cell.x * 1000 + entry.cell.y)).size).toBe(4);
    expect(trace.cells.every((entry) => (entry.cell.x - first!.inside.x) * first!.delta.y === 0
      && (entry.cell.y - first!.inside.y) * first!.delta.x === 0)).toBe(true);
  });
});

describe("routing a line around obstacles", () => {
  it("finds a way around a wall when the pen reaches the target machine", async () => {
    const target = { ...furnace({ recipe: false }), id: "target", position: { x: 30, y: 42 } };
    // 两台设备挡在起点与目标之间，直着或一次转弯都过不去。
    const walls = [26, 29, 32, 35].map((x, index) => ({ ...furnace({ recipe: false }), id: `wall-${index}`, position: { x, y: 36 } }));
    const appHost = await createAppHost([furnace({ recipe: true }), target, ...walls]);
    const { inside, delta } = furnaceBeltOutput(appHost);

    penDrag(appHost, inside, [{ x: inside.x + delta.x * 2, y: inside.y + delta.y * 2 }, { x: 31, y: 43 }]);

    const belts = entities(appHost).filter((entity) => entity.definitionId.startsWith("belt"));
    expect(belts.length).toBeGreaterThan(9);
    const wallCells = walls.flatMap((wall) => [0, 1, 2].flatMap((dx) => [0, 1, 2].map((dy) => `${wall.position.x + dx}:${wall.position.y + dy}`)));
    expect(belts.some((belt) => wallCells.includes(`${belt.position.x}:${belt.position.y}`))).toBe(false);
    expect(inputOutsideCells(appHost, target).some((cell) =>
      belts.some((belt) => belt.position.x === cell.x && belt.position.y === cell.y))).toBe(true);
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

function fingerDrag(appHost: AppHost, from: GridPoint, path: readonly GridPoint[]): void {
  const touch = (cell: GridPoint, buttons: number) => ({ ...pointer(appHost, cell, buttons), pointerType: "touch", pointerId: 11 });
  appHost.gestureAdapter.handlePointerDown(touch(from, 1));
  for (const cell of path) {
    const start = clientCenter(appHost, from);
    const target = clientCenter(appHost, cell);
    // 分几步移动，像手指一样连续上报位置。
    for (let step = 1; step <= 4; step += 1) {
      appHost.gestureAdapter.handlePointerMove({
        ...touch(cell, 1),
        clientX: start.x + (target.x - start.x) * step / 4,
        clientY: start.y + (target.y - start.y) * step / 4,
      });
      appHost.gestureAdapter.advanceFrame(0);
    }
  }
  appHost.gestureAdapter.handlePointerUp(touch(path.at(-1)!, 0));
}
