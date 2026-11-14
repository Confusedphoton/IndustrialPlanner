import { Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import type { GridRect } from "@/domain/shared/grid";
import { resolveRegionGridBounds } from "@/shared/geometry/region-rects";
import { resolveSceneOuterRects, resolveSceneViewportGridRect, resolveSceneWarningRects } from "./scene-space-layout";
import {
  resolveDisplayRotationRadians,
  resolveViewportPointFromWorldPoint,
} from "@/shared/geometry/viewport-transform";
import {
  BASE_OUTER_WARNING_PADDING_CELLS,
  resolveCurrentBaseDefinition,
} from "./BaseBoundaryDecoration";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveMarqueeGridRectLayout } from "./MarqueeRectDecoration";
import {
  createGrassGroundLayout,
  GRASS_GROUND_BASE_TEXTURE_KEY,
  GRASS_GROUND_TILE_GRID_CELLS,
  type GrassGroundPlacement,
} from "./grass-ground-layout";

const SCANLINE_TEXTURE_KEY = "texture-scanline-45deg-50opacity";
const WARNING_FILL_COLOR_RED = 0xff4d4f;
const WARNING_FILL_COLOR_BLUE = 0x4d7fff;
const WARNING_FILL_ALPHA = 0.18;
const WARNING_SCANLINE_TINT_RED = 0xff4d4f;
const WARNING_SCANLINE_TINT_BLUE = 0x4d7fff;
const WARNING_SCANLINE_ALPHA = 0.92;
const WARNING_BLUE_TAG = "武陵";

