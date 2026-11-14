import {
  Container,
  Graphics,
  Text,
} from "pixi.js";

import {
  EntityCollectionType,
  type EntityPlacementValidationResult,
} from "@/domain/editor/types/editor-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridRect } from "@/domain/shared/grid";
import type { AppLocale } from "@/domain/app/types/app-types";
import { lookupText } from "@/shared/i18n";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { createDecorationActivityGuard } from "./DecorationRedrawGuard";
import {
  resolveMarqueeGridRectLayout,
  resolveWorldAuxiliaryStrokeWidth,
} from "./MarqueeRectDecoration";

const INVALID_PLACEMENT_COLOR = 0xff3b30;
const _INVALID_PLACEMENT_STROKE_ALPHA = 0.95;
const INVALID_PLACEMENT_TOAST_ALPHA = 0.88;
const INVALID_PLACEMENT_TOAST_TEXT_COLOR = 0xffffff;
const _INVALID_PLACEMENT_STROKE_WIDTH_SCALE = 1.35;
const INVALID_PLACEMENT_TOAST_HORIZONTAL_PADDING = 5;
const INVALID_PLACEMENT_TOAST_VERTICAL_PADDING = 3;
const INVALID_PLACEMENT_TOAST_TOP_OFFSET = 3;
const INVALID_PLACEMENT_TOAST_RADIUS = 4;

export function createInvalidPlacementDecoration(): DecorationLayer {
  const container = new Container();
  const shouldSync = createDecorationActivityGuard();
  const graphics = new Graphics({ roundPixels: true });
  const reasonTexts = new Map<string, Text>();

  container.addChild(graphics);

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      const invalidEntityIds = [...new Set([
        ...(ctx.renderHost.input.source.snapshot.getSnapshot().interaction?.collections[EntityCollectionType.invalidPlacement] ?? []),
        ...(ctx.renderHost.input.overlay.getSnapshot()?.invalidEntityIds ?? []),
      ])];
      if (!shouldSync(invalidEntityIds.length > 0)) return;
      measureDecorationStep(ctx, "invalidPlacement.clear", () => {
        graphics.clear();
      });

      const source = ctx.renderHost.input.source;
      if (source === null) {
        hideUnusedReasonTexts(reasonTexts, new Set());
        return;
      }

      ctx.profiler?.count("invalidPlacement.entityIds", invalidEntityIds.length);
      const locale = ctx.renderHost.input.presentation.getSnapshot().settings.locale;
      const activeTextEntityIds = new Set<string>();
      const entityDefinitionMap = measureDecorationStep(
        ctx,
        "invalidPlacement.buildDefinitionMap",
        () => new Map(
          ctx.renderHost.input.source.registry.entityDefinitions.map((definition) => [
            definition.id,
            definition,
          ]),
        ),
      );

      const previewCollection = source.snapshot.getSnapshot().interaction?.collections[EntityCollectionType.preview];
      ctx.profiler?.count("invalidPlacement.previewEntityIds", previewCollection?.length ?? 0);

      measureDecorationStep(ctx, "invalidPlacement.syncEntities", () => {
        for (const entityId of invalidEntityIds) {

          const entity = source.queries.getEntityById(entityId);
          if (entity === null) {
            continue;
          }

          const definition = entityDefinitionMap.get(entity.definitionId);
          if (definition === undefined) {
            continue;
          }

          const gridRect = resolveEntityGridRect({
            entity,
            definition,
          });
          const layout = resolveMarqueeGridRectLayout({
            gridRect,
            viewportBounds: ctx.viewportBounds,
            viewportCenter: {
              x: ctx.viewportState.centerX,
              y: ctx.viewportState.centerY,
            },
            gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
            displayRotation: ctx.viewportState.displayRotation,
          });

          if (layout === null) {
            continue;
          }

          drawInvalidPlacementStroke({
            graphics,
            layout,
            gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          });

          const reasonText = resolveInvalidPlacementToastReasonText({
            gridRect,
            locale,
            validation: source.queries.getEntityPlacementValidation(entityId),
          });
          if (reasonText === null || reasonText.length === 0) {
            continue;
          }

          const text = resolveReasonText({
            entityId,
            reasonTexts,
            container,
          });
          activeTextEntityIds.add(entityId);
          syncReasonToast({
            graphics,
            text,
            reasonText,
            layout,
            gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          });
        }
      });

      ctx.profiler?.count("invalidPlacement.activeTexts", activeTextEntityIds.size);
      ctx.profiler?.count("invalidPlacement.cachedTexts", reasonTexts.size);

      measureDecorationStep(ctx, "invalidPlacement.hideUnusedTexts", () => {
        hideUnusedReasonTexts(reasonTexts, activeTextEntityIds);
      });
    },

    destroy(): void {
      reasonTexts.clear();
      container.destroy({ children: true });
    },
  };
}

export function resolveInvalidPlacementToastReasonText(options: {
  validation: EntityPlacementValidationResult;
  gridRect: GridRect;
  locale: AppLocale;
}): string | null {
  const primaryReason = options.validation.reasons[0];
  if (primaryReason === undefined) {
    return null;
  }

  if (primaryReason.code === "overlap" && isUnitGridRect(options.gridRect)) {
    return null;
  }

  return lookupText(options.locale, primaryReason.message) ?? primaryReason.message;
}

