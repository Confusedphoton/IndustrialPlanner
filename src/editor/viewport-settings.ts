import { EDITOR_GRID_CELL_PIXEL_SIZE } from "./viewport-constants";

export const DEFAULT_VIEWPORT_GRID_SIZE = 1;

import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { GridRect, GridRotation } from "@/domain/shared/grid";
import type { SceneBounds } from "@/domain/shared/scene-space";
import { expandSceneBounds } from "@/shared/geometry/scene-space";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";

const VIEWPORT_ZOOM_STEPS_PER_DOUBLING = 6;
const BASE_WARNING_PADDING_CELLS = 2;
export const MIN_VIEWPORT_GRID_SIZE = 0.5;
export const MAX_VIEWPORT_GRID_SIZE = 8;
/** 放宽后的最小缩放下，有限场景范围只占画布的这一比例，给边缘工具条与留白留足余量。 */
const SPACE_FIT_MINIMUM_FRACTION = 0.5;

export type ViewportBounds = "base" | "unbounded" | {
  readonly content: GridRect;
  readonly padding: number;
  readonly maxAutoZoom: number;
};

/** 按可见世界范围约束视口；达到自动放大阈值后，无法容纳的方向锁定内容中心。 */
export function resolveContentBoundedViewport(options: {
  center: { x: number; y: number };
  gridSize: number;
  clientRect: { width: number; height: number };
  displayRotation: GridRotation;
  bounds: Exclude<ViewportBounds, string>;
}): { center: { x: number; y: number }; gridSize: number } {
  const { content, padding, maxAutoZoom } = options.bounds;
  const rotated = options.displayRotation === 90 || options.displayRotation === 270;
  const pixelWidth = rotated ? options.clientRect.height : options.clientRect.width;
  const pixelHeight = rotated ? options.clientRect.width : options.clientRect.height;
  const width = content.width + 2 * padding;
  const height = content.height + 2 * padding;
  const minimumZoom = Math.min(maxAutoZoom, Math.max(
    pixelWidth / (width * EDITOR_GRID_CELL_PIXEL_SIZE),
    pixelHeight / (height * EDITOR_GRID_CELL_PIXEL_SIZE),
  ));
  const gridSize = clampViewportGridSize(Math.max(options.gridSize, minimumZoom));
  const cellSize = resolveViewportGridCellPixelSize(gridSize);
  const axis = (center: number, start: number, span: number, pixels: number): number => {
    const halfVisible = pixels / cellSize / 2;
    const min = start - padding + halfVisible;
    const max = start + span + padding - halfVisible;
    return min >= max ? start + span / 2 : Math.min(max, Math.max(min, center));
  };
  return {
    gridSize,
    center: {
      x: axis(options.center.x, content.x, content.width, pixelWidth),
      y: axis(options.center.y, content.y, content.height, pixelHeight),
    },
  };
}

/**
 * 有限场景范围下的最小缩放：默认 50%；画布过矮或过窄、50% 仍显示不下整个范围时放宽，
 * 使「显示整个基地」与滚轮都能缩小到看见全貌。
 */
export function resolveViewportMinimumGridSize(options: {
  bounds: SceneBounds;
  clientRect: { width: number; height: number };
  displayRotation: GridRotation;
}): number {
  const { minX, minY, maxX, maxY } = options.bounds;
  if (minX === null || minY === null || maxX === null || maxY === null
    || maxX <= minX || maxY <= minY || options.clientRect.width <= 0 || options.clientRect.height <= 0) {
    return MIN_VIEWPORT_GRID_SIZE;
  }
  const rotated = options.displayRotation === 90 || options.displayRotation === 270;
  const pixelWidth = rotated ? options.clientRect.height : options.clientRect.width;
  const pixelHeight = rotated ? options.clientRect.width : options.clientRect.height;
  const fit = Math.min(
    pixelWidth / ((maxX - minX) * EDITOR_GRID_CELL_PIXEL_SIZE),
    pixelHeight / ((maxY - minY) * EDITOR_GRID_CELL_PIXEL_SIZE),
  );
  return Math.min(MIN_VIEWPORT_GRID_SIZE, fit * SPACE_FIT_MINIMUM_FRACTION);
}

export function resolveViewportGridSizeAfterZoom(options: {
  currentGridSize: number;
  step: number;
  minimumGridSize?: number;
}): number | null {
  if (!Number.isFinite(options.step) || options.step === 0) {
    return null;
  }

  const zoomFactor = Math.pow(
    2,
    options.step / VIEWPORT_ZOOM_STEPS_PER_DOUBLING,
  );

  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return null;
  }

  const minimum = options.minimumGridSize ?? MIN_VIEWPORT_GRID_SIZE;
  const current = clampViewportGridSize(options.currentGridSize, 0);
  // 下限随画布变大而升高时，低于下限的当前缩放只允许放大，缩小不会反向跳到下限。
  return clampViewportGridSize(current * zoomFactor, Math.min(minimum, current));
}

export function resolveViewportGridCellPixelSize(gridSize: number): number {
  return EDITOR_GRID_CELL_PIXEL_SIZE * clampViewportGridSize(gridSize, 0);
}

export function clampViewportGridSize(value: number, minimum = MIN_VIEWPORT_GRID_SIZE): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_VIEWPORT_GRID_SIZE;
  }

  return Math.min(MAX_VIEWPORT_GRID_SIZE, Math.max(minimum, value));
}

export function clampViewportCenterToBaseWarningBounds(options: {
  center: {
    x: number;
    y: number;
  };
  baseDefinition: BaseDefinition | null;
}): {
  x: number;
  y: number;
} {
  if (options.baseDefinition === null) {
    return {
      x: options.center.x,
      y: options.center.y,
    };
  }

  const bounds = resolveBaseWarningBounds(options.baseDefinition);

  if (bounds === null) {
    return {
      x: options.center.x,
      y: options.center.y,
    };
  }

  return {
    x: clampViewportAxisToBounds(options.center.x, bounds.minX, bounds.maxX),
    y: clampViewportAxisToBounds(options.center.y, bounds.minY, bounds.maxY),
  };
}

function resolveBaseWarningBounds(baseDefinition: BaseDefinition): SceneBounds | null {
  const outerBounds = resolveBaseOuterBounds(baseDefinition);
  return outerBounds === null ? null : expandSceneBounds(outerBounds, {
    top: BASE_WARNING_PADDING_CELLS, right: BASE_WARNING_PADDING_CELLS,
    bottom: BASE_WARNING_PADDING_CELLS, left: BASE_WARNING_PADDING_CELLS,
  });
}

function clampViewportAxisToBounds(
  value: number,
  min: number | null,
  max: number | null,
): number {
  if (!Number.isFinite(value)) {
    return min ?? max ?? 0;
  }

  const lowerClamped = min === null ? value : Math.max(min, value);
  return max === null ? lowerClamped : Math.min(max, lowerClamped);
}