export function createGrassBackgroundDecoration(
  renderHost: DecorationSyncContext["renderHost"],
): DecorationLayer {
  const container = new Container();
  container.label = "grass-background";
  container.eventMode = "none";
  const ground = new Container();
  ground.label = "grass-ground";
  ground.visible = false;
  const patches = new Container();
  patches.label = "grass-patches";
  const gravel = new Container();
  gravel.label = "grass-gravel";
  const groundMask = new Graphics();
  const grassSprite = new TilingSprite({
    texture: Texture.EMPTY,
    width: 0,
    height: 0,
  });
  grassSprite.label = "grass-base";
  const warningFill = new Graphics({ roundPixels: true });
  const warningScanlineSprite = new TilingSprite({
    texture: Texture.EMPTY,
    width: 0,
    height: 0,
  });
  const warningMask = new Graphics({ roundPixels: true });
  let isGrassTextureReady = false;
  let isWarningTextureReady = false;
  let destroyed = false;
  let textureRevision = 0;
  let layoutKey = "";
  let lastSyncKey = "";
  let visibleInstanceCount = 0;
  const textures = new Map<string, Texture>();
  const requestedTextures = new Set<string>();
  const instances = new Map<string, {
    sprite: Sprite;
    placement: GrassGroundPlacement;
  }>();

  // 矩形遮罩需要参与 Pixi 的边界计算；mask 机制会自行排除其普通绘制。
  groundMask.renderable = true;
  ground.mask = groundMask;
  warningMask.renderable = false;
  warningScanlineSprite.mask = warningMask;
  warningScanlineSprite.alpha = WARNING_SCANLINE_ALPHA;

  ground.addChild(grassSprite, patches, gravel, groundMask);
  container.addChild(ground);
  container.addChild(warningFill);
  container.addChild(warningScanlineSprite);
  container.addChild(warningMask);


  void renderHost.textureManager.getTexture(SCANLINE_TEXTURE_KEY).then((texture) => {
    if (destroyed) return;
    warningScanlineSprite.texture = texture;
    isWarningTextureReady = true;
    textureRevision += 1;
  });

  function requestGroundTexture(key: string): void {
    if (requestedTextures.has(key)) return;
    requestedTextures.add(key);
    void renderHost.textureManager.getTexture(key).then((texture) => {
      if (destroyed) return;
      textures.set(key, texture);
      if (key === GRASS_GROUND_BASE_TEXTURE_KEY) {
        grassSprite.texture = texture;
        isGrassTextureReady = true;
      }
      textureRevision += 1;
    });
  }

  function syncGroundInstances(
    outerRects: readonly GridRect[],
    nextLayoutKey: string,
  ): void {
    if (layoutKey === nextLayoutKey) return;
    layoutKey = nextLayoutKey;
    const retainedIds = new Set<string>();
    for (const placement of outerRects.flatMap((rect) => createGrassGroundLayout(rect))) {
      if (retainedIds.has(placement.id)) continue;
      retainedIds.add(placement.id);
      let instance = instances.get(placement.id);
      if (instance === undefined) {
        const sprite = new Sprite(Texture.EMPTY);
        sprite.label = placement.id;
        sprite.anchor.set(0.5);
        sprite.visible = false;
        instance = { sprite, placement };
        instances.set(placement.id, instance);
      }
      instance.placement = placement;
      instance.sprite.position.set(placement.x, placement.y);
      instance.sprite.rotation = resolveDisplayRotationRadians(placement.rotation);
      // 基地范围变化时也按确定性行列顺序重新排列，避免透明混合顺序改变。
      const layer = placement.layer === "patches" ? patches : gravel;
      layer.addChild(instance.sprite);
      requestGroundTexture(placement.textureKey);
    }
    for (const [id, instance] of instances) {
      if (!retainedIds.has(id)) {
        instance.sprite.destroy();
        instances.delete(id);
      }
    }
    groundMask.clear();
    for (const rect of outerRects) {
      groundMask.rect(rect.x, rect.y, rect.width, rect.height).fill(0xffffff);
    }
  }

  function hideBackgroundLayers(): void {
    ground.visible = false;
    visibleInstanceCount = 0;
    lastSyncKey = "";
    grassSprite.visible = false;
    warningScanlineSprite.visible = false;
    warningFill.clear();
    warningMask.clear();
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) return;
      ctx.profiler?.count("grass.instances", instances.size);
      ctx.profiler?.count("grass.visible", visibleInstanceCount);
      ctx.profiler?.count("grass.textures", textures.size);
      const app = ctx.renderHost.input.presentation.getSnapshot();
      if (app === null) {
        hideBackgroundLayers();
        return;
      }

      const baseDefinition = resolveCurrentBaseDefinition(ctx);
      const unbounded = !ctx.renderHost.input.presentation.getSnapshot().showBaseBoundary;
      const baseTag = ctx.renderHost.input.source.registry.baseDefinitions.find((base) =>
        base.id === ctx.renderHost.input.source.snapshot.getSnapshot().document.baseId)?.tag;
      // 无边场景按当前视口加载地面块；世界坐标相位固定，不创建巨型虚构基地。
      const visibleGround = resolveSceneViewportGridRect(ctx, GRASS_GROUND_TILE_GRID_CELLS, GRASS_GROUND_TILE_GRID_CELLS);
      const space = baseDefinition ?? { areas: unbounded ? [{
        id: "preview", bounds: { minX: null, maxX: null, minY: null, maxY: null },
        outerRing: { top: 0, right: 0, bottom: 0, left: 0 },
      }] : [] };
      const outerGridRects = resolveSceneOuterRects(space, visibleGround);
      const outerGridRect = resolveRegionGridBounds(outerGridRects);
      const warningGridRects = resolveSceneWarningRects(space, visibleGround, BASE_OUTER_WARNING_PADDING_CELLS);
      if (outerGridRect === null) {
        hideBackgroundLayers();
        return;
      }

      const showGrass = app.settings.showGrassBackground;
      const nextLayoutKey = outerGridRects.flatMap((rect) =>
        [rect.x, rect.y, rect.width, rect.height]
      ).join(":");
      const syncKey = [
        nextLayoutKey, baseTag, showGrass, textureRevision,
        ctx.viewportState.centerX, ctx.viewportState.centerY,
        ctx.viewportState.gridCellPixelSize, ctx.viewportState.displayRotation,
        ctx.viewportBounds.left, ctx.viewportBounds.top,
        ctx.viewportBounds.width, ctx.viewportBounds.height,
      ].join(":");
      // 仿真帧和设备编辑不会改变地面；只在相关输入变化时更新布局及警告几何。
      if (lastSyncKey === syncKey) return;
      lastSyncKey = syncKey;
      ctx.profiler?.count("grass.layoutSyncs");

      const isBlueWarning = baseTag === WARNING_BLUE_TAG;
      const warningFillColor = isBlueWarning ? WARNING_FILL_COLOR_BLUE : WARNING_FILL_COLOR_RED;
      const warningScanlineTint = isBlueWarning ? WARNING_SCANLINE_TINT_BLUE : WARNING_SCANLINE_TINT_RED;

      const layouts = warningGridRects.flatMap((rect) => {
        const layout = resolveMarqueeGridRectLayout({
          gridRect: rect,
          viewportBounds: ctx.viewportBounds,
          viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          displayRotation: ctx.viewportState.displayRotation,
        });
        return layout === null ? [] : [layout];
      });

      const gridCellSize = ctx.viewportState.gridCellPixelSize;
      const tileGridSize = GRASS_GROUND_TILE_GRID_CELLS;
      const gridOriginPixelPoint = resolveViewportPointFromWorldPoint({
        worldPoint: {
          x: 0,
          y: 0,
        },
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: gridCellSize,
        displayRotation: ctx.viewportState.displayRotation,
      });

      warningScanlineSprite.tint = warningScanlineTint;

      warningFill.clear();
      warningMask.clear();
      for (const warning of layouts) {
        warningFill.rect(warning.x, warning.y, warning.width, warning.height)
          .fill({ color: warningFillColor, alpha: WARNING_FILL_ALPHA });
        warningMask.rect(warning.x, warning.y, warning.width, warning.height)
          .fill({ color: 0xffffff });
      }

      grassSprite.visible = showGrass && isGrassTextureReady;
      ground.visible = grassSprite.visible;
      visibleInstanceCount = 0;
      if (showGrass) {
        requestGroundTexture(GRASS_GROUND_BASE_TEXTURE_KEY);
        syncGroundInstances(outerGridRects, nextLayoutKey);
      }
      if (grassSprite.visible) {
        ground.position.set(gridOriginPixelPoint.x, gridOriginPixelPoint.y);
        ground.scale.set(gridCellSize);
        ground.rotation = resolveDisplayRotationRadians(ctx.viewportState.displayRotation);
        grassSprite.x = outerGridRect.x;
        grassSprite.y = outerGridRect.y;
        grassSprite.width = outerGridRect.width;
        grassSprite.height = outerGridRect.height;
        grassSprite.tileScale.set(
          tileGridSize / (grassSprite.texture.width || tileGridSize),
        );

        // Align grass tile corners with grid origin, handling negative modulo
        grassSprite.tilePosition.x = ((-outerGridRect.x % tileGridSize) + tileGridSize) % tileGridSize;
        grassSprite.tilePosition.y = ((-outerGridRect.y % tileGridSize) + tileGridSize) % tileGridSize;

        for (const { sprite, placement } of instances.values()) {
          const texture = textures.get(placement.textureKey);
          if (texture === undefined) {
            sprite.visible = false;
            continue;
          }
          if (sprite.texture !== texture) {
            sprite.texture = texture;
            sprite.width = placement.size;
            sprite.height = placement.size;
          }
          const point = resolveViewportPointFromWorldPoint({
            worldPoint: placement,
            viewportBounds: ctx.viewportBounds,
            viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
            gridCellPixelSize: gridCellSize,
            displayRotation: ctx.viewportState.displayRotation,
          });
          const radius = placement.size * gridCellSize / 2;
          sprite.visible = point.x + radius > ctx.viewportBounds.left
            && point.x - radius < ctx.viewportBounds.left + ctx.viewportBounds.width
            && point.y + radius > ctx.viewportBounds.top
            && point.y - radius < ctx.viewportBounds.top + ctx.viewportBounds.height;
          if (sprite.visible) visibleInstanceCount += 1;
        }
      }

      warningScanlineSprite.visible = layouts.length > 0 && isWarningTextureReady;
      if (warningScanlineSprite.visible) {
        const warningTilePixelSize = warningScanlineSprite.texture.width || 64;

        warningScanlineSprite.width = ctx.viewportBounds.width;
        warningScanlineSprite.height = ctx.viewportBounds.height;
        warningScanlineSprite.tileScale.set(1);
        warningScanlineSprite.tilePosition.x = ((gridOriginPixelPoint.x % warningTilePixelSize) + warningTilePixelSize) % warningTilePixelSize;
        warningScanlineSprite.tilePosition.y = ((gridOriginPixelPoint.y % warningTilePixelSize) + warningTilePixelSize) % warningTilePixelSize;
      }
    },

    destroy(): void {
      destroyed = true;
      container.destroy({ children: true });
      instances.clear();
      textures.clear();
      requestedTextures.clear();
    },
  };
}

