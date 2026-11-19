import { action } from "mobx";

import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import type { GridEdge, GridRotation } from "@/domain/shared/grid";
import { type LogisticsKind } from "@/domain/shared/logistics";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { resolveRotatedPortGeometry, rotateGridEdge } from "@/shared/geometry/port";
import type { DraftEntity } from "../draft-entity";
import { syncPlacementValidationState } from "../placement-validation";
import type { EditorActionsContext } from "./types";

type Axis = "x" | "y";
interface SeamPort {
  readonly lane: number;
  readonly kind: ItemDomainFlag;
  readonly direction: "input" | "output";
  readonly highSide: boolean;
  readonly transport: LogisticsKind | null;
}

export function createEditorLayoutGapActions({ document, documentWriter, state, workspace }: EditorActionsContext):
  Pick<EditorAction, "previewLayoutGap" | "finishLayoutGap"> {
  const preview = state.collections[EntityCollectionType.preview];
  const ghost = state.collections[EntityCollectionType.ghost];
  const invalid = state.collections[EntityCollectionType.invalidPlacement];
  const registry = workspace.registry.queries;
  let source: WorldDocument | null = null;
  let changes: readonly WorldEntity[] = [];
  let valid = false;
  let draftIds = new Set<string>();
  let hiddenIds = new Set<string>();

  const clear = () => {
    if (source === null) return;
    state.drafts = state.drafts.filter((draft) => !draftIds.has(draft.id));
    preview.replace(preview.filter((id) => !draftIds.has(id)));
    ghost.replace(ghost.filter((id) => !hiddenIds.has(id)));
    draftIds.clear();
    hiddenIds.clear();
    source = null;
    changes = [];
    valid = false;
    syncPlacementValidationState({ document: document.getSnapshot(), state, workspace });
  };

  return {
    previewLayoutGap: action((axis, boundary, offset) => {
      clear();
      if (!Number.isSafeInteger(boundary) || !Number.isInteger(offset) || offset === 0
        || Math.abs(offset) > 32 || preview.length > 0 || ghost.length > 0) return false;
      const current = document.getSnapshot();
      const across: Axis = axis === "x" ? "y" : "x";
      const moved: WorldEntity[] = [];
      const ports: SeamPort[] = [];
      const highEdge: GridEdge = axis === "x" ? "EAST" : "SOUTH";
      const lowEdge: GridEdge = axis === "x" ? "WEST" : "NORTH";

      for (const entity of Object.values(current.entities)) {
        const definition = registry.findEntityDefinition(entity.definitionId);
        if (definition === null) return false;
        const rect = resolveEntityGridRect({ entity, definition });
        const length = axis === "x" ? rect.width : rect.height;
        const highSide = rect[axis] >= boundary;
        if (!highSide && rect[axis] + length > boundary) return false;
        if (highSide === (offset > 0)) {
          moved.push({ ...entity, position: { ...entity.position, [axis]: entity.position[axis] + offset } });
        }
        if ((highSide ? rect[axis] : rect[axis] + length) !== boundary) continue;
        const transport = registry.isBelt(entity.definitionId) ? "belt" : registry.isPipe(entity.definitionId) ? "pipe" : null;
        for (const group of definition.portGroups) {
          for (const port of group.ports) {
            const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
            if (geometry.edge !== (highSide ? lowEdge : highEdge)) continue;
            if (group.direction === "bidirectional") continue;
            ports.push({ lane: entity.position[across] + geometry.cell[across], kind: group.kind,
              direction: group.direction, highSide, transport });
          }
        }
      }
      if (moved.length === 0) return false;
      const usedIds = new Set([...Object.keys(current.entities), ...state.drafts.map((draft) => draft.id)]);
      let id = 0;
      const allocateId = () => {
        let next: string;
        do { next = `layout-gap-${++id}`; } while (usedIds.has(next));
        usedIds.add(next);
        return next;
      };
      const incoming = new Map(ports.filter((port) => port.direction === "input")
        .map((port) => [`${port.highSide}:${port.lane}:${port.kind}`, port]));
      const inserted: WorldEntity[] = [];
      const seenLanes = new Set<string>();
      for (const output of ports.filter((port) => port.direction === "output")) {
        const input = incoming.get(`${!output.highSide}:${output.lane}:${output.kind}`);
        const kind = output.transport ?? input?.transport;
        if (input === undefined || kind == null) continue;
        const laneKey = `${kind}:${output.lane}`;
        if (seenLanes.has(laneKey)) continue;
        seenLanes.add(laneKey);
        const definitionId = registry.resolveLogisticsDefinitionId(kind, "straight");
        if (definitionId === null) return false;
        const edge = registry.findEntityDefinition(definitionId)?.portGroups.find((group) => group.direction === "output")?.ports[0]?.edge;
        const rotations: readonly GridRotation[] = [0, 90, 180, 270];
        const rotation = edge === undefined ? undefined
          : rotations.find((candidate) => rotateGridEdge(edge, candidate) === (output.highSide ? lowEdge : highEdge));
        if (rotation === undefined) return false;
        for (let cell = boundary + Math.min(offset, 0); cell < boundary + Math.max(offset, 0); cell += 1) {
          const position = axis === "x" ? { x: cell, y: output.lane } : { x: output.lane, y: cell };
          inserted.push({ id: allocateId(), definitionId, position, rotation, config: {}, tags: [] });
        }
      }

      changes = [...moved, ...inserted];
      source = current;
      const drafts: DraftEntity[] = changes.map((entity) => ({ ...entity, originalEntityId: entity.id, id: allocateId() }));
      state.drafts = [...state.drafts, ...drafts];
      hiddenIds = new Set(moved.map((entity) => entity.id));
      draftIds = new Set(drafts.map((entity) => entity.id));
      ghost.replace([...hiddenIds]);
      preview.replace([...draftIds]);
      syncPlacementValidationState({ document: current, state, workspace });
      valid = drafts.every((draft) => !invalid.contains(draft.id));
      return valid;
    }),

    finishLayoutGap: action((commit) => {
      const current = source;
      const next = changes;
      const canApply = valid && current !== null && current === document.getSnapshot();
      clear();
      if (!commit || !canApply) return false;
      const entities = { ...current.entities };
      const entityOrder = [...current.entityOrder];
      for (const entity of next) {
        if (entities[entity.id] === undefined) entityOrder.push(entity.id);
        entities[entity.id] = entity;
      }
      return documentWriter.commit({
        action: { type: "entity.move", label: "展开布局", count: next.length, entityIds: next.map((entity) => entity.id) },
        update: (snapshot) => ({ ...snapshot, entities, entityOrder }),
      }) !== null;
    }),
  };
}
