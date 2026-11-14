import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import { hasPlaceableEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { UiKey } from "@/shared/i18n";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { createDeviceIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { ComponentProps } from "react";

type PlacementOperationIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];

export interface PlacementOperationButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: UiKey;
  readonly icon?: PlacementOperationIconKind;
  readonly iconSrc?: string;
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

const BELT_DRAW_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-action-belt-draw",
  labelKey: "workbench.button.beltDraw",
  iconSrc: createDeviceIconAssetUrl("item_log_belt_01"),
  hotkeyKeyId: SHORTCUT_KEY.PLACE_CONVEYOR,
  activeWhen: (appHost) =>
    appHost.mainCanvas.state.activeTool === "logistics-placement"
    && appHost.mainCanvas.state.runtime.logisticsPlacement.kind === LOGISTICS_KIND.belt,
};

const PIPE_DRAW_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-action-pipe-draw",
  labelKey: "workbench.button.pipeDraw",
  iconSrc: createDeviceIconAssetUrl("item_log_pipe_01"),
  hotkeyKeyId: SHORTCUT_KEY.PLACE_PIPE,
  visibleWhen: (appHost) => hasPlaceableEntityDefinitionInCurrentBase(appHost.mainCanvas, "pipeLogistics"),
  activeWhen: (appHost) =>
    appHost.mainCanvas.state.activeTool === "logistics-placement"
    && appHost.mainCanvas.state.runtime.logisticsPlacement.kind === LOGISTICS_KIND.pipe,
};

export const PLACEMENT_OPERATION_BUTTONS = [
  SELECT_OPERATION_BUTTON,
  MARQUEE_OPERATION_BUTTON,
  BELT_DRAW_OPERATION_BUTTON,
  PIPE_DRAW_OPERATION_BUTTON,
] as const satisfies readonly PlacementOperationButtonDefinition[];

export function getVisiblePlacementOperationButtons(
  appHost: AppHost,
): PlacementOperationButtonDefinition[] {
  return PLACEMENT_OPERATION_BUTTONS.filter((button) => button.visibleWhen?.(appHost) ?? true);
}
