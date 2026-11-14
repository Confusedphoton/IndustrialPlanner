import type { SceneAreaDefinition, SceneBounds, SceneOuterRing, SceneSpace } from "@/domain/shared/scene-space";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import { expandSceneBounds, isPointInSceneBounds, isRectInSceneBounds, unionSceneBounds } from "./scene-space";

export interface BaseAreaGeometry {
  readonly id: string;
  readonly nameplate?: string;
  readonly placeableBounds: SceneBounds;
  readonly outerBounds: SceneBounds;
  readonly outerRing: SceneOuterRing;
}


export function resolveBaseAreas(base: SceneSpace): BaseAreaGeometry[] {
  return base.areas.map(createBaseAreaGeometry);
}

export function resolveBaseAreaContainingRect(
  base: SceneSpace,
  rect: GridRect,
  scope: "placeable" | "outer",
): BaseAreaGeometry | null {
  return resolveBaseAreas(base).find((area) =>
    isRectInSceneBounds(scope === "placeable" ? area.placeableBounds : area.outerBounds, rect)
  ) ?? null;
}

export function isGridPointInBaseArea(
  base: SceneSpace,
  point: GridPoint,
  scope: "placeable" | "outer",
): boolean {
  return isGridPointInBaseAreas(resolveBaseAreas(base), point, scope);
}

export function isGridPointInBaseAreas(
  areas: readonly BaseAreaGeometry[],
  point: GridPoint,
  scope: "placeable" | "outer",
): boolean {
  return areas.some((area) =>
    isPointInSceneBounds(scope === "placeable" ? area.placeableBounds : area.outerBounds, point)
  );
}



export function resolveBaseOuterBounds(base: SceneSpace): SceneBounds | null {
  return unionSceneBounds(resolveBaseAreas(base).map((area) => area.outerBounds));
}

function createBaseAreaGeometry(area: SceneAreaDefinition): BaseAreaGeometry {
  return {
    id: area.id,
    nameplate: area.nameplate,
    placeableBounds: area.bounds,
    outerBounds: expandSceneBounds(area.bounds, area.outerRing),
    outerRing: area.outerRing,
  };
}
