import { observer } from "mobx-react-lite";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import LucideGripHorizontal from "~icons/lucide/grip-horizontal";
import LucideZap from "~icons/lucide/zap";
import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import type { AppHost } from "@/app/host/app-host";
import { openQuickPlace } from "@/app/input/gesture/actions";
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
 * 画布边缘常驻的笔工具条：编辑工具、撤销/重做与快速放置，不随左侧面板切换或滚动而消失。
 * 拖动顶部手柄可沿边缘移动，松手时贴靠较近的左缘或右缘，让工具条留在笔正在工作的一侧。
 */
export const CanvasToolRail = observer(function CanvasToolRail({ appHost }: { appHost: AppHost }) {
  useEffect(() => hookCanvasToolRailPersistence(), []);
  const t = appHost.actions.translate;
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragPosition, setDragPosition] = useState<{ side: CanvasToolRailSide; center: number } | null>(null);
  const [railHeight, setRailHeight] = useState(0);
  useEffect(() => {
    const element = railRef.current;
    if (element === null) {
      return;
    }
    setRailHeight(element.offsetHeight);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => setRailHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const side = dragPosition?.side ?? canvasToolRailState.side;
  const center = dragPosition?.center ?? canvasToolRailState.center;
  const editor = appHost.workspace.editor;
  // 订阅 document 变化使管道按钮在切换基地后正确显示/隐藏
  useEditorDocumentSnapshot(editor, selectDocumentBaseId, Object.is);
  const toolButtons = getVisiblePlacementOperationButtons(appHost);
  const history = editor?.state.history;
  const canUndo = editor !== null && (history?.undoDepth ?? 0) > 0;
  const canRedo = editor !== null && (history?.redoDepth ?? 0) > 0;
  const quickPlaceEnabled = appHost.internalState.settings.quickPlaceEnabled;

  const resolveDragPosition = (clientX: number, clientY: number) => {
    const canvasRect = railRef.current?.parentElement?.querySelector(`.${cm(styles, "canvas-panel")}`)?.getBoundingClientRect();
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

  const handleToolPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    button: PlacementOperationButtonDefinition,
  ) => {
    event.stopPropagation();
    const modifiers = {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    };

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({ uiButtonId: button.uiButtonId, button: event.button, ...modifiers });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({ uiButtonId: button.uiButtonId, ...modifiers });
    }
  };

  const handleToolKeyboardActivate = (button: PlacementOperationButtonDefinition) => {
    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: button.uiButtonId,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
  };

  return (
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
      {toolButtons.map((button) => {
        const isActive = button.activeWhen?.(appHost) ?? false;
        const hotkey = button.hotkey
          ?? (button.hotkeyKeyId ? appHost.internalActions.getKeyboardShortcutFor(button.hotkeyKeyId) : null);
        return (
          <RailButton
            active={isActive}
            hint={hotkey}
            key={button.uiButtonId}
            label={t(button.labelKey)}
            onKeyboardActivate={() => handleToolKeyboardActivate(button)}
            onPointerUp={(event) => handleToolPointerUp(event, button)}
            pressed={button.activeWhen ? isActive : undefined}
            uiButtonId={button.uiButtonId}
          >
            {button.icon ? (
              <WorkbenchIcon className={cm(styles, "canvas-tool-rail-icon")} kind={button.icon} />
            ) : button.iconSrc ? (
              <img alt="" className={cm(styles, "canvas-tool-rail-image")} src={button.iconSrc} />
            ) : null}
          </RailButton>
        );
      })}
      <span aria-hidden="true" className={cm(styles, "canvas-tool-rail-divider")} />
      <RailButton
        disabled={!canUndo}
        label={t("workbench.button.undo")}
        onActivate={() => editor?.actions.undoDocumentHistory()}
        uiButtonId="canvas-tool-rail-undo"
      >
        <WorkbenchIcon className={cm(styles, "canvas-tool-rail-icon")} kind="undo" />
      </RailButton>
      <RailButton
        disabled={!canRedo}
        label={t("workbench.button.redo")}
        onActivate={() => editor?.actions.redoDocumentHistory()}
        uiButtonId="canvas-tool-rail-redo"
      >
        <WorkbenchIcon className={cm(styles, "canvas-tool-rail-icon")} kind="redo" />
      </RailButton>
      {quickPlaceEnabled ? (
        <>
          <span aria-hidden="true" className={cm(styles, "canvas-tool-rail-divider")} />
          <RailButton
            active={appHost.mainCanvas.state.runtime.quickPlace.visible}
            label={t("workbench.quickPlace.title")}
            onActivate={(rect) => openQuickPlace(appHost.mainCanvas, { x: rect.right + 12, y: rect.top }, "pointer")}
            uiButtonId="canvas-tool-rail-quick-place"
          >
            <LucideZap aria-hidden className={cm(styles, "canvas-tool-rail-icon")} />
          </RailButton>
        </>
      ) : null}
    </div>
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
