import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { EditorHost } from "@/editor/editor-host";
import { resolvePlacementValidations } from "@/editor/placement-validation";
import { createRegistryContract } from "@/registry";
import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

const hosts = new Set<EditorHost>();
beforeEach(() => { localStorage.clear(); vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(async () => {
  try {
    for (const host of hosts) {
      try { await host.internalDocuments.flush(); } finally { host.dispose(); }
    }
  } finally { hosts.clear(); localStorage.clear(); vi.unstubAllGlobals(); }
});

async function createHost(): Promise<EditorHost> {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null,
  };
  const host = createEditorTestHost(workspace);
  hosts.add(host);
  await host.internalDocuments.ready();
  host.internalDocument.setSnapshot(createWorldDocument({ baseId: "wuling_protocol_core" }));
  return host;
}

/** 选一个普通的非正方形设备，旋转 90° 会改变占地朝向。 */
function findOblongDefinition(host: EditorHost): EntityDefinition {
  const definition = host.services.registry.entityDefinitions.find((candidate) =>
    candidate.uiGroup === "advancedManufacturing"
    && candidate.footprint.width !== candidate.footprint.height
    && candidate.placementBehaviors.every((behavior) => behavior.type === "default-placement"));
  if (definition === undefined) throw new Error("No oblong manufacturing device in the registry.");
  return definition;
}

function entity(id: string, definitionId: string, x: number, y: number): WorldEntity {
  return { id, definitionId, position: { x, y }, rotation: 0, config: {}, tags: [] };
}

function withEntities(document: WorldDocument, entities: readonly WorldEntity[]): WorldDocument {
  return {
    ...document,
    entities: { ...document.entities, ...Object.fromEntries(entities.map((item) => [item.id, item])) },
    entityOrder: [...document.entityOrder, ...entities.map((item) => item.id)],
  };
}

function isPlaceable(host: EditorHost, document: WorldDocument, entityIds: readonly string[]): boolean {
  const validations = resolvePlacementValidations({ document, workspace: host.services });
  return entityIds.every((entityId) => validations[entityId]?.canPlace === true);
}

/** 在基地内找一处能放下 entities 的平移量，使测试不依赖具体基地坐标。 */
function placeInsideBase(host: EditorHost, entities: readonly WorldEntity[]): WorldDocument {
  const base = host.document.getSnapshot();
  for (let y = 0; y < 120; y += 2) {
    for (let x = 0; x < 120; x += 2) {
      const shifted = entities.map((item) => ({ ...item, position: { x: item.position.x + x, y: item.position.y + y } }));
      const candidate = withEntities(base, shifted);
      if (isPlaceable(host, candidate, shifted.map((item) => item.id))) return candidate;
    }
  }
  throw new Error("No free spot inside the base.");
}

function select(host: EditorHost, entityId: string): void {
  host.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
}

describe("rotating a placed selection in place", () => {
  it("rotates through history so undo and redo restore each orientation", async () => {
    const host = await createHost();
    const definition = findOblongDefinition(host);
    const document = placeInsideBase(host, [entity("device", definition.id, 0, 0)]);
    host.internalDocument.setSnapshot(document);
    select(host, "device");

    expect(host.actions.rotateCollection(EntityCollectionType.selection)).toEqual({ status: "rotated" });
    expect(host.document.getSnapshot().entities.device?.rotation).toBe(90);

    expect(host.actions.undoDocumentHistory()).toBe(true);
    expect(host.document.getSnapshot().entities.device).toEqual(document.entities.device);
    expect(host.actions.redoDocumentHistory()).toBe(true);
    expect(host.document.getSnapshot().entities.device?.rotation).toBe(90);
  });

  it("leaves the device and history untouched when the rotated footprint would overlap another device", async () => {
    const host = await createHost();
    const definition = findOblongDefinition(host);
    const alone = placeInsideBase(host, [entity("device", definition.id, 0, 0)]);
    host.internalDocument.setSnapshot(alone);
    select(host, "device");
    const original = host.queries.findEntityCollectionGridRect(EntityCollectionType.selection)!;
    host.actions.rotateCollection(EntityCollectionType.selection);
    const rotated = host.queries.findEntityCollectionGridRect(EntityCollectionType.selection)!;
    host.actions.undoDocumentHistory();

    // 邻居放在旋转后才会占到的格子上：原朝向下可以放置，旋转后与之重叠。
    const { width, height } = definition.footprint;
    const span = Math.max(width, height) + 1;
    let document: WorldDocument | null = null;
    for (let dy = -span; dy <= span && document === null; dy += 1) {
      for (let dx = -span; dx <= span && document === null; dx += 1) {
        const neighbourRect = { x: original.x + dx, y: original.y + dy, width, height };
        if (!intersects(neighbourRect, rotated) || intersects(neighbourRect, original)) continue;
        const candidate = withEntities(alone, [entity("neighbour", definition.id, neighbourRect.x, neighbourRect.y)]);
        if (isPlaceable(host, candidate, ["device", "neighbour"])) document = candidate;
      }
    }
    expect(document).not.toBeNull();
    host.internalDocument.setSnapshot(document!);
    const undoDepth = host.state.history.undoDepth;

    expect(host.actions.rotateCollection(EntityCollectionType.selection)).toEqual({ status: "blocked", reason: "overlap" });
    expect(host.document.getSnapshot().entities.device).toEqual(document!.entities.device);
    expect(host.state.history.undoDepth).toBe(undoDepth);
  });
});

function intersects(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height;
}
