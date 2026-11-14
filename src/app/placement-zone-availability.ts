import type { CanvasInteractionController } from "./canvas";
import type { AppHost } from "@/app/host/app-host";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import { resolveEntityPlacementAreas } from "@/shared/entity-placement-whitelist";
import { allowsFreeProtocolCorePlacement, isProtocolCoreDefinitionId } from "@/shared/protocol-core";

const UNPLACEABLE_TAG = "不可摆放";


export function canPlaceEntityDefinitionInCurrentBase(
  canvas: CanvasInteractionController,
  definition: EntityDefinition,
  placementKind: "manual" | "blueprint" = "manual",
): boolean {
  const paletteAvailable = canvas.isPaletteDefinitionAvailable(definition.id);
  if (paletteAvailable !== null) return paletteAvailable;
  let baseId: string | null = null;
  try {
    const editor = canvas.editor;
    baseId = editor?.document.getSnapshot().baseId ?? null;
  } catch {
    baseId = null;
  }

  return canPlaceEntityDefinitionInBase(canvas.workbench, definition, baseId, placementKind);
}

export function canPlaceEntityDefinitionInBase(
  appHost: AppHost,
  definition: EntityDefinition,
  baseId: string | null,
  placementKind: "manual" | "blueprint" = "manual",
): boolean {

  const baseDefinitions = appHost.workspace.registry.baseDefinitions;
  if (placementKind === "manual" && isProtocolCoreDefinitionId(definition.id)
    && !allowsFreeProtocolCorePlacement(baseId ?? "", baseDefinitions)) {
    return false;
  }
  const baseDefinition = baseDefinitions.find((candidate) => candidate.id === baseId);
  return baseDefinition !== undefined
    && resolveEntityPlacementAreas(definition, baseDefinition, resolveBaseAreas(baseDefinition)).length > 0;
}

export function hasPlaceableEntityDefinitionInCurrentBase(
  canvas: CanvasInteractionController,
  uiGroup: EntityDefinition["uiGroup"],
): boolean {
  return canvas.registry.entityDefinitions.some((definition) =>
    definition.uiGroup === uiGroup
    && !definition.tags.includes(UNPLACEABLE_TAG)
    && canPlaceEntityDefinitionInCurrentBase(canvas, definition),
  );
}

export function canPlaceBlueprintDocumentInCurrentBase(
  canvas: CanvasInteractionController,
  blueprint: BlueprintDocument,
): boolean {
  const definitionById = new Map(
    canvas.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );

  return Object.values(blueprint.entities).every((entity) => {
    const definition = definitionById.get(entity.definitionId);

    return definition === undefined
      || canPlaceEntityDefinitionInCurrentBase(canvas, definition, "blueprint");
  });
}

