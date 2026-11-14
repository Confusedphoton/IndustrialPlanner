import { type ReactNode, useMemo } from "react";

import { SHORTCUT_KEY } from "@/app/actions";
import type { AppSettings } from "@/domain/app/types/app-types";
import type { DeviceClass } from "@/domain/app/types/screen-profile";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { KeyboardShortcutPrompt } from "@/app/shell/shared";

type ShortcutResolver = (key: string) => string;

interface GuideRow {
  /** 操作名称 */
  label: string;
  /** PC 键鼠操作说明（null 表示不可用） */
  pc: ReactNode | null;
  /** 移动端触控操作说明（null 表示不可用） */
  touch: string | null;
  /** 若为快捷键操作，提供 SHORTCUT_KEY 常量来获取当前绑定值 */
  shortcutKey?: string;
}

interface GuideGroup {
  title: string;
  rows: GuideRow[];
}

interface SettingsSnapshot {
  /** 鹰角操作模式总开关 */
  /** 立即拖动（左键拖拽选中设备直接移动） */
  immediateMove: boolean;
  /** 立即框选（左键拖拽空白区域直接框选） */
  immediateMarquee: boolean;
}

function buildGuideData(
  resolveShortcut: ShortcutResolver,
  ss: SettingsSnapshot,
  // 操作说明文案改走 i18n。
  tr: (key: string) => string,
): GuideGroup[] {
  const s = (key: string): string => resolveShortcut(key);
  const keyboard = (shortcut: string): ReactNode => (
    <KeyboardShortcutPrompt shortcut={shortcut} />
  );

  // ── 根据设置推导 PC 端操作说明 ──

  // 平移画布：鹰角模式下若"立即框选"未开，左键拖空白也会平移
  const panPC: string = !ss.immediateMarquee
    ? tr("guide.leftDragEmptySpaceMiddleDrag")
    : tr("guide.middleDrag");

  // 框选：鹰角模式下若"立即框选"未开，需要先进入批量选择模式
  const marqueePC: string = !ss.immediateMarquee
    ? tr("guide.enterBatchSelectThenLeftDrag")
    : tr("guide.leftDragARectangle");
  const marqueeTouch: string = !ss.immediateMarquee
    ? tr("guide.enterBatchSelectThenLongPress")
    : tr("guide.longPressThenDragARectangle");

  // 移动已选中设备
  const movePC: string = !ss.immediateMove
    ? tr("guide.longPressASelectedDeviceThen")
    : tr("guide.leftDragASelectedDevice");

  return [
    {
      title: tr("guide.canvas"),
      rows: [
        { label: tr("guide.pan"), pc: panPC, touch: tr("guide.swipeOneFingerOnEmptySpace") },
        { label: tr("guide.wasdPan"), pc: <>{tr("guide.hold")} {keyboard(s(SHORTCUT_KEY.PAN_VIEWPORT_UP))} {keyboard(s(SHORTCUT_KEY.PAN_VIEWPORT_DOWN))} {keyboard(s(SHORTCUT_KEY.PAN_VIEWPORT_LEFT))} {keyboard(s(SHORTCUT_KEY.PAN_VIEWPORT_RIGHT))}</>, touch: null },
        { label: tr("guide.zoom"), pc: tr("guide.mouseWheel"), touch: tr("guide.pinch") },
        { label: tr("guide.rotateView"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.ROTATE_VIEWPORT))}</>, touch: tr("guide.twoFingerRotateRotateViewButton"), shortcutKey: SHORTCUT_KEY.ROTATE_VIEWPORT },
        { label: tr("guide.centerTheBase"), pc: <>{tr("guide.press")} {keyboard("H")}</>, touch: null },
      ],
    },
    {
      title: tr("guide.selection"),
      rows: [
        { label: tr("guide.selectADevice"), pc: tr("guide.leftClickTheDevice"), touch: tr("guide.tapTheDevice") },
        { label: tr("guide.selectSeveralDevices"), pc: marqueePC, touch: marqueeTouch },
        { label: tr("guide.moveSelection"), pc: movePC, touch: tr("guide.longPressASelectedDeviceThen") },
        { label: tr("guide.addToRemoveFromSelection"), pc: <>{tr("guide.hold")} {keyboard("Ctrl")} {tr("guide.thenClickDevice")}</>, touch: null },
        { label: tr("guide.deselect"), pc: <>{tr("guide.rightClickEmpty")} / {keyboard("Esc")}</>, touch: tr("guide.tapEmptySpaceOrTheCancel") },
      ],
    },
    {
      title: tr("guide.placingDevices"),
      rows: [
        { label: tr("guide.rotatePreview"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.ROTATE))}</>, touch: tr("guide.tapTheRotateButton"), shortcutKey: SHORTCUT_KEY.ROTATE },
        { label: tr("guide.place"), pc: tr("guide.leftClickTheCanvas"), touch: tr("guide.tapTheConfirmButtonOrThe") },
        { label: tr("guide.placeRepeatedly"), pc: <>{tr("guide.hold")} {keyboard("Shift")} {tr("guide.click")}</>, touch: tr("guide.turnOnContinuousPlacement") },
        { label: tr("guide.cancelPlacement"), pc: <>{tr("guide.rightClick")} / {keyboard("Esc")}</>, touch: tr("guide.tapTheCancelButton") },
        { label: tr("guide.beltTool"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.PLACE_CONVEYOR))}</>, touch: tr("guide.switchInThePanel"), shortcutKey: SHORTCUT_KEY.PLACE_CONVEYOR },
        { label: tr("guide.pipeTool"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.PLACE_PIPE))}</>, touch: tr("guide.switchInThePanel"), shortcutKey: SHORTCUT_KEY.PLACE_PIPE },
        { label: tr("guide.quickPickByCategory"), pc: <>{keyboard("X")} {keyboard("G")} {keyboard("C")} {keyboard("V")} {keyboard("B")} + {tr("guide.number")} {keyboard("1")}–{keyboard("0")}</>, touch: null },
        { label: tr("guide.keepPlacing"), pc: <>{tr("guide.hold")} {keyboard("Shift")} / {keyboard("Ctrl")} {tr("guide.thenClick")}</>, touch: tr("guide.turnOnContinuousPlacement2") },
      ],
    },
    {
      title: tr("guide.deleting"),
      rows: [
        { label: tr("guide.deleteADevice"), pc: tr("guide.leftClickTheDevice"), touch: tr("guide.tapTheDevice") },
        { label: tr("guide.deleteAWholeBeltPipeLine"), pc: tr("guide.clickTheLineInLineDelete"), touch: tr("guide.clickTheLineInLineDelete") },
        { label: tr("guide.deleteByBox"), pc: tr("guide.leftDrag"), touch: tr("guide.longPressThenDrag") },
        { label: tr("guide.deleteSelection"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.DELETE_DEVICE))} / {keyboard("Delete")}</>, touch: null, shortcutKey: SHORTCUT_KEY.DELETE_DEVICE },
      ],
    },
    {
      title: tr("guide.blueprints"),
      rows: [
        { label: tr("guide.saveAsBlueprint"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.SAVE_BLUEPRINT))}</>, touch: null, shortcutKey: SHORTCUT_KEY.SAVE_BLUEPRINT },
        { label: tr("guide.copyAsTemporaryBlueprint"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.COPY_SELECTION))}</>, touch: null, shortcutKey: SHORTCUT_KEY.COPY_SELECTION },
        { label: tr("guide.pasteTemporaryBlueprint"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.PASTE_SELECTION))}</>, touch: null, shortcutKey: SHORTCUT_KEY.PASTE_SELECTION },
        { label: tr("guide.rotateBlueprintPreview"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.ROTATE))}</>, touch: tr("guide.tapTheRotateButton"), shortcutKey: SHORTCUT_KEY.ROTATE },
        { label: tr("guide.placeBlueprint"), pc: tr("guide.leftClick"), touch: tr("guide.tapTheConfirmButtonOrThe") },
      ],
    },
    {
      title: tr("guide.simulation"),
      rows: [
        { label: tr("guide.startPause"), pc: tr("guide.playButtonInTheTopBar"), touch: tr("guide.playButtonInTheTopBar") },
        { label: tr("guide.speed"), pc: tr("guide.speedButtonsInTheTopBar"), touch: tr("guide.speedButtonsInTheTopBar") },
      ],
    },
    {
      title: tr("guide.penTitle"),
      rows: [
        { label: tr("guide.penHover"), pc: tr("guide.penHoverHow"), touch: tr("guide.penHoverHow") },
        { label: tr("guide.penTip"), pc: tr("guide.penTipHow"), touch: tr("guide.penTipHow") },
        { label: tr("guide.penBarrel"), pc: tr("guide.penBarrelHow"), touch: tr("guide.penBarrelHow") },
        { label: tr("guide.penEraser"), pc: tr("guide.penEraserHow"), touch: tr("guide.penEraserHow") },
        { label: tr("guide.penPalm"), pc: tr("guide.penPalmHow"), touch: tr("guide.penPalmHow") },
      ],
    },
    {
      title: tr("guide.general"),
      rows: [
        { label: tr("guide.undo"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.UNDO))}</>, touch: null, shortcutKey: SHORTCUT_KEY.UNDO },
        { label: tr("guide.redo"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.REDO))}</>, touch: null, shortcutKey: SHORTCUT_KEY.REDO },
        { label: tr("guide.backToSelect"), pc: <>{tr("guide.press")} {keyboard("Esc")}</>, touch: null },
      ],
    },
    {
      title: tr("guide.categoryShortcuts"),
      rows: [
        { label: tr("guide.resourcesPower"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.RESOURCES_POWER))}</>, touch: null, shortcutKey: SHORTCUT_KEY.RESOURCES_POWER },
        { label: tr("guide.depot"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.WAREHOUSE))}</>, touch: null, shortcutKey: SHORTCUT_KEY.WAREHOUSE },
        { label: tr("guide.basicProduction"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.BASIC_PRODUCTION))}</>, touch: null, shortcutKey: SHORTCUT_KEY.BASIC_PRODUCTION },
        { label: tr("guide.synthesis"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.SYNTHESIS))}</>, touch: null, shortcutKey: SHORTCUT_KEY.SYNTHESIS },
        { label: tr("guide.cheats"), pc: <>{tr("guide.press")} {keyboard(s(SHORTCUT_KEY.CHEAT))}</>, touch: null, shortcutKey: SHORTCUT_KEY.CHEAT },
      ],
    },
  ];
}

