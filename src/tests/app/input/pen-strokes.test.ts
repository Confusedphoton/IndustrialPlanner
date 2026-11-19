import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recipeTreeOverlayState } from "@/app/shell/recipe-tree/recipe-tree-state";
import type { AppHost } from "@/app/host/app-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import type { GridPoint } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";
import { createAppTestHost, createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../../shared/fake-indexed-db";

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

describe("pouring the pinned plan into a loop", () => {
  it("lays the plan's machines out inside the loop, stage by stage, without moving the view", async () => {
    runInAction(() => recipeTreeOverlayState.addPin("item_iron_powder"));
    try {
      const appHost = await createAppHost([]);
      const center = { ...appHost.mainCanvas.view.state.center };
      const corner = (x: number, y: number) => clientCenter(appHost, { x, y });

      penTap(appHost, corner(12, 40));
      penDrag(appHost, [corner(12, 40), corner(36, 40), corner(36, 60), corner(12, 60), corner(12, 41)]);

      const placed = entities(appHost);
      const furnaceAt = placed.find((entity) => entity.definitionId === "furnance_1");
      const grinderAt = placed.find((entity) => entity.definitionId === "grinder_1");
      expect(furnaceAt).toBeDefined();
      expect(grinderAt).toBeDefined();
      expect(furnaceAt!.position.x).toBeLessThan(grinderAt!.position.x);
      expect(placed.every((entity) => entity.position.x > 12 && entity.position.x < 36 && entity.position.y > 40 && entity.position.y < 60)).toBe(true);
      expect(appHost.mainCanvas.view.state.center).toEqual(center);
      expect(appHost.workspace.editor!.actions.undoDocumentHistory()).toBe(true);
      expect(entities(appHost)).toHaveLength(0);
    } finally {
      runInAction(() => recipeTreeOverlayState.pins.forEach((pin) => recipeTreeOverlayState.removePin(pin.id)));
    }
  });
});

describe("tap-then-drag lasso", () => {
  it("selects only the devices inside the loop without panning", async () => {
    const appHost = await createAppHost([furnace("inside", { x: 30, y: 30 }), furnace("outside", { x: 48, y: 30 })]);
    const center = { ...appHost.mainCanvas.view.state.center };
    const corner = (x: number, y: number) => clientCenter(appHost, { x, y });
    penTap(appHost, corner(26, 24));
    penDrag(appHost, [corner(26, 24), corner(38, 24), corner(38, 39), corner(26, 39), corner(26, 24)]);

    expect([...appHost.workspace.editor!.state.collections.selection]).toEqual(["inside"]);
    expect(appHost.mainCanvas.view.state.center).toEqual(center);
  });

  it("pans immediately and preserves devices when an unarmed pen reverses direction", async () => {
    const appHost = await createAppHost([furnace("a", { x: 30, y: 30 })]);
    const center = { ...appHost.mainCanvas.view.state.center };
    const from = clientCenter(appHost, { x: 24, y: 31 });
    const to = { x: from.x + 240, y: from.y };
    penDrag(appHost, [from, to, from, to], () => expect(appHost.mainCanvas.view.state.center).not.toEqual(center));
    expect(entities(appHost).map((entity) => entity.id)).toEqual(["a"]);
  });
});

describe("rubber wedge", () => {
  it("extends a connected belt through the gap, moves a machine and undoes both together", async () => {
    const belt = (id: string, x: number): WorldEntity => ({
      ...furnace(id, { x, y: 34 }), definitionId: "belt_straight_1x1",
    });
    const appHost = await createAppHost([belt("left", 31), belt("right", 32), furnace("machine", { x: 36, y: 35 })]);
    const editor = appHost.workspace.editor!;
    expect(editor.actions.previewLayoutGap("x", 32, 2)).toBe(true);
    expect(entities(appHost).map((entity) => entity.position.x)).toEqual([31, 32, 36]);
    expect(editor.actions.finishLayoutGap(true)).toBe(true);
    expect(entities(appHost).find((entity) => entity.id === "machine")?.position.x).toBe(38);
    expect(entities(appHost).filter((entity) => entity.definitionId === "belt_straight_1x1")
      .map((entity) => entity.position.x).sort()).toEqual([31, 32, 33, 34]);
    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(entities(appHost).map((entity) => entity.position.x)).toEqual([31, 32, 36]);
  });

  it("previews a gap after dwelling on the second press and commits on lift", async () => {
    const appHost = await createAppHost([furnace("machine", { x: 38, y: 35 })]);
    const editor = appHost.workspace.editor!;
    const start = clientCenter(appHost, { x: 34, y: 35 });
    const end = clientCenter(appHost, { x: 37, y: 35 });
    let now = 0;
    vi.spyOn(appHost.gestureAdapter, "tapTimeMs").mockImplementation(() => now);
    vi.useFakeTimers();
    try {
      penTap(appHost, start);
      appHost.gestureAdapter.handlePointerDown(pointer(start, 1));
      now = 600;
      vi.advanceTimersByTime(600);
      appHost.gestureAdapter.handlePointerMove(pointer(end, 1));
      appHost.gestureAdapter.advanceFrame(0);
      const preview = editor.queries.getEntityById(editor.state.collections.preview[0] ?? "");
      expect(preview?.position.x).toBe(41);
      expect(editor.document.getSnapshot().entities.machine?.position.x).toBe(38);
      appHost.gestureAdapter.handlePointerUp(pointer(end, 0));
      expect(editor.document.getSnapshot().entities.machine?.position.x).toBe(41);
    } finally {
      vi.useRealTimers();
    }
  });

});

function furnace(id: string, position: GridPoint): WorldEntity {
  return { id, definitionId: "furnance_1", position, rotation: 0, config: {}, tags: [] };
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

function clientCenter(appHost: AppHost, cell: GridPoint): { x: number; y: number } {
  const rect = appHost.mainCanvas.view.queries.findClientRectForGridCell(cell)!;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function pointer(position: { x: number; y: number }, buttons: number) {
  return {
    pointerId: 7, pointerType: "pen", clientX: position.x, clientY: position.y,
    button: 0, buttons, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  };
}

function penTap(appHost: AppHost, position: { x: number; y: number }) {
  appHost.gestureAdapter.handlePointerDown(pointer(position, 1));
  appHost.gestureAdapter.handlePointerUp(pointer(position, 0));
}

function penDrag(appHost: AppHost, path: ReadonlyArray<{ x: number; y: number }>, afterFirstLeg?: () => void): void {
  appHost.gestureAdapter.handlePointerDown(pointer(path[0]!, 1));
  for (let index = 1; index < path.length; index += 1) {
    // 每段分几步移动，像真实的笔一样连续上报位置。
    const previous = path[index - 1]!;
    const position = path[index]!;
    for (let step = 1; step <= 4; step += 1) {
      appHost.gestureAdapter.handlePointerMove(pointer({
        x: previous.x + (position.x - previous.x) * step / 4,
        y: previous.y + (position.y - previous.y) * step / 4,
      }, 1));
      appHost.gestureAdapter.advanceFrame(0);
    }
    if (index === 1) afterFirstLeg?.();
  }
  appHost.gestureAdapter.handlePointerUp(pointer(path.at(-1)!, 0));
}
