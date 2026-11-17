// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY,
  WORKBENCH_SETTINGS_GROUPS,
  WorkbenchSettingsDialogController,
} from "@/app/shell/state/settings-dialog-state";
import { FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED } from "@/shared/logging/debug-mode-runtime";

describe("WorkbenchSettingsDialogController", () => {

  it("defaults wheel zoom inversion to off and persists the user's choice", () => {
    const controller = new WorkbenchSettingsDialogController();
    expect(controller.getValue("game-invert-wheel-zoom")).toBe(false);
    expect(controller.isSettingEditable("game-invert-wheel-zoom")).toBe(true);
    controller.updateSwitchValue("game-invert-wheel-zoom", true);
    expect(new WorkbenchSettingsDialogController().getValue("game-invert-wheel-zoom")).toBe(true);
    controller.updateSwitchValue("game-invert-wheel-zoom", false);
    expect(new WorkbenchSettingsDialogController().getValue("game-invert-wheel-zoom")).toBe(false);
  });

  it("keeps device audio independent of animation, image style and experiments, and persists it", () => {
    const controller = new WorkbenchSettingsDialogController();
    expect(controller.getValue("game-play-device-audio")).toBe(false);
    expect(controller.isSettingEditable("game-play-device-audio")).toBe(true);
    controller.updateSwitchValue("other-experimental-features", false);
    controller.updateSwitchValue("game-play-device-audio", true);
    controller.updateSwitchValue("game-use-blueprint-style-device-images", true);
    expect(controller.isSettingEditable("game-play-device-audio")).toBe(true);
    expect(controller.getValue("game-play-device-audio")).toBe(true);
    const restored = new WorkbenchSettingsDialogController();
    expect(restored.getValue("game-play-device-audio")).toBe(true);
    restored.updateSwitchValue("other-experimental-features", true);
    restored.updateSwitchValue("other-experimental-features", false);
    expect(restored.getValue("game-play-device-audio")).toBe(true);
    expect(restored.isSettingEditable("game-play-device-audio")).toBe(true);
    expect(new WorkbenchSettingsDialogController().getValue("game-play-device-audio")).toBe(true);
    expect(resolveGroupSettingIds("experimental")).not.toContain("game-play-device-audio");
  });
  it("蓝图默认连续开启，关闭后持久化", () => {
    const controller = new WorkbenchSettingsDialogController();
    const key = "game-blueprint-placement-default-continuous";
    expect(controller.getValue(key)).toBe(true);
    controller.updateSwitchValue(key, false);
    expect(new WorkbenchSettingsDialogController().getValue(key)).toBe(false);
    controller.resetArknightsOperation();
    expect(controller.getValue(key)).toBe(true);
    expect(new WorkbenchSettingsDialogController().getValue(key)).toBe(true);
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("defines settings groups by user intent and keeps every setting in its requested group", () => {
    expect(WORKBENCH_SETTINGS_GROUPS.map((group) => group.id)).toEqual([
      "system",
      "display",
      "interaction-mode",
      "auxiliary-display",
      "convenience-operation",
      "activity",
      "shortcuts",
      "other",
      "experimental",
      "debug",
    ]);

    expect(resolveGroupSettingIds("system")).toEqual([
      "system-language",
      "system-theme",
    ]);
    expect(resolveGroupSettingIds("display")).toEqual([
      "game-play-device-animations",
      "game-play-device-audio",
      "game-pipe-wall-reflection",
      "game-use-blueprint-style-device-images",
      "game-show-grass-background",
      "game-show-device-names",
      "game-show-device-icons",
    ]);
    expect(resolveGroupSettingIds("experimental")).toContain("game-show-region-annotations");
    expect(resolveGroupSettingIds("interaction-mode")).toEqual([
      "game-invert-wheel-zoom",
      "game-pen-precise-input",
      "game-use-inspector-panel",
      "game-arknights-selection-right-dock-sync",
      "game-arknights-inspector-open-on-second-click",
      "game-collapse-device-modes",
    ]);
    expect(resolveGroupSettingIds("auxiliary-display")).toEqual([
      "game-always-show-grid-lines",
      "game-always-show-power-range",
      "game-show-pipe-exact-fluid-position",
    ]);
    expect(resolveGroupSettingIds("activity")).toEqual([
      "other-toolbox-show-all-activity-content",
    ]);
    expect(resolveGroupSettingIds("shortcuts")).toEqual([
      "game-show-hotkeys",
    ]);
    expect(resolveGroupSettingIds("debug").includes(
      "debug-force-flatten-blueprint-version",
    )).toBe(FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED);
    expect(FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED).toBe(false);
  });

  it("persists schema-driven values and hydrates them on the next controller", () => {
    const controller = new WorkbenchSettingsDialogController();

    controller.selectGroup("display");
    controller.updateSelectValue("system-language", "en-US");
    controller.updateSelectValue("system-theme", "graphite-dark");
    controller.updateSwitchValue("game-use-blueprint-style-device-images", true);
    controller.updateSwitchValue("other-debug-mode", true);
    controller.updateSwitchValue("debug-simulation-worker-detailed-report", true);
    controller.updateTextValue("debug-backend-api-address-override", "https://debug.example.test/api");
    controller.updateSwitchValue("debug-show-fps", true);
    controller.updateSwitchValue("debug-show-gesture-diagnostics-window", true);

    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")).toEqual({
      selectedGroupId: "display",
      values: {
        "system-language": "en-US",
        "system-theme": "graphite-dark",
        "game-arknights-immediate-move": true,
        "game-arknights-copy-while-moving": false,
        "game-arknights-immediate-marquee": false,
        "game-blueprint-placement-default-continuous": true,
        "game-arknights-allow-empty-logistics-endpoints": false,
        "game-arknights-auto-create-splitters-and-convergers": true,
        "game-invert-wheel-zoom": false,
        "game-pen-precise-input": true,
        "game-arknights-selection-right-dock-sync": false,
        "game-arknights-inspector-open-on-second-click": false,
        "game-show-device-names": true,
        "game-show-region-annotations": false,
        "game-show-device-icons": true,
        "game-show-hotkeys": true,
        "game-pipe-wall-reflection": false,
        "game-show-pipe-exact-fluid-position": false,
        "game-collapse-device-modes": true,
        "game-always-show-grid-lines": true,
        "game-always-show-power-range": false,
        "game-show-grass-background": false,
        "game-use-inspector-panel": true,
        "game-use-blueprint-style-device-images": true,
        "game-play-device-animations": false,
        "game-play-device-audio": false,
        "other-toolbox-show-all-activity-content": true,
        "other-debug-mode": true,
        "other-experimental-features": false,
        "debug-simulation-worker-detailed-report": true,
        ...(FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED
          ? { "debug-force-flatten-blueprint-version": false }
          : {}),
        "debug-backend-api-address-override": "https://debug.example.test/api",
        "debug-disable-cargo-entry-animation": false,
        "debug-show-fps": true,
        "debug-show-gesture-diagnostics-window": true,
        "experimental-virtual-mouse-pointer": false,
        "sync-provider": "none",
      },
    });

    const hydratedController = new WorkbenchSettingsDialogController();

    expect(hydratedController.selectedGroupId).toBe("display");
    expect(hydratedController.values["system-language"]).toBe("en-US");
    expect(hydratedController.values["system-theme"]).toBe("graphite-dark");
    expect(hydratedController.values["game-arknights-immediate-move"]).toBe(true);
    expect(hydratedController.values["game-arknights-copy-while-moving"]).toBe(false);
    expect(hydratedController.values["game-arknights-immediate-marquee"]).toBe(false);
    expect(hydratedController.values["game-arknights-allow-empty-logistics-endpoints"]).toBe(false);
    expect(
      hydratedController.values["game-arknights-auto-create-splitters-and-convergers"],
    ).toBe(true);
    expect(hydratedController.values["game-arknights-selection-right-dock-sync"]).toBe(false);
    expect(hydratedController.values["game-arknights-inspector-open-on-second-click"]).toBe(false);
    expect(Object.keys(hydratedController.values).some((key) => key.startsWith("shortcut-"))).toBe(false);
    expect(hydratedController.values["game-show-device-names"]).toBe(true);
    expect(hydratedController.values["game-show-region-annotations"]).toBe(false);
    expect(hydratedController.values["game-show-device-icons"]).toBe(true);
    expect(hydratedController.values["game-collapse-device-modes"]).toBe(true);
    expect(hydratedController.values["game-always-show-grid-lines"]).toBe(true);
    expect(hydratedController.values["game-always-show-power-range"]).toBe(false);
    expect(hydratedController.values["game-show-grass-background"]).toBe(false);
    expect(hydratedController.values["game-use-blueprint-style-device-images"]).toBe(true);
    expect(hydratedController.values["other-toolbox-show-all-activity-content"]).toBe(true);
    expect(hydratedController.values["other-debug-mode"]).toBe(true);
    expect(hydratedController.values["debug-simulation-worker-detailed-report"]).toBe(true);
    expect(hydratedController.values["debug-backend-api-address-override"]).toBe(
      "https://debug.example.test/api",
    );
    expect(hydratedController.values["debug-show-fps"]).toBe(true);
    expect(hydratedController.values["debug-show-gesture-diagnostics-window"]).toBe(true);
  });



  it("disables grass and grid toggles when simplified device icons are enabled", () => {
    const controller = new WorkbenchSettingsDialogController();

    expect(controller.isSettingEditable("game-always-show-grid-lines")).toBe(true);
    expect(controller.isSettingEditable("game-show-grass-background")).toBe(true);

    controller.updateSwitchValue("game-use-blueprint-style-device-images", true);

    expect(controller.isSettingEditable("game-always-show-grid-lines")).toBe(false);
    expect(controller.isSettingEditable("game-show-grass-background")).toBe(false);

    controller.updateSwitchValue("game-always-show-grid-lines", false);
    controller.updateSwitchValue("game-show-grass-background", true);

    expect(controller.values["game-always-show-grid-lines"]).toBe(true);
    expect(controller.values["game-show-grass-background"]).toBe(false);
  });

  it("gates region annotations and clears persisted and external values when experiments are disabled", () => {
    let visible = true;
    const controller = new WorkbenchSettingsDialogController({
      externalBindings: {
        "game-show-region-annotations": {
          readValue: () => visible,
          writeValue: (value) => { visible = value === true; },
        },
      },
    });
    expect(visible).toBe(false);
    expect(controller.isSettingEditable("game-show-region-annotations")).toBe(false);
    controller.updateSwitchValue("game-show-region-annotations", true);
    expect(visible).toBe(false);
    controller.updateSwitchValue("other-experimental-features", true);
    controller.updateSwitchValue("game-show-region-annotations", true);
    expect(visible).toBe(true);
    controller.updateSwitchValue("other-experimental-features", false);
    expect(visible).toBe(false);

    localStorage.setItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, JSON.stringify({
      values: {
        "other-experimental-features": false,
        "game-show-region-annotations": true,
      },
    }));
    const hydratedController = new WorkbenchSettingsDialogController();
    expect(hydratedController.getValue("game-show-region-annotations")).toBe(false);
  });

  it("places device animation under display and preserves it across blueprint mode and experiment changes", () => {
    const controller = new WorkbenchSettingsDialogController();
    const displayGroup = WORKBENCH_SETTINGS_GROUPS.find((group) => group.id === "display");
    const experimentalGroup = WORKBENCH_SETTINGS_GROUPS.find((group) => group.id === "experimental");

    expect(displayGroup?.items.some((setting) => setting.id === "game-play-device-animations")).toBe(true);
    expect(experimentalGroup?.items.some((setting) => setting.id === "game-play-device-animations")).toBe(false);
    expect(controller.getValue("game-play-device-animations")).toBe(false);
    expect(controller.isSettingEditable("game-play-device-animations")).toBe(true);

    controller.updateSwitchValue("game-play-device-animations", true);
    expect(controller.getValue("game-play-device-animations")).toBe(true);

    controller.updateSwitchValue("other-experimental-features", true);
    expect(controller.isSettingEditable("game-play-device-animations")).toBe(true);
    controller.updateSwitchValue("game-play-device-animations", true);
    controller.updateSwitchValue("game-use-blueprint-style-device-images", true);

    expect(controller.isSettingEditable("game-play-device-animations")).toBe(false);
    expect(controller.getValue("game-play-device-animations")).toBe(true);

    controller.updateSwitchValue("game-play-device-animations", false);
    expect(controller.getValue("game-play-device-animations")).toBe(true);

    const hydratedController = new WorkbenchSettingsDialogController();
    expect(hydratedController.isSettingEditable("game-play-device-animations")).toBe(false);
    expect(hydratedController.getValue("game-play-device-animations")).toBe(true);

    hydratedController.updateSwitchValue("game-use-blueprint-style-device-images", false);
    expect(hydratedController.isSettingEditable("game-play-device-animations")).toBe(true);
    expect(hydratedController.getValue("game-play-device-animations")).toBe(true);

    hydratedController.updateSwitchValue("other-experimental-features", false);
    expect(hydratedController.isSettingEditable("game-play-device-animations")).toBe(true);
    expect(hydratedController.getValue("game-play-device-animations")).toBe(true);
    expect(new WorkbenchSettingsDialogController().getValue("game-play-device-animations")).toBe(true);

    hydratedController.updateSwitchValue("other-experimental-features", true);
    expect(hydratedController.isSettingEditable("game-play-device-animations")).toBe(true);
    expect(hydratedController.getValue("game-play-device-animations")).toBe(true);
  });

  it("preserves the externally bound animation runtime value when experimental features are disabled", () => {
    let gameUseBlueprintStyleDeviceImages = false;
    let gamePlayDeviceAnimations = true;
    const controller = new WorkbenchSettingsDialogController({
      externalBindings: {
        "game-use-blueprint-style-device-images": {
          readValue: () => gameUseBlueprintStyleDeviceImages,
          writeValue: (value) => {
            if (typeof value === "boolean") {
              gameUseBlueprintStyleDeviceImages = value;
            }
          },
        },
        "game-play-device-animations": {
          readValue: () => gamePlayDeviceAnimations,
          writeValue: (value) => {
            if (typeof value === "boolean") {
              gamePlayDeviceAnimations = value;
            }
          },
        },
      },
    });

    expect(gamePlayDeviceAnimations).toBe(true);
    expect(controller.isSettingEditable("game-play-device-animations")).toBe(true);

    controller.updateSwitchValue("other-experimental-features", true);
    controller.updateSwitchValue("game-play-device-animations", true);
    controller.updateSwitchValue("game-use-blueprint-style-device-images", true);
    controller.updateSwitchValue("game-play-device-animations", false);

    expect(gamePlayDeviceAnimations).toBe(true);
    expect(controller.getValue("game-play-device-animations")).toBe(true);
    expect(controller.isSettingEditable("game-play-device-animations")).toBe(false);
    expect(controller.values["game-play-device-animations"]).toBeUndefined();

    controller.updateSwitchValue("game-use-blueprint-style-device-images", false);
    expect(controller.isSettingEditable("game-play-device-animations")).toBe(true);
    expect(controller.getValue("game-play-device-animations")).toBe(true);

    controller.updateSwitchValue("other-experimental-features", false);
    expect(gamePlayDeviceAnimations).toBe(true);
    expect(controller.isSettingEditable("game-play-device-animations")).toBe(true);
  });

  it("locks device icons on when simplified device icons are enabled", () => {
    const controller = new WorkbenchSettingsDialogController();

    expect(controller.getValue("game-show-device-names")).toBe(true);
    expect(controller.getValue("game-show-device-icons")).toBe(false);
    expect(controller.isSettingEditable("game-show-device-icons")).toBe(true);

    controller.updateSwitchValue("game-use-blueprint-style-device-images", true);

    expect(controller.getValue("game-show-device-icons")).toBe(true);
    expect(controller.isSettingEditable("game-show-device-icons")).toBe(false);

    controller.updateSwitchValue("game-show-device-icons", false);

    expect(controller.getValue("game-show-device-icons")).toBe(true);
  });

  it("uses external bindings as the source of truth for text settings", () => {
    let backendApiAddressOverride = "";
    const controller = new WorkbenchSettingsDialogController({
      externalBindings: {
        "debug-backend-api-address-override": {
          readValue: () => backendApiAddressOverride,
          writeValue: (value) => {
            if (typeof value === "string") {
              backendApiAddressOverride = value;
            }
          },
        },
      },
    });

    controller.updateSwitchValue("other-debug-mode", true);
    controller.updateTextValue(
      "debug-backend-api-address-override",
      " http://localhost:8787 ",
    );
    controller.updateSwitchValue("debug-show-fps", true);

    expect(backendApiAddressOverride).toBe(" http://localhost:8787 ");
    expect(controller.getValue("debug-backend-api-address-override")).toBe(
      " http://localhost:8787 ",
    );
    expect(controller.values["debug-backend-api-address-override"]).toBe(
      " http://localhost:8787 ",
    );
    expect(
      JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")
        .values["debug-backend-api-address-override"],
    ).toBeUndefined();
  });

  it("disables grass and grid toggles when simplified device icons are enabled", () => {
    let locale = "zh-CN";
    let themeId = "ayu-light";
    const controller = new WorkbenchSettingsDialogController({
      externalBindings: {
        "system-language": {
          readValue: () => locale,
          writeValue: (value) => {
            if (value === "zh-CN" || value === "en-US") {
              locale = value;
            }
          },
        },
        "system-theme": {
          readValue: () => themeId,
          writeValue: (value) => {
            if (value === "ayu-light" || value === "graphite-dark") {
              themeId = value;
            }
          },
        },
      },
    });

    controller.selectGroup("system");
    controller.updateSelectValue("system-language", "en-US");
    controller.updateSelectValue("system-theme", "graphite-dark");
    controller.updateSwitchValue("other-debug-mode", true);

    expect(locale).toBe("en-US");
    expect(themeId).toBe("graphite-dark");
    expect(controller.getValue("system-language")).toBe("en-US");
    expect(controller.getValue("system-theme")).toBe("graphite-dark");
    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")).toEqual({
      selectedGroupId: "system",
      values: {
        "game-arknights-immediate-move": true,
        "game-arknights-copy-while-moving": false,
        "game-arknights-immediate-marquee": false,
        "game-blueprint-placement-default-continuous": true,
        "game-arknights-allow-empty-logistics-endpoints": false,
        "game-arknights-auto-create-splitters-and-convergers": true,
        "game-invert-wheel-zoom": false,
        "game-pen-precise-input": true,
        "game-arknights-selection-right-dock-sync": false,
        "game-arknights-inspector-open-on-second-click": false,
        "game-show-device-names": true,
        "game-show-region-annotations": false,
        "game-show-device-icons": false,
        "game-show-hotkeys": true,
        "game-pipe-wall-reflection": false,
        "game-show-pipe-exact-fluid-position": false,
        "game-collapse-device-modes": true,
        "game-always-show-grid-lines": true,
        "game-always-show-power-range": false,
        "game-show-grass-background": false,
        "game-use-inspector-panel": true,
        "game-use-blueprint-style-device-images": false,
        "game-play-device-animations": false,
        "game-play-device-audio": false,
        "other-toolbox-show-all-activity-content": true,
        "other-debug-mode": true,
        "other-experimental-features": false,
        "debug-simulation-worker-detailed-report": false,
        ...(FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED
          ? { "debug-force-flatten-blueprint-version": false }
          : {}),
        "debug-backend-api-address-override": "",
        "debug-disable-cargo-entry-animation": false,
        "debug-show-fps": false,
        "debug-show-gesture-diagnostics-window": false,
        "experimental-virtual-mouse-pointer": false,
        "sync-provider": "none",
      },
    });
  });
});

function resolveGroupSettingIds(groupId: string): string[] {
  return WORKBENCH_SETTINGS_GROUPS
    .find((group) => group.id === groupId)
    ?.items.map((setting) => setting.id) ?? [];
}
