import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { observer } from "mobx-react-lite";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideChevronRight from "~icons/lucide/chevron-right";
import LucideChevronUp from "~icons/lucide/chevron-up";
import LucideGripHorizontal from "~icons/lucide/grip-horizontal";
import LucideListTree from "~icons/lucide/list-tree";
import LucideMinus from "~icons/lucide/minus";
import LucidePin from "~icons/lucide/pin";
import LucidePinOff from "~icons/lucide/pin-off";
import LucideX from "~icons/lucide/x";
import LucideWorkflow from "~icons/lucide/workflow";
import LucidePanelRight from "~icons/lucide/panel-right";
import LucidePictureInPicture from "~icons/lucide/picture-in-picture-2";
import LucideHammer from "~icons/lucide/hammer";
import LucideMousePointerClick from "~icons/lucide/mouse-pointer-click";
import LucideFilter from "~icons/lucide/filter";
import LucideWand from "~icons/lucide/wand";
import { ProductionFlowGraph } from "@/app/shell/production-planning/flow";

import type { AppHost } from "@/app/host/app-host";
import { NumberInput } from "@/app/shell/shared/number-input";
import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  formatProductionDeviceCount,
  formatProductionFlow,
  resolveProductionPlanningCandidateName,
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  type ProductionPlanningIndex,
  type ProductionPlanningItemNode,
  type ProductionPlanningResult,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

import {
  RECIPE_TREE_MIN_HEIGHT,
  RECIPE_TREE_MIN_WIDTH,
  hookRecipeTreeOverlayPersistence,
  recipeTreeOverlayState,
  type RecipeTreeOverlayRect,
  type RecipeTreePin,
} from "./recipe-tree-state";
import {
  applyItemToSelectedAdmissions,
  applyRecipeToSelection,
  countSelectedAdmissions,
  countSelectedMachines,
  selectAdmissionsForItem,
  selectFacilitiesForRecipe,
  startPlacementWithRecipe,
} from "./recipe-quick-actions";

/** 节点快捷操作菜单的打开入口（树行与流程图节点共用）。 */
interface RecipeActionTarget {
  readonly itemId: string | null;
  readonly recipeId: string | null;
  readonly anchor: DOMRect;
}
const RecipeActionMenuContext = createContext<(target: RecipeActionTarget) => void>(() => {});

type Translate = (key: string) => string;

/** 与产线规划器默认来源策略一致，保证两处数值可互相对照。 */
const RECIPE_TREE_SOURCE_CONFIG: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "fractional",
};
const RECIPE_TREE_INFINITE_ITEM_IDS: ReadonlySet<string> = new Set(["item_liquid_sewage"]);
const SEARCH_RESULT_LIMIT = 8;
const VIEWPORT_MARGIN_PX = 8;

export const RecipeTreeOverlay = observer(function RecipeTreeOverlay({ appHost }: { appHost: AppHost }) {
  useEffect(() => hookRecipeTreeOverlayPersistence(), []);

  const state = recipeTreeOverlayState;
  if (!state.visible) {
    return null;
  }

  return <RecipeTreeOverlayCard appHost={appHost} />;
});

