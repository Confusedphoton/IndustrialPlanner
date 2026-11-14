import { Container, Sprite, Texture } from "pixi.js";

import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform";
import {
  DEVICE_LABEL_ICON_SIZE,
  getPrimaryOutputCircleTexture,
} from "@/renderer/sprites/generic-device-sprite";
import type { RenderTextureConfig } from "@/renderer/texture/texture-config";
import { createInsetItemIconTexture } from "@/renderer/texture";

import { isLogisticsDefinitionSuppressed } from "@/shared/logistics-suppression";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { createEntityDefinitionMap } from "./BeltVisualGeometry";
import {
  createConfiguredItemIconEntityCache,
} from "./ConfiguredItemIconEntityCache";

const WAREHOUSE_PICKUP_DEFINITION_ID = "unloader_1";


interface ConfiguredItemIconView {
  readonly root: Container;
  readonly circle: Sprite;
  readonly icon: Sprite;
  currentItemId: string | null;
  iconTextureKey: string | null;
}

interface ConfiguredItemIconDecoration extends DecorationLayer {
  sync(
    context: DecorationSyncContext,
    entities?: readonly WorldEntity[],
  ): void;
}

/**
 * 物品准入口图标 Decoration。
 *
 * 当准入口设备（item_log_admission / item_pipe_admission）设置了准入物品时，
 * 在设备中心渲染 圆圈 + 物品图标，与主要产物图标样式一致。
 */
