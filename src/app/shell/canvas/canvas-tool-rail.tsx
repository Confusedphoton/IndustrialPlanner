import { observer } from "mobx-react-lite";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from "react";
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
 * 画布左缘常驻的笔工具条：编辑工具、撤销/重做与快速放置，始终在落笔处附近，
 * 不随左侧面板切换或滚动而消失。
 */
export const CanvasToolRail = observer(function CanvasToolRail({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  // 订阅 document 变化使管道按钮在切换基地后正确显示/隐藏
  useEditorDocumentSnapshot(editor, selectDocumentBaseId, Object.is);
  const toolButtons = getVisiblePlacementOperationButtons(appHost);
  const history = editor?.state.history;
  const canUndo = editor !== null && (history?.undoDepth ?? 0) > 0;
  const canRedo = editor !== null && (history?.redoDepth ?? 0) > 0;
  const quickPlaceEnabled = appHost.internalState.settings.quickPlaceEnabled;

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

  return (
    <div
      aria-label={t("toolbar.canvasTools")}
      className={cm(styles, "canvas-tool-rail")}
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
