import { makeAutoObservable } from "mobx";

import type { UiKey } from "@/shared/i18n";
import { FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED } from "@/shared/logging/debug-mode-runtime";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";
import { BUILD_BACKEND_API_BASE_URL } from "@/shared/storage/backend-api-address";
import type { SyncProviderId } from "@/shared/storage/sync-provider-activation";


const SYNC_PROVIDER_OPTIONS: readonly {
  readonly value: SyncProviderId;
  readonly labelKey: UiKey;
}[] = [
  { value: "none", labelKey: "settingsOption.syncProvider.none" },
  { value: "webdav", labelKey: "settingsOption.syncProvider.webdav" },
  { value: "cloudflare", labelKey: "settingsOption.syncProvider.cloudflare" },
  { value: "yituliu", labelKey: "settingsOption.syncProvider.yituliu" },
];

export const USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY = "v3-user-settings-dialog";

export type SettingsGroupId =
  | "system"
  | "display"
  | "interaction-mode"
  | "auxiliary-display"
  | "convenience-operation"
  | "activity"
  | "shortcuts"
  | "other"
  | "experimental"
  | "debug";

export type WorkbenchSettingControlValue = string | number | boolean;

interface WorkbenchSettingEditableWhenDefinition {
  readonly settingId: string;
  readonly equals: WorkbenchSettingControlValue;
}

interface WorkbenchSettingBaseDefinition {
  readonly id: string;
  readonly labelKey?: UiKey;
  readonly labelText?: string;
  readonly descriptionKey?: UiKey;
  readonly descriptionText?: string;
  readonly disabled?: boolean;
  /** 所有条件同时成立时才可编辑；单条件写法保留给既有设置。 */
  readonly editableWhen?: WorkbenchSettingEditableWhenDefinition
    | readonly WorkbenchSettingEditableWhenDefinition[];
  /** 非桌面端（移动端/平板）隐藏该设置项 */
  readonly mobileHidden?: boolean;
}

interface WorkbenchSelectOptionDefinition {
  readonly value: string;
  readonly labelKey: UiKey;
}

interface WorkbenchSelectSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "select";
  readonly defaultValue: string;
  readonly options: readonly WorkbenchSelectOptionDefinition[];
}

interface WorkbenchSliderSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "slider";
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly valueSuffix?: string;
}

interface WorkbenchSwitchSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "switch";
  readonly defaultValue: boolean;
}


interface WorkbenchTextSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "text";
  readonly defaultValue: string;
  readonly placeholderText?: string;
}

interface WorkbenchPasswordSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "password";
  readonly defaultValue: string;
  readonly placeholderText?: string;
}

export type WorkbenchSettingDefinition =
  | WorkbenchSelectSettingDefinition
  | WorkbenchSliderSettingDefinition
  | WorkbenchSwitchSettingDefinition
  | WorkbenchPasswordSettingDefinition
  | WorkbenchTextSettingDefinition;

export interface WorkbenchSettingsGroupDefinition {
  readonly id: SettingsGroupId;
  readonly labelKey: UiKey;
  readonly descriptionKey: UiKey;
  readonly items: readonly WorkbenchSettingDefinition[];
  /** 非桌面端（移动端/平板）隐藏该整个设置分组 */
  readonly mobileHidden?: boolean;
}

interface WorkbenchSettingExternalBinding {
  readonly readValue: () => WorkbenchSettingControlValue;
  readonly writeValue: (value: WorkbenchSettingControlValue) => void;
}

interface WorkbenchSettingsDialogControllerOptions {
  readonly externalBindings?: Readonly<Record<string, WorkbenchSettingExternalBinding>>;
}

interface PersistedUserSettingsDialogState {
  readonly selectedGroupId: SettingsGroupId;
  readonly values: Record<string, WorkbenchSettingControlValue>;
}

