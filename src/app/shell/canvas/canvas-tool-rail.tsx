import { observer } from "mobx-react-lite";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from "react";
import LucideCornerDownRight from "~icons/lucide/corner-down-right";
import LucideCornerRightDown from "~icons/lucide/corner-right-down";
import LucideEllipsis from "~icons/lucide/ellipsis";
import LucideGripHorizontal from "~icons/lucide/grip-horizontal";
import LucideScan from "~icons/lucide/scan";
import LucideX from "~icons/lucide/x";
import LucideZap from "~icons/lucide/zap";
import LucideZoomIn from "~icons/lucide/zoom-in";
import LucideZoomOut from "~icons/lucide/zoom-out";
import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { UiButtonHoldState } from "@/app/input/gesture/adapter";
import {
  fitCanvasViewportToBase,
  LOGISTICS_CANCEL_ROUTE_BUTTON_ID,
  LOGISTICS_ROUTE_ORDER_BUTTON_ID,
  openQuickPlace,
  PLACEMENT_RAIL_CANCEL_BUTTON_ID,
  PLACEMENT_RAIL_ROTATE_BUTTON_ID,
  ROTATE_VIEW_BUTTON_ID,
  zoomCanvasViewportByButton,
} from "@/app/input/gesture/actions";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { useEditorDocumentSnapshot } from "../hooks";
import {
  getVisiblePlacementOperationButtons,
  type PlacementOperationButtonDefinition,
} from "@/app/shell/panels/placement-operation-buttons";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { canvasToolRailState, hookCanvasToolRailPersistence, type CanvasToolRailSide } from "./canvas-tool-rail-state";

const RAIL_EDGE_MARGIN_PX = 8;
/** 与 .canvas-tool-rail 的 left/right 偏移一致：工具条距画布边缘的距离。 */
const RAIL_EDGE_INSET_PX = 10;
/** 与 .canvas-tool-rail 的 max-height 留白一致（上下各 8px，与纵向夹紧的边距相同）。 */
const RAIL_VERTICAL_RESERVE_PX = 16;
const RAIL_ITEM_GAP_PX = 4;
/** 分隔线 1px 加上下各 2px 外边距。 */
const RAIL_DIVIDER_HEIGHT_PX = 5;
const DEFAULT_RAIL_BUTTON_SIZE_PX = 44;
/** 与 .canvas-tool-rail-attached 的水平间距一致。 */
const RAIL_ATTACHED_GAP_PX = 6;
const MORE_BUTTON_ID = "canvas-tool-rail-more";
const MORE_FLYOUT_ID = "canvas-tool-rail-more-flyout";

type RailItem =
  | { readonly kind: "button"; readonly key: string; readonly node: ReactNode }
  | { readonly kind: "divider"; readonly key: string };

/**
 * 按每列可用高度把按钮顺序分列，列数尽量少，且在列数不变的前提下各列尽量等高。
 * 高度不足时增加列数而不是滚动，所有按钮始终可见、可点按。
 */
function packRailColumns(items: readonly RailItem[], columnBudget: number, buttonSize: number): RailItem[][] {
  let columns = packRailColumnsGreedy(items, columnBudget, buttonSize);
  if (columns.length <= 1 || !Number.isFinite(columnBudget)) {
    return columns;
  }
  for (let budget = Math.floor(columnBudget) - 1; budget >= buttonSize; budget -= 1) {
    const tighter = packRailColumnsGreedy(items, budget, buttonSize);
    if (tighter.length > columns.length) break;
    columns = tighter;
  }
  return columns;
}

/** 顺序填满每一列；分组之间的分隔线放得下才保留，否则直接紧接或换列。 */
function packRailColumnsGreedy(items: readonly RailItem[], columnBudget: number, buttonSize: number): RailItem[][] {
  const columns: RailItem[][] = [];
  let column: RailItem[] = [];
  let height = 0;
  let pendingDivider: RailItem | null = null;
  for (const item of items) {
    if (item.kind === "divider") {
      if (column.length > 0) pendingDivider = item;
      continue;
    }
    const withButton = height + (column.length > 0 ? RAIL_ITEM_GAP_PX : 0) + buttonSize;
    const withDivider = withButton + RAIL_DIVIDER_HEIGHT_PX + RAIL_ITEM_GAP_PX;
    if (pendingDivider !== null && withDivider <= columnBudget) {
      column.push(pendingDivider, item);
      height = withDivider;
    } else if (column.length === 0 || withButton <= columnBudget) {
      column.push(item);
      height = withButton;
    } else {
      columns.push(column);
      column = [item];
      height = buttonSize;
    }
    pendingDivider = null;
  }
  if (column.length > 0) columns.push(column);
  return columns;
}

