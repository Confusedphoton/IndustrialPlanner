import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import LucideFilter from "~icons/lucide/filter";
import LucideHammer from "~icons/lucide/hammer";
import LucideMousePointerClick from "~icons/lucide/mouse-pointer-click";
import LucidePin from "~icons/lucide/pin";
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
  t,
}: {
  appHost: AppHost;
  index: ProductionPlanningIndex;
  target: RecipeActionTarget;
  onClose: () => void;
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
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
  const run = (action: () => void) => {
    action();
    onClose();
  };

  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const left = Math.min(Math.max(8, target.anchor.left), viewportWidth - 288);
  const openAbove = target.anchor.bottom + 260 > viewportHeight;

  // 挂到 body：菜单也会从工具箱对话框内的流程图打开，不能被对话框层级或变换裁剪。
  return createPortal((
    <div
      className={cm(styles, "recipe-action-menu")}
      ref={menuRef}
      role="menu"
      style={{
        left,
        top: openAbove ? undefined : target.anchor.bottom + 4,
        bottom: openAbove ? viewportHeight - target.anchor.top + 4 : undefined,
      }}
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
          <button
            className={cm(styles, "recipe-action-menu-item")}
            disabled={selectedMachines === 0}
            onClick={() => run(() => applyRecipeToSelection(appHost, recipe))}
            role="menuitem"
            type="button"
          >
            <LucideWand aria-hidden />
            <span>{t("recipeTree.action.applyRecipe").replace("{count}", String(selectedMachines))}</span>
          </button>
        </>
      ) : null}
      {itemId !== null ? (
        <>
          <button
            className={cm(styles, "recipe-action-menu-item")}
            disabled={selectedAdmissions === 0}
            onClick={() => run(() => applyItemToSelectedAdmissions(appHost, itemId))}
            role="menuitem"
            type="button"
          >
            <LucideFilter aria-hidden />
            <span>{t("recipeTree.action.applyFilter").replace("{count}", String(selectedAdmissions))}</span>
          </button>
          <button
            className={cm(styles, "recipe-action-menu-item")}
            onClick={() => run(() => selectAdmissionsForItem(appHost, itemId))}
            role="menuitem"
            type="button"
          >
            <LucideMousePointerClick aria-hidden />
            <span>{t("recipeTree.action.selectAdmissions")}</span>
          </button>
          <button
            className={cm(styles, "recipe-action-menu-item")}
            onClick={() => run(() => recipeTreeOverlayState.addPin(itemId))}
            role="menuitem"
            type="button"
          >
            <LucidePin aria-hidden />
            <span>{t("recipeTree.action.pin")}</span>
          </button>
        </>
      ) : null}
    </div>
  ), document.body);
}
