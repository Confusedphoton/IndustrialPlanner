import { makeAutoObservable, runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CONFIGURABLE_SHORTCUT_ACTION_SPECS,
  SHORTCUT_ACTION_GROUP_SPECS,
  SHORTCUT_ACTION_SPECS,
  type ShortcutKeyId,
} from "@/app/actions";
import type { AppHost } from "@/app/host";
import type { ShortcutRouteConflict } from "@/app/input/gesture/actions";
import { DialogShell, KeyboardShortcutPrompt, canRenderKeyboardShortcut } from "@/app/shell/shared";

import styles from "./keyboard-shortcut-settings-dialog.module.scss";

interface KeyboardShortcutDialogState {
  visible: boolean;
  maximized: boolean;
  offsetX: number;
  offsetY: number;
  width: number | null;
  height: number | null;
  activeTab: string | null;
}

interface CapturingSlot {
  readonly shortcutId: ShortcutKeyId;
  readonly slotIndex: 0 | 1;
}

interface ShortcutConflict {
  readonly conflicts: readonly ShortcutRouteConflict[];
  readonly currentShortcutId: ShortcutKeyId;
  readonly currentSlotIndex: 0 | 1;
  readonly nextBinding: string;
}

interface KeyboardShortcutSettingsDialogProps {
  readonly appHost: AppHost;
  readonly dialogState: KeyboardShortcutDialogState;
  readonly onClose: () => void;
}

/*
interface KeyboardShortcutSettingDefinition {
  readonly id: ShortcutKeyId;
  readonly labelKey: UiKey;
}

export const KEYBOARD_SHORTCUT_SETTINGS: readonly KeyboardShortcutSettingDefinition[] = [
  { id: SHORTCUT_KEY.OPEN_TOOLBOX, labelKey: "settingsField.shortcut-open-toolbox" },
  { id: SHORTCUT_KEY.PLACE_CONVEYOR, labelKey: "settingsField.shortcut-place-conveyor" },
  { id: SHORTCUT_KEY.PLACE_PIPE, labelKey: "settingsField.shortcut-place-pipe" },
  { id: SHORTCUT_KEY.RESOURCES_POWER, labelKey: "settingsField.shortcut-resources-power" },
  { id: SHORTCUT_KEY.WAREHOUSE, labelKey: "settingsField.shortcut-warehouse" },
  { id: SHORTCUT_KEY.BASIC_PRODUCTION, labelKey: "settingsField.shortcut-basic-production" },
  { id: SHORTCUT_KEY.SYNTHESIS, labelKey: "settingsField.shortcut-synthesis" },
  { id: SHORTCUT_KEY.CHEAT, labelKey: "settingsField.shortcut-cheat" },
  { id: SHORTCUT_KEY.SAVE_BLUEPRINT, labelKey: "settingsField.shortcut-save-blueprint" },
  { id: SHORTCUT_KEY.ROTATE, labelKey: "settingsField.shortcut-rotate" },
  { id: SHORTCUT_KEY.SWITCH_DEVICE_MODE, labelKey: "settingsField.shortcut-switch-device-mode" },
  { id: SHORTCUT_KEY.ROTATE_VIEWPORT, labelKey: "settingsField.shortcut-rotate-viewport" },
  { id: SHORTCUT_KEY.PAN_VIEWPORT_UP, labelKey: "settingsField.shortcut-pan-viewport-up" },
  { id: SHORTCUT_KEY.PAN_VIEWPORT_DOWN, labelKey: "settingsField.shortcut-pan-viewport-down" },
  { id: SHORTCUT_KEY.PAN_VIEWPORT_LEFT, labelKey: "settingsField.shortcut-pan-viewport-left" },
  { id: SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, labelKey: "settingsField.shortcut-pan-viewport-right" },
  { id: SHORTCUT_KEY.MARQUEE, labelKey: "settingsField.shortcut-marquee" },
  { id: SHORTCUT_KEY.DELETE_DEVICE, labelKey: "settingsField.shortcut-delete-device" },
  { id: SHORTCUT_KEY.MOVE_SELECTION, labelKey: "settingsField.shortcut-move-selection" },
  { id: SHORTCUT_KEY.COPY_SELECTION, labelKey: "settingsField.shortcut-copy-selection" },
  { id: SHORTCUT_KEY.PASTE_SELECTION, labelKey: "settingsField.shortcut-paste-selection" },
  { id: SHORTCUT_KEY.UNDO, labelKey: "settingsField.shortcut-undo" },
  { id: SHORTCUT_KEY.REDO, labelKey: "settingsField.shortcut-redo" },
  { id: SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL, labelKey: "settingsField.shortcut-toggle-placement-panel" },
  { id: SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL, labelKey: "settingsField.shortcut-toggle-blueprint-panel" },
  { id: SHORTCUT_KEY.TOGGLE_BASE_PANEL, labelKey: "settingsField.shortcut-toggle-base-panel" },
];
*/
// CONFIGURABLE_SHORTCUT_ACTION_SPECS 派生；SHORTCUT_ACTION_SPECS 仅用于解析全部冲突 Action 名称。
export const KEYBOARD_SHORTCUT_SETTINGS = CONFIGURABLE_SHORTCUT_ACTION_SPECS;