const SIMPLIFIED_DEVICE_ICONS_SETTING_ID = "game-use-blueprint-style-device-images";
const ALWAYS_SHOW_GRID_LINES_SETTING_ID = "game-always-show-grid-lines";
const SHOW_GRASS_BACKGROUND_SETTING_ID = "game-show-grass-background";
const SHOW_DEVICE_NAMES_SETTING_ID = "game-show-device-names";
const SHOW_DEVICE_ICONS_SETTING_ID = "game-show-device-icons";
const COLLAPSE_DEVICE_MODES_SETTING_ID = "game-collapse-device-modes";
const SHOW_PIPE_EXACT_FLUID_POSITION_SETTING_ID = "game-show-pipe-exact-fluid-position";
const EXPERIMENTAL_FEATURES_SETTING_ID = "other-experimental-features";
const DEVICE_ANIMATIONS_SETTING_ID = "game-play-device-animations";

export const WORKBENCH_SETTINGS_GROUPS: readonly WorkbenchSettingsGroupDefinition[] = [
  {
    id: "system",
    labelKey: "settingsGroup.system",
    descriptionKey: "settingsGroup.systemDescription",
    items: [
      {
        id: "system-language",
        kind: "select",
        labelKey: "settingsField.system-language",
        descriptionKey: "settingsField.system-languageDescription",
        defaultValue: "zh-CN",
        options: [
          { value: "zh-CN", labelKey: "settingsOption.languageZhHans" },
          { value: "en-US", labelKey: "settingsOption.languageEnglish" },
        ],
      },
      {
        id: "system-theme",
        kind: "select",
        labelKey: "settingsField.system-theme",
        descriptionKey: "settingsField.system-themeDescription",
        defaultValue: "ayu-light",
        options: [
          { value: "ayu-light", labelKey: "settingsOption.ayuLight" },
          // { value: "ayu-dark", labelKey: "settingsOption.ayuDark" }。
          { value: "graphite-dark", labelKey: "settingsOption.graphiteDark" },
        ],
      },
    ],
  },
  {
    id: "display",
    labelKey: "settingsGroup.display",
    descriptionKey: "settingsGroup.displayDescription",
    items: [
      {
        id: DEVICE_ANIMATIONS_SETTING_ID,
        kind: "switch",
        labelKey: "settingsField.game-play-device-animations",
        descriptionKey: "settingsField.game-play-device-animationsDescription",
        defaultValue: false,
        editableWhen: {
          settingId: SIMPLIFIED_DEVICE_ICONS_SETTING_ID,
          equals: false,
        },
      },
      {
        id: "game-play-device-audio",
        kind: "switch",
        labelKey: "settingsField.game-play-device-audio",
        descriptionKey: "settingsField.game-play-device-audioDescription",
        defaultValue: false,
      },
      {
        id: "game-pipe-wall-reflection",
        kind: "switch",
        labelKey: "settingsField.game-pipe-wall-reflection",
        descriptionKey: "settingsField.game-pipe-wall-reflectionDescription",
        defaultValue: false,
        editableWhen: { settingId: "game-use-blueprint-style-device-images", equals: false },
      },
      {
        id: "game-use-blueprint-style-device-images",
        kind: "switch",
        labelKey: "settingsField.game-use-blueprint-style-device-images",
        descriptionKey: "settingsField.game-use-blueprint-style-device-imagesDescription",
        defaultValue: false,
      },
      {
        id: "game-show-grass-background",
        kind: "switch",
        labelKey: "settingsField.game-show-grass-background",
        descriptionKey: "settingsField.game-show-grass-backgroundDescription",
        defaultValue: false,
        editableWhen: {
          settingId: "game-use-blueprint-style-device-images",
          equals: false,
        },
      },
      {
        id: SHOW_DEVICE_NAMES_SETTING_ID,
        kind: "switch",
        labelKey: "settingsField.game-show-device-names",
        descriptionKey: "settingsField.game-show-device-namesDescription",
        defaultValue: true,
      },
      {
        id: SHOW_DEVICE_ICONS_SETTING_ID,
        kind: "switch",
        labelKey: "settingsField.game-show-device-icons",
        descriptionKey: "settingsField.game-show-device-iconsDescription",
        defaultValue: false,
        editableWhen: {
          settingId: SIMPLIFIED_DEVICE_ICONS_SETTING_ID,
          equals: false,
        },
      },
    ],
  },
  {
    id: "interaction-mode",
    labelKey: "settingsGroup.interactionMode",
    descriptionKey: "settingsGroup.interactionModeDescription",
    items: [
      {
        id: "game-invert-wheel-zoom",
        kind: "switch",
        labelKey: "settingsField.game-invert-wheel-zoom",
        descriptionKey: "settingsField.game-invert-wheel-zoomDescription",
        defaultValue: false,
      },
      {
        id: "game-pen-precise-input",
        kind: "switch",
        labelKey: "settingsField.game-pen-precise-input",
        descriptionKey: "settingsField.game-pen-precise-inputDescription",
        defaultValue: true,
      },
      {
        id: "game-use-inspector-panel",
        kind: "switch",
        labelKey: "settingsField.game-use-inspector-panel",
        descriptionKey: "settingsField.game-use-inspector-panelDescription",
        defaultValue: true,
      },
      {
        id: "game-arknights-selection-right-dock-sync",
        kind: "switch",
        labelKey: "settingsField.game-arknights-selection-right-dock-sync",
        descriptionKey: "settingsField.game-arknights-selection-right-dock-syncDescription",
        defaultValue: false,
        editableWhen: {
          settingId: "game-use-inspector-panel",
          equals: true,
        },
      },
      {
        id: "game-arknights-inspector-open-on-second-click",
        kind: "switch",
        labelKey: "settingsField.game-arknights-inspector-open-on-second-click",
        descriptionKey: "settingsField.game-arknights-inspector-open-on-second-clickDescription",
        defaultValue: false,
      },
      {
        id: COLLAPSE_DEVICE_MODES_SETTING_ID,
        kind: "switch",
        labelKey: "settingsField.game-collapse-device-modes",
        descriptionKey: "settingsField.game-collapse-device-modesDescription",
        defaultValue: true,
      },
    ],
  },
  {
    id: "auxiliary-display",
    labelKey: "settingsGroup.auxiliaryDisplay",
    descriptionKey: "settingsGroup.auxiliaryDisplayDescription",
    items: [
      {
        id: "game-always-show-grid-lines",
        kind: "switch",
        labelKey: "settingsField.game-always-show-grid-lines",
        descriptionKey: "settingsField.game-always-show-grid-linesDescription",
        defaultValue: true,
        editableWhen: {
          settingId: "game-use-blueprint-style-device-images",
          equals: false,
        },
      },
      {
        id: "game-always-show-power-range",
        kind: "switch",
        labelKey: "settingsField.game-always-show-power-range",
        descriptionKey: "settingsField.game-always-show-power-rangeDescription",
        defaultValue: false,
      },
      {
        id: SHOW_PIPE_EXACT_FLUID_POSITION_SETTING_ID,
        kind: "switch",
        labelKey: "settingsField.game-show-pipe-exact-fluid-position",
        descriptionKey: "settingsField.game-show-pipe-exact-fluid-positionDescription",
        defaultValue: false,
      },
    ],
  },
  {
    id: "convenience-operation",
    labelKey: "settingsGroup.convenienceOperation",
    descriptionKey: "settingsGroup.convenienceOperationDescription",
    items: [
      {
        id: "game-quick-place",
        kind: "switch",
        labelKey: "settingsField.game-quick-place",
        descriptionKey: "settingsField.game-quick-placeDescription",
        defaultValue: true,
      },
      {
        id: "game-arknights-immediate-move",
        kind: "switch",
        labelKey: "settingsField.game-arknights-immediate-move",
        descriptionKey: "settingsField.game-arknights-immediate-moveDescription",
        defaultValue: true,
      },
      {
        id: "game-arknights-copy-while-moving",
        kind: "switch",
        labelKey: "settingsField.game-arknights-copy-while-moving",
        descriptionKey: "settingsField.game-arknights-copy-while-movingDescription",
        defaultValue: false,
      },
      {
        id: "game-blueprint-placement-default-continuous",
        kind: "switch",
        labelKey: "settingsField.game-blueprint-placement-default-continuous",
        descriptionKey: "settingsField.game-blueprint-placement-default-continuousDescription",
        defaultValue: true,
      },
      {
        id: "game-arknights-immediate-marquee",
        kind: "switch",
        labelKey: "settingsField.game-arknights-immediate-marquee",
        descriptionKey: "settingsField.game-arknights-immediate-marqueeDescription",
        defaultValue: false,
      },
      {
        id: "game-arknights-allow-empty-logistics-endpoints",
        kind: "switch",
        labelKey: "settingsField.game-arknights-allow-empty-logistics-endpoints",
        descriptionKey: "settingsField.game-arknights-allow-empty-logistics-endpointsDescription",
        defaultValue: false,
      },
      {
        id: "game-arknights-auto-create-splitters-and-convergers",
        kind: "switch",
        labelKey: "settingsField.game-arknights-auto-create-splitters-and-convergers",
        descriptionKey: "settingsField.game-arknights-auto-create-splitters-and-convergersDescription",
        defaultValue: true,
      },
    ],
  },
  {
    id: "activity",
    labelKey: "settingsGroup.activity",
    descriptionKey: "settingsGroup.activityDescription",
    items: [
      {
        id: "other-toolbox-show-all-activity-content",
        kind: "switch",
        labelKey: "settingsField.other-toolbox-show-all-activity-content",
        descriptionKey: "settingsField.other-toolbox-show-all-activity-contentDescription",
        defaultValue: true,
      },
    ],
  },
  {
    id: "shortcuts",
    labelKey: "settingsGroup.shortcuts",
    descriptionKey: "settingsGroup.shortcutsDescription",
    items: [
      {
        id: "game-show-hotkeys",
        kind: "switch",
        labelKey: "settingsField.game-show-hotkeys",
        descriptionKey: "settingsField.game-show-hotkeysDescription",
        defaultValue: true,
        mobileHidden: true,
      },
    ],
  },
  {
    id: "other",
    labelKey: "settingsGroup.other",
    descriptionKey: "settingsGroup.otherDescription",
    items: [
      {
        id: "other-experimental-features",
        kind: "switch",
        labelKey: "settingsField.other-experimental-features",
        descriptionKey: "settingsField.other-experimental-featuresDescription",
        defaultValue: false,
      },
    ],
  },
  {
    id: "experimental",
    labelKey: "settingsGroup.experimental" as UiKey,
    descriptionKey: "settingsGroup.experimentalDescription" as UiKey,
    items: [
      {
        id: "game-show-region-annotations",
        kind: "switch",
        labelKey: "settingsField.game-show-region-annotations",
        descriptionKey: "settingsField.game-show-region-annotationsDescription",
        defaultValue: false,
      },

      {
        id: "sync-provider",
        kind: "select",
        labelKey: "settingsField.sync-provider" as UiKey,
        descriptionKey: "settingsField.sync-providerDescription" as UiKey,
        defaultValue: "none" satisfies SyncProviderId,
        options: SYNC_PROVIDER_OPTIONS,
      },
      {
        id: "experimental-virtual-mouse-pointer",
        kind: "switch",
        labelKey: "settingsField.experimental-virtual-mouse-pointer",
        descriptionKey: "settingsField.experimental-virtual-mouse-pointerDescription",
        defaultValue: false,
      },
    ],
  },
  {
    id: "debug",
    labelKey: "settingsGroup.debug",
    descriptionKey: "settingsGroup.debugDescription",
    items: [
      {
        id: "other-debug-mode",
        kind: "switch",
        labelKey: "settingsField.other-debug-mode",
        descriptionKey: "settingsField.other-debug-modeDescription",
        defaultValue: false,
      },
      {
        id: "debug-simulation-worker-detailed-report",
        kind: "switch",
        labelKey: "settingsField.debug-simulation-worker-detailed-report",
        descriptionKey: "settingsField.debug-simulation-worker-detailed-reportDescription",
        defaultValue: false,
      },
      ...(FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED ? [{
        id: "debug-force-flatten-blueprint-version",
        kind: "switch",
        labelKey: "settingsField.debug-force-flatten-blueprint-version",
        descriptionKey: "settingsField.debug-force-flatten-blueprint-versionDescription",
        defaultValue: false,
      } satisfies WorkbenchSwitchSettingDefinition] : []),
      {
        id: "debug-backend-api-address-override",
        kind: "text",
        labelKey: "settingsField.debug-backend-api-address-override",
        descriptionKey: "settingsField.debug-backend-api-address-overrideDescription",
        defaultValue: "",
        placeholderText: BUILD_BACKEND_API_BASE_URL,
      },
      {
        id: "debug-disable-cargo-entry-animation",
        kind: "switch",
        labelKey: "settingsField.debug-disable-cargo-entry-animation",
        defaultValue: false,
      },
      {
        id: "debug-show-fps",
        kind: "switch",
        labelKey: "settingsField.debug-show-fps",
        descriptionKey: "settingsField.debug-show-fpsDescription",
        defaultValue: false,
      },
      {
        id: "debug-show-gesture-diagnostics-window",
        kind: "switch",
        labelKey: "settingsField.debug-show-gesture-diagnostics-window",
        descriptionKey: "settingsField.debug-show-gesture-diagnostics-windowDescription",
        defaultValue: false,
      },
    ],
  },
] as const satisfies readonly [
  WorkbenchSettingsGroupDefinition,
  ...WorkbenchSettingsGroupDefinition[],
];

