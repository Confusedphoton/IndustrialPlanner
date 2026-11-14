import type { CanvasInteractionController } from "./canvas";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  isEntityDefinitionVariantSwitchable,
  resolveEntityVariantDefinitions,
  resolveNextEntityVariantDefinitionId,
} from "@/shared/entity-variants";

const UNPLACEABLE_TAG = "不可摆放";

export const SWITCH_DEVICE_MODE_BUTTON_ID =
  "canvas-floating-toolbar-button-switch-mode";

export function resolveSwitchableEntityVariantDefinitions(options: {
  readonly canvas: CanvasInteractionController;
  readonly definitionId: string;
}): readonly EntityDefinition[] {
  return resolveEntityVariantDefinitions({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.canvas),
  });
}

export function resolveNextSwitchableEntityVariantDefinitionId(options: {
  readonly canvas: CanvasInteractionController;
  readonly definitionId: string;
}): string | null {
  return resolveNextEntityVariantDefinitionId({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.canvas),
  });
}

export function canSwitchEntityVariantDefinition(options: {
  readonly canvas: CanvasInteractionController;
  readonly definitionId: string;
}): boolean {
  return isEntityDefinitionVariantSwitchable({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.canvas),
  });
}

function resolveCurrentBaseSwitchableDefinitions(
  canvas: CanvasInteractionController,
): readonly EntityDefinition[] {
  return canvas.registry.entityDefinitions.filter((definition) =>
    !definition.tags.includes(UNPLACEABLE_TAG)
    && canPlaceEntityDefinitionInCurrentBase(canvas, definition),
  );
}