const KEYBOARD_SHORTCUT_ACTION_BY_ID = new Map(
  SHORTCUT_ACTION_SPECS.map((action) => [action.id, action]),
);

export const KeyboardShortcutSettingsDialog = observer(function KeyboardShortcutSettingsDialog({
  appHost,
  dialogState,
  onClose,
}: KeyboardShortcutSettingsDialogProps) {
  const t = appHost.actions.translate;
  const [capturingSlot, setCapturingSlot] = useState<CapturingSlot | null>(null);
  const [conflict, setConflict] = useState<ShortcutConflict | null>(null);
  const pendingModifierRef = useRef<string | null>(null);
  const resetConfirmDialogState = useMemo(() => makeAutoObservable<KeyboardShortcutDialogState>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  useEffect(() => {
    if (dialogState.visible) {
      return;
    }

    setCapturingSlot(null);
    setConflict(null);
    pendingModifierRef.current = null;
    runInAction(() => {
      resetConfirmDialogState.visible = false;
    });
  }, [dialogState.visible, resetConfirmDialogState]);

  const closeDialog = useCallback(() => {
    setCapturingSlot(null);
    setConflict(null);
    pendingModifierRef.current = null;
    runInAction(() => {
      resetConfirmDialogState.visible = false;
    });
    onClose();
  }, [onClose, resetConfirmDialogState]);

  const updateSlot = useCallback((
    shortcutId: ShortcutKeyId,
    slotIndex: 0 | 1,
    nextBinding: string,
  ) => {
    const currentValue = appHost.internalActions.getKeyboardShortcutFor(shortcutId);
    const slots = splitShortcutSlots(currentValue);
    slots[slotIndex] = nextBinding;
    appHost.internalActions.setShortcutFor(shortcutId, serializeShortcutSlots(slots));
  }, [appHost]);

  const commitCapturedBinding = useCallback((
    slot: CapturingSlot,
    nextBinding: string,
  ) => {
    const conflicts = appHost.gestureActionRouter.findShortcutConflicts({
      shortcutId: slot.shortcutId,
      slotIndex: slot.slotIndex,
      nextBinding,
    });
    pendingModifierRef.current = null;
    setCapturingSlot(null);

    if (conflicts.length > 0) {
      setConflict({
        conflicts,
        currentShortcutId: slot.shortcutId,
        currentSlotIndex: slot.slotIndex,
        nextBinding,
      });
      return;
    }

    updateSlot(slot.shortcutId, slot.slotIndex, nextBinding);
  }, [appHost, updateSlot]);

  const handleWindowKeyDown = useCallback((event: KeyboardEvent) => {
    if (capturingSlot === null) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      pendingModifierRef.current = null;
      setCapturingSlot(null);
      return true;
    }

    const modifierLabel = normalizeCapturedModifierLabel(event.key);
    if (modifierLabel !== null) {
      pendingModifierRef.current = hasOtherActiveModifier(event, modifierLabel)
        ? null
        : modifierLabel;
      return true;
    }

    pendingModifierRef.current = null;

    const nextBinding = formatCapturedKeybinding(event);
    if (nextBinding === null || !canRenderKeyboardShortcut(nextBinding)) {
      return true;
    }

    commitCapturedBinding(capturingSlot, nextBinding);
    return true;
  }, [capturingSlot, commitCapturedBinding]);

  const handleWindowKeyUp = useCallback((event: KeyboardEvent) => {
    if (capturingSlot === null || pendingModifierRef.current === null) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    const modifierLabel = normalizeCapturedModifierLabel(event.key);
    if (modifierLabel !== pendingModifierRef.current) {
      return true;
    }

    if (canRenderKeyboardShortcut(modifierLabel)) {
      commitCapturedBinding(capturingSlot, modifierLabel);
    }
    return true;
  }, [capturingSlot, commitCapturedBinding]);

  const confirmConflict = useCallback(() => {
    if (conflict === null) {
      return;
    }

    if (conflict.conflicts.some((item) => item.kind === "fixed")) {
      return;
    }

    runInAction(() => {
      for (const item of conflict.conflicts) {
        if (item.shortcutId !== undefined && item.slotIndex !== undefined) {
          updateSlot(item.shortcutId, item.slotIndex, "");
        }
      }
      updateSlot(conflict.currentShortcutId, conflict.currentSlotIndex, conflict.nextBinding);
    });
    setConflict(null);
  }, [conflict, updateSlot]);

  const confirmReset = useCallback(() => {
    appHost.internalActions.resetAllShortcutsToDefaults();
    runInAction(() => {
      resetConfirmDialogState.visible = false;
    });
  }, [appHost, resetConfirmDialogState]);

  return (
    <>
      <DialogShell
        bodyClassName={styles["keyboard-shortcut-dialog-body"]}
        className="keyboard-shortcut-settings-dialog"
        closeTitle={t("action.close")}
        compactMobileLayout={appHost.state.screenProfile.deviceClass === "mobile"}
        dialogKey="keyboard-shortcut-settings"
        dialogState={dialogState}
        immersiveMaximized={dialogState.maximized && appHost.state.screenProfile.deviceClass !== "desktop"}
        maximizeTitle={t("dialog.maximize")}
        onClose={closeDialog}
        onOffsetChange={(offsetX, offsetY) => {
          runInAction(() => {
            dialogState.offsetX = offsetX;
            dialogState.offsetY = offsetY;
          });
        }}
        onResize={(width, height) => {
          runInAction(() => {
            dialogState.width = width;
            dialogState.height = height;
          });
        }}
        onToggleMaximized={() => {
          runInAction(() => {
            dialogState.maximized = !dialogState.maximized;
          });
        }}
        onWindowKeyDown={handleWindowKeyDown}
        onWindowKeyUp={handleWindowKeyUp}
        restoreTitle={t("dialog.restore")}
        title={t("keyboardShortcutDialog.title")}
        titleId="keyboard-shortcut-settings-dialog-title"
      >
        <div className={styles["keyboard-shortcut-list"]}>
          <div className={styles["keyboard-shortcut-list-header"]}>
            <span>{t("keyboardShortcutDialog.actionColumn")}</span>
            <div className={styles["keyboard-shortcut-list-header-slots"]}>
              <span>{t("keyboardShortcutDialog.primaryColumn")}</span>
              <span>{t("keyboardShortcutDialog.secondaryColumn")}</span>
            </div>
          </div>
          {SHORTCUT_ACTION_GROUP_SPECS.map((group) => {
            const groupTitleId = `keyboard-shortcut-group-${group.id}-title`;
            const settings = KEYBOARD_SHORTCUT_SETTINGS.filter((setting) => setting.group === group.id);

            return (
              <section
                aria-labelledby={groupTitleId}
                className={styles["keyboard-shortcut-group"]}
                data-shortcut-group={group.id}
                key={group.id}
              >
                <h2 className={styles["keyboard-shortcut-group-title"]} id={groupTitleId}>
                  {t(group.labelKey)}
                </h2>
                {settings.map((setting) => {
                  const slots = splitShortcutSlots(
                    appHost.internalActions.getKeyboardShortcutFor(setting.id),
                  );

                  return (
                    <article className={styles["keyboard-shortcut-row"]} key={setting.id}>
                      <h3 className={styles["keyboard-shortcut-label"]}>{t(setting.labelKey)}</h3>
                      <div className={styles["keyboard-shortcut-slots"]}>
                        {slots.map((binding, slotIndex) => {
                          const normalizedSlotIndex = slotIndex as 0 | 1;
                          const isCapturing = capturingSlot?.shortcutId === setting.id
                            && capturingSlot.slotIndex === normalizedSlotIndex;
                          const slotLabel = t("keyboardShortcutDialog.slotLabel")
                            .replace("{index}", String(slotIndex + 1));

                          return (
                            <div
                              className={styles["keyboard-shortcut-slot"]}
                              data-empty={binding === ""}
                              key={normalizedSlotIndex}
                            >
                              <button
                                aria-label={`${t(setting.labelKey)} · ${slotLabel} · ${
                                  binding === "" ? t("keyboardShortcutDialog.unassigned") : binding
                                }`}
                                aria-pressed={isCapturing}
                                className={isCapturing
                                  ? `${styles["keyboard-shortcut-slot-button"]} ${styles["is-capturing"]}`
                                  : styles["keyboard-shortcut-slot-button"]}
                                data-shortcut-id={setting.id}
                                data-slot-index={normalizedSlotIndex}
                                onClick={() => {
                                  pendingModifierRef.current = null;
                                  setCapturingSlot({
                                    shortcutId: setting.id,
                                    slotIndex: normalizedSlotIndex,
                                  });
                                }}
                                type="button"
                              >
                                {isCapturing ? (
                                  <span className={styles["keyboard-shortcut-capture-text"]}>
                                    {t("settingsKeybinding.awaitingInput")}
                                  </span>
                                ) : binding === "" ? (
                                  <span className={styles["keyboard-shortcut-empty-text"]}>
                                    {t("keyboardShortcutDialog.unassigned")}
                                  </span>
                                ) : (
                                  <KeyboardShortcutPrompt shortcut={binding} size="small" />
                                )}
                              </button>
                              {binding === "" ? null : (
                                <button
                                  aria-label={`${t("keyboardShortcutDialog.clearSlot")} · ${t(setting.labelKey)} · ${slotLabel}`}
                                  className={styles["keyboard-shortcut-clear-button"]}
                                  onClick={() => {
                                    updateSlot(setting.id, normalizedSlotIndex, "");
                                  }}
                                  title={t("keyboardShortcutDialog.clearSlot")}
                                  type="button"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
        <div className={styles["keyboard-shortcut-footer"]}>
          <button
            className={styles["keyboard-shortcut-reset-button"]}
            onClick={() => {
              runInAction(() => {
                resetConfirmDialogState.visible = true;
              });
            }}
            type="button"
          >
            {t("keyboardShortcutDialog.resetAll")}
          </button>
        </div>
      </DialogShell>
      {conflict === null ? null : (
        <KeyboardShortcutConflictDialog
          conflict={conflict}
          onCancel={() => setConflict(null)}
          onConfirm={confirmConflict}
          t={t}
        />
      )}
      {resetConfirmDialogState.visible ? (
        <KeyboardShortcutResetDialog
          dialogState={resetConfirmDialogState}
          onCancel={() => {
            runInAction(() => {
              resetConfirmDialogState.visible = false;
            });
          }}
          onConfirm={confirmReset}
          t={t}
        />
      ) : null}
    </>
  );
});

function KeyboardShortcutConflictDialog({
  conflict,
  onCancel,
  onConfirm,
  t,
}: {
  readonly conflict: ShortcutConflict;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly t: AppHost["actions"]["translate"];
}) {
  const dialogState = useMemo(() => makeAutoObservable<KeyboardShortcutDialogState>({
    visible: true,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 440,
    height: null,
    activeTab: null,
  }), []);
  const hasFixedConflict = conflict.conflicts.some((item) => item.kind === "fixed");
  const conflictLabel = conflict.conflicts.map((item) => {
    const definition = KEYBOARD_SHORTCUT_ACTION_BY_ID.get(item.actionId);
    const actionLabel = definition === undefined ? item.actionId : t(definition.labelKey);
    return `${actionLabel}（${item.binding}）`;
  }).join("、");

  return (
    <DialogShell
      bodyClassName={styles["keyboard-shortcut-confirm-body"]}
      className="keyboard-shortcut-conflict-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="keyboard-shortcut-conflict"
      dialogState={dialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      shellStyle={{ height: "auto", minHeight: 0 }}
      showMaximizeButton={false}
      title={t("settingsKeybinding.conflictTitle")}
      titleId="keyboard-shortcut-conflict-dialog-title"
    >
      <div className={styles["keyboard-shortcut-confirm-content"]}>
        <p className={styles["keyboard-shortcut-conflict-message"]}>
          <span>{t("keyboardShortcutDialog.conflictPrefix")}</span>
          <KeyboardShortcutPrompt shortcut={conflict.nextBinding} />
          <span>
            {t(hasFixedConflict
              ? "keyboardShortcutDialog.conflictFixedSuffix"
              : "keyboardShortcutDialog.conflictSuffix")
              .replace("{conflictLabel}", conflictLabel)}
          </span>
        </p>
        <div className={styles["keyboard-shortcut-confirm-actions"]}>
          <button onClick={onCancel} type="button">{t("settingsKeybinding.conflictCancel")}</button>
          {hasFixedConflict ? null : (
            <button className={styles["is-primary"]} onClick={onConfirm} type="button">
              {t("settingsKeybinding.conflictReplace")}
            </button>
          )}
        </div>
      </div>
    </DialogShell>
  );
}

function KeyboardShortcutResetDialog({
  dialogState,
  onCancel,
  onConfirm,
  t,
}: {
  readonly dialogState: KeyboardShortcutDialogState;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly t: AppHost["actions"]["translate"];
}) {
  return (
    <DialogShell
      bodyClassName={styles["keyboard-shortcut-confirm-body"]}
      className="keyboard-shortcut-reset-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="keyboard-shortcut-reset"
      dialogState={dialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      shellStyle={{ height: "auto", minHeight: 0 }}
      showMaximizeButton={false}
      title={t("keyboardShortcutDialog.resetAll")}
      titleId="keyboard-shortcut-reset-dialog-title"
    >
      <div className={styles["keyboard-shortcut-confirm-content"]}>
        <p>{t("keyboardShortcutDialog.resetAllConfirm")}</p>
        <div className={styles["keyboard-shortcut-confirm-actions"]}>
          <button onClick={onCancel} type="button">{t("action.cancel")}</button>
          <button className={styles["is-primary"]} onClick={onConfirm} type="button">
            {t("keyboardShortcutDialog.resetAll")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}


function splitShortcutSlots(value: string): [string, string] {
  const [first = "", second = ""] = value.split(";", 2);

  return [first.trim(), second.trim()];
}

function serializeShortcutSlots(slots: readonly [string, string]): string {
  if (slots[1] === "") {
    return slots[0];
  }

  return `${slots[0]};${slots[1]}`;
}

function formatCapturedKeybinding(event: KeyboardEvent): string | null {
  if (isModifierOnlyKey(event.key)) {
    return null;
  }

  const keyLabel = normalizeCapturedKeyLabel(event.key);
  if (keyLabel === null || keyLabel === "Esc") {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  if (!parts.includes(keyLabel)) parts.push(keyLabel);

  return parts.join("+");
}

function normalizeCapturedKeyLabel(key: string): string | null {
  if (key === "") return null;
  if (key === " ") return "Space";
  if (key === "Escape") return "Esc";
  if (key === "+") return "Plus";
  if (key === "-") return "Minus";
  if (key === "=") return "Equals";
  if (key.length === 1) return key.toUpperCase();

  return key;
}

function isModifierOnlyKey(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}

function normalizeCapturedModifierLabel(key: string): string | null {
  if (key === "Control") return "Ctrl";
  if (key === "Shift") return "Shift";
  if (key === "Alt") return "Alt";
  if (key === "Meta") return "Meta";

  return null;
}

function hasOtherActiveModifier(event: KeyboardEvent, currentModifier: string): boolean {
  return (currentModifier !== "Ctrl" && event.ctrlKey)
    || (currentModifier !== "Shift" && event.shiftKey)
    || (currentModifier !== "Alt" && event.altKey)
    || (currentModifier !== "Meta" && event.metaKey);
}

/*
function normalizeKeybindingForConflict(binding: string): string | null {
  const tokens = binding
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== "");

  if (tokens.length === 0) {
    return null;
  }

  const modifiers = tokens
    .filter((token) => isNormalizedModifier(token))
    .map((token) => normalizeModifier(token))
    .sort();
  const primaryKeys = tokens.filter((token) => !isNormalizedModifier(token));
  if (primaryKeys.length !== 1) {
    return null;
  }

  return [...modifiers, primaryKeys[0]].join("+");
}

function isNormalizedModifier(token: string): boolean {
  return token === "alt"
    || token === "option"
    || token === "ctrl"
    || token === "control"
    || token === "meta"
    || token === "cmd"
    || token === "command"
    || token === "shift";
}

function normalizeModifier(token: string): string {
  if (token === "option") return "alt";
  if (token === "control") return "ctrl";
  if (token === "cmd" || token === "command") return "meta";

  return token;
}
*/