const DEFAULT_SETTINGS_GROUP = WORKBENCH_SETTINGS_GROUPS[0]!;

const EXPERIMENTAL_SETTING_DEFINITIONS: readonly WorkbenchSettingDefinition[] =
  WORKBENCH_SETTINGS_GROUPS.find((group) => group.id === "experimental")?.items ?? [];
const EXPERIMENTAL_SETTING_IDS = new Set(
  EXPERIMENTAL_SETTING_DEFINITIONS.map((setting) => setting.id),
);

const SETTING_DEFINITION_BY_ID = new Map<string, WorkbenchSettingDefinition>(
  WORKBENCH_SETTINGS_GROUPS.flatMap((group) =>
    group.items.map((setting): [string, WorkbenchSettingDefinition] => [setting.id, setting])
  ),
);


function createDefaultValues(externalBindingIds: ReadonlySet<string> = new Set()): Record<string, WorkbenchSettingControlValue> {
  const values = Object.fromEntries(
    WORKBENCH_SETTINGS_GROUPS.flatMap((group) =>
      group.items
        .filter((setting) => !externalBindingIds.has(setting.id))
        .map((setting) => [setting.id, setting.defaultValue])
    ),
  );

  normalizeLocalValues(values, (settingId) => externalBindingIds.has(settingId) ? undefined : values[settingId]);

  return values;
}

