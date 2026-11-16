import { observer } from "mobx-react-lite";
import LucidePlus from "~icons/lucide/plus";

import { resolveLineEndSnapPlacements, type LineEndChipState } from "@/app/canvas/line-end-chip";
import type { AppHost } from "@/app/host/app-host";
import { expandLineEndChip, placeConsumerAtLineEnd } from "@/app/input/gesture/actions";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import {
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
} from "@/app/shell/production-planning/production-planning-model";
import { resolveRecipePlacementTarget } from "@/app/shell/recipe-tree/recipe-quick-actions";
import { useRecipeTreePlanningIndex } from "@/app/shell/recipe-tree/recipe-tree-plan";
import { resolveDevicePlacementTarget, type PanelPlacementTarget } from "@/app/shell/shared/panel-placement-drag";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

/** 列出的消费设备上限，避免原矿这类物品铺满画布。 */
const MAX_CONSUMERS = 16;

export interface LineEndConsumer {
  readonly key: string;
  readonly target: PanelPlacementTarget;
  readonly recipe: RecipeDefinition | null;
}

/**
 * 消费线上物品的设备：带配方的设备连同配方交出；只有消耗频道（如发电设备的燃料）的设备不带配方，同型号只列一次。
 * 只列有同族输入端口、可放在当前基地的设备。
 */
export function resolveLineEndConsumers(
  appHost: AppHost,
  recipes: Iterable<RecipeDefinition>,
  chip: LineEndChipState,
): LineEndConsumer[] {
  const registry = appHost.workspace.registry.queries;
  const consumers: LineEndConsumer[] = [];
  const keys = new Set<string>();
  for (const recipe of recipes) {
    if (!recipe.inputs.some((input) => chip.itemIds.includes(input.itemId))) continue;
    const definition = registry.findEntityDefinition(recipe.machineId);
    if (
      definition === null
      || !canPlaceEntityDefinitionInCurrentBase(appHost.mainCanvas, definition)
      || resolveLineEndSnapPlacements({ definition, kind: chip.kind, targetCell: chip.targetCell, flowEdge: chip.flowEdge }).length === 0
    ) continue;
    const withRecipe = resolveRecipePlacementTarget(appHost, recipe);
    const target = withRecipe ?? resolveDevicePlacementTarget(appHost, definition.id);
    const key = withRecipe === null ? definition.id : recipe.id;
    if (target === null || keys.has(key)) continue;
    keys.add(key);
    consumers.push({ key, target, recipe: withRecipe === null ? null : recipe });
    if (consumers.length >= MAX_CONSUMERS) break;
  }
  return consumers;
}

/**
 * 线末端提示：末端外侧的一个「+」小按钮（带线上物品图标），点开后在旁边列出消费该物品的设备，
 * 选一个即接在末端。画布上的下一次操作会让它消失（由手势模块处理）。
 */
export const LineEndChipOverlay = observer(function LineEndChipOverlay({ appHost }: { appHost: AppHost }) {
  const canvas = appHost.mainCanvas;
  const chip = canvas.state.runtime.lineEndChip;
  const index = useRecipeTreePlanningIndex(appHost);
  if (chip === null || canvas.state.activeTool !== "select") {
    return null;
  }
  const view = canvas.view.state;
  const cellRect = resolveViewportRectFromWorldGridRect({
    gridRect: { ...chip.targetCell, width: 1, height: 1 },
    viewportBounds: view.clientRect,
    viewportCenter: view.center,
    gridCellPixelSize: view.gridCellPixelSize,
    displayRotation: view.displayRotation,
  });
  if (cellRect === null) {
    return null;
  }
  const t = appHost.actions.translate;
  const registry = appHost.workspace.registry.queries;
  const center = { left: cellRect.left + cellRect.width / 2, top: cellRect.top + cellRect.height / 2 };
  const consumers = resolveLineEndConsumers(appHost, index.recipeById.values(), chip);
  if (consumers.length === 0) {
    return null;
  }

  return (
    <div className={cm(styles, "line-end-chip")} onPointerDown={(event) => event.stopPropagation()} style={center}>
      {chip.expanded ? (
        <div aria-label={t("lineEndChip.consumers")} className={cm(styles, "line-end-chip-list")} role="menu">
          {consumers.map((consumer) => {
            const definition = registry.findEntityDefinition(consumer.target.deviceId);
            const machineName = t(definition?.nameKey ?? consumer.target.deviceId);
            const outputId = consumer.recipe?.outputs[0]?.itemId;
            const outputName = outputId === undefined ? null : resolveProductionPlanningItemName(outputId, index, t);
            return (
              <button
                aria-label={outputName === null ? machineName : `${outputName} · ${machineName}`}
                className={cm(styles, "line-end-chip-consumer")}
                key={consumer.key}
                onClick={() => placeConsumerAtLineEnd(canvas, consumer.target)}
                role="menuitem"
                title={outputName === null ? machineName : `${outputName} · ${machineName}`}
                type="button"
              >
                <img alt="" src={consumer.target.iconSrc ?? undefined} />
                {outputId === undefined ? null : (
                  <img
                    alt=""
                    className={cm(styles, "line-end-chip-output")}
                    src={resolveProductionPlanningItemIconSrc(outputId, index)}
                  />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <button
          aria-label={t("lineEndChip.add")}
          className={cm(styles, "line-end-chip-button")}
          onClick={() => expandLineEndChip(canvas)}
          title={t("lineEndChip.add")}
          type="button"
        >
          <LucidePlus aria-hidden="true" />
          <img alt="" src={resolveProductionPlanningItemIconSrc(chip.itemIds[0]!, index)} />
        </button>
      )}
    </div>
  );
});
