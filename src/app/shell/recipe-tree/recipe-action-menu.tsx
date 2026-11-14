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

import { resolveOverlayBottomLimit } from "@/app/shell/layout/status-bar-bounds";

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
  /** 来自流程图卡片时的节点 id；同一物品可能有多张卡片（不同设备、外部供给），按 id 才能找回被点的那一张。 */
  readonly nodeId?: string;
  readonly itemId: string | null;
  readonly recipeId: string | null;
  readonly anchor: DOMRect;
  readonly details?: readonly string[];
}

export function resolveFlowNodeActionTarget(node: ProductionFlowNode, anchor: DOMRect): RecipeActionTarget {
  return {
    nodeId: node.id,
    itemId: node.itemId ?? null,
    recipeId: node.recipeId ?? node.recipeNode?.recipeId ?? null,
    anchor,
    details: [
      [node.subtitle, node.machineCount].filter((part) => part !== undefined && part !== "").join(" "),
      node.rate ?? "",
    ].filter((line) => line !== ""),
  };
}

/**
 * 按当前流程图重新找回菜单对应的卡片：优先同一节点 id；节点 id 随配方切换而变化时，
 * 只有该物品恰好对应一个配方节点才改写，避免把动作换到另一台设备或外部供给上。
 */
/**
 * 配方选择按物品记录：同一物品在图中只有一张生产卡片时，改配方才作用于被点的卡片；
 * 有多张卡片（不同设备并行、副产物）时改选可能落在另一张卡片上或毫无效果，不提供配方切换。
 */
export function canChooseRecipeForActionTarget(
  target: RecipeActionTarget,
  nodes: readonly ProductionFlowNode[],
): boolean {
  return target.itemId !== null && nodes.filter((candidate) => (
    candidate.itemId === target.itemId && candidate.recipeNode !== undefined && candidate.tone !== "source"
  )).length <= 1;
}

export function resolveLiveFlowNodeActionTarget(
  target: RecipeActionTarget,
  nodes: readonly ProductionFlowNode[],
): RecipeActionTarget {
  const sameNode = target.nodeId === undefined ? undefined : nodes.find((candidate) => candidate.id === target.nodeId);
  if (sameNode !== undefined) {
    return resolveFlowNodeActionTarget(sameNode, target.anchor);
  }
  const itemNodes = nodes.filter((candidate) => (
    candidate.itemId === target.itemId && candidate.recipeNode !== undefined && candidate.tone !== "source"
  ));
  const [onlyNode] = itemNodes;
  return itemNodes.length === 1 && onlyNode !== undefined ? resolveFlowNodeActionTarget(onlyNode, target.anchor) : target;
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
  /** 调用方提供的就地编辑区（例如配方树里的目标产量与配方选择），放在操作项之后，避免长配方列表把操作挤出视口。 */
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
  // 菜单打开后内容会随就地编辑变化（配方行、清除按钮），尺寸变化时重新定位。
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const place = () => setPlacement((current) => {
      // 内容高度加上边框：scrollHeight 不含边框，offsetHeight 会被 maxHeight 截断。
      const next = resolveMenuPlacement(target.anchor, menu.offsetWidth, menu.scrollHeight + menu.offsetHeight - menu.clientHeight);
      return current !== null && current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight
        ? current
        : next;
    });
    place();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(place);
    if (menu.firstElementChild !== null) {
      observer.observe(menu.firstElementChild);
    }
    return () => observer.disconnect();
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
      <div className={cm(styles, "recipe-action-menu-content")}>
        {/* 标题、明细和操作项固定在顶部：在下方长配方列表里滚动并改选后，“放置”等操作仍在笔下。 */}
        <div className={cm(styles, "recipe-action-menu-head")}>
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
        {editor}
      </div>
    </div>
  ), document.body);
}

const MENU_VIEWPORT_MARGIN_PX = 8;
const MENU_ANCHOR_GAP_PX = 4;

interface MenuPlacement {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
}

/**
 * 依次尝试卡片下方、上方、右侧、左侧，选第一处放得下整张菜单的位置，尽量不盖住被点的卡片；
 * 都放不下时贴着可用区域底部，菜单内部滚动。可用区域的下边界是状态栏顶端。
 */
export function resolveMenuPlacement(
  anchor: DOMRect,
  width: number,
  height: number,
  bottomEdge = resolveOverlayBottomLimit(),
): MenuPlacement {
  const viewportWidth = window.innerWidth;
  const bottomLimit = bottomEdge - MENU_VIEWPORT_MARGIN_PX;
  const maxHeight = bottomLimit - MENU_VIEWPORT_MARGIN_PX;
  const fitsVertically = height <= maxHeight;
  const clampLeft = (left: number) => Math.max(MENU_VIEWPORT_MARGIN_PX, Math.min(left, viewportWidth - width - MENU_VIEWPORT_MARGIN_PX));
  const clampTop = (top: number) => Math.max(MENU_VIEWPORT_MARGIN_PX, Math.min(top, bottomLimit - Math.min(height, maxHeight)));
  const below = anchor.bottom + MENU_ANCHOR_GAP_PX;
  if (below + height <= bottomLimit) {
    return { left: clampLeft(anchor.left), top: below, maxHeight };
  }
  const above = anchor.top - MENU_ANCHOR_GAP_PX - height;
  if (above >= MENU_VIEWPORT_MARGIN_PX) {
    return { left: clampLeft(anchor.left), top: above, maxHeight };
  }
  const right = anchor.right + MENU_ANCHOR_GAP_PX;
  if (fitsVertically && right + width <= viewportWidth - MENU_VIEWPORT_MARGIN_PX) {
    return { left: right, top: clampTop(anchor.top), maxHeight };
  }
  const left = anchor.left - MENU_ANCHOR_GAP_PX - width;
  if (fitsVertically && left >= MENU_VIEWPORT_MARGIN_PX) {
    return { left, top: clampTop(anchor.top), maxHeight };
  }
  return { left: clampLeft(anchor.left), top: clampTop(bottomLimit), maxHeight };
}