export class WorkbenchSettingsDialogController {
  public selectedGroupId: SettingsGroupId = DEFAULT_SETTINGS_GROUP.id;
  public values: Record<string, WorkbenchSettingControlValue> = {};

  private static readonly RESET_OPERATION_KEYS: readonly string[] = [
    // 操作
    "game-quick-place",
    "game-arknights-immediate-move",
    "game-arknights-copy-while-moving",
    "game-arknights-immediate-marquee",
    "game-blueprint-placement-default-continuous",
    "game-arknights-allow-empty-logistics-endpoints",
    "game-arknights-auto-create-splitters-and-convergers",
  ];

  private readonly externalBindings: ReadonlyMap<string, WorkbenchSettingExternalBinding>;
  private readonly externalBindingIds: ReadonlySet<string>;
  private externalBindingRevision = 0;

  public constructor(options: WorkbenchSettingsDialogControllerOptions = {}) {
    const explicitBindings = new Map(Object.entries(options.externalBindings ?? {}));

    this.externalBindings = explicitBindings;
    this.externalBindingIds = new Set(this.externalBindings.keys());
    this.values = createDefaultValues(this.externalBindingIds);
    this.hydrate(readFromLocalStorage<unknown>(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY));
    if (this.normalizeLocalValues()) {
      this.persist();
    }

    makeAutoObservable<
      WorkbenchSettingsDialogController,
      | "externalBindingIds"
      | "externalBindings"
      | "getValue"
      | "isSettingEditable"
    >(
      this,
      {
        externalBindingIds: false,
        externalBindings: false,
        getValue: false,
        isSettingEditable: false,
      },
      { autoBind: true },
    );
  }

