import { observer } from "mobx-react-lite";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import LucideCornerDownRight from "~icons/lucide/corner-down-right";
import LucideCornerRightDown from "~icons/lucide/corner-right-down";
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
/** 与 .canvas-tool-rail 的 max-height 留白一致。 */
const RAIL_VERTICAL_RESERVE_PX = 24;
const RAIL_ITEM_GAP_PX = 4;
/** 分隔线 1px 加上下各 2px 外边距。 */
const RAIL_DIVIDER_HEIGHT_PX = 5;
const DEFAULT_RAIL_BUTTON_SIZE_PX = 44;

type RailItem =
  | { readonly kind: "button"; readonly key: string; readonly node: ReactNode }
  | { readonly kind: "divider"; readonly key: string };

/**
 * 按每列可用高度把按钮顺序分列；分隔线只出现在列内两组按钮之间。
 * 高度不足时增加列数而不是滚动，所有按钮始终可见、可点按。
 */
function packRailColumns(items: readonly RailItem[], columnBudget: number, buttonSize: number): RailItem[][] {
  const columns: RailItem[][] = [[]];
  let height = 0;
  const trimTrailingDividers = (column: RailItem[]) => {
    while (column.length > 0 && column[column.length - 1]!.kind === "divider") column.pop();
  };
  for (const item of items) {
    const column = columns[columns.length - 1]!;
    const size = item.kind === "button" ? buttonSize : RAIL_DIVIDER_HEIGHT_PX;
    const needed = (column.length > 0 ? RAIL_ITEM_GAP_PX : 0) + size;
    if (item.kind === "divider") {
      if (column.length > 0 && height + needed <= columnBudget) {
        column.push(item);
        height += needed;
      }
      continue;
    }
    if (column.length > 0 && height + needed > columnBudget) {
      trimTrailingDividers(column);
      columns.push([item]);
      height = size;
      continue;
    }
    column.push(item);
    height += needed;
  }
  for (const column of columns) trimTrailingDividers(column);
  return columns.filter((column) => column.length > 0);
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
 * 画布边缘常驻的笔工具条：编辑工具、物流布设的上下文操作、撤销/重做、视图缩放与快速放置，
 * 不随左侧面板切换或滚动而消失。拖动顶部手柄可沿边缘移动，松手时贴靠较近的左缘或右缘，
 * 让工具条留在笔正在工作的一侧。画布高度不足时按钮分成多列。
 */
export const CanvasToolRail = observer(function CanvasToolRail({ appHost }: { appHost: AppHost }) {
  useEffect(() => hookCanvasToolRailPersistence(), []);
  const t = appHost.actions.translate;
  const railRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [dragPosition, setDragPosition] = useState<{ side: CanvasToolRailSide; center: number } | null>(null);
  const [railHeight, setRailHeight] = useState(0);
  const [layoutMetrics, setLayoutMetrics] = useState({ areaHeight: 0, chromeHeight: 0, buttonSize: DEFAULT_RAIL_BUTTON_SIZE_PX });
  const findCanvasPanel = () => railRef.current?.parentElement?.querySelector<HTMLElement>(`.${cm(styles, "canvas-panel")}`) ?? null;

  useLayoutEffect(() => {
    const rail = railRef.current;
    const area = areaRef.current;
    if (rail === null || area === null) {
      return;
    }
    const measure = () => {
      setRailHeight(rail.offsetHeight);
      canvasToolRailState.setWidth(RAIL_EDGE_INSET_PX + rail.offsetWidth);
      const button = rail.querySelector<HTMLElement>(`.${cm(styles, "canvas-tool-rail-button")}`);
      const next = {
        areaHeight: area.offsetHeight,
        // 手柄、内边距与边框占用的固定高度；按列容器的位置计算，不受内容是否被 max-height 截断影响。
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
  const logistics = canvas.state.runtime.logisticsPlacement;
  const inLogisticsPlacement = canvas.state.activeTool === "logistics-placement" && logistics.kind !== null;
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
  const items: RailItem[] = toolButtons.map((button: PlacementOperationButtonDefinition) => {
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

  if (inLogisticsPlacement) {
    const RouteOrderIcon = logistics.routeOrder === "vertical-first" ? LucideCornerDownRight : LucideCornerRightDown;
    items.push(
      { kind: "divider", key: "divider-logistics" },
      {
        kind: "button",
        key: LOGISTICS_ROUTE_ORDER_BUTTON_ID,
        node: (
          <RailButton
            hint={appHost.internalActions.getKeyboardShortcutFor(SHORTCUT_KEY.ROTATE)}
            label={t(logistics.kind === LOGISTICS_KIND.pipe ? "action.changePipeRoutePriority" : "action.changeBeltRoutePriority")}
            onKeyboardActivate={() => dispatchUiButtonKeyboardActivate(LOGISTICS_ROUTE_ORDER_BUTTON_ID)}
            onPointerUp={(event) => dispatchUiButtonPointerUp(event, LOGISTICS_ROUTE_ORDER_BUTTON_ID)}
            uiButtonId={LOGISTICS_ROUTE_ORDER_BUTTON_ID}
          >
            <RouteOrderIcon aria-hidden className={iconClassName} />
          </RailButton>
        ),
      },
      {
        kind: "button",
        key: LOGISTICS_CANCEL_ROUTE_BUTTON_ID,
        node: (
          <RailButton
            disabled={!isDrawingRoute}
            label={t("action.cancelLogisticsRoute")}
            onKeyboardActivate={() => dispatchUiButtonKeyboardActivate(LOGISTICS_CANCEL_ROUTE_BUTTON_ID)}
            onPointerUp={(event) => dispatchUiButtonPointerUp(event, LOGISTICS_CANCEL_ROUTE_BUTTON_ID)}
            uiButtonId={LOGISTICS_CANCEL_ROUTE_BUTTON_ID}
          >
            <LucideX aria-hidden className={iconClassName} />
          </RailButton>
        ),
      },
    );
  }

  items.push(
    { kind: "divider", key: "divider-history" },
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
    { kind: "divider", key: "divider-view" },
    {
      kind: "button",
      key: "zoom-out",
      node: (
        <RailButton
          label={t("action.zoomOut")}
          onActivate={() => zoomCanvasViewportByButton(canvas, -1)}
          uiButtonId="canvas-tool-rail-zoom-out"
        >
          <LucideZoomOut aria-hidden className={iconClassName} />
        </RailButton>
      ),
    },
    {
      kind: "button",
      key: "zoom-in",
      node: (
        <RailButton
          label={t("action.zoomIn")}
          onActivate={() => zoomCanvasViewportByButton(canvas, 1)}
          uiButtonId="canvas-tool-rail-zoom-in"
        >
          <LucideZoomIn aria-hidden className={iconClassName} />
        </RailButton>
      ),
    },
    {
      kind: "button",
      key: "fit-base",
      node: (
        <RailButton
          label={t("action.fitBaseInView")}
          onActivate={() => fitCanvasViewportToBase(canvas)}
          uiButtonId="canvas-tool-rail-fit-base"
        >
          <LucideScan aria-hidden className={iconClassName} />
        </RailButton>
      ),
    },
    {
      kind: "button",
      key: "rotate-view",
      node: <RotateViewRailButton appHost={appHost} />,
    },
  );

  if (quickPlaceEnabled) {
    items.push(
      { kind: "divider", key: "divider-quick-place" },
      {
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
      },
    );
  }

  const columnBudget = layoutMetrics.areaHeight > 0
    ? layoutMetrics.areaHeight - RAIL_VERTICAL_RESERVE_PX - layoutMetrics.chromeHeight
    : Number.POSITIVE_INFINITY;
  const columns = packRailColumns(items, columnBudget, layoutMetrics.buttonSize);

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
        <div className={cm(styles, "canvas-tool-rail-columns")} ref={columnsRef}>
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
  disabled = false,
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
  readonly disabled?: boolean;
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