const RecipeTreeOverlayCard = observer(function RecipeTreeOverlayCard({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const state = recipeTreeOverlayState;
  const showAllActivityContent = appHost.internalState.settings.toolboxShowAllActivityContent;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  const registry = appHost.workspace.registry;
  const index = useMemo(
    () => buildProductionPlanningIndex(registry, {
      includeInactiveActivityContent: showAllActivityContent,
      activeActivityIds: resolveEffectiveActivityIds({ selectedActivityIds }),
    }),
    [registry, selectedActivityIds, showAllActivityContent],
  );

  const rect = resolveOnScreenRect(state.rect);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const beginPointerTracking = (
    event: ReactPointerEvent<HTMLElement>,
    apply: (deltaX: number, deltaY: number, start: RecipeTreeOverlayRect) => RecipeTreeOverlayRect,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = rect;
    target.setPointerCapture(pointerId);

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      state.setRect(apply(moveEvent.clientX - startX, moveEvent.clientY - startY, start));
    };
    const stop = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
    };
    const cleanup = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (state.docked || (event.target as HTMLElement).closest("button") !== null) {
      return;
    }
    beginPointerTracking(event, (dx, dy, start) => clampRectToViewport({ ...start, x: start.x + dx, y: start.y + dy }));
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    beginPointerTracking(event, (dx, dy, start) => clampRectToViewport({
      ...start,
      width: Math.max(RECIPE_TREE_MIN_WIDTH, start.width + dx),
      height: Math.max(RECIPE_TREE_MIN_HEIGHT, start.height + dy),
    }));
  };

  // 停靠栏左缘拖动调整宽度（向左拖动变宽）。
  const handleDockResizePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = state.dockWidth;
    target.setPointerCapture(pointerId);
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) {
        state.setDockWidth(startWidth + (startX - moveEvent.clientX));
      }
    };
    const stop = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) {
        return;
      }
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    };
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };

  const title = t("recipeTree.title");
  const [actionTarget, setActionTarget] = useState<RecipeActionTarget | null>(null);
  const docked = state.docked;
  const minimized = state.minimized && !docked;

  return (
    <section
      aria-label={title}
      className={cm(styles, `recipe-tree-overlay${minimized ? " is-minimized" : ""}${docked ? " is-docked" : ""}`)}
      style={docked ? undefined : {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: minimized ? undefined : rect.height,
      }}
    >
      {docked ? (
        <div
          aria-hidden
          className={cm(styles, "recipe-tree-dock-resize")}
          onPointerDown={handleDockResizePointerDown}
        />
      ) : null}
      <header className={cm(styles, "recipe-tree-header")} onPointerDown={handleHeaderPointerDown}>
        <LucideListTree aria-hidden className={cm(styles, "recipe-tree-header-icon")} />
        <h2>{title}</h2>
        <span className={cm(styles, "recipe-tree-header-count")}>{state.pins.length}</span>
        <div aria-label={t("recipeTree.view")} className={cm(styles, "recipe-tree-view-toggle")} role="group">
          <button
            aria-pressed={state.viewMode === "tree"}
            className={cm(styles, "recipe-tree-icon-button")}
            onClick={() => state.setViewMode("tree")}
            title={t("recipeTree.viewTree")}
            type="button"
          >
            <LucideListTree />
          </button>
          <button
            aria-pressed={state.viewMode === "graph"}
            className={cm(styles, "recipe-tree-icon-button")}
            onClick={() => state.setViewMode("graph")}
            title={t("recipeTree.viewGraph")}
            type="button"
          >
            <LucideWorkflow />
          </button>
        </div>
        <button
          aria-label={t(docked ? "recipeTree.float" : "recipeTree.dock")}
          aria-pressed={docked}
          className={cm(styles, "recipe-tree-icon-button")}
          onClick={state.toggleDocked}
          title={t(docked ? "recipeTree.float" : "recipeTree.dock")}
          type="button"
        >
          {docked ? <LucidePictureInPicture /> : <LucidePanelRight />}
        </button>
        {docked ? null : (
          <button
            aria-label={t(minimized ? "action.expand" : "action.collapse")}
            className={cm(styles, "recipe-tree-icon-button")}
            onClick={state.toggleMinimized}
            title={t(minimized ? "action.expand" : "action.collapse")}
            type="button"
          >
            {minimized ? <LucideChevronDown /> : <LucideMinus />}
          </button>
        )}
        <button
          aria-label={t("action.close")}
          className={cm(styles, "recipe-tree-icon-button")}
          onClick={() => state.setVisible(false)}
          title={t("action.close")}
          type="button"
        >
          <LucideX />
        </button>
      </header>
      {minimized ? null : (
        <>
          <RecipeTreeSearch index={index} t={t} />
          <RecipeActionMenuContext.Provider value={setActionTarget}>
            {state.pins.length === 0 ? (
              <div className={cm(styles, "recipe-tree-body")}>
                <p className={cm(styles, "recipe-tree-empty")}>{t("recipeTree.empty")}</p>
              </div>
            ) : state.viewMode === "graph" ? (
              <RecipeTreeGraph appHost={appHost} index={index} t={t} />
            ) : (
              <div className={cm(styles, "recipe-tree-body")}>
                {state.pins.map((pin, pinIndex) => (
                  <RecipeTreePinSection
                    index={index}
                    isFirst={pinIndex === 0}
                    key={pin.id}
                    pin={pin}
                    t={t}
                  />
                ))}
              </div>
            )}
          </RecipeActionMenuContext.Provider>
          {actionTarget === null ? null : (
            <RecipeActionMenu
              appHost={appHost}
              index={index}
              onClose={() => setActionTarget(null)}
              t={t}
              target={actionTarget}
            />
          )}
          {docked ? null : (
            <div
              aria-hidden
              className={cm(styles, "recipe-tree-resize-handle")}
              onPointerDown={handleResizePointerDown}
            >
              <LucideGripHorizontal />
            </div>
          )}
        </>
      )}
    </section>
  );
});