  public get selectedGroup(): WorkbenchSettingsGroupDefinition {
    return WORKBENCH_SETTINGS_GROUPS.find((group) => group.id === this.selectedGroupId)
      ?? DEFAULT_SETTINGS_GROUP;
  }

  public getValue(settingId: string): WorkbenchSettingControlValue | undefined {
    const externalBinding = this.externalBindings.get(settingId);
    if (!externalBinding) {
      return this.values[settingId];
    }

    void this.externalBindingRevision;
    const localValue = this.values[settingId];
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);

    if ((setting?.kind === "text" || setting?.kind === "password") && localValue !== undefined) {
      return localValue;
    }

    return externalBinding.readValue();
  }

  public isSettingEditable(settingId: string): boolean {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (!setting) {
      return false;
    }

    if (setting.disabled) {
      return false;
    }

    if (EXPERIMENTAL_SETTING_IDS.has(settingId)
      && this.getValue(EXPERIMENTAL_FEATURES_SETTING_ID) !== true) {
      return false;
    }

    if (!setting.editableWhen) {
      return true;
    }

    const conditions = "settingId" in setting.editableWhen
      ? [setting.editableWhen]
      : setting.editableWhen;
    return conditions.every((condition) =>
      this.getValue(condition.settingId) === condition.equals
    );
  }

  public selectGroup(groupId: SettingsGroupId): void {
    if (!WORKBENCH_SETTINGS_GROUPS.some((group) => group.id === groupId)) {
      return;
    }

    if (this.selectedGroupId === groupId) {
      return;
    }

    this.selectedGroupId = groupId;
    this.persist();
  }

  public updateSelectValue(settingId: string, value: string): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "select" || !this.isSettingEditable(settingId)) {
      return;
    }

    if (!setting.options.some((option) => option.value === value)) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      this.writeExternalBinding(externalBinding, value);

      return;
    }

    this.values[settingId] = value;
    this.persist();
  }

  public updateSliderValue(settingId: string, value: number): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "slider" || !Number.isFinite(value) || !this.isSettingEditable(settingId)) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      this.writeExternalBinding(externalBinding, normalizeSliderValue(setting, value));

      return;
    }

    this.values[settingId] = normalizeSliderValue(setting, value);
    this.persist();
  }

  public updateSwitchValue(settingId: string, checked: boolean): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "switch" || !this.isSettingEditable(settingId)) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      this.writeExternalBinding(externalBinding, checked);

      if (this.normalizeLocalValues()) {
        this.persist();
      }

      return;
    }

    this.values[settingId] = checked;
    this.normalizeLocalValues();
    this.persist();
  }


  public updateTextValue(settingId: string, value: string): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if ((setting?.kind !== "text" && setting?.kind !== "password") || !this.isSettingEditable(settingId)) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      this.writeExternalBinding(externalBinding, value);
      this.values[settingId] = value;

      return;
    }

    this.values[settingId] = value;
    this.persist();
  }



  /** 将鹰角操作模式相关开关恢复为默认值。 */
  public resetArknightsOperation(): void {
    for (const settingId of WorkbenchSettingsDialogController.RESET_OPERATION_KEYS) {
      const setting = SETTING_DEFINITION_BY_ID.get(settingId);
      if (!setting) continue;

      const externalBinding = this.externalBindings.get(settingId);
      if (externalBinding) {
        this.writeExternalBinding(externalBinding, setting.defaultValue);
      } else {
        this.values[settingId] = setting.defaultValue;
      }
    }

    this.normalizeLocalValues();
    this.persist();
  }

  /** 重置所有设置为默认值，包括快捷键、外部绑定和本地值。 */
  public resetAllSettings(): void {

    for (const setting of SETTING_DEFINITION_BY_ID.values()) {
      const externalBinding = this.externalBindings.get(setting.id);
      if (externalBinding) {
        this.writeExternalBinding(externalBinding, setting.defaultValue);
        if (setting.kind === "text" || setting.kind === "password") {
          this.values[setting.id] = setting.defaultValue;
        }
      } else {
        this.values[setting.id] = setting.defaultValue;
      }
    }

    this.normalizeLocalValues();
    this.persist();
  }

  private hydrate(persistedState: unknown): void {
    if (!isRecord(persistedState)) {
      return;
    }

    if (isSettingsGroupId(persistedState.selectedGroupId)) {
      this.selectedGroupId = persistedState.selectedGroupId;
    }

    if (!isRecord(persistedState.values)) {
      return;
    }

    const nextValues = createDefaultValues(this.externalBindingIds);

    for (const [settingId, rawValue] of Object.entries(persistedState.values)) {
      if (this.externalBindings.has(settingId)) {
        continue;
      }

      const setting = SETTING_DEFINITION_BY_ID.get(settingId);
      if (!setting) {
        continue;
      }

      if (setting.kind === "select" && typeof rawValue === "string") {
        if (setting.options.some((option) => option.value === rawValue)) {
          nextValues[settingId] = rawValue;
        }

        continue;
      }

      if (setting.kind === "slider" && typeof rawValue === "number" && Number.isFinite(rawValue)) {
        nextValues[settingId] = normalizeSliderValue(setting, rawValue);

        continue;
      }

      if (setting.kind === "switch" && typeof rawValue === "boolean") {
        nextValues[settingId] = rawValue;

        continue;
      }


      if ((setting.kind === "text" || setting.kind === "password") && typeof rawValue === "string") {
        nextValues[settingId] = rawValue;
      }
    }

    this.values = nextValues;
  }

  private writeExternalBinding(
    binding: WorkbenchSettingExternalBinding,
    value: WorkbenchSettingControlValue,
  ): void {
    binding.writeValue(value);
    this.externalBindingRevision += 1;
  }

  private persist(): PersistedUserSettingsDialogState {
    const values = Object.fromEntries(
      Object.entries(this.values).filter(([settingId]) => !this.externalBindingIds.has(settingId)),
    );

    return saveToLocalStorage(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, {
      selectedGroupId: this.selectedGroupId,
      values,
    });
  }

  private normalizeLocalValues(): boolean {
    let valuesChanged = normalizeLocalValues(this.values, (settingId) => this.getValue(settingId), (settingId, value) => {
      this.values[settingId] = value;
    });

    if (this.getValue(EXPERIMENTAL_FEATURES_SETTING_ID) === true) {
      return valuesChanged;
    }

    for (const setting of EXPERIMENTAL_SETTING_DEFINITIONS) {
      if (this.getValue(setting.id) === setting.defaultValue) {
        continue;
      }

      const externalBinding = this.externalBindings.get(setting.id);
      if (externalBinding) {
        this.writeExternalBinding(externalBinding, setting.defaultValue);
      } else {
        this.values[setting.id] = setting.defaultValue;
      }
      valuesChanged = true;
    }

    return valuesChanged;
  }

}

