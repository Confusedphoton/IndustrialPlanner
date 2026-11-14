import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import LucideFilter from "~icons/lucide/filter";
import LucideHammer from "~icons/lucide/hammer";
import LucideMousePointerClick from "~icons/lucide/mouse-pointer-click";
import LucidePin from "~icons/lucide/pin";
import LucidePinOff from "~icons/lucide/pin-off";
import LucideWand from "~icons/lucide/wand";

import type { AppHost } from "@/app/host/app-host";
import type { ProductionFlowNode } from "@/app/shell/production-planning/flow";
import {
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  type ProductionPlanningIndex,
} from "@/app/shell/production-planning/production-planning-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

import { recipeTreeOverlayState } from "./recipe-tree-state";
import {
  applyItemToSelectedAdmissions,
  applyRecipeToSelection,
  countSelectedAdmissions,
  countSelectedMachines,
  selectAdmissionsForItem,
  selectFacilitiesForRecipe,
  startPlacementWithRecipe,
} from "./recipe-quick-actions";

/** 节点快捷操作菜单的目标：物品/配方与锚点；来自流程图卡片时附带卡片上可能被截断的明细。 */
export interface RecipeActionTarget {
  readonly itemId: string | null;
  readonly recipeId: string | null;
  readonly anchor: DOMRect;
  readonly details?: readonly string[];
}

export function resolveFlowNodeActionTarget(node: ProductionFlowNode, anchor: DOMRect): RecipeActionTarget {
  return {
    itemId: node.itemId ?? null,
    recipeId: node.recipeId ?? node.recipeNode?.recipeId ?? null,
    anchor,
    details: [
      [node.subtitle, node.machineCount].filter((part) => part !== undefined && part !== "").join(" "),
      node.rate ?? "",
    ].filter((line) => line !== ""),
  };
}

