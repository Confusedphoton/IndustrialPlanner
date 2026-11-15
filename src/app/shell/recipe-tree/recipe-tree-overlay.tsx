import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { observer } from "mobx-react-lite";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideChevronRight from "~icons/lucide/chevron-right";
import LucideChevronUp from "~icons/lucide/chevron-up";
import LucideGripHorizontal from "~icons/lucide/grip-horizontal";
import LucideListTree from "~icons/lucide/list-tree";
import LucideMinus from "~icons/lucide/minus";
import LucidePlus from "~icons/lucide/plus";
import LucideLibrary from "~icons/lucide/library-big";
import LucidePin from "~icons/lucide/pin";
import LucidePinOff from "~icons/lucide/pin-off";
import LucideX from "~icons/lucide/x";
import LucideWorkflow from "~icons/lucide/workflow";
import LucidePanelRight from "~icons/lucide/panel-right";
import LucidePictureInPicture from "~icons/lucide/picture-in-picture-2";
import { buildProductionFlowGraph, ProductionFlowGraph } from "@/app/shell/production-planning/flow";

import type { AppHost } from "@/app/host/app-host";
import { NumberInput } from "@/app/shell/shared/number-input";
import { DEFAULT_RIGHT_DOCK_WIDTH } from "@/app/state/state-impl";
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
import type { ProductionPlanningCandidate } from "@/app/shell/production-planning/production-planning-candidate";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { sortRecipesByDefaultPriority } from "@/shared/registry/recipe-visibility";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

import {
  RECIPE_TREE_DOCK_MIN_WIDTH,
  RECIPE_TREE_MIN_HEIGHT,
  RECIPE_TREE_MIN_WIDTH,
  hookRecipeTreeOverlayPersistence,
  recipeTreeOverlayState,
  type RecipeTreeOverlayRect,
  type RecipeTreePin,
} from "./recipe-tree-state";
import {
  RecipeActionMenu,
  resolveFlowNodeActionTarget,
  canChooseRecipeForActionTarget,
  resolveLiveFlowNodeActionTarget,
  type RecipeActionTarget,
} from "./recipe-action-menu";
import { resolveStackRatioForBoundary, resolveStackedRightColumn } from "@/app/shell/layout/dock-layout-budget";

