import { observer } from "mobx-react-lite";
import { useState } from "react";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideChevronUp from "~icons/lucide/chevron-up";
import LucidePanelRightOpen from "~icons/lucide/panel-right-open";

import type { AppHost } from "@/app/host/app-host";
import { applyAdmissionItemToEntity } from "@/app/shell/inspector/admission-rule-inspector";
import { RecipeTileGrid } from "@/app/shell/inspector/recipe-tile-grid";
import { SelectionInspectorActionStrip } from "@/app/shell/inspector/selection-inspector-action-strip";
import {
  LogisticsRoleSwitcher,
  resolveCachedRecipeStatusIndex,
} from "@/app/shell/inspector/selection-inspector-slot";
import { resolveMachineRecipes } from "@/app/shell/inspector/simulation-recipe-status-runtime-inspector";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { readAdmissionRule } from "@/shared/registry/admission-rule";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { avoidCanvasToolRail } from "./canvas-tool-rail-bounds";
import { canvasToolRailState } from "./canvas-tool-rail-state";

const POPUP_WIDTH = 384;
/** 展开配方磁贴时加宽，配方以多列显示。 */
const POPUP_EXPANDED_WIDTH = 540;
/** 最窄画布（预算保证的 360px 减去工具条占用带）里仍能放下操作按钮的宽度。 */
const POPUP_MIN_WIDTH = 240;
const POPUP_GAP = 10;
const POPUP_MARGIN = 8;

/**
 * 选中单个设备时直接浮在设备上方的精简操作卡。
 *
 * 只放最常用的操作：移动/切换模式/删除、配方磁贴、物流设备类型、准入物品；
 * 完整属性通过“更多”打开右侧属性面板（打开后本卡片隐藏，避免重复）。
 */