export function RecipeActionMenu({
  appHost,
  index,
  target,
  onClose,
  editor,
  t,
}: {
  appHost: AppHost;
  index: ProductionPlanningIndex;
  target: RecipeActionTarget;
  onClose: () => void;
  /** 调用方提供的就地编辑区（例如配方树里的目标产量与配方选择），显示在明细下方。 */
  editor?: ReactNode;
  t: (key: string) => string;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menuRef.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    // 捕获阶段处理并吞掉 Escape：只关闭菜单，不连带关闭菜单所在的工具箱对话框。
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    // 视口变化后锚点卡片已移动，旧位置不再可信，直接收起菜单。
    const handleResize = () => onClose();
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [onClose]);

  const recipe = target.recipeId === null ? undefined : index.recipeById.get(target.recipeId);
  const itemId = target.itemId ?? recipe?.primaryOutputs?.[0] ?? recipe?.outputs[0]?.itemId ?? null;
  const machineName = recipe === undefined
    ? null
    : t(index.entityById.get(recipe.machineId)?.nameKey ?? recipe.machineId);
  const selectedMachines = recipe === undefined ? 0 : countSelectedMachines(appHost, recipe.machineId);
  const selectedAdmissions = itemId === null ? 0 : countSelectedAdmissions(appHost);
  const itemName = itemId === null ? null : resolveProductionPlanningItemName(itemId, index, t);
  const existingPin = itemId === null ? undefined : recipeTreeOverlayState.pins.find((pin) => pin.itemId === itemId);
  const run = (action: () => void) => {
    action();
    onClose();
  };

  // 先以隐藏状态渲染并测量真实尺寸，再选择有空间的一侧并夹紧在视口内；仍放不下时菜单内部滚动。
  const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    setPlacement(resolveMenuPlacement(target.anchor, menu.offsetWidth, menu.scrollHeight));
  }, [target.anchor]);

  // 挂到 body：菜单也会从工具箱对话框内的流程图打开，不能被对话框层级或变换裁剪。
  return createPortal((
    <div
      className={cm(styles, "recipe-action-menu")}
      ref={menuRef}
      role="menu"
      style={placement === null
        ? { left: 0, top: 0, visibility: "hidden" }
        : { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }}
    >
      {itemName !== null ? (
        <div className={cm(styles, "recipe-action-menu-title")}>
          <img alt="" src={resolveProductionPlanningItemIconSrc(itemId as string, index)} />
          <span>{itemName}</span>
        </div>
      ) : null}
      {target.details === undefined || target.details.length === 0 ? null : (
        <div className={cm(styles, "recipe-action-menu-details")}>
          {target.details.map((line) => <span key={line}>{line}</span>)}
        </div>
      )}
      {editor}
      {recipe !== undefined && machineName !== null ? (
        <>
          <button
            className={cm(styles, "recipe-action-menu-item")}
            onClick={() => run(() => startPlacementWithRecipe(appHost, recipe))}
            role="menuitem"
            type="button"
          >
            <LucideHammer aria-hidden />
            <span>{t("recipeTree.action.place").replace("{machine}", machineName)}</span>
          </button>
          <button
            className={cm(styles, "recipe-action-menu-item")}
            onClick={() => run(() => selectFacilitiesForRecipe(appHost, recipe))}
            role="menuitem"
            type="button"
          >
            <LucideMousePointerClick aria-hidden />
            <span>{t("recipeTree.action.selectFacilities").replace("{machine}", machineName)}</span>
          </button>
          {/* 只在有可应用的选中设备时出现，不显示“对 0 个选中设备……”这类无效项。 */}
          {selectedMachines === 0 ? null : (
            <button
              className={cm(styles, "recipe-action-menu-item")}
              onClick={() => run(() => applyRecipeToSelection(appHost, recipe))}
              role="menuitem"
              type="button"
            >
              <LucideWand aria-hidden />
              <span>{t("recipeTree.action.applyRecipe").replace("{count}", String(selectedMachines))}</span>
            </button>
          )}
        </>
      ) : null}
      {itemId !== null ? (
        <>
          {selectedAdmissions === 0 ? null : (
            <button
              className={cm(styles, "recipe-action-menu-item")}
              onClick={() => run(() => applyItemToSelectedAdmissions(appHost, itemId))}
              role="menuitem"
              type="button"
            >
              <LucideFilter aria-hidden />
              <span>{t("recipeTree.action.applyFilter").replace("{count}", String(selectedAdmissions))}</span>
            </button>
          )}
          <button
            className={cm(styles, "recipe-action-menu-item")}
            onClick={() => run(() => selectAdmissionsForItem(appHost, itemId))}
            role="menuitem"
            type="button"
          >
            <LucideMousePointerClick aria-hidden />
            <span>{t("recipeTree.action.selectAdmissions")}</span>
          </button>
          {existingPin === undefined ? (
            <button
              className={cm(styles, "recipe-action-menu-item")}
              onClick={() => run(() => recipeTreeOverlayState.addPin(itemId))}
              role="menuitem"
              type="button"
            >
              <LucidePin aria-hidden />
              <span>{t("recipeTree.action.pin")}</span>
            </button>
          ) : (
            <button
              className={cm(styles, "recipe-action-menu-item")}
              onClick={() => run(() => recipeTreeOverlayState.removePin(existingPin.id))}
              role="menuitem"
              type="button"
            >
              <LucidePinOff aria-hidden />
              <span>{t("recipeTree.unpin")}</span>
            </button>
          )}
        </>
      ) : null}
    </div>
  ), document.body);
}

const MENU_VIEWPORT_MARGIN_PX = 8;
const MENU_ANCHOR_GAP_PX = 4;

export function resolveMenuPlacement(anchor: DOMRect, width: number, height: number): { left: number; top: number; maxHeight: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxHeight = viewportHeight - MENU_VIEWPORT_MARGIN_PX * 2;
  const left = Math.min(Math.max(MENU_VIEWPORT_MARGIN_PX, anchor.left), viewportWidth - width - MENU_VIEWPORT_MARGIN_PX);
  const below = anchor.bottom + MENU_ANCHOR_GAP_PX;
  const above = anchor.top - MENU_ANCHOR_GAP_PX - height;
  const top = below + height <= viewportHeight - MENU_VIEWPORT_MARGIN_PX
    ? below
    : above >= MENU_VIEWPORT_MARGIN_PX
      ? above
      : Math.max(MENU_VIEWPORT_MARGIN_PX, viewportHeight - MENU_VIEWPORT_MARGIN_PX - Math.min(height, maxHeight));
  return { left: Math.max(MENU_VIEWPORT_MARGIN_PX, left), top, maxHeight };
}
