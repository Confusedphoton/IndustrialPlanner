import { describe, expect, it } from "vitest";

import {
  createWorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { collectTransportSegmentEntityIds } from "@/shared/transport-component";

const registry = createRegistryContract();
describe("transport component collection", () => {
  it("does not include an adjacent pipe without reciprocal ports in whole-segment operations", () => {
    const selected = createPipe("selected", 0, 0, 0);
    const adjacentButDisconnected = createPipe("adjacent-disconnected", 1, 0, 90);

    expect(collectPipeSegment([selected, adjacentButDisconnected], selected.id)).toEqual(
      new Set([selected.id]),
    );
  });

  it("includes an adjacent pipe when both endpoint positions match", () => {
    const selected = createPipe("selected", 0, 0, 0);
    const connected = createPipe("connected", 1, 0, 0);

    expect(collectPipeSegment([selected, connected], selected.id)).toEqual(
      new Set([selected.id, connected.id]),
    );
  });
  it("crosses a bridge along the selected lane and keeps the other line intact", () => {
    const first = createPipe("first", 0, 0, 0);
    const bridge = { ...createPipe("bridge", 1, 0, 0), definitionId: "pipe_connector" };
    const last = createPipe("last", 2, 0, 0);
    const crossing = createPipe("crossing", 1, 1, 90);

    expect(collectPipeSegment([first, bridge, last, crossing], first.id)).toEqual(new Set([first.id, last.id]));
    expect(collectPipeSegment([first, bridge, last], first.id)).toEqual(new Set([first.id, bridge.id, last.id]));
  });

});

function collectPipeSegment(
  entities: readonly WorldEntity[],
  startEntityId: string,
): ReadonlySet<string> {
  const document = {
    ...createWorldDocument(),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  };

  return collectTransportSegmentEntityIds({
    startEntity: document.entities[startEntityId]!,
    document,
    registry,
  });
}

function createPipe(
  id: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"],
): WorldEntity {
  return {
    id,
    definitionId: "pipe_straight_1x1",
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}
