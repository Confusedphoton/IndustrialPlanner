import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import { LINE_DRAW_BUTTON_ID } from "@/app/input/gesture/actions/hypergryph/hypergryph-logistics-placement-gesture-module";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { UiKey } from "@/shared/i18n";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { createDeviceIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { ComponentProps } from "react";

const BELT_ICON_SRC = createDeviceIconAssetUrl("item_log_belt_01");
const PIPE_ICON_SRC = createDeviceIconAssetUrl("item_log_pipe_01");

type PlacementOperationIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];

export interface PlacementOperationButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: UiKey | ((appHost: AppHost) => UiKey);
  readonly icon?: PlacementOperationIconKind;
  readonly iconSrc?: string | ((appHost: AppHost) => string);
  readonly hotkey?: string | null;
  readonly hotkeyKeyId?: ShortcutKeyId;
  readonly visibleWhen?: (appHost: AppHost) => boolean;
  readonly activeWhen?: (appHost: AppHost) => boolean;
}

const SELECT_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-tool-select",
  labelKey: "workbench.button.select",
  icon: "select-arrow",
  hotkey: "Esc",
  activeWhen: (appHost) => appHost.mainCanvas.state.activeTool === "select",
};

const MARQUEE_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-tool-marquee",
  labelKey: "workbench.button.batchSelect",
  icon: "batch-select",
  hotkeyKeyId: SHORTCUT_KEY.MARQUEE,
  activeWhen: (appHost) => appHost.mainCanvas.state.activeTool === "marquee",
};

const isDrawingPipe = (appHost: AppHost) =>
  appHost.mainCanvas.state.activeTool === "logistics-placement"
  && appHost.mainCanvas.state.runtime.logisticsPlacement.kind === LOGISTICS_KIND.pipe;

/** 一个铺线工具：显示当前在铺的线；已在铺线时再点一下切换传送带与管道。 */
const LINE_DRAW_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: LINE_DRAW_BUTTON_ID,
  labelKey: (appHost) => isDrawingPipe(appHost) ? "workbench.button.pipeDraw" : "workbench.button.beltDraw",
  iconSrc: (appHost) => isDrawingPipe(appHost) ? PIPE_ICON_SRC : BELT_ICON_SRC,
  hotkeyKeyId: SHORTCUT_KEY.PLACE_CONVEYOR,
  activeWhen: (appHost) => appHost.mainCanvas.state.activeTool === "logistics-placement",
};

export const PLACEMENT_OPERATION_BUTTONS = [
  SELECT_OPERATION_BUTTON,
  MARQUEE_OPERATION_BUTTON,
  LINE_DRAW_OPERATION_BUTTON,
] as const satisfies readonly PlacementOperationButtonDefinition[];

export function getVisiblePlacementOperationButtons(
  appHost: AppHost,
): PlacementOperationButtonDefinition[] {
  return PLACEMENT_OPERATION_BUTTONS.filter((button) => button.visibleWhen?.(appHost) ?? true);
}