function drawInvalidPlacementStroke(options: {
  graphics: Graphics;
  layout: { x: number; y: number; width: number; height: number };
  gridCellPixelSize: number;
}): void {
  const strokeWidth =
    resolveWorldAuxiliaryStrokeWidth(options.gridCellPixelSize)
    * _INVALID_PLACEMENT_STROKE_WIDTH_SCALE;
  const halfStrokeWidth = strokeWidth / 2;

  options.graphics
    .rect(
      options.layout.x + halfStrokeWidth,
      options.layout.y + halfStrokeWidth,
      Math.max(0, options.layout.width - strokeWidth),
      Math.max(0, options.layout.height - strokeWidth),
    )
    .stroke({
      width: strokeWidth,
      color: INVALID_PLACEMENT_COLOR,
      alpha: _INVALID_PLACEMENT_STROKE_ALPHA,
    });
}

function resolveReasonText(options: {
  entityId: string;
  reasonTexts: Map<string, Text>;
  container: Container;
}): Text {
  const existing = options.reasonTexts.get(options.entityId);
  if (existing !== undefined) {
    return existing;
  }

  const text = new Text({
    text: "",
    style: {
      fill: INVALID_PLACEMENT_TOAST_TEXT_COLOR,
      fontFamily: "system-ui, sans-serif",
      fontSize: 10,
      fontWeight: "600",
      align: "center",
      wordWrap: true,
      wordWrapWidth: 80,
      lineHeight: 12,
    },
  });
  text.anchor.set(0.5);
  text.roundPixels = true;
  options.container.addChild(text);
  options.reasonTexts.set(options.entityId, text);
  return text;
}

function syncReasonToast(options: {
  graphics: Graphics;
  text: Text;
  reasonText: string;
  layout: { x: number; y: number; width: number; height: number };
  gridCellPixelSize: number;
}): void {
  const maxToastWidth = Math.max(8, options.layout.width - INVALID_PLACEMENT_TOAST_TOP_OFFSET * 2);
  const fontSize = Math.max(
    6,
    Math.min(12, Math.floor(options.gridCellPixelSize * 0.2)),
  );
  const lineHeight = Math.ceil(fontSize * 1.16);

  options.text.text = options.reasonText;
  options.text.style = {
    fill: INVALID_PLACEMENT_TOAST_TEXT_COLOR,
    fontFamily: "system-ui, sans-serif",
    fontSize,
    fontWeight: "600",
    align: "center",
    wordWrap: true,
    wordWrapWidth: Math.max(4, maxToastWidth - INVALID_PLACEMENT_TOAST_HORIZONTAL_PADDING * 2),
    lineHeight,
  };

  const textSize = resolveReasonToastTextSize({
    text: options.reasonText,
    fontSize,
    lineHeight,
    maxLineWidth: Math.max(4, maxToastWidth - INVALID_PLACEMENT_TOAST_HORIZONTAL_PADDING * 2),
  });
  const toastWidth = Math.min(
    maxToastWidth,
    Math.max(
      8,
      textSize.width + INVALID_PLACEMENT_TOAST_HORIZONTAL_PADDING * 2,
    ),
  );
  const toastHeight = Math.min(
    Math.max(8, options.layout.height),
    Math.max(
      lineHeight + INVALID_PLACEMENT_TOAST_VERTICAL_PADDING * 2,
      textSize.height + INVALID_PLACEMENT_TOAST_VERTICAL_PADDING * 2,
    ),
  );
  const toastX = options.layout.x + (options.layout.width - toastWidth) / 2;
  const toastY = options.layout.y + INVALID_PLACEMENT_TOAST_TOP_OFFSET;

  options.graphics
    .roundRect(
      toastX,
      toastY,
      toastWidth,
      toastHeight,
      Math.min(INVALID_PLACEMENT_TOAST_RADIUS, toastHeight / 2),
    )
    .fill({
      color: INVALID_PLACEMENT_COLOR,
      alpha: INVALID_PLACEMENT_TOAST_ALPHA,
    });

  options.text.x = toastX + toastWidth / 2;
  options.text.y = toastY + toastHeight / 2;
  options.text.visible = true;
}

function resolveReasonToastTextSize(options: {
  text: string;
  fontSize: number;
  lineHeight: number;
  maxLineWidth: number;
}): { width: number; height: number } {
  const averageCharacterWidth = Math.max(1, options.fontSize * 0.58);
  const maxCharactersPerLine = Math.max(
    1,
    Math.floor(options.maxLineWidth / averageCharacterWidth),
  );
  const lineCount = Math.max(
    1,
    options.text.split(/\s+/).reduce((total, segment) =>
      total + Math.max(1, Math.ceil(segment.length / maxCharactersPerLine)),
    0),
  );
  const longestLineCharacterCount = Math.min(
    options.text.length,
    maxCharactersPerLine,
  );

  return {
    width: Math.min(
      options.maxLineWidth,
      Math.max(1, longestLineCharacterCount * averageCharacterWidth),
    ),
    height: lineCount * options.lineHeight,
  };
}

function hideUnusedReasonTexts(
  reasonTexts: Map<string, Text>,
  activeEntityIds: ReadonlySet<string>,
): void {
  for (const [entityId, text] of reasonTexts) {
    if (activeEntityIds.has(entityId)) {
      continue;
    }

    text.visible = false;
  }
}

function resolveEntityGridRect(options: {
  entity: { position: { x: number; y: number }; rotation: 0 | 90 | 180 | 270 };
  definition: EntityDefinition;
}): GridRect {
  const footprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.entity.rotation,
  );

  return {
    x: options.entity.position.x,
    y: options.entity.position.y,
    width: footprint.width,
    height: footprint.height,
  };
}

function isUnitGridRect(gridRect: GridRect): boolean {
  return gridRect.width === 1 && gridRect.height === 1;
}

function measureDecorationStep<T>(
  ctx: DecorationSyncContext,
  stage: string,
  callback: () => T,
): T {
  if (ctx.profiler === undefined) {
    return callback();
  }

  return ctx.profiler.measure(stage, callback);
}