export const DevicePopup = observer(function DevicePopup({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  // 配方磁贴：还没选配方时直接展开（选配方就是下一步），已选时收起为一行摘要；用户点过之后以用户为准，换设备时复位。
  const [recipesToggle, setRecipesToggle] = useState<{ readonly entityId: string; readonly expanded: boolean } | null>(null);
  const canvas = appHost.mainCanvas;
  const editor = appHost.workspace.editor;

  if (
    editor === null
    || canvas.state.activeTool !== "select"
    || editor.queries.resolveLogisticsDraftState() !== null
    // 刚拉出的线末端提示是下一步，卡片让出位置，提示消失后再回来。
    || canvas.state.runtime.lineEndChip !== null
    || (appHost.state.settings.gameUseInspectorPanel && appHost.state.workbench.rightDockOpen)
  ) {
    return null;
  }

  const selection = editor.state.collections.selection;
  if (selection.length !== 1) {
    return null;
  }
  const entity = editor.queries.getEntityById(selection[0]!);
  const registry = appHost.workspace.registry;
  const definition = entity === null ? null : registry.queries.findEntityDefinition(entity.definitionId);
  if (entity === null || definition === null || registry.queries.isBelt(definition.id) || registry.queries.isPipe(definition.id)) {
    return null;
  }

  const index = resolveCachedRecipeStatusIndex(registry, false);
  const productionChannel = definition.recipeChannels.find((channel) => channel.type !== "consumption-channel");
  const recipes = productionChannel === undefined ? [] : resolveMachineRecipes(index, definition.id);
  const storedRecipes = (entity.config.channelRecipes as Record<string, string> | undefined) ?? {};
  const selectedRecipeId = productionChannel === undefined ? undefined : storedRecipes[productionChannel.id];
  const selectedRecipe = selectedRecipeId === undefined ? undefined : index.recipeById.get(selectedRecipeId);
  const recipesExpanded = recipesToggle !== null && recipesToggle.entityId === entity.id
    ? recipesToggle.expanded
    : selectedRecipe === undefined;
  const setRecipesExpanded = (expanded: boolean) => setRecipesToggle({ entityId: entity.id, expanded });

  const gridRect = editor.queries.findEntityCollectionGridRect(EntityCollectionType.selection);
  const view = canvas.view.state;
  const deviceRect = gridRect === null ? null : resolveViewportRectFromWorldGridRect({
    gridRect,
    viewportBounds: view.clientRect,
    viewportCenter: view.center,
    gridCellPixelSize: view.gridCellPixelSize,
    displayRotation: view.displayRotation,
  });
  // 设备整台滑出画布露出的部分（侧栏、工具条下面或视口外）时卡片随之收起，不悬在别的面板上。
  const exposed = canvas.unobstructedClientRect;
  if (
    deviceRect === null
    || deviceRect.left + deviceRect.width <= exposed.left || deviceRect.left >= exposed.left + exposed.width
    || deviceRect.top + deviceRect.height <= exposed.top || deviceRect.top >= exposed.top + exposed.height
  ) {
    return null;
  }

  // 定位：优先放在设备上方（底边贴设备顶边）；上方空间不足或触控悬浮工具条占用上方时放在下方；
  // 水平居中并限制在画布视口内，高度不超过可用空间（内容滚动）。
  const viewport = view.clientRect;
  const centerX = deviceRect.left + deviceRect.width / 2;
  // 宽度以画布去掉工具条占用带后的空间为上限，展开配方时也不会盖住工具条。
  const railFreeWidth = viewport.width - canvasToolRailState.width - POPUP_MARGIN * 2;
  const popupWidth = Math.max(POPUP_MIN_WIDTH, Math.min(recipesExpanded ? POPUP_EXPANDED_WIDTH : POPUP_WIDTH, railFreeWidth));
  const spaceAbove = deviceRect.top - viewport.top - POPUP_GAP - POPUP_MARGIN;
  const spaceBelow = viewport.top + viewport.height - (deviceRect.top + deviceRect.height) - POPUP_GAP - POPUP_MARGIN;
  const toolbarAbove = canvas.state.runtime.canvasFloatingToolbar.visible;
  const placeAbove = !toolbarAbove && (spaceAbove >= 260 || spaceAbove >= spaceBelow);
  // 水平居中于设备，并避开画布工具条；纵向范围按弹出层可能占用的最大高度估算。
  const left = avoidCanvasToolRail({
    canvas: viewport,
    left: centerX - popupWidth / 2,
    width: popupWidth,
    top: placeAbove ? viewport.top : deviceRect.top + deviceRect.height,
    height: placeAbove ? deviceRect.top - viewport.top : viewport.top + viewport.height - deviceRect.top - deviceRect.height,
    minLeft: viewport.left + POPUP_MARGIN,
    maxRight: viewport.left + viewport.width - POPUP_MARGIN,
  });
  const positionStyle = placeAbove
    ? { top: deviceRect.top - POPUP_GAP, transform: "translateY(-100%)", maxHeight: Math.max(120, spaceAbove) }
    : { top: deviceRect.top + deviceRect.height + POPUP_GAP, maxHeight: Math.max(120, spaceBelow) };

  const hasAdmission = definition.inspectors.some((declaration) => declaration.type === INSPECTOR_TYPE.admissionRule);
  const admissionItemId = hasAdmission ? resolveAdmissionItemId(entity.config) : null;
  const admissionItem = admissionItemId === null ? null : registry.queries.findItemDefinition(admissionItemId);
  const placement = editor.queries.getEntityPlacementValidation(entity.id);
  const problems = placement.canPlace ? [] : placement.reasons.map((reason) => t(reason.message));

  const pickAdmissionItem = async () => {
    const itemId = await appHost.encyclopediaPicker.pickItem({ title: t("encyclopediaPicker.title.item") });
    const item = itemId === null ? null : registry.queries.findItemDefinition(itemId);
    if (item !== null) {
      applyAdmissionItemToEntity({ appHost, entity, item });
    }
  };

  return (
    <div
      className={cm(styles, "device-popup")}
      data-device-popup={entity.id}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ left, width: popupWidth, ...positionStyle }}
    >
      <div className={cm(styles, "device-popup-header")}>
        <img alt="" src={createEntityIconAssetUrl(definition.iconPath)} />
        <strong>{t(definition.nameKey)}</strong>
        <button
          aria-label={t("devicePopup.more")}
          className={cm(styles, "device-popup-icon-button")}
          onClick={() => appHost.internalActions.setRightDockOpen(true, { preserveSingleSelection: true })}
          title={t("devicePopup.more")}
          type="button"
        >
          <LucidePanelRightOpen aria-hidden />
        </button>
      </div>
      <SelectionInspectorActionStrip appHost={appHost} variant="inline" />
      {problems.length > 0 ? (
        <p className={cm(styles, "device-popup-problem")}>{problems.join(" · ")}</p>
      ) : null}
      <LogisticsRoleSwitcher appHost={appHost} definition={definition} entity={entity} translate={t} />
      {hasAdmission ? (
        <button className={cm(styles, "device-popup-item")} onClick={() => void pickAdmissionItem()} type="button">
          {admissionItem === null ? null : <img alt="" src={createItemIconAssetUrl(admissionItem.iconId)} />}
          <span>{admissionItem === null ? t("devicePopup.chooseItem") : t(admissionItem.nameKey)}</span>
        </button>
      ) : null}
      {productionChannel !== undefined && recipes.length > 0 ? (
        <button
          aria-expanded={recipesExpanded}
          className={cm(styles, "device-popup-item")}
          onClick={() => setRecipesExpanded(!recipesExpanded)}
          type="button"
        >
          {selectedRecipe === undefined
            ? null
            : <img alt="" src={createItemIconAssetUrl(index.itemById.get(selectedRecipe.outputs[0]?.itemId ?? "")?.iconId ?? "")} />}
          <span>
            {selectedRecipe === undefined
              ? t("devicePopup.chooseRecipe")
              : t(index.itemById.get(selectedRecipe.outputs[0]?.itemId ?? "")?.nameKey ?? selectedRecipe.id)}
          </span>
          {recipesExpanded ? <LucideChevronUp aria-hidden /> : <LucideChevronDown aria-hidden />}
        </button>
      ) : null}
      {productionChannel !== undefined && recipes.length > 0 && recipesExpanded ? (
        <div className={cm(styles, "device-popup-recipes")}>
          <RecipeTileGrid
            index={index}
            onSelect={(recipeId) => {
              const next = { ...storedRecipes };
              if (recipeId === null) {
                delete next[productionChannel.id];
              } else {
                next[productionChannel.id] = recipeId;
              }
              editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
              setRecipesExpanded(false);
            }}
            recipes={recipes}
            selectedRecipeId={storedRecipes[productionChannel.id] ?? null}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
});

function resolveAdmissionItemId(config: Readonly<Record<string, unknown>>): string | null {
  for (const [key, value] of Object.entries(config)) {
    if (key.endsWith(".admissionRule")) {
      const rule = readAdmissionRule(value);
      if (rule?.itemId) {
        return rule.itemId;
      }
    }
  }
  return null;
}