/** 节点快捷操作菜单的打开入口（树行与流程图节点共用）。 */
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
const TOP_BAR_CLEARANCE_PX = 56;
/** 底部状态栏高度；浮层不压到状态栏上。 */
const STATUS_BAR_CLEARANCE_PX = 28;

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

  // 读取可观察的屏幕尺寸：窗口缩放时重新渲染并把浮层夹回视口内。
  const inspectorDocked = appHost.state.settings.gameUseInspectorPanel && appHost.state.workbench.rightDockOpen;
  const viewport = {
    width: appHost.state.screenProfile.viewportWidth,
    height: appHost.state.screenProfile.viewportHeight,
    rightInset: inspectorDocked ? DEFAULT_RIGHT_DOCK_WIDTH : 0,
  };
  const rect = resolveOnScreenRect(state.rect, viewport);
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
    beginPointerTracking(event, (dx, dy, start) => clampRectToViewport({ ...start, x: start.x + dx, y: start.y + dy }, viewport));
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    beginPointerTracking(event, (dx, dy, start) => clampRectToViewport({
      ...start,
      width: Math.max(RECIPE_TREE_MIN_WIDTH, start.width + dx),
      height: Math.max(RECIPE_TREE_MIN_HEIGHT, start.height + dy),
    }, viewport));
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
    const startWidth = state.dockLayoutWidth;
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

  // 与属性面板叠放时，拖动顶边调整两者的高度分配。
  const handleStackResizePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    // 按比例分配的只有属性面板行与配方树行；配方树额外跨越的底部停靠栏行不参与。
    const overlayRect = target.parentElement?.getBoundingClientRect();
    const dockRect = document.querySelector(`.${cm(styles, "dock-right")}`)?.getBoundingClientRect();
    const workbench = target.closest<HTMLElement>(`.${cm(styles, "workbench")}`);
    if (overlayRect === undefined || dockRect === undefined || workbench === null) {
      return;
    }
    const bottomDockHeight = Number.parseFloat(getComputedStyle(workbench).getPropertyValue("--toolbox-bottom-dock-height")) || 0;
    const columnHeight = dockRect.height + overlayRect.height - bottomDockHeight;
    // 保留按下时笔尖与分隔线的偏移，分隔线跟随笔尖移动而不是跳到笔尖处。
    let grabOffset = event.clientY - overlayRect.top;
    target.setPointerCapture(pointerId);
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) {
        // 用布局同一套高度下限夹紧，拖过极限后往回拖时分隔线立即跟随，没有空行程。
        const column = resolveStackedRightColumn({
          columnHeight,
          recipeExtraHeight: bottomDockHeight,
          recipeRatio: resolveStackRatioForBoundary({
            boundaryFromColumnTop: moveEvent.clientY - grabOffset - dockRect.top,
            columnHeight,
          }),
          inspectorEmpty: false,
          focus: "inspector",
        });
        if (column.mode === "split") {
          state.setStackRatio(column.recipeRatio);
          // 碰到高度下限时重设偏移，让分隔线停在极限处而笔继续走；往回拖时立即跟随。
          const boundaryY = dockRect.top + (1 - column.recipeRatio) * columnHeight;
          grabOffset = moveEvent.clientY - boundaryY;
        }
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
  const closeActionMenu = useCallback(() => setActionTarget(null), []);
  const docked = state.docked;
  const minimized = state.minimized && !docked;
  const showsGraph = !minimized && state.pins.length > 0 && state.viewMode === "graph";
  const combinedPlan = useCombinedRecipeTreePlan(index, showsGraph || actionTarget !== null);
  const liveAction = useMemo(
    () => actionTarget === null || combinedPlan === null
      ? (actionTarget === null ? null : { target: actionTarget, canChooseRecipe: true })
      : resolveLiveAction(actionTarget, combinedPlan, index, t),
    [actionTarget, combinedPlan, index, t],
  );

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
      {/* 布局给停靠栏留的最大宽度不超过其下限时拖动没有效果，不显示拖动条。 */}
      {docked && state.dockWidthLimit > RECIPE_TREE_DOCK_MIN_WIDTH ? (
        <div
          aria-hidden
          className={cm(styles, "recipe-tree-dock-resize")}
          onPointerDown={handleDockResizePointerDown}
        />
      ) : null}
      {docked && state.stacked ? (
        <div
          aria-hidden
          className={cm(styles, "recipe-tree-stack-resize")}
          onPointerDown={handleStackResizePointerDown}
        />
      ) : null}
      <header
        className={cm(styles, "recipe-tree-header")}
        onClick={(event) => {
          // 叠放右栏只能展开一栏时，点按标题栏切换到配方树。
          if (docked && (event.target as HTMLElement).closest("button") === null) {
            state.setStackFocus("recipe");
          }
        }}
        onPointerDown={handleHeaderPointerDown}
      >
        <LucideListTree aria-hidden className={cm(styles, "recipe-tree-header-icon")} />
        <h2>{title}</h2>
        <span className={cm(styles, "recipe-tree-header-count")}>{state.pins.length}</span>
        {docked ? (
          <button
            aria-expanded={false}
            aria-label={t("recipeTree.expandPane")}
            className={cm(styles, "recipe-tree-icon-button stack-pane-expand-button")}
            onClick={() => state.setStackFocus("recipe")}
            title={t("recipeTree.expandPane")}
            type="button"
          >
            <LucideChevronDown />
          </button>
        ) : null}
        <div aria-label={t("recipeTree.view")} className={cm(styles, "recipe-tree-view-toggle")} role="group">
          <button
            aria-pressed={state.viewMode === "tree"}
            className={cm(styles, "recipe-tree-icon-button")}
            onClick={() => {
              state.setViewMode("tree");
              state.setStackFocus("recipe");
            }}
            title={t("recipeTree.viewTree")}
            type="button"
          >
            <LucideListTree />
          </button>
          <button
            aria-pressed={state.viewMode === "graph"}
            className={cm(styles, "recipe-tree-icon-button")}
            onClick={() => {
              state.setViewMode("graph");
              state.setStackFocus("recipe");
            }}
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
          {/* 流程图视图把搜索框并入图的工具栏行，给图留出高度。 */}
          {state.viewMode === "graph" && state.pins.length > 0 ? null : <RecipeTreeSearch appHost={appHost} index={index} t={t} />}
          <RecipeActionMenuContext.Provider value={setActionTarget}>
            {state.pins.length === 0 ? (
              <div className={cm(styles, "recipe-tree-body")}>
                <p className={cm(styles, "recipe-tree-empty")}>{t("recipeTree.empty")}</p>
              </div>
            ) : showsGraph && combinedPlan !== null ? (
              <RecipeTreeGraph
                appHost={appHost}
                index={index}
                plan={combinedPlan}
                search={<RecipeTreeSearch appHost={appHost} inline index={index} t={t} />}
                t={t}
              />
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
          {liveAction === null ? null : (
            <RecipeActionMenu
              appHost={appHost}
              editor={(
                <RecipeTreeNodeEditor
                  activeRecipeId={liveAction.target.recipeId}
                  canChooseRecipe={liveAction.canChooseRecipe}
                  index={index}
                  itemId={liveAction.target.itemId}
                  t={t}
                />
              )}
              index={index}
              onClose={closeActionMenu}
              t={t}
              target={liveAction.target}
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
  appHost,
  index,
  inline = false,
  t,
}: {
  appHost: AppHost;
  index: ProductionPlanningIndex;
  inline?: boolean;
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

  // 笔用户不必打字：从物品图鉴中点选要钉住的物品。
  const pickItemToPin = async () => {
    const itemId = await appHost.encyclopediaPicker.pickItem({
      title: t("recipeTree.pickItem"),
      filterItem: (item) => (index.candidatesByOutputItem.get(item.id)?.length ?? 0) > 0,
    });
    if (itemId !== null) {
      pinItem(itemId);
    }
  };

  return (
    <div className={cm(styles, inline ? "recipe-tree-search is-inline" : "recipe-tree-search")}>
      <button
        aria-label={t("recipeTree.pickItem")}
        className={cm(styles, "recipe-tree-icon-button recipe-tree-pick-button")}
        disabled={!state.canAddPin}
        onClick={() => void pickItemToPin()}
        title={t("recipeTree.pickItem")}
        type="button"
      >
        <LucideLibrary aria-hidden />
      </button>
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

  const controls = <RecipeTreePinControls isFirst={isFirst} pin={pin} t={t} />;

  // 钉住目标的名称、产量与操作并入根节点行，不再单独占一行标题。
  return (
    <article className={cm(styles, "recipe-tree-pin")}>
      {root === null ? (
        <>
          <div className={cm(styles, "recipe-tree-pin-header")}>
            <img alt="" className={cm(styles, "recipe-tree-item-icon")} src={resolveProductionPlanningItemIconSrc(pin.itemId, index)} />
            <strong className={cm(styles, "recipe-tree-pin-name")} title={itemName}>{itemName}</strong>
            {controls}
          </div>
          <p className={cm(styles, "recipe-tree-empty")}>{t("recipeTree.noRecipe")}</p>
        </>
      ) : (
        <>
          <ul className={cm(styles, "recipe-tree-nodes")} role="tree">
            <RecipeTreeNode
              depth={0}
              index={index}
              node={root}
              nodePath="0"
              pin={pin}
              pinControls={controls}
              t={t}
            />
          </ul>
          {pin.collapsed ? null : <RecipeTreeTotals index={index} plan={plan} t={t} />}
        </>
      )}
    </article>
  );
});

/** 钉住目标的产量输入与排序、取消钉住按钮。 */
const RecipeTreePinControls = observer(function RecipeTreePinControls({
  pin,
  isFirst,
  t,
}: {
  pin: RecipeTreePin;
  isFirst: boolean;
  t: Translate;
}) {
  const state = recipeTreeOverlayState;

  return (
    <span className={cm(styles, "recipe-tree-pin-controls")}>
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
      {state.pins.length > 1 ? (
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
      ) : null}
      <button
        aria-label={t("recipeTree.unpin")}
        className={cm(styles, "recipe-tree-icon-button")}
        onClick={() => state.removePin(pin.id)}
        title={t("recipeTree.unpin")}
        type="button"
      >
        <LucidePinOff />
      </button>
    </span>
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
  pinControls,
}: {
  node: ProductionPlanningItemNode;
  nodePath: string;
  depth: number;
  pin: RecipeTreePin;
  index: ProductionPlanningIndex;
  t: Translate;
  isUpkeep?: boolean;
  /** 根节点行承担钉住目标的标题：展开按钮折叠整个目标（含合计），产量由输入框给出。 */
  pinControls?: ReactNode;
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
  const isPinRow = pinControls !== undefined;
  const collapsed = isPinRow ? pin.collapsed : state.isNodeCollapsed(nodeId);
  const toggleCollapsed = () => {
    if (isPinRow) {
      state.updatePin(pin.id, { collapsed: !pin.collapsed });
    } else {
      state.toggleNodeCollapsed(nodeId);
    }
  };
  const itemName = resolveProductionPlanningItemName(node.itemId, index, t);
  const candidates = (index.candidatesByOutputItem.get(node.itemId) ?? [])
    .filter((candidate) => candidate.sourceType === "system-recipe");
  const byproducts = recipeNode?.outputs.filter((output) => output.itemId !== node.itemId && output.perMinute > 0) ?? [];
  const externalPerMinute = node.supply.manual + node.supply.infinite + node.supply.surplus + node.supply.cycle;
  const hasRecipeChoice = candidates.length > 1;
  const hasExtras = byproducts.length > 0 || externalPerMinute > 0.0001;
  const openNodeActionMenu = (anchor: DOMRect) => openActionMenu({
    itemId: node.itemId,
    recipeId: recipeNode?.recipeId ?? null,
    anchor,
  });

  return (
    <li
      aria-expanded={children.length > 0 || isPinRow ? !collapsed : undefined}
      role="treeitem"
      style={{ "--recipe-tree-depth": depth } as CSSProperties}
    >
      <div
        className={cm(styles, isPinRow ? "recipe-tree-node is-pin" : "recipe-tree-node")}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, input, label") !== null) {
            return;
          }
          openNodeActionMenu(event.currentTarget.getBoundingClientRect());
        }}
      >
        {children.length > 0 || isPinRow ? (
          <button
            aria-label={itemName}
            className={cm(styles, "recipe-tree-node-toggle")}
            onClick={toggleCollapsed}
            type="button"
          >
            {collapsed ? <LucideChevronRight /> : <LucideChevronDown />}
          </button>
        ) : <span className={cm(styles, "recipe-tree-node-toggle-spacer")} />}
        <img alt="" className={cm(styles, "recipe-tree-item-icon")} src={resolveProductionPlanningItemIconSrc(node.itemId, index)} />
        <span className={cm(styles, "recipe-tree-node-name")} title={itemName}>{itemName}</span>
        {isUpkeep ? <span className={cm(styles, "recipe-tree-tag")}>{t("recipeTree.upkeep")}</span> : null}
        {recipeNode !== null && (hasRecipeChoice || hasExtras) ? (
          <span className={cm(styles, "recipe-tree-node-detail")}>
            {hasRecipeChoice ? (
              <RecipeTreeRecipeChip
                activeRecipeId={recipeNode.recipeId}
                candidates={candidates}
                chosen={pin.recipeChoices[node.itemId] !== undefined}
                index={index}
                onOpen={openNodeActionMenu}
                t={t}
              />
            ) : null}
            {hasExtras ? (
              <span className={cm(styles, "recipe-tree-node-extras")}>
                {byproducts.map((output) => {
                  const byproductLabel = `${resolveProductionPlanningItemName(output.itemId, index, t)} +${formatProductionFlow(output.perMinute)}${t("recipeTree.perMinute")}`;
                  return (
                    <span
                      aria-label={byproductLabel}
                      className={cm(styles, "recipe-tree-byproduct")}
                      key={output.id}
                      role="img"
                      title={byproductLabel}
                    >
                      +<img alt="" src={resolveProductionPlanningItemIconSrc(output.itemId, index)} />
                      <span className={cm(styles, "recipe-tree-byproduct-rate")}>{formatProductionFlow(output.perMinute)}</span>
                    </span>
                  );
                })}
                {externalPerMinute > 0.0001 ? (
                  <span className={cm(styles, "recipe-tree-tag")}>
                    {t("recipeTree.supplied")} {formatProductionFlow(externalPerMinute)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className={cm(styles, "recipe-tree-node-metrics")}>
          {isPinRow ? null : (
            <span className={cm(styles, "recipe-tree-node-rate")}>
              {formatProductionFlow(node.demandPerMinute)}
              <small>{t("recipeTree.perMinute")}</small>
            </span>
          )}
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
        </span>
        {pinControls}
      </div>
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

/**
 * 有多条备选配方的节点上的配方芯片：以文字标出当前配方——各备选所用设备不同时显示设备名，
 * 否则显示区分各备选的主要原料；未手动指定时附带次要的「自动」标记。点按打开该物品的节点菜单切换配方。
 */
function RecipeTreeRecipeChip({
  activeRecipeId,
  candidates,
  chosen,
  index,
  onOpen,
  t,
}: {
  activeRecipeId: string | null;
  candidates: readonly ProductionPlanningCandidate[];
  chosen: boolean;
  index: ProductionPlanningIndex;
  onOpen: (anchor: DOMRect) => void;
  t: Translate;
}) {
  const activeCandidate = candidates.find((candidate) => candidate.recipeId === activeRecipeId);
  const subject = resolveRecipeChipSubject(activeRecipeId, candidates, index, t);
  const description = t("recipeTree.recipeChip").replace(
    "{recipe}",
    activeCandidate === undefined ? t("productionPlanning.autoRecipe") : resolveProductionPlanningCandidateName(activeCandidate, index, t),
  );

  return (
    <button
      aria-haspopup="menu"
      aria-label={description}
      className={cm(styles, "recipe-tree-recipe-chip", chosen && "is-chosen")}
      onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
      title={description}
      type="button"
    >
      {subject === null ? null : <img alt="" src={subject.iconSrc} />}
      <span>{subject?.name ?? t("recipeTree.recipeAuto")}</span>
      {chosen || subject === null ? null : <small>{t("recipeTree.recipeAuto")}</small>}
      <LucideChevronDown aria-hidden />
    </button>
  );
}

/** 配方芯片上用来区分当前配方的对象：备选配方的设备不同则取设备，否则取其他备选不全都使用的第一种原料。 */
function resolveRecipeChipSubject(
  activeRecipeId: string | null,
  candidates: readonly ProductionPlanningCandidate[],
  index: ProductionPlanningIndex,
  t: Translate,
): { readonly name: string; readonly iconSrc: string } | null {
  const activeRecipe = activeRecipeId === null ? undefined : index.recipeById.get(activeRecipeId);
  if (activeRecipe === undefined) {
    return null;
  }

  const recipes = candidates.flatMap((candidate) => {
    const recipe = candidate.recipeId === null ? undefined : index.recipeById.get(candidate.recipeId);
    return recipe === undefined ? [] : [recipe];
  });
  const machine = {
    name: t(index.entityById.get(activeRecipe.machineId)?.nameKey ?? activeRecipe.machineId),
    iconSrc: resolveProductionPlanningEntityIconSrc(activeRecipe.machineId, index),
  };
  if (new Set(recipes.map((recipe) => recipe.machineId)).size > 1) {
    return machine;
  }

  const inputItemIds = activeRecipe.inputs.map((flow) => flow.itemId).filter((itemId) => index.itemById.has(itemId));
  const alternatives = recipes.filter((recipe) => recipe.id !== activeRecipe.id);
  const itemId = inputItemIds.find((candidateItemId) => (
    alternatives.some((recipe) => !recipe.inputs.some((flow) => flow.itemId === candidateItemId))
  )) ?? inputItemIds[0];
  return itemId === undefined
    ? machine
    : { name: resolveProductionPlanningItemName(itemId, index, t), iconSrc: resolveProductionPlanningItemIconSrc(itemId, index) };
}

function RecipeTreeTotals({
  plan,
  index,
  expanded: controlledExpanded,
  onExpandedChange,
  t,
}: {
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  /** 由流程图视图控制：展开时列表取代流程图占满主体区域。 */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  t: Translate;
}) {
  // 按显示名称合并：同名设备（例如固体/液体模式的种植机）在合计里只出现一次。
  const machineTotals = useMemo(() => {
    const totals = new Map<string, { machineId: string; count: number }>();
    for (const recipeTotal of plan.recipeTotals) {
      const recipe = recipeTotal.recipeId === null ? undefined : index.recipeById.get(recipeTotal.recipeId);
      if (recipe === undefined || recipeTotal.deviceCount <= 0) {
        continue;
      }
      const nameKey = index.entityById.get(recipe.machineId)?.nameKey ?? recipe.machineId;
      const existing = totals.get(nameKey);
      totals.set(nameKey, {
        machineId: existing?.machineId ?? recipe.machineId,
        count: (existing?.count ?? 0) + recipeTotal.deviceCount,
      });
    }
    return [...totals.values()]
      .map(({ machineId, count }) => [machineId, count] as const)
      .sort((left, right) => right[1] - left[1]);
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

  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = onExpandedChange ?? setLocalExpanded;

  if (machineTotals.length === 0 && rawTotals.length === 0) {
    return null;
  }

  // 合计默认是紧凑的图标 + 数字；点按任一项展开带名称与精确数值的列表（笔无法依赖悬停提示）。
  if (expanded) {
    return (
      <div className={cm(styles, "recipe-tree-totals is-expanded")}>
        <button
          aria-expanded
          className={cm(styles, "recipe-tree-totals-toggle")}
          onClick={() => setExpanded(false)}
          type="button"
        >
          {t("action.collapse")}
        </button>
        <dl className={cm(styles, "recipe-tree-totals-list")}>
          {machineTotals.length > 0 ? <dt>{t("recipeTree.machines")}</dt> : null}
          {machineTotals.map(([machineId, count]) => (
            <dd key={machineId}>
              <img alt="" src={resolveProductionPlanningEntityIconSrc(machineId, index)} />
              <span>{t(index.entityById.get(machineId)?.nameKey ?? machineId)}</span>
              <b>×{formatProductionDeviceCount(count)}</b>
            </dd>
          ))}
          {rawTotals.length > 0 ? <dt>{t("recipeTree.inputs")}</dt> : null}
          {rawTotals.map(([itemId, perMinute]) => (
            <dd key={itemId}>
              <img alt="" src={resolveProductionPlanningItemIconSrc(itemId, index)} />
              <span>{resolveProductionPlanningItemName(itemId, index, t)}</span>
              <b>{formatProductionFlow(perMinute)}{t("recipeTree.perMinute")}</b>
            </dd>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className={cm(styles, "recipe-tree-totals")}>
      {machineTotals.length > 0 ? (
        <div className={cm(styles, "recipe-tree-totals-row")}>
          <span className={cm(styles, "recipe-tree-totals-label")}>{t("recipeTree.machines")}</span>
          {machineTotals.map(([machineId, count]) => (
            <button
              aria-expanded={false}
              aria-label={`${t(index.entityById.get(machineId)?.nameKey ?? machineId)} ×${formatProductionDeviceCount(count)}`}
              className={cm(styles, "recipe-tree-chip")}
              key={machineId}
              onClick={() => setExpanded(true)}
              type="button"
            >
              <img alt="" src={resolveProductionPlanningEntityIconSrc(machineId, index)} />
              {Math.ceil(count - 0.0001)}
            </button>
          ))}
        </div>
      ) : null}
      {rawTotals.length > 0 ? (
        <div className={cm(styles, "recipe-tree-totals-row")}>
          <span className={cm(styles, "recipe-tree-totals-label")}>{t("recipeTree.inputs")}</span>
          {rawTotals.map(([itemId, perMinute]) => (
            <button
              aria-expanded={false}
              aria-label={`${resolveProductionPlanningItemName(itemId, index, t)} ${formatProductionFlow(perMinute)}${t("recipeTree.perMinute")}`}
              className={cm(styles, "recipe-tree-chip")}
              key={itemId}
              onClick={() => setExpanded(true)}
              type="button"
            >
              <img alt="" src={resolveProductionPlanningItemIconSrc(itemId, index)} />
              {formatProductionFlow(perMinute)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ViewportSize {
  readonly width: number;
  readonly height: number;
  /** 右侧已停靠的属性面板宽度；浮层首次出现时贴靠画布右缘而不是盖住面板。 */
  readonly rightInset: number;
}

function resolveOnScreenRect(rect: RecipeTreeOverlayRect, viewport: ViewportSize): RecipeTreeOverlayRect {
  if (rect.x >= 0) {
    return clampRectToViewport(rect, viewport);
  }

  // 首次显示：贴靠视口右侧，避开左侧工具栏与面板。
  return clampRectToViewport({ ...rect, x: viewport.width - viewport.rightInset - rect.width - 24 }, viewport);
}

function clampRectToViewport(rect: RecipeTreeOverlayRect, viewport: ViewportSize): RecipeTreeOverlayRect {
  const viewportWidth = viewport.width;
  const viewportHeight = viewport.height;
  const width = Math.min(Math.max(RECIPE_TREE_MIN_WIDTH, rect.width), viewportWidth - VIEWPORT_MARGIN_PX * 2);
  const height = Math.min(
    Math.max(RECIPE_TREE_MIN_HEIGHT, rect.height),
    viewportHeight - TOP_BAR_CLEARANCE_PX - STATUS_BAR_CLEARANCE_PX - VIEWPORT_MARGIN_PX,
  );
  return {
    width,
    height,
    x: Math.max(VIEWPORT_MARGIN_PX, Math.min(rect.x, viewportWidth - width - VIEWPORT_MARGIN_PX)),
    // 整个卡片保持在顶栏下方的视口内，不遮挡仿真控制；矮屏下高度先被收窄。
    y: Math.max(TOP_BAR_CLEARANCE_PX, Math.min(rect.y, viewportHeight - height - STATUS_BAR_CLEARANCE_PX - VIEWPORT_MARGIN_PX)),
  };
}

/**
 * 合并全部钉住目标的产线求解结果，由配方树卡片求解一次，流程图与节点菜单共用，
 * 保证菜单显示与操作始终对应当前方案。用不到时（树形视图且菜单未打开、卡片最小化）不求解。
 */
function useCombinedRecipeTreePlan(index: ProductionPlanningIndex, needed: boolean): ProductionPlanningResult | null {
  const state = recipeTreeOverlayState;
  const pinsSignature = needed
    ? JSON.stringify(state.pins.map((pin) => [pin.itemId, pin.perMinute, pin.recipeChoices]))
    : null;
  return useMemo<ProductionPlanningResult | null>(() => {
    if (pinsSignature === null) {
      return null;
    }
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
}

/**
 * 菜单打开后目标的配方、产量可能被就地编辑；方案变化时按当前方案重新解析被点的卡片，
 * 使明细与“按此配方放置”等操作始终对应编辑后的状态，并判断改配方能否作用于这张卡片。
 */
function resolveLiveAction(
  target: RecipeActionTarget,
  plan: ProductionPlanningResult,
  index: ProductionPlanningIndex,
  t: Translate,
): { target: RecipeActionTarget; canChooseRecipe: boolean } {
  if (target.itemId === null) {
    return { target, canChooseRecipe: false };
  }
  const nodes = buildProductionFlowGraph(plan, index, t, "item").nodes;
  return {
    target: resolveLiveFlowNodeActionTarget(target, nodes),
    canChooseRecipe: canChooseRecipeForActionTarget(target, nodes),
  };
}

const RecipeTreeGraph = observer(function RecipeTreeGraph({
  appHost,
  index,
  plan,
  search,
  t,
}: {
  appHost: AppHost;
  index: ProductionPlanningIndex;
  plan: ProductionPlanningResult;
  search: ReactNode;
  t: Translate;
}) {
  const openActionMenu = useContext(RecipeActionMenuContext);
  const [totalsExpanded, setTotalsExpanded] = useState(false);

  return (
    <div className={cm(styles, totalsExpanded ? "recipe-tree-graph-body is-totals-expanded" : "recipe-tree-graph-body")}>
      <div className={cm(styles, "recipe-tree-graph")}>
        <ProductionFlowGraph
          displayMode="item"
          fitToView
          index={index}
          invertWheelZoom={appHost.internalState.settings.invertWheelZoom}
          nodeDrag="pan"
          toolbarLeading={search}
          onNodeActivate={(node, anchor) => openActionMenu(resolveFlowNodeActionTarget(node, anchor))}
          plan={plan}
          t={t}
        />
      </div>
      <RecipeTreeTotals
        expanded={totalsExpanded}
        index={index}
        onExpandedChange={setTotalsExpanded}
        plan={plan}
        t={t}
      />
    </div>
  );
});

/**
 * 节点菜单里的就地编辑：钉住的目标可直接调整产量，有多条配方的物品可直接切换配方，
 * 不必切回树形视图使用原生下拉框。配方选择作用于所有钉住目标（流程图合并了它们）。
 */
const RecipeTreeNodeEditor = observer(function RecipeTreeNodeEditor({
  activeRecipeId,
  canChooseRecipe,
  index,
  itemId,
  t,
}: {
  /** 当前方案里这张卡片实际使用的配方，标记为“使用中”。 */
  activeRecipeId: string | null;
  canChooseRecipe: boolean;
  index: ProductionPlanningIndex;
  itemId: string | null;
  t: Translate;
}) {
  const state = recipeTreeOverlayState;
  if (itemId === null) {
    return null;
  }
  const pin = state.pins.find((candidate) => candidate.itemId === itemId);
  const itemCandidates = (index.candidatesByOutputItem.get(itemId) ?? [])
    .filter((candidate) => candidate.sourceType === "system-recipe");
  const candidates = canChooseRecipe ? itemCandidates : [];
  // 改选落不到这张卡片上时不给选项，只把它实际使用的配方显示出来。
  const activeRecipe = activeRecipeId === null ? undefined : index.recipeById.get(activeRecipeId);
  const readOnlyRecipe = !canChooseRecipe && itemCandidates.length >= 2 ? activeRecipe : undefined;
  const selectedCandidateId = state.pins.map((candidate) => candidate.recipeChoices[itemId]).find((id) => id !== undefined) ?? null;
  if (pin === undefined && candidates.length < 2 && readOnlyRecipe === undefined) {
    return null;
  }
  const candidateRecipes = candidates.flatMap((candidate) => {
    const recipe = candidate.recipeId === null ? undefined : index.recipeById.get(candidate.recipeId);
    return recipe === undefined ? [] : [recipe];
  });
  const machinesDiffer = new Set(candidateRecipes.map((recipe) => recipe.machineId)).size > 1;
  const outputsDiffer = new Set(candidateRecipes.map((recipe) => formatRecipeFlows(recipe.outputs, index, t))).size > 1;
  const chooseRecipe = (candidateId: string | null) => {
    for (const candidate of state.pins) {
      state.setRecipeChoice(candidate.id, itemId, candidateId);
    }
  };
  const step = pin === undefined ? 1 : pin.perMinute >= 60 ? 10 : pin.perMinute >= 10 ? 5 : 1;

  return (
    <div className={cm(styles, "recipe-action-menu-editor")}>
      {pin === undefined ? null : (
        <div className={cm(styles, "recipe-action-menu-rate")}>
          <span>{t("recipeTree.targetRate")}</span>
          <button
            aria-label={t("recipeTree.decreaseRate")}
            className={cm(styles, "recipe-tree-icon-button")}
            disabled={pin.perMinute - step <= 0}
            onClick={() => state.updatePin(pin.id, { perMinute: pin.perMinute - step })}
            type="button"
          >
            <LucideMinus />
          </button>
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
          <button
            aria-label={t("recipeTree.increaseRate")}
            className={cm(styles, "recipe-tree-icon-button")}
            onClick={() => state.updatePin(pin.id, { perMinute: pin.perMinute + step })}
            type="button"
          >
            <LucidePlus />
          </button>
        </div>
      )}
      {candidates.length < 2 ? null : (
        // 备选配方可能只差设备、原料数量或产物：设备不同时每行先写设备名，再列带数量的原料；
        // 产物不同时再列产物。设备都相同时只列原料，设备图标照常显示。
        <div aria-label={t("recipeTree.recipe")} className={cm(styles, "recipe-action-menu-recipes")} role="group">
          <button
            aria-pressed={selectedCandidateId === null}
            className={cm(styles, "recipe-action-menu-recipe")}
            onClick={() => chooseRecipe(null)}
            type="button"
          >
            <span className={cm(styles, "recipe-action-menu-recipe-machine")}>{t("productionPlanning.autoRecipe")}</span>
          </button>
          {sortRecipesByDefaultPriority(candidateRecipes).map((recipe) => {
            const candidate = candidates.find((entry) => entry.recipeId === recipe.id);
            return (
              <button
                aria-pressed={candidate !== undefined && candidate.id === selectedCandidateId}
                className={cm(styles, "recipe-action-menu-recipe")}
                key={recipe.id}
                onClick={() => chooseRecipe(candidate?.id ?? null)}
                type="button"
              >
                {renderRecipeRow(recipe, machinesDiffer, outputsDiffer)}
              </button>
            );
          })}
        </div>
      )}
      {readOnlyRecipe === undefined ? null : (
        <div aria-label={t("recipeTree.recipe")} className={cm(styles, "recipe-action-menu-recipe is-static")} role="group">
          {renderRecipeRow(readOnlyRecipe, true, false)}
        </div>
      )}
    </div>
  );

  function renderRecipeRow(recipe: RecipeDefinition, showMachine: boolean, showOutputs: boolean) {
    const inputs = formatRecipeFlows(recipe.inputs, index, t);
    const machineName = t(index.entityById.get(recipe.machineId)?.nameKey ?? recipe.machineId);
    const primary = showMachine || inputs === "" ? machineName : inputs;
    const details = [showMachine ? inputs : "", showOutputs ? `→ ${formatRecipeFlows(recipe.outputs, index, t)}` : ""]
      .filter((line) => line !== "");
    return (
      <>
        <img alt="" src={resolveProductionPlanningEntityIconSrc(recipe.machineId, index)} />
        <span className={cm(styles, "recipe-action-menu-recipe-text")}>
          <span className={cm(styles, "recipe-action-menu-recipe-machine")}>{primary}</span>
          {details.map((line) => (
            <span className={cm(styles, "recipe-action-menu-recipe-inputs")} key={line}>{line}</span>
          ))}
        </span>
        <span className={cm(styles, "recipe-action-menu-recipe-meta")}>
          {recipe.id === activeRecipeId ? (
            <span className={cm(styles, "recipe-action-menu-recipe-in-use")} data-recipe-in-use="">{t("recipeTree.recipeInUse")}</span>
          ) : null}
          <span>{recipe.durationSeconds}s</span>
        </span>
      </>
    );
  }
});

/** 配方的原料或产物清单：“名称 ×数量”，数量为 1 时省略。 */
function formatRecipeFlows(
  flows: readonly { readonly itemId: string; readonly amount: number }[],
  index: ProductionPlanningIndex,
  t: Translate,
): string {
  return flows
    .filter((flow) => index.itemById.has(flow.itemId))
    .map((flow) => {
      const name = resolveProductionPlanningItemName(flow.itemId, index, t);
      return flow.amount > 1 ? `${name} ×${flow.amount}` : name;
    })
    .join(" + ");
}
