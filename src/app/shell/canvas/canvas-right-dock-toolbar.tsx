import type { CanvasOperationId } from "@/domain/shared/canvas-operation";
import { observer } from "mobx-react-lite";

import type { CanvasInteractionController } from "@/app/canvas";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { KeyboardShortcutPrompt, MouseShortcutPrompt } from "@/app/shell/shared";
import type {
  CanvasRightDockToolbarButtonId,
  CanvasRightDockToolbarItemRequest,
} from "@/app/state/state-impl";
import type { UiKey } from "@/shared/i18n";
import {
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { useLastInputKind } from "@/app/shell/shared/use-last-input-kind";
import {
  resolveCanvasRightDockToolbarShortcut,
  type CanvasRightDockToolbarShortcutDefinition,
} from "./canvas-right-dock-toolbar-shortcut";

type CanvasRightDockToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasRightDockToolbarTone = "exit";


interface CanvasRightDockToolbarButtonDefinition {
  readonly buttonId: CanvasRightDockToolbarButtonId;
  readonly icon: CanvasRightDockToolbarIconKind;
  readonly tone?: CanvasRightDockToolbarTone;
}


interface CanvasRightDockToolbarDefinition {
  readonly labelKey: UiKey;
  readonly button?: CanvasRightDockToolbarButtonDefinition;
  readonly shortcut?: CanvasRightDockToolbarShortcutDefinition;
}

interface CanvasRightDockToolbarProps {
  canvas: CanvasInteractionController;
  items: readonly CanvasRightDockToolbarItemRequest[];
}

const CANVAS_RIGHT_DOCK_TOOLBAR_DEFINITIONS: Partial<Record<
  CanvasOperationId,
  CanvasRightDockToolbarDefinition
>> = {
  exit: {
    labelKey: "action.exit",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-exit",
      icon: "cancel",
      tone: "exit",
    },
    shortcut: {
      parts: [{ kind: "fixed-key", value: "Esc" }],
    },
  },
  move: {
    labelKey: "tool.move",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-move",
      icon: "move",
    },
    shortcut: {
      parts: [
        { kind: "fixed-label", labelKey: "input.mouseLongPress" },
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.MOVE_SELECTION,
        },
      ],
      separator: "alternative",
    },
  },
  "save-blueprint": {
    labelKey: "action.saveBlueprint",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-save-blueprint",
      icon: "save-blueprint",
    },
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.SAVE_BLUEPRINT }],
    },
  },
  copy: {
    labelKey: "action.copySelection",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-copy",
      icon: "copy",
    },
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.COPY_SELECTION }],
    },
  },
  delete: {
    labelKey: "action.deleteSelection",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-delete",
      icon: "delete",
    },
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.DELETE_DEVICE }],
    },
  },
  "pan-viewport": {
    labelKey: "action.panViewport",
    shortcut: {
      rows: [
        {
          groups: [
            {
              parts: [
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_UP, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_LEFT, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_DOWN, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, slotIndex: 0 },
              ],
              separator: "gap",
            },
            {
              parts: [
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_UP, slotIndex: 1 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_LEFT, slotIndex: 1 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_DOWN, slotIndex: 1 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, slotIndex: 1 },
              ],
              separator: "gap",
            },
          ],
          separator: "alternative",
        },
        {
          groups: [
            {
              parts: [{ kind: "fixed-key", value: "Shift" }],
            },
            {
              parts: [
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_UP, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_LEFT, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_DOWN, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, slotIndex: 0 },
              ],
              separator: "gap",
            },
          ],
          separator: "plus",
        },
      ],
    },
  },
  "zoom-viewport": {
    labelKey: "action.zoomViewport",
    shortcut: {
      parts: [{ kind: "mouse", input: "wheel" }],
    },
  },
  "switch-device-variant": {
    labelKey: "action.switchDeviceVariant",
    shortcut: {
      parts: [{
        kind: "shortcut-key",
        shortcutKeyId: SHORTCUT_KEY.SWITCH_DEVICE_MODE,
      }],
    },
  },
  "rotate-placement": {
    labelKey: "action.rotateDevice",
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.ROTATE }],
    },
  },
  "confirm-placement": {
    labelKey: "action.confirmPlacement",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "continuous-placement": {
    labelKey: "action.continuousPlacement",
    shortcut: {
      parts: [
        { kind: "fixed-key", value: "Ctrl" },
        { kind: "mouse", input: "left-button" },
      ],
      separator: "plus",
    },
  },
  "delete-device": {
    labelKey: "action.deleteDevice",
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.DELETE_DEVICE }],
    },
  },
  "cancel-placement": {
    labelKey: "action.cancelPlacement",
    shortcut: {
      parts: [{ kind: "fixed-key", value: "Esc" }],
    },
  },
  "confirm-logistics-start": {
    labelKey: "action.confirmLogisticsStart",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "confirm-logistics-end": {
    labelKey: "action.confirmLogisticsEnd",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "change-belt-route-priority": {
    labelKey: "action.changeBeltRoutePriority",
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.ROTATE }],
    },
  },
  "change-pipe-route-priority": {
    labelKey: "action.changePipeRoutePriority",
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.ROTATE }],
    },
  },
  "toggle-marquee-selection": {
    labelKey: "action.selectOrDeselect",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "marquee-select": {
    labelKey: "action.marqueeSelect",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "marquee-deselect": {
    labelKey: "action.marqueeDeselect",
    shortcut: {
      parts: [{ kind: "mouse", input: "right-button" }],
    },
  },
  "exit-marquee": {
    labelKey: "action.exitMarquee",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-exit",
      icon: "cancel",
      tone: "exit",
    },
    shortcut: {
      parts: [
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.MARQUEE,
        },
        { kind: "fixed-key", value: "Esc" },
      ],
      separator: "alternative",
    },
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export const CanvasRightDockToolbar = observer(function CanvasRightDockToolbar({
  canvas,
  items,
}: CanvasRightDockToolbarProps) {
  const t = canvas.workbench.actions.translate;
  const showShortcuts = useLastInputKind() === "pointer";

  const visibleItems = items.flatMap((item) => {
    const availability = canvas.getOperationAvailability(item.operationId);
    if (!availability.supported) return [];
    const definition = CANVAS_RIGHT_DOCK_TOOLBAR_DEFINITIONS[item.operationId];
    if (definition === undefined) return [];
    const wantsButton = item.presentation === "button" || item.presentation === "both";
    const wantsShortcut = item.presentation === "shortcut" || item.presentation === "both";
    const button = wantsButton ? definition.button ?? null : null;
    const shortcut = wantsShortcut && showShortcuts && definition.shortcut
      ? resolveCanvasRightDockToolbarShortcut(
        definition.shortcut,
        canvas.workbench.internalActions.getKeyboardShortcutFor,
      )
      : null;


    if (button === null && shortcut === null) {
      return [];
    }

    return [{
      availability,
      button,
      definition,
      operationId: item.operationId,
      presentation: item.presentation,
      shortcut,
    }];
  });

  if (visibleItems.length === 0) {
    return null;
  }


  const stopUiPropagation = (
    event:
      | ReactMouseEvent<HTMLElement>
      | ReactPointerEvent<HTMLElement>
      | ReactWheelEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
  };

  const stopUiPropagationAndDefault = (
    event: ReactMouseEvent<HTMLElement> | ReactWheelEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const stopTouchPointerDownPropagation = (event: ReactPointerEvent<HTMLElement>) => {
    preventTouchPointerCompatibilityMouseEvents(event);
    event.stopPropagation();
  };

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: CanvasRightDockToolbarButtonId,
  ) => {
    event.stopPropagation();


    if (event.pointerType === "mouse") {
      canvas.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: buttonId,
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      canvas.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: buttonId,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };


  return (
    <div
      aria-label={t("toolbar.canvasRightDock")}
      className={cm(styles, "canvas-right-dock-toolbar")}
      onAuxClick={stopUiPropagationAndDefault}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerCancel={stopUiPropagation}
      onPointerDown={stopUiPropagation}
      onPointerMove={stopUiPropagation}
      onPointerUp={stopUiPropagation}
      onWheel={stopUiPropagationAndDefault}
    >
      {visibleItems.map(({ button, definition, operationId, presentation, shortcut, availability }) => {
        const label = t(definition.labelKey);

        const contents = (
          <>
            {button === null ? null : (
              <WorkbenchIcon
                className={cm(styles, "canvas-right-dock-toolbar-icon")}
                kind={button.icon}
              />
            )}
            {shortcut === null ? null : (
              <>
                <span className={cm(styles, "canvas-right-dock-toolbar-shortcut-prompt")}>
                  {shortcut.rows === undefined ? (
                    shortcut.parts.map((part, partIndex) => (
                      <span
                        className={cm(styles, "canvas-right-dock-toolbar-shortcut-part")}
                        key={`${operationId}-${part.kind}-${partIndex}`}
                      >
                        {partIndex > 0 && shortcut.separator !== "gap" ? (
                          <span
                            aria-hidden="true"
                            className={cm(styles, "canvas-right-dock-toolbar-shortcut-separator")}
                          >
                            {shortcut.separator === "plus" ? "+" : "/"}
                          </span>
                        ) : null}
                        {part.kind === "keyboard" ? (
                          <KeyboardShortcutPrompt shortcut={part.value} size="small" />
                        ) : part.kind === "mouse" ? (
                          <MouseShortcutPrompt input={part.input} size="small" />
                        ) : (
                          <span
                            className={cm(styles, "canvas-right-dock-toolbar-shortcut-label")}
                          >
                            {t(part.labelKey)}
                          </span>
                        )}
                      </span>
                    ))
                  ) : (
                    <span className={cm(styles, "canvas-right-dock-toolbar-shortcut-rows")}>
                      {shortcut.rows.map((row, rowIndex) => (
                        <span
                          className={cm(styles, "canvas-right-dock-toolbar-shortcut-row")}
                          data-shortcut-row-index={rowIndex}
                          key={`${operationId}-row-${rowIndex}`}
                        >
                          {row.groups.map((group, groupIndex) => (
                            <span
                              className={cm(styles, "canvas-right-dock-toolbar-shortcut-group")}
                              key={`${operationId}-row-${rowIndex}-group-${groupIndex}`}
                            >
                              {groupIndex > 0 && row.separator !== "gap" ? (
                                <span
                                  aria-hidden="true"
                                  className={cm(styles, "canvas-right-dock-toolbar-shortcut-separator")}
                                >
                                  {row.separator === "plus" ? "+" : "/"}
                                </span>
                              ) : null}
                              {group.parts.map((part, partIndex) => (
                                <span
                                  className={cm(styles, "canvas-right-dock-toolbar-shortcut-part")}
                                  key={`${operationId}-row-${rowIndex}-group-${groupIndex}-${part.kind}-${partIndex}`}
                                >
                                  {partIndex > 0 && group.separator !== "gap" ? (
                                    <span
                                      aria-hidden="true"
                                      className={cm(styles, "canvas-right-dock-toolbar-shortcut-separator")}
                                    >
                                      {group.separator === "plus" ? "+" : "/"}
                                    </span>
                                  ) : null}
                                  {part.kind === "keyboard" ? (
                                    <KeyboardShortcutPrompt shortcut={part.value} size="small" />
                                  ) : part.kind === "mouse" ? (
                                    <MouseShortcutPrompt input={part.input} size="small" />
                                  ) : (
                                    <span
                                      className={cm(styles, "canvas-right-dock-toolbar-shortcut-label")}
                                    >
                                      {t(part.labelKey)}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </span>
                          ))}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </>
            )}
            <span
              className={cm(
                styles,
                shortcut === null
                  ? "canvas-right-dock-toolbar-label"
                  : "canvas-right-dock-toolbar-label--glow",
              )}
            >
              {label}
            </span>
          </>
        );

        if (button === null) {
          return (
            <div
              aria-label={label}
              className={cm(styles, "canvas-right-dock-toolbar-shortcut")}
              data-toolbar-operation-id={operationId}
              data-toolbar-presentation={presentation}
              key={operationId}
            >
              {contents}
            </div>
          );
        }

        return (
          <button
            disabled={!availability.enabled}
            aria-label={label}
            className={cm(styles, joinClassNames([
              "canvas-right-dock-toolbar-button",
              button.tone ? `is-${button.tone}` : undefined,
            ]))}
            data-toolbar-operation-id={operationId}
            data-toolbar-presentation={presentation}
            data-ui-button-id={button.buttonId}
            key={operationId}
            onClick={stopUiPropagation}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopTouchPointerDownPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, button.buttonId);
            }}
            type="button"
          >
            {contents}
          </button>
        );
      })}
    </div>
  );
});