interface OperationGuideContentProps {
  deviceClass: DeviceClass;
  translate: (key: string) => string;
  getShortcut: ShortcutResolver;
  settings: AppSettings;
}

export function OperationGuideContent({ deviceClass, getShortcut, settings, translate }: OperationGuideContentProps) {
  const settingsSnapshot = useMemo<SettingsSnapshot>(
    () => ({
      immediateMove: settings.hypergryphImmediateMove,
      immediateMarquee: settings.hypergryphImmediateMarquee,
    }),
    [settings.hypergryphImmediateMove, settings.hypergryphImmediateMarquee],
  );

  const groups = useMemo(
    () => buildGuideData(getShortcut, settingsSnapshot, translate),
    [getShortcut, settingsSnapshot, translate],
  );

  // 本项目移动端只允许横屏，因此 tablet / mobile 共用同一布局策略
  const isNarrow = deviceClass === "tablet" || deviceClass === "mobile";

  return (
    <div className={cm(styles, `operation-guide${isNarrow ? " is-narrow" : ""}`)}>
      {groups.map((group) => (
        <div key={group.title} className={cm(styles, "operation-guide-group")}>
          <div className={cm(styles, "operation-guide-group-title")}>{group.title}</div>
          <div className={cm(styles, "operation-guide-table")} role="table" aria-label={group.title}>
            <div className={cm(styles, "operation-guide-row operation-guide-header")} role="row">
              <span className={cm(styles, "operation-guide-label")} role="columnheader">{translate("guide.headerAction")}</span>
              <span className={cm(styles, "operation-guide-pc")} role="columnheader">{translate("guide.headerPc")}</span>
              <span className={cm(styles, "operation-guide-touch")} role="columnheader">{translate("guide.headerTouch")}</span>
            </div>
            {group.rows.map((row, i) => (
              <div
                key={`${group.title}-${row.label}-${i}`}
                className={cm(styles, "operation-guide-row")}
                role="row"
              >
                <span className={cm(styles, "operation-guide-label")} role="cell">
                  {row.label}
                </span>
                <span className={cm(styles, "operation-guide-pc")} role="cell">
                  {row.pc !== null ? row.pc : "—"}
                </span>
                <span className={cm(styles, "operation-guide-touch")} role="cell">
                  {row.touch !== null ? row.touch : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