function asRailItems(nodes: readonly ReactElement[]): RailItem[] {
  return nodes.map((node) => ({ kind: "button", key: String(node.key), node }));
}

function RailColumns({ columns, ref }: { readonly columns: readonly RailItem[][]; readonly ref?: Ref<HTMLDivElement> }) {
  return (
    <div className={cm(styles, "canvas-tool-rail-columns")} ref={ref}>
      {columns.map((column) => (
        <div className={cm(styles, "canvas-tool-rail-column")} key={column[0]!.key}>
          {column.map((item) => item.kind === "divider" ? (
            <span aria-hidden="true" className={cm(styles, "canvas-tool-rail-divider")} key={item.key} />
          ) : (
            <Fragment key={item.key}>{item.node}</Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 贴附在工具条外侧的按钮组的纵向位置（相对工具条）：首个按钮与触发它的工具按钮对齐，
 * 没有触发按钮时与工具条顶部对齐，并尽量不超出工具条的纵向范围。
 */
function resolveAttachedTop(rail: HTMLElement, group: HTMLElement | null, triggerId: string | null): number {
  if (group === null) {
    return 0;
  }
  const trigger = triggerId === null ? null : rail.querySelector<HTMLElement>(`[data-ui-button-id="${triggerId}"]`);
  const firstButtonOffset = group.clientTop + ((group.firstElementChild as HTMLElement | null)?.offsetTop ?? 0);
  const desired = trigger === null ? 0 : trigger.offsetTop - firstButtonOffset;
  return Math.round(Math.max(0, Math.min(desired, rail.clientHeight - group.offsetHeight)));
}

/** 对外发布的占用带宽包含贴附的上下文按钮组；临时打开的「更多」弹出组不计入。 */
function publishRailGeometry(rail: HTMLElement, attached: HTMLElement | null): void {
  canvasToolRailState.setSize(
    RAIL_EDGE_INSET_PX + rail.offsetWidth + (attached === null ? 0 : RAIL_ATTACHED_GAP_PX + attached.offsetWidth),
    rail.offsetHeight,
  );
}

const stopUiPropagation = (
  event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement> | ReactWheelEvent<HTMLElement>,
) => {
  event.stopPropagation();
};

const stopUiPropagationAndDefault = (event: ReactMouseEvent<HTMLElement> | ReactWheelEvent<HTMLElement>) => {
  event.preventDefault();
  event.stopPropagation();
};

const stopTouchPointerDownPropagation = (event: ReactPointerEvent<HTMLElement>) => {
  preventTouchPointerCompatibilityMouseEvents(event);
  event.stopPropagation();
};

/**
 * 画布边缘常驻的笔工具条：编辑工具、撤销/重做、视图缩放与快速放置，不随左侧面板切换或滚动而消失。
 * 拖动手柄可沿边缘移动，松手时贴靠较近的左缘或右缘，让工具条留在笔正在工作的一侧。
 * 物流布设与放置模式的上下文按钮贴附在工具条外侧，工具条本身的按钮位置不因此变化。
 * 画布高度放不下一列时进入紧凑布局：视图类按钮收进「更多」弹出组，其余按钮分列。
 */
export const CanvasToolRail = observer(function CanvasToolRail({ appHost }: { appHost: AppHost }) {
  useEffect(() => hookCanvasToolRailPersistence(), []);
  const t = appHost.actions.translate;
  const railRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const attachedRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const [dragPosition, setDragPosition] = useState<{ side: CanvasToolRailSide; center: number } | null>(null);
  const [railHeight, setRailHeight] = useState(0);
  const [layoutMetrics, setLayoutMetrics] = useState({ areaHeight: 0, chromeHeight: 0, buttonSize: DEFAULT_RAIL_BUTTON_SIZE_PX });
  const [attachedLayout, setAttachedLayout] = useState({ contextTop: 0, flyoutTop: 0, flyoutOffset: 0 });
  const [moreOpen, setMoreOpen] = useState(false);
  const findCanvasPanel = () => railRef.current?.parentElement?.querySelector<HTMLElement>(`.${cm(styles, "canvas-panel")}`) ?? null;

  useLayoutEffect(() => {
    const rail = railRef.current;
    const area = areaRef.current;
    if (rail === null || area === null) {
      return;
    }
    const measure = () => {
      setRailHeight(rail.offsetHeight);
      publishRailGeometry(rail, attachedRef.current);
      const button = rail.querySelector<HTMLElement>(`.${cm(styles, "canvas-tool-rail-button")}`);
      const next = {
        areaHeight: area.offsetHeight,
        // 内边距与边框占用的固定高度；按列容器的位置计算，不受内容是否被 max-height 截断影响。
        chromeHeight: (rail.offsetHeight - rail.clientHeight) + (columnsRef.current?.offsetTop ?? 0)
          + Number.parseFloat(getComputedStyle(rail).paddingBottom || "0"),
        buttonSize: button?.offsetHeight || DEFAULT_RAIL_BUTTON_SIZE_PX,
      };
      setLayoutMetrics((current) => (
        current.areaHeight === next.areaHeight
        && current.chromeHeight === next.chromeHeight
        && current.buttonSize === next.buttonSize
      ) ? current : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const side = dragPosition?.side ?? canvasToolRailState.side;
  const center = dragPosition?.center ?? canvasToolRailState.center;
  const canvas = appHost.mainCanvas;
  const editor = appHost.workspace.editor;
  // 订阅 document 变化使管道按钮在切换基地后正确显示/隐藏
  useEditorDocumentSnapshot(editor, selectDocumentBaseId, Object.is);
  const toolButtons = getVisiblePlacementOperationButtons(appHost);
  const history = editor?.state.history;
  const canUndo = editor !== null && (history?.undoDepth ?? 0) > 0;
  const canRedo = editor !== null && (history?.redoDepth ?? 0) > 0;
  const quickPlaceEnabled = appHost.internalState.settings.quickPlaceEnabled;
  const activeTool = canvas.state.activeTool;
  const logistics = canvas.state.runtime.logisticsPlacement;
  const inLogisticsPlacement = activeTool === "logistics-placement" && logistics.kind !== null;
  const inPlacement = activeTool === "single-placement" || activeTool === "blueprint-placement";
  const isDrawingRoute = inLogisticsPlacement && logistics.phase !== "idle" && !logistics.isHoverPreview;

  const resolveDragPosition = (clientX: number, clientY: number) => {
    const canvasRect = findCanvasPanel()?.getBoundingClientRect();
    const railHeight = railRef.current?.offsetHeight ?? 0;
    if (canvasRect === undefined || canvasRect.height <= 0) {
      return null;
    }
    const halfFraction = (railHeight / 2 + RAIL_EDGE_MARGIN_PX) / canvasRect.height;
    const rawCenter = (clientY - canvasRect.top) / canvasRect.height;
    return {
      side: clientX < canvasRect.left + canvasRect.width / 2 ? "left" as const : "right" as const,
      center: halfFraction >= 0.5 ? 0.5 : Math.min(1 - halfFraction, Math.max(halfFraction, rawCenter)),
    };
  };

  const handleGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragPosition({ side: canvasToolRailState.side, center: canvasToolRailState.center });
  };

  const handleGripPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (dragPosition === null) {
      return;
    }
    setDragPosition(resolveDragPosition(event.clientX, event.clientY) ?? dragPosition);
  };

  const finishGripDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (dragPosition !== null) {
      canvasToolRailState.setPosition(dragPosition.side, dragPosition.center);
    }
    setDragPosition(null);
  };

  const dispatchUiButtonPointerUp = (event: ReactPointerEvent<HTMLButtonElement>, uiButtonId: string) => {
    event.stopPropagation();
    const modifiers = {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    };

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({ uiButtonId, button: event.button, ...modifiers });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({ uiButtonId, ...modifiers });
    }
  };

  const dispatchUiButtonKeyboardActivate = (uiButtonId: string) => {
    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
  };

  const iconClassName = cm(styles, "canvas-tool-rail-icon");
  const gestureButton = (options: {
    readonly uiButtonId: string;
    readonly label: string;
    readonly icon: ReactNode;
    readonly hint?: string | null;
    readonly disabled?: boolean;
  }) => (
    <RailButton
      disabled={options.disabled}
      hint={options.hint}
      key={options.uiButtonId}
      label={options.label}
      onKeyboardActivate={() => dispatchUiButtonKeyboardActivate(options.uiButtonId)}
      onPointerUp={(event) => dispatchUiButtonPointerUp(event, options.uiButtonId)}
      uiButtonId={options.uiButtonId}
    >
      {options.icon}
    </RailButton>
  );

  const gripItem: RailItem = {
    kind: "button",
    key: "grip",
    node: (
      <button
        aria-label={t("toolbar.canvasToolsMove")}
        className={cm(styles, "canvas-tool-rail-grip")}
        onLostPointerCapture={finishGripDrag}
        onPointerCancel={finishGripDrag}
        onPointerDown={handleGripPointerDown}
        onPointerMove={handleGripPointerMove}
        onPointerUp={finishGripDrag}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            canvasToolRailState.setPosition(event.key === "ArrowLeft" ? "left" : "right", canvasToolRailState.center);
          }
        }}
        title={t("toolbar.canvasToolsMove")}
        type="button"
      >
        <LucideGripHorizontal aria-hidden="true" />
      </button>
    ),
  };

  const toolItems: RailItem[] = toolButtons.map((button: PlacementOperationButtonDefinition) => {
    const isActive = button.activeWhen?.(appHost) ?? false;
    const hotkey = button.hotkey
      ?? (button.hotkeyKeyId ? appHost.internalActions.getKeyboardShortcutFor(button.hotkeyKeyId) : null);
    return {
      kind: "button",
      key: button.uiButtonId,
      node: (
        <RailButton
          active={isActive}
          hint={hotkey}
          label={t(button.labelKey)}
          onKeyboardActivate={() => dispatchUiButtonKeyboardActivate(button.uiButtonId)}
          onPointerUp={(event) => dispatchUiButtonPointerUp(event, button.uiButtonId)}
          pressed={button.activeWhen ? isActive : undefined}
          uiButtonId={button.uiButtonId}
        >
          {button.icon ? (
            <WorkbenchIcon className={iconClassName} kind={button.icon} />
          ) : button.iconSrc ? (
            <img alt="" className={cm(styles, "canvas-tool-rail-image")} src={button.iconSrc} />
          ) : null}
        </RailButton>
      ),
    };
  });
  const activeToolButtonId = toolButtons.find((button) => button.activeWhen?.(appHost) ?? false)?.uiButtonId ?? null;

  const historyItems: RailItem[] = [
    {
      kind: "button",
      key: "undo",
      node: (
        <RailButton
          disabled={!canUndo}
          label={t("workbench.button.undo")}
          onActivate={() => editor?.actions.undoDocumentHistory()}
          uiButtonId="canvas-tool-rail-undo"
        >
          <WorkbenchIcon className={iconClassName} kind="undo" />
        </RailButton>
      ),
    },
    {
      kind: "button",
      key: "redo",
      node: (
        <RailButton
          disabled={!canRedo}
          label={t("workbench.button.redo")}
          onActivate={() => editor?.actions.redoDocumentHistory()}
          uiButtonId="canvas-tool-rail-redo"
        >
          <WorkbenchIcon className={iconClassName} kind="redo" />
        </RailButton>
      ),
    },
  ];

  const viewButtons: ReactElement[] = [
    <RailButton
      key="zoom-out"
      label={t("action.zoomOut")}
      onActivate={() => zoomCanvasViewportByButton(canvas, -1)}
      uiButtonId="canvas-tool-rail-zoom-out"
    >
      <LucideZoomOut aria-hidden className={iconClassName} />
    </RailButton>,
    <RailButton
      key="zoom-in"
      label={t("action.zoomIn")}
      onActivate={() => zoomCanvasViewportByButton(canvas, 1)}
      uiButtonId="canvas-tool-rail-zoom-in"
    >
      <LucideZoomIn aria-hidden className={iconClassName} />
    </RailButton>,
    <RailButton
      key="fit-base"
      label={t("action.fitBaseInView")}
      onActivate={() => fitCanvasViewportToBase(canvas, {
        left: canvasToolRailState.side === "left" ? canvasToolRailState.width : 0,
        right: canvasToolRailState.side === "right" ? canvasToolRailState.width : 0,
      })}
      uiButtonId="canvas-tool-rail-fit-base"
    >
      <LucideScan aria-hidden className={iconClassName} />
    </RailButton>,
    <RotateViewRailButton appHost={appHost} key="rotate-view" />,
  ];

  const quickPlaceItems: RailItem[] = quickPlaceEnabled ? [{
    kind: "button",
    key: "quick-place",
    node: (
      <RailButton
        active={canvas.state.runtime.quickPlace.visible}
        label={t("workbench.quickPlace.title")}
        onActivate={(rect) => openQuickPlace(canvas, { x: rect.right + 12, y: rect.top }, "pointer")}
        uiButtonId="canvas-tool-rail-quick-place"
      >
        <LucideZap aria-hidden className={iconClassName} />
      </RailButton>
    ),
  }] : [];

  const columnBudget = layoutMetrics.areaHeight > 0
    ? layoutMetrics.areaHeight - RAIL_VERTICAL_RESERVE_PX - layoutMetrics.chromeHeight
    : Number.POSITIVE_INFINITY;
  const fullColumns = packRailColumns([
    gripItem,
    ...toolItems,
    { kind: "divider", key: "divider-history" },
    ...historyItems,
    { kind: "divider", key: "divider-view" },
    ...asRailItems(viewButtons),
    { kind: "divider", key: "divider-quick-place" },
    ...quickPlaceItems,
  ], columnBudget, layoutMetrics.buttonSize);
  const compact = fullColumns.length > 1;
  const showMore = compact && moreOpen;
  const columns = compact ? packRailColumns([
    gripItem,
    ...toolItems,
    { kind: "divider", key: "divider-quick-place" },
    ...quickPlaceItems,
    { kind: "divider", key: "divider-history" },
    ...historyItems,
    { kind: "divider", key: "divider-more" },
    {
      kind: "button",
      key: "more",
      node: (
        <RailButton
          active={showMore}
          controls={MORE_FLYOUT_ID}
          expanded={showMore}
          label={t("toolbar.canvasToolsMore")}
          onActivate={() => setMoreOpen((open) => !open)}
          uiButtonId={MORE_BUTTON_ID}
        >
          <LucideEllipsis aria-hidden className={iconClassName} />
        </RailButton>
      ),
    },
  ], columnBudget, layoutMetrics.buttonSize) : fullColumns;

  const contextual = inLogisticsPlacement ? {
    triggerId: activeToolButtonId,
    nodes: [
      gestureButton({
        uiButtonId: LOGISTICS_ROUTE_ORDER_BUTTON_ID,
        hint: appHost.internalActions.getKeyboardShortcutFor(SHORTCUT_KEY.ROTATE),
        label: t(logistics.kind === LOGISTICS_KIND.pipe ? "action.changePipeRoutePriority" : "action.changeBeltRoutePriority"),
        icon: logistics.routeOrder === "vertical-first"
          ? <LucideCornerDownRight aria-hidden className={iconClassName} />
          : <LucideCornerRightDown aria-hidden className={iconClassName} />,
      }),
      gestureButton({
        uiButtonId: LOGISTICS_CANCEL_ROUTE_BUTTON_ID,
        disabled: !isDrawingRoute,
        label: t("action.cancelLogisticsRoute"),
        icon: <LucideX aria-hidden className={iconClassName} />,
      }),
    ],
  } : inPlacement ? {
    triggerId: activeToolButtonId,
    nodes: [
      gestureButton({
        uiButtonId: PLACEMENT_RAIL_ROTATE_BUTTON_ID,
        hint: appHost.internalActions.getKeyboardShortcutFor(SHORTCUT_KEY.ROTATE),
        label: t("action.rotatePlacement"),
        icon: <WorkbenchIcon className={iconClassName} kind="rotate" />,
      }),
      gestureButton({
        uiButtonId: PLACEMENT_RAIL_CANCEL_BUTTON_ID,
        label: t("action.cancelPlacement"),
        icon: <LucideX aria-hidden className={iconClassName} />,
      }),
    ],
  } : null;
  const contextTriggerId = contextual?.triggerId ?? null;
  const hasContextual = contextual !== null;
  const columnsLayoutKey = columns.map((column) => column.map((item) => item.key).join(",")).join("|");

  // 按钮分列、贴附组出现或消失后，按实际布局对齐贴附组并重新发布几何；数值不变时不触发更新。
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (rail === null) {
      return;
    }
    const attached = attachedRef.current;
    publishRailGeometry(rail, attached);
    const next = {
      contextTop: resolveAttachedTop(rail, attached, contextTriggerId),
      flyoutTop: resolveAttachedTop(rail, flyoutRef.current, MORE_BUTTON_ID),
      flyoutOffset: attached === null ? 0 : attached.offsetWidth + RAIL_ATTACHED_GAP_PX,
    };
    setAttachedLayout((current) => (
      current.contextTop === next.contextTop
      && current.flyoutTop === next.flyoutTop
      && current.flyoutOffset === next.flyoutOffset
    ) ? current : next);
  }, [columnsLayoutKey, contextTriggerId, hasContextual, railHeight, showMore]);

  useEffect(() => {
    if (!showMore) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || railRef.current?.contains(event.target) !== true) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [showMore]);

  const closeMoreFromKeyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setMoreOpen(false);
    railRef.current?.querySelector<HTMLElement>(`[data-ui-button-id="${MORE_BUTTON_ID}"]`)?.focus();
  };

  return (
    <>
      {/* 与工具条同处画布网格区域的不可见量尺：其高度即工具条可用的纵向空间。 */}
      <div aria-hidden="true" className={cm(styles, "canvas-tool-rail-area")} ref={areaRef} />
      <div
        aria-label={t("toolbar.canvasTools")}
        className={cm(styles, [
          "canvas-tool-rail",
          side === "right" ? "is-right" : "",
          dragPosition === null ? "" : "is-dragging",
          showMore ? "is-expanded" : "",
        ].filter(Boolean).join(" "))}
        ref={railRef}
        style={{
          "--canvas-tool-rail-center": `${center * 100}%`,
          "--canvas-tool-rail-half": `${railHeight / 2}px`,
        } as CSSProperties}
        onAuxClick={stopUiPropagationAndDefault}
        onClick={stopUiPropagation}
        onContextMenu={stopUiPropagationAndDefault}
        onPointerCancel={stopUiPropagation}
        onPointerDown={stopUiPropagation}
        onPointerMove={stopUiPropagation}
        onPointerUp={stopUiPropagation}
        onWheel={stopUiPropagationAndDefault}
        role="toolbar"
        aria-orientation="vertical"
      >
        <RailColumns columns={columns} ref={columnsRef} />
        {contextual === null ? null : (
          <div
            aria-label={t("toolbar.canvasToolsContext")}
            className={cm(styles, "canvas-tool-rail-attached")}
            ref={attachedRef}
            role="group"
            style={{ "--canvas-tool-rail-attached-top": `${attachedLayout.contextTop}px` } as CSSProperties}
          >
            <RailColumns columns={packRailColumns(asRailItems(contextual.nodes), columnBudget, layoutMetrics.buttonSize)} />
          </div>
        )}
        {showMore ? (
          <div
            aria-label={t("toolbar.canvasToolsMore")}
            className={cm(styles, "canvas-tool-rail-attached")}
            id={MORE_FLYOUT_ID}
            onKeyDown={closeMoreFromKeyboard}
            ref={flyoutRef}
            role="group"
            style={{
              "--canvas-tool-rail-attached-top": `${attachedLayout.flyoutTop}px`,
              "--canvas-tool-rail-attached-offset": `${attachedLayout.flyoutOffset}px`,
            } as CSSProperties}
          >
            <RailColumns columns={packRailColumns(asRailItems(viewButtons), columnBudget, layoutMetrics.buttonSize)} />
          </div>
        ) : null}
      </div>
    </>
  );
});

/**
 * 旋转视角需要按住确认：按压起止交给手势适配器，按住期间显示进度条，松开前离开或取消即作废。
 */
const RotateViewRailButton = observer(function RotateViewRailButton({ appHost }: { appHost: AppHost }) {
  const label = appHost.actions.translate("action.rotateView");
  const [holdState, setHoldState] = useState<UiButtonHoldState>(() => appHost.gestureAdapter.getUiButtonHoldState());
  useEffect(() => appHost.gestureAdapter.subscribeUiButtonHoldState(setHoldState), [appHost]);

  const toPressEvent = (event: ReactPointerEvent<HTMLButtonElement>) => ({
    uiButtonId: ROTATE_VIEW_BUTTON_ID,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    sourceEvent: event.nativeEvent,
  });
  const isSupportedPointer = (event: ReactPointerEvent<HTMLButtonElement>) =>
    event.pointerType === "mouse" || event.pointerType === "touch" || event.pointerType === "pen";

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    stopTouchPointerDownPropagation(event);
    if (!isSupportedPointer(event) || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    appHost.gestureAdapter.handleUiButtonPressStart(toPressEvent(event));
  };

  const handlePressEnd = (event: ReactPointerEvent<HTMLButtonElement>, reason: "release" | "cancel") => {
    event.stopPropagation();
    if (!isSupportedPointer(event)) {
      return;
    }
    appHost.gestureAdapter.handleUiButtonPressEnd(toPressEvent(event), reason);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const showHoldProgress = holdState.visible && holdState.uiButtonId === ROTATE_VIEW_BUTTON_ID;
  return (
    <button
      aria-label={label}
      className={cm(styles, "canvas-tool-rail-button")}
      data-ui-button-id={ROTATE_VIEW_BUTTON_ID}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onLostPointerCapture={(event) => handlePressEnd(event, "cancel")}
      onPointerCancel={(event) => handlePressEnd(event, "cancel")}
      onPointerDown={handlePointerDown}
      onPointerMove={stopUiPropagation}
      onPointerUp={(event) => handlePressEnd(event, "release")}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className={cm(styles, "canvas-tool-rail-button-icon")}>
        <WorkbenchIcon className={cm(styles, "canvas-tool-rail-icon")} kind="rotate" />
      </span>
      {showHoldProgress ? (
        <span
          aria-hidden="true"
          className={cm(styles, "canvas-tool-rail-hold-progress")}
          key={holdState.gestureId ?? holdState.startedAt ?? "hold"}
        >
          <span
            className={cm(styles, "canvas-tool-rail-hold-progress-fill")}
            style={{ animationDuration: `${holdState.durationMs}ms` }}
          />
        </span>
      ) : null}
    </button>
  );
});

function RailButton({
  active = false,
  children,
  controls,
  disabled = false,
  expanded,
  hint = null,
  label,
  onActivate,
  onKeyboardActivate,
  onPointerUp,
  pressed,
  uiButtonId,
}: {
  readonly active?: boolean;
  readonly children: ReactNode;
  readonly controls?: string;
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly hint?: string | null;
  readonly label: string;
  readonly onActivate?: (rect: DOMRect) => void;
  /** 指针点按已由 onPointerUp 处理；键盘触发的 click（detail 为 0）走这里。 */
  readonly onKeyboardActivate?: () => void;
  readonly onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly pressed?: boolean;
  readonly uiButtonId: string;
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={label}
      aria-pressed={pressed}
      className={cm(styles, active ? "canvas-tool-rail-button is-active" : "canvas-tool-rail-button")}
      data-ui-button-id={uiButtonId}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail === 0) {
          onKeyboardActivate?.();
        }
        onActivate?.(event.currentTarget.getBoundingClientRect());
      }}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerDown={stopTouchPointerDownPropagation}
      onPointerUp={onPointerUp ?? stopUiPropagation}
      title={hint === null || hint === "" ? label : `${label} (${hint})`}
      type="button"
    >
      <span aria-hidden="true" className={cm(styles, "canvas-tool-rail-button-icon")}>{children}</span>
    </button>
  );
}
