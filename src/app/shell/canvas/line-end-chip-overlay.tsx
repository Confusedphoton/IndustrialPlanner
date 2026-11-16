import { observer } from "mobx-react-lite";
import { useMemo, type MouseEvent } from "react";
import LucidePlus from "~icons/lucide/plus";

import { resolveLineEndSnapPlacements, type LineEndChipState } from "@/app/canvas/line-end-chip";
import type { AppHost } from "@/app/host/app-host";
import { expandLineEndChip, placeConsumerAtLineEnd, resolveLineEndTarget } from "@/app/input/gesture/actions";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import {
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
} from "@/app/shell/production-planning/production-planning-model";
import { resolveRecipePlacementTarget } from "@/app/shell/recipe-tree/recipe-quick-actions";
import { useRecipeTreePlanningIndex } from "@/app/shell/recipe-tree/recipe-tree-plan";
import { resolveDevicePlacementTarget, type PanelPlacementTarget } from "@/app/shell/shared/panel-placement-drag";
import { resolvePlacementPointerSource } from "@/app/shell/shared/placement-pointer-source";
import type { WorldDocument } from "@/domain/document/world-document";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { isRecipeAvailableByActivity, resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { isRecipeVisibleInToolbox, sortRecipesByDefaultPriority } from "@/shared/registry/recipe-visibility";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { useEditorDocumentSnapshot } from "../hooks";

/** 提示按钮的尺寸（与样式一致），用于把它放在线末端之外，不挡住续画线端。 */
const CHIP_WIDTH_PX = 68;
const CHIP_HEIGHT_PX = 44;
const CHIP_GAP_PX = 6;
/** 展开列表：每行一台设备（图标与名称），超出时滚动。 */
const LIST_WIDTH_PX = 248;
const LIST_ROW_PX = 52;
const LIST_PADDING_PX = 6;
const LIST_MAX_VISIBLE_ROWS = 5;
const LIST_MARGIN_PX = 8;

export interface LineEndConsumer {
  readonly key: string;
  readonly target: PanelPlacementTarget;
  /** 交出时带上的配方；只消耗（如燃料、内部消耗配方）的设备为 null。 */
  readonly recipe: RecipeDefinition | null;
}

/**
 * 消费线上物品的设备：可见的生产配方连同配方交出；隐藏配方（设备内部消耗）和只有消耗频道的设备不带配方，
 * 同型号只列一次。只列有能收下该物品的同族输入端口、可放在当前基地的设备。
 */
export function resolveLineEndConsumers(
  appHost: AppHost,
  recipes: readonly RecipeDefinition[],
  chip: LineEndChipState,
): LineEndConsumer[] {
  const registry = appHost.workspace.registry.queries;
  const consumers: LineEndConsumer[] = [];
  const keys = new Set<string>();
  const ordered = [...recipes].sort((left, right) => Number(!isRecipeVisibleInToolbox(left)) - Number(!isRecipeVisibleInToolbox(right)));
  for (const recipe of ordered) {
    if (!recipe.inputs.some((input) => chip.itemIds.includes(input.itemId))) continue;
    const definition = registry.findEntityDefinition(recipe.machineId);
    if (
      definition === null
      || !canPlaceEntityDefinitionInCurrentBase(appHost.mainCanvas, definition)
      || resolveLineEndSnapPlacements({
        definition,
        kind: chip.kind,
        targetCell: chip.targetCell,
        flowEdge: chip.flowEdge,
        itemIds: chip.itemIds,
        resolveItemDomain: registry.resolveItemDomain,
      }).length === 0
    ) continue;
    const withRecipe = isRecipeVisibleInToolbox(recipe) ? resolveRecipePlacementTarget(appHost, recipe) : null;
    const target = withRecipe ?? resolveDevicePlacementTarget(appHost, definition.id);
    const key = withRecipe === null ? definition.id : recipe.id;
    if (target === null || keys.has(key)) continue;
    keys.add(key);
    consumers.push({ key, target, recipe: withRecipe === null ? null : recipe });
  }
  return consumers;
}

const selectEntities = (document: WorldDocument) => document.entities;

/**
 * 线末端提示：末端之外的一个「+」小按钮（带线上物品图标），点开后列出消费该物品的设备，选一个即接在末端。
 * 画布上的下一次操作会让它消失（由手势模块处理）；线被撤销、删除或接上后自行隐藏。
 */
export const LineEndChipOverlay = observer(function LineEndChipOverlay({ appHost }: { appHost: AppHost }) {
  const canvas = appHost.mainCanvas;
  const chip = canvas.state.runtime.lineEndChip;
  const editor = appHost.workspace.editor;
  const index = useRecipeTreePlanningIndex(appHost);
  // 文档每次变化都重新核对末端是否仍开放。
  useEditorDocumentSnapshot(editor, selectEntities);
  const settings = appHost.internalState.settings;
  const recipes = useMemo(() => {
    const activityIds = resolveEffectiveActivityIds({ selectedActivityIds: settings.selectedActivityIds });
    return sortRecipesByDefaultPriority(appHost.workspace.registry.recipeDefinitions.filter((recipe) => (
      settings.toolboxShowAllActivityContent || isRecipeAvailableByActivity(recipe, activityIds)
    )));
  }, [appHost, settings.selectedActivityIds, settings.toolboxShowAllActivityContent]);
  const consumers = useMemo(
    () => chip === null ? [] : resolveLineEndConsumers(appHost, recipes, chip),
    [appHost, recipes, chip],
  );

  if (
    chip === null
    || editor === null
    || (canvas.state.activeTool !== "select" && canvas.state.activeTool !== "logistics-placement")
    || consumers.length === 0
    || resolveLineEndTarget(canvas, editor, chip.kind, chip.endCell) === null
  ) {
    return null;
  }
  const cellCenter = (cell: { readonly x: number; readonly y: number }) => {
    const rect = canvas.view.queries.findClientRectForGridCell(cell);
    return rect === null ? null : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const end = cellCenter(chip.endCell);
  const beyond = cellCenter(chip.targetCell);
  if (end === null || beyond === null) {
    return null;
  }
  // 沿屏幕上的流出方向，把按钮放到末端格之外，按钮近边与末端格隔开一点。
  const step = Math.hypot(beyond.x - end.x, beyond.y - end.y) || 1;
  const direction = { x: (beyond.x - end.x) / step, y: (beyond.y - end.y) / step };
  const reach = step / 2 + CHIP_GAP_PX + Math.abs(direction.x) * CHIP_WIDTH_PX / 2 + Math.abs(direction.y) * CHIP_HEIGHT_PX / 2;
  // 末端贴近画布边缘时，按钮收回画布内（避开工具条），宁可靠近末端也要看得见、够得着。
  const visible = canvas.unobstructedClientRect;
  const clamp = (value: number, start: number, size: number, half: number) => (
    Math.min(Math.max(value, start + half + LIST_MARGIN_PX), start + size - half - LIST_MARGIN_PX)
  );
  const anchor = {
    x: clamp(end.x + direction.x * reach, visible.left, visible.width, CHIP_WIDTH_PX / 2),
    y: clamp(end.y + direction.y * reach, visible.top, visible.height, CHIP_HEIGHT_PX / 2),
  };

  const t = appHost.actions.translate;
  const registry = appHost.workspace.registry.queries;
  const choose = (consumer: LineEndConsumer, event: MouseEvent) => {
    const pointerType = (event.nativeEvent as PointerEvent).pointerType || "mouse";
    placeConsumerAtLineEnd(canvas, consumer.target, resolvePlacementPointerSource(appHost, pointerType));
  };

  if (!chip.expanded) {
    return (
      <button
        aria-label={t("lineEndChip.add")}
        className={cm(styles, "line-end-chip-button")}
        onClick={() => expandLineEndChip(canvas)}
        onPointerDown={(event) => event.stopPropagation()}
        style={{ left: anchor.x - CHIP_WIDTH_PX / 2, top: anchor.y - CHIP_HEIGHT_PX / 2, width: CHIP_WIDTH_PX, height: CHIP_HEIGHT_PX }}
        title={t("lineEndChip.add")}
        type="button"
      >
        <LucidePlus aria-hidden="true" />
        <img alt="" src={resolveProductionPlanningItemIconSrc(chip.itemIds[0]!, index)} />
      </button>
    );
  }

  // 列表以按钮位置为中心，收在画布内并避开工具条。
  const height = Math.min(
    Math.min(consumers.length, LIST_MAX_VISIBLE_ROWS + 0.5) * LIST_ROW_PX + LIST_PADDING_PX * 2,
    visible.height - LIST_MARGIN_PX * 2,
  );
  const left = clamp(anchor.x, visible.left, visible.width, LIST_WIDTH_PX / 2) - LIST_WIDTH_PX / 2;
  const top = clamp(anchor.y, visible.top, visible.height, height / 2) - height / 2;

  return (
    <div
      aria-label={t("lineEndChip.consumers")}
      className={cm(styles, "line-end-chip-list")}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
      style={{ left, top, width: LIST_WIDTH_PX, maxHeight: height }}
    >
      {consumers.map((consumer) => {
        const machineName = t(registry.findEntityDefinition(consumer.target.deviceId)?.nameKey ?? consumer.target.deviceId);
        const outputId = consumer.recipe?.outputs[0]?.itemId;
        const outputName = outputId === undefined ? null : resolveProductionPlanningItemName(outputId, index, t);
        return (
          <button
            aria-label={outputName === null
              ? machineName
              : t("lineEndChip.consumer").replace("{item}", outputName).replace("{machine}", machineName)}
            className={cm(styles, "line-end-chip-consumer")}
            key={consumer.key}
            onClick={(event) => choose(consumer, event)}
            role="menuitem"
            type="button"
          >
            <span className={cm(styles, "line-end-chip-icon")}>
              <img alt="" src={consumer.target.iconSrc ?? undefined} />
              {outputId === undefined ? null : (
                <img alt="" className={cm(styles, "line-end-chip-output")} src={resolveProductionPlanningItemIconSrc(outputId, index)} />
              )}
            </span>
            <span className={cm(styles, "line-end-chip-name")}>
              {outputName === null ? null : <strong>{outputName}</strong>}
              <span>{machineName}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
});