const RecipeTreeSearch = observer(function RecipeTreeSearch({
  index,
  t,
}: {
  index: ProductionPlanningIndex;
  t: Translate;
}) {
  const state = recipeTreeOverlayState;
  const [query, setQuery] = useState("");
  const pinnedItemIds = new Set(state.pins.map((pin) => pin.itemId));
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) {
      return [];
    }

    return index.allItems
      .filter((item) => (index.candidatesByOutputItem.get(item.id)?.length ?? 0) > 0)
      .filter((item) => (
        t(item.nameKey).toLowerCase().includes(normalized)
        || item.id.toLowerCase().includes(normalized)
      ))
      .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id))
      .slice(0, SEARCH_RESULT_LIMIT);
  }, [index, query, t]);

  const pinItem = (itemId: string) => {
    state.addPin(itemId);
    setQuery("");
  };

  return (
    <div className={cm(styles, "recipe-tree-search")}>
      <input
        aria-label={t("recipeTree.searchPlaceholder")}
        className={cm(styles, "recipe-tree-search-input")}
        disabled={!state.canAddPin}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          const first = results[0];
          if (event.key === "Enter" && first !== undefined) {
            pinItem(first.id);
          } else if (event.key === "Escape") {
            setQuery("");
          }
        }}
        placeholder={t(state.canAddPin ? "recipeTree.searchPlaceholder" : "recipeTree.pinLimitReached")}
        type="search"
        value={query}
      />
      {results.length > 0 ? (
        <ul className={cm(styles, "recipe-tree-search-results")} role="listbox">
          {results.map((item) => (
            <li key={item.id}>
              <button
                className={cm(styles, "recipe-tree-search-result")}
                onClick={() => pinItem(item.id)}
                role="option"
                aria-selected={false}
                type="button"
              >
                <img alt="" src={resolveProductionPlanningItemIconSrc(item.id, index)} />
                <span>{t(item.nameKey)}</span>
                {pinnedItemIds.has(item.id) ? <LucidePin aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

const RecipeTreePinSection = observer(function RecipeTreePinSection({
  pin,
  index,
  isFirst,
  t,
}: {
  pin: RecipeTreePin;
  index: ProductionPlanningIndex;
  isFirst: boolean;
  t: Translate;
}) {
  const state = recipeTreeOverlayState;
  const plan = useMemo<ProductionPlanningResult>(() => computeProductionPlan({
    targets: [{ id: pin.id, itemId: pin.itemId, perMinute: pin.perMinute }],
    supplies: [],
    infiniteItemIds: RECIPE_TREE_INFINITE_ITEM_IDS,
    recipeChoices: new Map(Object.entries(pin.recipeChoices)),
    sourceConfig: RECIPE_TREE_SOURCE_CONFIG,
    useModules: false,
  }, index), [index, pin.id, pin.itemId, pin.perMinute, pin.recipeChoices]);
  const root = plan.roots[0] ?? null;
  const itemName = resolveProductionPlanningItemName(pin.itemId, index, t);

  return (
    <article className={cm(styles, "recipe-tree-pin")}>
      <div className={cm(styles, "recipe-tree-pin-header")}>
        <button
          aria-expanded={!pin.collapsed}
          aria-label={itemName}
          className={cm(styles, "recipe-tree-icon-button")}
          onClick={() => state.updatePin(pin.id, { collapsed: !pin.collapsed })}
          type="button"
        >
          {pin.collapsed ? <LucideChevronRight /> : <LucideChevronDown />}
        </button>
        <img alt="" className={cm(styles, "recipe-tree-item-icon")} src={resolveProductionPlanningItemIconSrc(pin.itemId, index)} />
        <strong className={cm(styles, "recipe-tree-pin-name")} title={itemName}>{itemName}</strong>
        <label className={cm(styles, "recipe-tree-rate")}>
          <NumberInput
            aria-label={t("recipeTree.targetRate")}
            className={cm(styles, "recipe-tree-rate-input")}
            emptyFallback={pin.perMinute}
            min={0.01}
            onCommit={(value) => {
              if (value > 0) {
                state.updatePin(pin.id, { perMinute: value });
              }
            }}
            value={pin.perMinute}
          />
          <span>{t("recipeTree.perMinute")}</span>
        </label>
        <button
          aria-label={t("recipeTree.moveUp")}
          className={cm(styles, "recipe-tree-icon-button")}
          disabled={isFirst}
          onClick={() => state.movePin(pin.id, -1)}
          title={t("recipeTree.moveUp")}
          type="button"
        >
          <LucideChevronUp />
        </button>
        <button
          aria-label={t("recipeTree.unpin")}
          className={cm(styles, "recipe-tree-icon-button")}
          onClick={() => state.removePin(pin.id)}
          title={t("recipeTree.unpin")}
          type="button"
        >
          <LucidePinOff />
        </button>
      </div>
      {pin.collapsed ? null : root === null ? (
        <p className={cm(styles, "recipe-tree-empty")}>{t("recipeTree.noRecipe")}</p>
      ) : (
        <>
          <ul className={cm(styles, "recipe-tree-nodes")} role="tree">
            <RecipeTreeNode
              depth={0}
              index={index}
              node={root}
              nodePath="0"
              pin={pin}
              t={t}
            />
          </ul>
          <RecipeTreeTotals index={index} plan={plan} t={t} />
        </>
      )}
    </article>
  );
});

const RecipeTreeNode = observer(function RecipeTreeNode({
  node,
  nodePath,
  depth,
  pin,
  index,
  t,
  isUpkeep = false,
}: {
  node: ProductionPlanningItemNode;
  nodePath: string;
  depth: number;
  pin: RecipeTreePin;
  index: ProductionPlanningIndex;
  t: Translate;
  isUpkeep?: boolean;
}) {
  const state = recipeTreeOverlayState;
  const openActionMenu = useContext(RecipeActionMenuContext);
  const recipeNode = node.recipeNode;
  const recipe = recipeNode?.recipeId == null ? undefined : index.recipeById.get(recipeNode.recipeId);
  const machineId = recipe?.machineId ?? null;
  const children = recipeNode === null
    ? []
    : [
      ...recipeNode.inputItems.map((child) => ({ child, upkeep: false })),
      ...recipeNode.deviceMinimumConsumptionItems.map((child) => ({ child, upkeep: true })),
    ];
  const nodeId = `${pin.id}:${nodePath}`;
  const collapsed = state.isNodeCollapsed(nodeId);
  const itemName = resolveProductionPlanningItemName(node.itemId, index, t);
  const candidates = (index.candidatesByOutputItem.get(node.itemId) ?? [])
    .filter((candidate) => candidate.sourceType === "system-recipe");
  const byproducts = recipeNode?.outputs.filter((output) => output.itemId !== node.itemId && output.perMinute > 0) ?? [];
  const externalPerMinute = node.supply.manual + node.supply.infinite + node.supply.surplus + node.supply.cycle;

  return (
    <li aria-expanded={children.length > 0 ? !collapsed : undefined} role="treeitem">
      <div
        className={cm(styles, "recipe-tree-node")}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, select") !== null) {
            return;
          }
          openActionMenu({
            itemId: node.itemId,
            recipeId: recipeNode?.recipeId ?? null,
            anchor: event.currentTarget.getBoundingClientRect(),
          });
        }}
        style={{ paddingLeft: depth * 14 }}
      >
        {children.length > 0 ? (
          <button
            aria-label={itemName}
            className={cm(styles, "recipe-tree-node-toggle")}
            onClick={() => state.toggleNodeCollapsed(nodeId)}
            type="button"
          >
            {collapsed ? <LucideChevronRight /> : <LucideChevronDown />}
          </button>
        ) : <span className={cm(styles, "recipe-tree-node-toggle-spacer")} />}
        <img alt="" className={cm(styles, "recipe-tree-item-icon")} src={resolveProductionPlanningItemIconSrc(node.itemId, index)} />
        <span className={cm(styles, "recipe-tree-node-name")} title={itemName}>{itemName}</span>
        {isUpkeep ? <span className={cm(styles, "recipe-tree-tag")}>{t("recipeTree.upkeep")}</span> : null}
        <span className={cm(styles, "recipe-tree-node-rate")}>
          {formatProductionFlow(node.demandPerMinute)}
          <small>{t("recipeTree.perMinute")}</small>
        </span>
        {machineId !== null && recipeNode !== null ? (
          <span
            className={cm(styles, "recipe-tree-machine")}
            title={`${t(index.entityById.get(machineId)?.nameKey ?? machineId)} × ${formatProductionDeviceCount(recipeNode.deviceCount)}`}
          >
            <img alt="" src={resolveProductionPlanningEntityIconSrc(machineId, index)} />
            <span>×{formatProductionDeviceCount(recipeNode.deviceCount)}</span>
          </span>
        ) : recipeNode === null ? (
          <span className={cm(styles, "recipe-tree-tag is-raw")}>
            {node.isCycleSource ? t("recipeTree.cycle") : t("recipeTree.raw")}
          </span>
        ) : null}
      </div>
      {recipeNode !== null && (candidates.length > 1 || byproducts.length > 0 || externalPerMinute > 0.0001) ? (
        <div className={cm(styles, "recipe-tree-node-detail")} style={{ paddingLeft: depth * 14 + 40 }}>
          {candidates.length > 1 ? (
            <select
              aria-label={t("recipeTree.recipe")}
              className={cm(styles, "recipe-tree-recipe-select")}
              onChange={(event) => state.setRecipeChoice(pin.id, node.itemId, event.currentTarget.value || null)}
              value={pin.recipeChoices[node.itemId] ?? ""}
            >
              <option value="">{t("productionPlanning.autoRecipe")}</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {resolveProductionPlanningCandidateName(candidate, index, t)}
                </option>
              ))}
            </select>
          ) : null}
          {byproducts.map((output) => (
            <span className={cm(styles, "recipe-tree-byproduct")} key={output.id}>
              +<img alt="" src={resolveProductionPlanningItemIconSrc(output.itemId, index)} />
              {formatProductionFlow(output.perMinute)}
            </span>
          ))}
          {externalPerMinute > 0.0001 ? (
            <span className={cm(styles, "recipe-tree-tag")}>
              {t("recipeTree.supplied")} {formatProductionFlow(externalPerMinute)}
            </span>
          ) : null}
        </div>
      ) : null}
      {children.length > 0 && !collapsed ? (
        <ul role="group">
          {children.map(({ child, upkeep }, childIndex) => (
            <RecipeTreeNode
              depth={depth + 1}
              index={index}
              isUpkeep={upkeep}
              key={child.id}
              node={child}
              nodePath={`${nodePath}.${childIndex}`}
              pin={pin}
              t={t}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
});

function RecipeTreeTotals({
  plan,
  index,
  t,
}: {
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  t: Translate;
}) {
  const machineTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const recipeTotal of plan.recipeTotals) {
      const recipe = recipeTotal.recipeId === null ? undefined : index.recipeById.get(recipeTotal.recipeId);
      if (recipe === undefined || recipeTotal.deviceCount <= 0) {
        continue;
      }
      totals.set(recipe.machineId, (totals.get(recipe.machineId) ?? 0) + recipeTotal.deviceCount);
    }
    return [...totals.entries()].sort((left, right) => right[1] - left[1]);
  }, [index, plan]);
  const rawTotals = useMemo(() => {
    const totals = new Map<string, number>();
    const visit = (node: ProductionPlanningItemNode) => {
      // 无配方的外部原料，以及无输入配方（矿机、水泵等采集）的产物，都计为原料投入。
      if (node.recipeNode === null || node.recipeNode.inputItems.length === 0) {
        if (!node.isCycleSource) {
          totals.set(node.itemId, (totals.get(node.itemId) ?? 0) + node.demandPerMinute);
        }
        return;
      }
      node.recipeNode.inputItems.forEach(visit);
      node.recipeNode.deviceMinimumConsumptionItems.forEach(visit);
    };
    plan.roots.forEach(visit);
    return [...totals.entries()].filter(([, perMinute]) => perMinute > 0.0001);
  }, [plan]);

  if (machineTotals.length === 0 && rawTotals.length === 0) {
    return null;
  }

  return (
    <div className={cm(styles, "recipe-tree-totals")}>
      {machineTotals.length > 0 ? (
        <div className={cm(styles, "recipe-tree-totals-row")}>
          <span className={cm(styles, "recipe-tree-totals-label")}>{t("recipeTree.machines")}</span>
          {machineTotals.map(([machineId, count]) => (
            <span
              className={cm(styles, "recipe-tree-chip")}
              key={machineId}
              title={`${t(index.entityById.get(machineId)?.nameKey ?? machineId)} × ${formatProductionDeviceCount(count)}`}
            >
              <img alt="" src={resolveProductionPlanningEntityIconSrc(machineId, index)} />
              {Math.ceil(count - 0.0001)}
            </span>
          ))}
        </div>
      ) : null}
      {rawTotals.length > 0 ? (
        <div className={cm(styles, "recipe-tree-totals-row")}>
          <span className={cm(styles, "recipe-tree-totals-label")}>{t("recipeTree.inputs")}</span>
          {rawTotals.map(([itemId, perMinute]) => (
            <span
              className={cm(styles, "recipe-tree-chip")}
              key={itemId}
              title={`${resolveProductionPlanningItemName(itemId, index, t)} ${formatProductionFlow(perMinute)}${t("recipeTree.perMinute")}`}
            >
              <img alt="" src={resolveProductionPlanningItemIconSrc(itemId, index)} />
              {formatProductionFlow(perMinute)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function resolveOnScreenRect(rect: RecipeTreeOverlayRect): RecipeTreeOverlayRect {
  if (rect.x >= 0) {
    return clampRectToViewport(rect);
  }

  // 首次显示：贴靠视口右侧，避开左侧工具栏与面板。
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  return clampRectToViewport({ ...rect, x: viewportWidth - rect.width - 24 });
}

function clampRectToViewport(rect: RecipeTreeOverlayRect): RecipeTreeOverlayRect {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const width = Math.min(Math.max(RECIPE_TREE_MIN_WIDTH, rect.width), viewportWidth - VIEWPORT_MARGIN_PX * 2);
  const height = Math.min(Math.max(RECIPE_TREE_MIN_HEIGHT, rect.height), viewportHeight - VIEWPORT_MARGIN_PX * 2);
  return {
    width,
    height,
    x: Math.max(VIEWPORT_MARGIN_PX, Math.min(rect.x, viewportWidth - width - VIEWPORT_MARGIN_PX)),
    // 整个卡片保持在视口内；矮屏下高度已被收窄，再把顶边上移。
    y: Math.max(VIEWPORT_MARGIN_PX, Math.min(rect.y, viewportHeight - height - VIEWPORT_MARGIN_PX)),
  };
}

// ─── 2026-11-13：流程图视图 ───

/** 合并全部钉住目标求解，共用的中间产物在流程图中只出现一次；下方显示合计设备与原料。 */
const RecipeTreeGraph = observer(function RecipeTreeGraph({
  appHost,
  index,
  t,
}: {
  appHost: AppHost;
  index: ProductionPlanningIndex;
  t: Translate;
}) {
  const state = recipeTreeOverlayState;
  const openActionMenu = useContext(RecipeActionMenuContext);
  const pinsSignature = JSON.stringify(state.pins.map((pin) => [pin.itemId, pin.perMinute, pin.recipeChoices]));
  const plan = useMemo<ProductionPlanningResult>(() => {
    const recipeChoices = new Map<string, string>();
    for (const pin of state.pins) {
      for (const [itemId, candidateId] of Object.entries(pin.recipeChoices)) {
        if (!recipeChoices.has(itemId)) {
          recipeChoices.set(itemId, candidateId);
        }
      }
    }
    return computeProductionPlan({
      targets: state.pins.map((pin) => ({ id: pin.id, itemId: pin.itemId, perMinute: pin.perMinute })),
      supplies: [],
      infiniteItemIds: RECIPE_TREE_INFINITE_ITEM_IDS,
      recipeChoices,
      sourceConfig: RECIPE_TREE_SOURCE_CONFIG,
      useModules: false,
    }, index);
    // pinsSignature 覆盖 pins 的全部求解输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, pinsSignature]);

  return (
    <div className={cm(styles, "recipe-tree-graph-body")}>
      <div className={cm(styles, "recipe-tree-graph")}>
        <ProductionFlowGraph
          displayMode="item"
          fitToView
          minFitScale={0.8}
          index={index}
          invertWheelZoom={appHost.internalState.settings.invertWheelZoom}
          key={pinsSignature}
          onNodeActivate={(node, anchor) => openActionMenu({
            itemId: node.itemId ?? null,
            recipeId: node.recipeId ?? node.recipeNode?.recipeId ?? null,
            anchor,
          })}
          plan={plan}
          t={t}
        />
      </div>
      <RecipeTreeTotals index={index} plan={plan} t={t} />
    </div>
  );
});

// ─── 2026-11-13：节点快捷操作菜单 ───

function RecipeActionMenu({
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
  t: Translate;
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

  return (
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
  );
}
