import type { CanvasInteractionController } from "@/app/canvas";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridPoint } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { isLogisticsDefinitionSuppressed } from "@/shared/logistics-suppression";

type EntityCandidateFilter = (entity: WorldEntity) => boolean;

export function resolveOverlappingEntityCandidatesAtClientPoint(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  pointerEntity: WorldEntity | null;
  filterCandidate?: EntityCandidateFilter;
}): readonly WorldEntity[] {
  const gridCell = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
  if (gridCell === null) {
    return [];
  }

  const entityDefinitions = options.canvas.registry.entityDefinitions;
  const entityDefinitionMap = new Map(
    entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const listedEntities = options.editor.queries.listEntities();
  const candidates: WorldEntity[] = [];

  for (let index = listedEntities.length - 1; index >= 0; index -= 1) {
    const entity = listedEntities[index];
    if (entity === undefined || !(options.filterCandidate?.(entity) ?? true)) {
      continue;
    }

    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    if (!isGridCellInsideEntity({ cell: gridCell, entity, footprint: definition.footprint })) {
      continue;
    }

    if (isSuppressedLogisticsEntity(options.canvas, entity.definitionId)) {
      continue;
    }

    candidates.push(entity);
  }

  return candidates;
}

export function openOverlapEntityMenuIfNeeded(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  pointerEntity: WorldEntity | null;
  filterCandidate?: EntityCandidateFilter;
  onSelect: (entity: WorldEntity) => void;
}): boolean {
  if (resolveOverlapEntityMenu(options.canvas) === null) {
    return false;
  }

  const candidates = resolveOverlappingEntityCandidatesAtClientPoint(options);
  return openOverlapEntityMenuForCandidates({
    canvas: options.canvas,
    editor: options.editor,
    position: options.position,
    candidates,
    onSelect: options.onSelect,
  });
}

export function openOverlapEntityMenuForCandidates(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  candidates: readonly WorldEntity[];
  onSelect: (entity: WorldEntity) => void;
}): boolean {
  const menu = resolveOverlapEntityMenu(options.canvas);
  if (menu === null) {
    return false;
  }

  const candidates = options.candidates;
  if (candidates.length <= 1) {
    return false;
  }

  menu.open({
    position: options.position,
    candidates: candidates.map((entity) => ({
      entityId: entity.id,
      definitionId: entity.definitionId,
    })),
    onSelect: (entityId) => {
      const entity = options.editor.queries.getEntityById(entityId);
      if (entity === null) {
        return;
      }

      options.onSelect(entity);
    },
  });

  return true;
}

function resolveOverlapEntityMenu(canvas: CanvasInteractionController) { return canvas.overlapEntityMenu; }


function isSuppressedLogisticsEntity(
  canvas: CanvasInteractionController,
  definitionId: string,
): boolean {
  const editor = canvas.editor;
  if (editor === null) {
    return false;
  }

  return isLogisticsDefinitionSuppressed({
    definitionId,
    suppressBelts: editor.state.suppressBelts,
    suppressPipes: editor.state.suppressPipes,
    queries: canvas.registry.queries,
  });
}

function isGridCellInsideEntity(options: {
  cell: GridPoint;
  entity: WorldEntity;
  footprint: EntityDefinition["footprint"];
}): boolean {
  const footprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  );

  return (
    options.cell.x >= options.entity.position.x
    && options.cell.x < options.entity.position.x + footprint.width
    && options.cell.y >= options.entity.position.y
    && options.cell.y < options.entity.position.y + footprint.height
  );
}