export function createConfiguredItemIconDecoration(): ConfiguredItemIconDecoration {
  const container = new Container();
  const views: ConfiguredItemIconView[] = [];

  const configuredItemIconEntityCache = createConfiguredItemIconEntityCache();
  let textureConfig: RenderTextureConfig | null = null;
  let destroyed = false;

  const hideAll = (): void => {
    container.visible = false;

    for (const view of views) {
      view.root.visible = false;
    }
  };

  const ensureView = (index: number): ConfiguredItemIconView => {
    let view = views[index];
    if (view !== undefined) {
      return view;
    }

    const root = new Container();
    const circle = new Sprite(Texture.EMPTY);
    circle.anchor.set(0.5);
    circle.roundPixels = true;

    const icon = new Sprite(Texture.EMPTY);
    icon.anchor.set(0.5);
    icon.roundPixels = true;

    root.addChild(circle);
    root.addChild(icon);
    container.addChild(root);

    view = {
      root,
      circle,
      icon,
      currentItemId: null,
      iconTextureKey: null,
    };
    views.push(view);
    return view;
  };

  const resolveConfiguredItemIconEntities = (options: {
    ctx: DecorationSyncContext;
    entities: readonly WorldEntity[];
  }): readonly WorldEntity[] => {
    const source = options.ctx.renderHost.input.source;
    if (source.snapshot.getSnapshot().disposed) {
      return [];
    }

    const previewEntities = source.snapshot.getSnapshot().interaction?.collections.preview.flatMap((entityId) => {
      const entity = source.queries.getEntityById(entityId);
      return entity === null ? [] : [entity];
    });

    return configuredItemIconEntityCache.resolve({
      documentSnapshot: source.snapshot.getSnapshot().document.entities,
      entities: options.entities,
      previewEntities: previewEntities ?? [],
      isConfiguredItemIconDefinition: (definitionId) => (
        definitionId === WAREHOUSE_PICKUP_DEFINITION_ID
        || options.ctx.renderHost.input.source.registry.queries.resolveLogisticsRole(definitionId)
          === "admission"
      ),
    });
  };

  const resolveAdmissionItemId = (
    entity: WorldEntity,
    definition: EntityDefinition,
  ): string | null => {
    for (let gi = 0; gi < definition.portGroups.length; gi += 1) {
      const group = definition.portGroups[gi]!;
      if (group.direction !== "input") {
        continue;
      }

      for (let pi = 0; pi < group.ports.length; pi += 1) {
        const port = group.ports[pi]!;
        if (port.admissionRule === undefined || port.admissionRule === null) {
          continue;
        }

        // 优先读取 entity.config 覆盖值
        const configPath = `portGroups[${gi}].ports[${pi}].admissionRule`;
        const configValue = entity.config[configPath];
        if (configValue !== null && configValue !== undefined && typeof configValue === "object") {
          const itemId = (configValue as Record<string, unknown>).itemId;
          if (typeof itemId === "string" && itemId.length > 0) {
            return itemId;
          }
          // config 中 admissionRule 明确存在但 itemId 为 null/空 → 无准入物品
          return null;
        }

        // 回退到 definition 默认值
        if (port.admissionRule.itemId !== null) {
          return port.admissionRule.itemId;
        }
      }
    }

    return null;
  };

  const resolveWarehousePickupItemId = (
    entity: WorldEntity,
    slotLinks: readonly SlotLinkDefinition[],
  ): string | null => {
    const documentEntityId = resolveDocumentEntityId(entity);
    const warehouseLink = slotLinks.find((link) =>
      link.source.entityId === documentEntityId
      && link.target.entityId === "warehouse",
    );
    const itemId = warehouseLink?.target.slotId;
    return typeof itemId === "string" && itemId.length > 0 ? itemId : null;
  };

  const resolveConfiguredItemId = (options: {
    entity: WorldEntity;
    definition: EntityDefinition;
    slotLinks: readonly SlotLinkDefinition[];
    isAdmissionDefinition: boolean;
  }): string | null => {
    if (options.isAdmissionDefinition) {
      return resolveAdmissionItemId(options.entity, options.definition);
    }

    if (options.entity.definitionId === WAREHOUSE_PICKUP_DEFINITION_ID) {
      return resolveWarehousePickupItemId(options.entity, options.slotLinks);
    }

    return null;
  };

  return {
    container,

    sync(ctx: DecorationSyncContext, frameEntities?: readonly WorldEntity[]): void {
      if (destroyed) {
        return;
      }

      const entities = resolveConfiguredItemIconEntities({
        ctx,
        entities: frameEntities
          ?? ctx.renderHost.input.source?.queries.listEntities()
          ?? [],
      });
      if (entities.length === 0) {
        hideAll();
        return;
      }

      const editorState = ctx.renderHost.input.source.snapshot.getSnapshot().interaction;
      const documentSnapshot = ctx.renderHost.input.source.snapshot.getSnapshot().document ?? null;
      const slotLinks = documentSnapshot?.slotLinks ?? [];
      const suppressBelts = editorState?.suppressBelts ?? false;
      const suppressPipes = editorState?.suppressPipes ?? false;

      const definitionMap = createEntityDefinitionMap(ctx);
      const vs = ctx.viewportState;
      const vb = ctx.viewportBounds;
      const zoomRatio = Number.isFinite(vs.gridCellPixelSize) && vs.gridCellPixelSize > 0
        ? vs.gridCellPixelSize / WORLD_GRID_CELL_PIXEL_SIZE
        : 1;
      const iconSize = DEVICE_LABEL_ICON_SIZE * zoomRatio;

      // 纹理配置（首次获取后缓存）
      if (textureConfig === null) {
        textureConfig = ctx.renderHost.internalState.textureConfig as RenderTextureConfig;
      }
      const circleTex = getPrimaryOutputCircleTexture(textureConfig!);

      const itemIconById = new Map(
        ctx.renderHost.input.source.registry.itemDefinitions.map((item) => [item.id, item.iconId]),
      );

      let viewIndex = 0;

      for (const entity of entities) {
        // 主画布和计划覆盖由 GenericDeviceSprite 共用标签，普通静态预览保留配置圆框。
        if (entity.definitionId === WAREHOUSE_PICKUP_DEFINITION_ID
          && (ctx.renderHost.input.simulation !== null
            || ctx.renderHost.input.overlay.getSnapshot()?.deviceItemIds[resolveDocumentEntityId(entity)]?.length)) continue;
        // 被压制的准入口不显示物品图标
        if (isLogisticsDefinitionSuppressed({
          definitionId: entity.definitionId,
          suppressBelts,
          suppressPipes,
          queries: ctx.renderHost.input.source.registry.queries,
        })) {
          continue;
        }

        const definition = definitionMap.get(entity.definitionId);
        if (definition === undefined) {
          continue;
        }

        const itemId = resolveConfiguredItemId({
          entity,
          definition,
          slotLinks,
          isAdmissionDefinition:
            ctx.renderHost.input.source.registry.queries.resolveLogisticsRole(entity.definitionId)
              === "admission",
        });
        if (itemId === null) {
          continue;
        }

        const view = ensureView(viewIndex);
        viewIndex += 1;

        // 居中于设备中心
        const rotatedFootprint = getRotatedGridFootprint(definition.footprint, entity.rotation);
        const worldCenter = getGridFootprintCenterCells(entity.position, rotatedFootprint);
        const viewportPoint = resolveViewportPointFromWorldPoint({
          worldPoint: worldCenter,
          viewportBounds: { left: vb.left, top: vb.top, width: vb.width, height: vb.height },
          viewportCenter: { x: vs.centerX, y: vs.centerY },
          gridCellPixelSize: vs.gridCellPixelSize,
          displayRotation: vs.displayRotation,
        });

        view.root.x = viewportPoint.x;
        view.root.y = viewportPoint.y;
        view.root.visible = true;

        // 圆圈
        view.circle.texture = circleTex;
        view.circle.width = iconSize;
        view.circle.height = iconSize;

        // 物品图标：先布局尺寸（每帧更新），纹理异步加载
        const insideSize = iconSize;
        view.icon.width = insideSize;
        view.icon.height = insideSize;
        view.icon.anchor.set(0.5);

        const iconId = itemIconById.get(itemId);
        const nextTextureKey = iconId !== undefined ? `item-icon-${iconId}` : null;

        if (nextTextureKey !== null && view.iconTextureKey !== nextTextureKey) {
          view.iconTextureKey = nextTextureKey;
          view.icon.texture = Texture.EMPTY;

          void ctx.renderHost.textureManager.getTexture(nextTextureKey).then((texture) => {
            if (destroyed || view.iconTextureKey !== nextTextureKey) {
              return;
            }
            view.icon.texture = createInsetItemIconTexture(texture);
          });
        }

        view.currentItemId = itemId;
      }

      // 隐藏多余的 view
      for (let i = viewIndex; i < views.length; i += 1) {
        views[i]!.root.visible = false;
      }

      container.visible = viewIndex > 0;
    },

    destroy(): void {
      destroyed = true;
      hideAll();
      for (const view of views) {
        view.root.destroy({ children: true });
      }
      views.length = 0;
      container.destroy({ children: true });
    },
  };
}

function resolveDocumentEntityId(entity: WorldEntity): string {
  if (
    "originalEntityId" in entity
    && typeof entity.originalEntityId === "string"
    && entity.originalEntityId.length > 0
  ) {
    return entity.originalEntityId;
  }

  return entity.id;
}
