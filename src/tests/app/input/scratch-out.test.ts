import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isScratchOutStroke, type ScratchPoint } from "@/app/canvas/scratch-out";
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

function stroke(xs: readonly number[], stepMs = 30): ScratchPoint[] {
  return xs.map((x, index) => ({ x, y: 100 + (index % 2) * 3, timeMs: index * stepMs }));
}

describe("scratch-out stroke", () => {
  it("is a quick back-and-forth with at least three turns", () => {
    expect(isScratchOutStroke(stroke([0, 40, 0, 40, 0]))).toBe(true);
    expect(isScratchOutStroke(stroke([0, 40, 0, 40]))).toBe(false);
  });

  it("ignores hand tremor and slow panning back and forth", () => {
    expect(isScratchOutStroke(stroke([0, 6, 0, 6, 0, 6, 0]))).toBe(false);
    expect(isScratchOutStroke(stroke([0, 200, 0, 200, 0], 600))).toBe(false);
  });
});

describe("scratching out devices with the pen", () => {
  it("deletes the devices the scratch passes over, as one undo step, without moving the view", async () => {
    const appHost = await createAppHost([furnace("a", { x: 30, y: 30 }), furnace("b", { x: 34, y: 30 })]);
    const center = { ...appHost.mainCanvas.view.state.center };
    // 从设备旁的空地起笔（从设备上起笔是拖动设备），来回划过两台设备。
    const left = clientCenter(appHost, { x: 24, y: 31 });
    const right = clientCenter(appHost, { x: 42, y: 31 });

    penDrag(appHost, [left, right, left, right, left]);

    expect(entities(appHost)).toHaveLength(0);
    expect(appHost.mainCanvas.view.state.center).toEqual(center);
    expect(appHost.workspace.editor!.actions.undoDocumentHistory()).toBe(true);
    expect(entities(appHost)).toHaveLength(2);
  });

  it("still pans the view for an ordinary drag", async () => {
    const appHost = await createAppHost([furnace("a", { x: 30, y: 30 })]);
    const center = { ...appHost.mainCanvas.view.state.center };
    const from = clientCenter(appHost, { x: 24, y: 31 });

    penDrag(appHost, [from, { x: from.x + 120, y: from.y }, { x: from.x + 240, y: from.y + 30 }]);

    expect(entities(appHost)).toHaveLength(1);
    expect(appHost.mainCanvas.view.state.center).not.toEqual(center);
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

function penDrag(appHost: AppHost, path: ReadonlyArray<{ x: number; y: number }>): void {
  const pointer = (position: { x: number; y: number }, buttons: number) => ({
    pointerId: 7, pointerType: "pen", clientX: position.x, clientY: position.y,
    button: 0, buttons, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  });
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
  }
  appHost.gestureAdapter.handlePointerUp(pointer(path.at(-1)!, 0));
}