function normalizeLocalValues(
  values: Record<string, WorkbenchSettingControlValue>,
  getValue: (settingId: string) => WorkbenchSettingControlValue | undefined,
  setValue?: (settingId: string, value: boolean) => void,
): boolean {
  let changed = false;
  const applyValue = (settingId: string, nextValue: boolean) => {
    if (getValue(settingId) === nextValue) {
      return;
    }

    if (setValue) {
      setValue(settingId, nextValue);
    } else {
      values[settingId] = nextValue;
    }

    changed = true;
  };

  if (getValue(SIMPLIFIED_DEVICE_ICONS_SETTING_ID) === true) {
    applyValue(ALWAYS_SHOW_GRID_LINES_SETTING_ID, true);
    applyValue(SHOW_GRASS_BACKGROUND_SETTING_ID, false);
    applyValue(SHOW_DEVICE_ICONS_SETTING_ID, true);
  }

  return changed;
}

function normalizeSliderValue(
  setting: WorkbenchSliderSettingDefinition,
  value: number,
): number {
  const clamped = Math.min(setting.max, Math.max(setting.min, value));
  const steps = Math.round((clamped - setting.min) / setting.step);
  const rounded = setting.min + (steps * setting.step);
  const decimals = countDecimals(setting.step);

  return Number(rounded.toFixed(decimals));
}

function countDecimals(step: number): number {
  const [, decimals = ""] = `${step}`.split(".");

  return decimals.length;
}


function isSettingsGroupId(value: unknown): value is SettingsGroupId {
  return WORKBENCH_SETTINGS_GROUPS.some((group) => group.id === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
