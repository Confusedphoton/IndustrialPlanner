import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import type { AppHost } from "@/app/host/app-host";
import { observer } from "mobx-react-lite";
import { runInAction } from "mobx";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { EntityVariantDefinition } from "@/domain/registry/types/entity-variant-definition";
import { useEditorDocumentSnapshot } from "../hooks";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import type { PlacementGroup } from "@/app/state/state-impl";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import { KeyboardShortcutPrompt, PlacementPaletteRow } from "@/app/shell/shared";
import LucideChevronDown from "~icons/lucide/chevron-down";
import { createEntityIconAssetUrl, createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import { isMobileOrTabletScreenProfile } from "@/shared/browser/screen-profile";
import {
  collapseEntityVariantDefinitions,
  resolveEntityCraftGroupKey,
  resolveEntityVariantDefinitions,
  resolveEntityVariantName,
} from "@/shared/entity-variants";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const DEVICE_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
const COMPACT_DEVICE_LABEL_MAX_WIDTH = 6.5;

function estimateDeviceLabelWidth(label: string): number {
  let width = 0;
  for (const character of label) {
    width += (character.codePointAt(0) ?? 0) <= 0x7f ? 0.5 : 1;
  }
  return width;
}

// ─── 设备图标路径映射 ───
function resolveDeviceIconPath(definition: EntityDefinition): string {
  return createEntityIconAssetUrl(definition.iconPath);
}

// ─── uiGroup → 分组配置映射 ───
const UI_GROUP_SECTION_CONFIG: Record<PlacementGroup, {
  titleKey: string;
  shortcutKeyId?: ShortcutKeyId;
}> = {
  beltLogistics: {
    titleKey: "workbench.section.beltLogistics",
    shortcutKeyId: SHORTCUT_KEY.PLACE_CONVEYOR,
  },
  pipeLogistics: {
    titleKey: "workbench.section.pipeLogistics",
    shortcutKeyId: SHORTCUT_KEY.PLACE_PIPE,
  },
  resourcePower: {
    titleKey: "workbench.section.resourcePower",
    shortcutKeyId: SHORTCUT_KEY.RESOURCES_POWER,
  },
  warehouse: {
    titleKey: "workbench.section.warehouse",
    shortcutKeyId: SHORTCUT_KEY.WAREHOUSE,
  },
  basicProduction: {
    titleKey: "workbench.section.production",
    shortcutKeyId: SHORTCUT_KEY.BASIC_PRODUCTION,
  },
  advancedManufacturing: {
    titleKey: "workbench.section.advancedManufacturing",
    shortcutKeyId: SHORTCUT_KEY.SYNTHESIS,
  },
  agriculture: {
    titleKey: "workbench.section.agriculture",
  },
  cheat: {
    titleKey: "workbench.section.cheat",
    shortcutKeyId: SHORTCUT_KEY.CHEAT,
  },
};

/** 设备分组在面板中的显示顺序 */
const DEVICE_SECTION_ORDER: readonly PlacementGroup[] = [
  "beltLogistics",
  "pipeLogistics",
  "resourcePower",
  "warehouse",
  "basicProduction",
  "advancedManufacturing",
  "agriculture",
  "cheat",
];

// ─── 类型定义 ───

interface PlacementButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: string;
  readonly entityVariant?: EntityVariantDefinition;
  readonly craftGroupKey?: string;
  readonly variantDefinitions?: readonly EntityDefinition[];
  readonly icon?: ComponentProps<typeof WorkbenchIcon>["kind"];
  readonly iconSrc?: string;
  readonly hotkey?: string | null;
  readonly hotkeyKeyId?: ShortcutKeyId;
  readonly visibleWhen?: (appHost: AppHost) => boolean;
  readonly activeWhen?: (appHost: AppHost) => boolean;
}

interface PlacementSectionDefinition {
  readonly uiGroup: PlacementGroup;
  readonly titleKey: string;
  readonly shortcutKey: string | null;
  readonly buttons: readonly PlacementButtonDefinition[];
}

// ─── 动态构建设备分组 ───

function buildPlacementDeviceSections(appHost: AppHost): readonly PlacementSectionDefinition[] {
  // 1. 按 uiGroup 分组设备（过滤 hidden，组内按 id 排序）
  const groupedByUiGroup = new Map<PlacementGroup, EntityDefinition[]>();
  for (const group of DEVICE_SECTION_ORDER) {
    groupedByUiGroup.set(group, []);
  }

  for (const entity of appHost.workspace.registry.entityDefinitions) {
    if (entity.uiGroup === "hidden") continue;
    if (entity.tags.includes("不可摆放")) continue;
    if (!canPlaceEntityDefinitionInCurrentBase(appHost.mainCanvas, entity)) continue;
    const group = groupedByUiGroup.get(entity.uiGroup);
    if (group) {
      group.push(entity);
    }
  }

  // 组内按 displayOrder 排序（order 越小越靠前），同 order 按 id 兜底
  for (const [, entities] of groupedByUiGroup) {
    entities.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  }

  // 2. 构建设备分组 section
  const deviceSections: PlacementSectionDefinition[] = DEVICE_SECTION_ORDER
    .map((uiGroup) => {
      const config = UI_GROUP_SECTION_CONFIG[uiGroup];
      const entities = groupedByUiGroup.get(uiGroup) ?? [];
      const shortcutKey = config.shortcutKeyId === undefined
        ? null
        : appHost.internalActions.getKeyboardShortcutFor(config.shortcutKeyId);

      const visibleEntities = appHost.state.settings.collapseDeviceModes
        ? collapseEntityVariantDefinitions({
            definitions: entities,
            selectedVariantNameByCraftGroup:
              appHost.state.workbench.selectedPlacementVariantByCraftGroup,
          })
        : entities;
      const buttons: PlacementButtonDefinition[] = visibleEntities.map((entity) => {
        const variantDefinitions = resolveEntityVariantDefinitions({
          definitionId: entity.id,
          definitions: entities,
        });
        const variantName = resolveEntityVariantName(entity);
        const entityVariant = variantDefinitions.length > 1 && variantName !== null
          ? appHost.workspace.registry.entityVariantDefinitions[variantName]
          : undefined;

        return {
          uiButtonId: `placement-${entity.id}`,
          labelKey: entity.nameKey,
          entityVariant,
          craftGroupKey: entityVariant === undefined
            ? undefined
            : resolveEntityCraftGroupKey(entity) ?? undefined,
          variantDefinitions: entityVariant === undefined ? undefined : variantDefinitions,
        };
      });

      return {
        uiGroup,
        titleKey: config.titleKey,
        shortcutKey: shortcutKey || null,
        buttons,
      };
    })
    .filter((section) => section.buttons.length > 0);

  return deviceSections;
}


function resolveVariantModeIconSrc(entityVariant: EntityVariantDefinition): string {
  return createPublicAssetUrl(entityVariant.iconPath);
}

function resolveVariantModeIconStyle(entityVariant: EntityVariantDefinition): CSSProperties {
  const maskImage = `url("${resolveVariantModeIconSrc(entityVariant)}")`;

  return {
    maskImage,
    WebkitMaskImage: maskImage,
  };
}

function resolveVariantMenuStyle(
  anchor: DOMRect,
  itemCount: number,
): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? 336 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 480 : window.innerHeight;
  const width = Math.min(320, Math.max(240, viewportWidth - 16));
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - width - 8));
  const estimatedHeight = Math.min(300, itemCount * 46 + 8);
  const openAbove = anchor.bottom + estimatedHeight + 8 > viewportHeight
    && anchor.top > estimatedHeight + 8;

  return {
    left,
    top: openAbove ? anchor.top - 4 : anchor.bottom + 4,
    width,
    transform: openAbove ? "translateY(-100%)" : undefined,
  };
}

function persistSelectedPlacementVariant(
  appHost: AppHost,
  craftGroupKey: string,
  definition: EntityDefinition,
): void {
  const variantName = resolveEntityVariantName(definition);
  if (variantName === null) {
    return;
  }

  runInAction(() => {
    appHost.internalState.workbench.selectedPlacementVariantByCraftGroup = {
      ...appHost.internalState.workbench.selectedPlacementVariantByCraftGroup,
      [craftGroupKey]: variantName,
    };
  });
}

function triggerPlacementDeviceFromKeyboard(
  appHost: AppHost,
  deviceId: string,
  event: ReactKeyboardEvent<HTMLButtonElement>,
): void {
  appHost.gestureAdapter.handleUiButtonMouseTap({
    uiButtonId: `ui-left-dock-placement-mode-${deviceId}-mouse-tap`,
    button: 0,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    sourceEvent: event.nativeEvent,
  });
}

const PlacementDeviceButton = observer(function PlacementDeviceButton({
  appHost,
  button,
  buttonLabel,
  deviceId,
  hotkey,
  isActive,
  labelClassName,
  onButtonPointerDown,
  onButtonPointerUp,
  showDeviceHotkey,
}: {
  readonly appHost: AppHost;
  readonly button: PlacementButtonDefinition;
  readonly buttonLabel: string;
  readonly deviceId: string;
  readonly hotkey: string | null | undefined;
  readonly isActive: boolean;
  readonly labelClassName: string;
  readonly onButtonPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onButtonPointerUp: (
    event: ReactPointerEvent<HTMLButtonElement>,
    button: Pick<PlacementButtonDefinition, "uiButtonId">,
  ) => void;
  readonly showDeviceHotkey: boolean;
}) {
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mainButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const t = appHost.actions.translate;
  const baseId = useEditorDocumentSnapshot(appHost.workspace.editor, selectDocumentBaseId, Object.is);
  const entityVariant = button.entityVariant;
  const craftGroupKey = button.craftGroupKey;
  const variantDefinitions = button.variantDefinitions ?? [];
  const definition = appHost.workspace.registry.entityDefinitions.find((entry) => entry.id === deviceId);
  const canOpenVariantMenu = appHost.state.settings.collapseDeviceModes
    && entityVariant !== undefined
    && craftGroupKey !== undefined
    && variantDefinitions.length > 1;
  const isMenuOpen = canOpenVariantMenu && menuAnchor !== null;
  useEffect(() => {
    setMenuAnchor(null);
  }, [baseId]);
  const variantLongName = entityVariant === undefined
    ? null
    : t(entityVariant.longNameKey);
  const className = isActive
    ? "placement-button placement-device-button is-active"
    : "placement-button placement-device-button";

  const openVariantMenu = () => {
    if (!canOpenVariantMenu) {
      return;
    }

    const anchor = triggerButtonRef.current?.getBoundingClientRect();
    if (anchor !== undefined) {
      setMenuAnchor(anchor);
    }
  };

  const toggleVariantMenu = () => {
    if (menuAnchor === null) {
      openVariantMenu();
      return;
    }
    setMenuAnchor(null);
  };


  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const closeMenu = () => setMenuAnchor(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (shellRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [isMenuOpen]);


  const handleVariantSelection = (
    definition: EntityDefinition,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (craftGroupKey !== undefined) {
      persistSelectedPlacementVariant(appHost, craftGroupKey, definition);
    }
    setMenuAnchor(null);
    onButtonPointerUp(event, { uiButtonId: `placement-${definition.id}` });
  };

  const handleVariantSelectionKeyDown = (
    definition: EntityDefinition,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    if (craftGroupKey !== undefined) {
      persistSelectedPlacementVariant(appHost, craftGroupKey, definition);
    }
    setMenuAnchor(null);
    triggerPlacementDeviceFromKeyboard(appHost, definition.id, event);
  };

  return (
    <PlacementPaletteRow
      className={cm(styles, entityVariant === undefined ? "placement-device-button-shell" : "placement-device-button-shell has-entity-variant")}
      rootRef={shellRef}
      label={buttonLabel}
      iconSrc={definition === undefined ? undefined : resolveDeviceIconPath(definition)}
      iconClassName={cm(styles, "button-icon")}
      imageClassName={cm(styles, "button-icon-image")}
      labelClassName={cm(styles, labelClassName)}
      buttonProps={{
        "aria-pressed": isActive ? isActive : undefined,
        className: cm(styles, className, entityVariant === undefined ? null : "has-entity-variant"),
        "data-ui-button-id": button.uiButtonId,
        onPointerDown: onButtonPointerDown,
        onPointerUp: event => onButtonPointerUp(event, button),
        ref: mainButtonRef,
      }}
      buttonSuffix={<>
        {showDeviceHotkey ? (
          <span className={cm(styles, "placement-button-hotkey")}>
            <KeyboardShortcutPrompt shortcut={hotkey ?? ""} size="small" />
          </span>
        ) : null}
      </>}
    >
      {entityVariant !== undefined && !canOpenVariantMenu ? (
        <span
          aria-hidden="true"
          className={cm(styles, "placement-entity-variant-indicator")}
          data-entity-variant-name={entityVariant.variantName}
          title={variantLongName ?? undefined}
        >
          <span
            className={cm(styles, "placement-entity-variant-mode-icon")}
            data-machine-mode-icon="true"
            style={resolveVariantModeIconStyle(entityVariant)}
          />
        </span>
      ) : null}
      {canOpenVariantMenu ? (
        <button
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={variantLongName ?? buttonLabel}
          className={cm(styles, "placement-entity-variant-trigger")}
          data-entity-variant-name={entityVariant.variantName}
          data-ui-button-id={`${button.uiButtonId}-variant-trigger`}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            event.preventDefault();
            toggleVariantMenu();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onButtonPointerDown(event);
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            if (event.pointerType === "mouse" && event.button !== 0) {
              return;
            }
            toggleVariantMenu();
          }}
          ref={triggerButtonRef}
          title={variantLongName ?? undefined}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cm(styles, "placement-entity-variant-mode-icon")}
            data-machine-mode-icon="true"
            style={resolveVariantModeIconStyle(entityVariant as EntityVariantDefinition)}
          />
          <LucideChevronDown className={cm(styles, "placement-entity-variant-chevron")} aria-hidden="true" />
        </button>
      ) : null}
      <OverlayStackLayer
        kind="system"
        layerId={`placement-variant-menu-${craftGroupKey ?? deviceId}`}
        visible={isMenuOpen}
      >
        {({ zIndex }) => (
          <div className={cm(styles, "placement-variant-menu-layer")} style={{ zIndex }}>
            <div
              aria-label={buttonLabel}
              className={cm(styles, "placement-variant-menu")}
              onPointerDown={(event) => event.stopPropagation()}
              ref={menuRef}
              role="menu"
              style={resolveVariantMenuStyle(menuAnchor as DOMRect, variantDefinitions.length)}
            >
              {variantDefinitions.map((definition) => {
                const variantName = resolveEntityVariantName(definition);
                const variantDefinition = variantName === null
                  ? undefined
                  : appHost.workspace.registry.entityVariantDefinitions[variantName];
                if (variantDefinition === undefined) {
                  return null;
                }

                const isSelected = definition.id === deviceId;
                const menuItemLabel = `${t(definition.nameKey)} · ${t(variantDefinition.longNameKey)}`;

                return (
                  <button
                    aria-checked={isSelected}
                    className={cm(
                      styles,
                      isSelected
                        ? "placement-variant-menu-item is-selected"
                        : "placement-variant-menu-item",
                    )}
                    data-entity-variant-name={variantName}
                    key={definition.id}
                    onKeyDown={(event) => handleVariantSelectionKeyDown(definition, event)}
                    onPointerDown={onButtonPointerDown}
                    onPointerUp={(event) => handleVariantSelection(definition, event)}
                    role="menuitemradio"
                    type="button"
                  >
                    <span className={cm(styles, "placement-variant-menu-icon")} aria-hidden="true">
                      <span
                        className={cm(styles, "placement-entity-variant-mode-icon")}
                        data-machine-mode-icon="true"
                        style={resolveVariantModeIconStyle(variantDefinition)}
                      />
                    </span>
                    <span className={cm(styles, "placement-variant-menu-label")}>{menuItemLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </OverlayStackLayer>
    </PlacementPaletteRow>
  );
});

export const PlacementPanel = observer(function PlacementPanel({
  appHost,
  active = true,
}: {
  appHost: AppHost;
  active?: boolean;
}) {
  const t = appHost.actions.translate;
  // 设备搜索。输入即过滤，Enter 放置首个匹配，Esc 清空；画布上按 “/” 聚焦。
  const [deviceQuery, setDeviceQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // 最近放置的设备（本机 localStorage），以及分类跳转用的分组节点。
  const [recentDeviceIds, setRecentDeviceIds] = useState<readonly string[]>(() => readRecentPlacementDevices());
  const sectionElementsRef = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!active) {
      return;
    }
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || isEditableEventTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [active]);
  const editor = appHost.workspace.editor;
  // 订阅 document 变化以在切换基地后重新过滤设备列表
  useEditorDocumentSnapshot(editor, selectDocumentBaseId, Object.is);
  const screenProfile = appHost.state.screenProfile;
  const isTouchLayout = isMobileOrTabletScreenProfile(screenProfile);
  const showShortcutHints = !isTouchLayout && appHost.state.settings.gameShowHotkeys;
  const normalizedDeviceQuery = deviceQuery.trim().toLowerCase();
  const deviceSections = filterPlacementDeviceSections(buildPlacementDeviceSections(appHost), normalizedDeviceQuery, t);
  const firstMatchedDeviceId = normalizedDeviceQuery.length === 0
    ? null
    : deviceSections[0]?.buttons[0]?.uiButtonId.replace("placement-", "") ?? null;

  const handleButtonPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    preventTouchPointerCompatibilityMouseEvents(event);
  };

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    button: Pick<PlacementButtonDefinition, "uiButtonId">,
  ) => {
    const deviceId = button.uiButtonId.replace("placement-", "");
    if (event.pointerType !== "mouse" || event.button === 0) {
      setRecentDeviceIds(recordRecentPlacementDevice(deviceId));
      // 从面板选择设备时清除配方树带入的放置配置，避免旧配方带到新放置。
      runInAction(() => {
        appHost.mainCanvas.state.runtime.singlePlacementConfig = null;
      });
    }
    const uiButtonId = `ui-left-dock-placement-mode-${deviceId}-${event.pointerType === "mouse" ? "mouse-tap" : "touch-tap"}`;

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId,
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
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  return (
    <div className={cm(styles, "placement-panel")}>
      <div className={cm(styles, "placement-panel-sticky-header")}>
      <input
        aria-label={t("placement.search")}
        className={cm(styles, "placement-search-input")}
        onChange={(event) => setDeviceQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            setDeviceQuery("");
            event.currentTarget.blur();
            return;
          }
          if (event.key === "Enter" && firstMatchedDeviceId !== null) {
            setRecentDeviceIds(recordRecentPlacementDevice(firstMatchedDeviceId));
            appHost.gestureAdapter.handleUiButtonMouseTap({
              uiButtonId: `ui-left-dock-placement-mode-${firstMatchedDeviceId}-mouse-tap`,
              button: 0,
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
              sourceEvent: event.nativeEvent,
            });
            setDeviceQuery("");
            event.currentTarget.blur();
          }
        }}
        placeholder={t(isTouchLayout ? "placement.searchShort" : "placement.searchWithShortcut")}
        ref={searchInputRef}
        type="search"
        value={deviceQuery}
      />
      {normalizedDeviceQuery.length === 0 && deviceSections.length > 1 ? (
        <nav aria-label={t("placement.jumpToCategory")} className={cm(styles, "placement-category-chips")}>
          {deviceSections.map((section) => (
            <button
              className={cm(styles, "placement-category-chip")}
              key={section.titleKey}
              onClick={() => {
                sectionElementsRef.current.get(section.titleKey)?.scrollIntoView({ block: "start", behavior: "smooth" });
              }}
              type="button"
            >
              {t(section.titleKey)}
            </button>
          ))}
        </nav>
      ) : null}
      </div>
      {normalizedDeviceQuery.length === 0 ? (() => {
        const recentButtons = resolveRecentPlacementButtons(deviceSections, recentDeviceIds);
        if (recentButtons.length === 0) {
          return null;
        }
        return (
          <>
          <section aria-labelledby="placement-recent-section" className={cm(styles, "placement-panel-group")}>
            <div className={cm(styles, "placement-panel-group-header")}>
              <h3 id="placement-recent-section">{t("placement.recent")}</h3>
            </div>
            <div className={cm(styles, "placement-button-list is-tile-grid")}>
              {recentButtons.map((button) => {
                const deviceId = button.uiButtonId.replace("placement-", "");
                const activePlacementDeviceId = appHost.mainCanvas.state.runtime.singlePlacementDeviceId;
                const isActive = appHost.mainCanvas.state.activeTool === "single-placement"
                  && (activePlacementDeviceId === deviceId
                    || (appHost.state.settings.collapseDeviceModes
                      && button.variantDefinitions?.some((definition) => definition.id === activePlacementDeviceId) === true));
                return (
                  <PlacementDeviceButton
                    appHost={appHost}
                    button={button}
                    buttonLabel={t(button.labelKey)}
                    deviceId={deviceId}
                    hotkey={null}
                    isActive={isActive}
                    key={`recent-${button.uiButtonId}`}
                    labelClassName="placement-button-label"
                    onButtonPointerDown={handleButtonPointerDown}
                    onButtonPointerUp={handleButtonPointerUp}
                    showDeviceHotkey={false}
                  />
                );
              })}
            </div>
          </section>
          <div aria-hidden="true" className={cm(styles, "placement-panel-divider")} />
          </>
        );
      })() : null}

      {deviceSections.map((section, sectionIndex) => {
        const sectionTitleId = `placement-device-section-${sectionIndex}`;
        const isPlacementGroupActive = (
          appHost.mainCanvas.state.activeTool === "select"
          && appHost.mainCanvas.state.runtime.selectingPlacementGroup === section.uiGroup
        ) || (
          appHost.mainCanvas.state.activeTool === "logistics-placement"
          && appHost.mainCanvas.state.runtime.logisticsPlacement.shortcutPlacementGroup === section.uiGroup
        );

        return (
          <Fragment key={section.titleKey}>
            {sectionIndex > 0 ? <div aria-hidden="true" className={cm(styles, "placement-panel-divider")} /> : null}
            <section
              aria-labelledby={sectionTitleId}
              ref={(element) => {
                if (element === null) {
                  sectionElementsRef.current.delete(section.titleKey);
                } else {
                  sectionElementsRef.current.set(section.titleKey, element);
                }
              }}
              className={cm(styles, isPlacementGroupActive
                ? "placement-panel-group is-placement-group-active"
                : "placement-panel-group")}
            >
              <div className={cm(styles, "placement-panel-group-header")}>
                <h3 id={sectionTitleId}>{t(section.titleKey)}</h3>
                {showShortcutHints && section.shortcutKey ? (
                  <span className={cm(styles, "placement-panel-group-shortcut")}>
                    <KeyboardShortcutPrompt shortcut={section.shortcutKey} size="small" />
                  </span>
                ) : null}
              </div>
              <div className={cm(styles, "placement-button-list is-tile-grid")}>
                {section.buttons.map((button, buttonIndex) => {
                  const buttonLabel = t(button.labelKey);
                  const hotkey = button.hotkey
                    ?? (button.hotkeyKeyId
                      ? appHost.internalActions.getKeyboardShortcutFor(button.hotkeyKeyId)
                      : DEVICE_SHORTCUT_KEYS[buttonIndex]);
                  const deviceId = button.uiButtonId.replace("placement-", "");
                  const activePlacementDeviceId = appHost.mainCanvas.state.runtime.singlePlacementDeviceId;
                  const isActive = appHost.mainCanvas.state.activeTool === "single-placement"
                    && (
                      activePlacementDeviceId === deviceId
                      || (
                        appHost.state.settings.collapseDeviceModes
                        && button.variantDefinitions?.some((definition) =>
                          definition.id === activePlacementDeviceId,
                        ) === true
                      )
                    );
                  const showDeviceHotkey = Boolean(
                    !isTouchLayout && isPlacementGroupActive && hotkey,
                  );
                  const labelClassName = estimateDeviceLabelWidth(buttonLabel) > COMPACT_DEVICE_LABEL_MAX_WIDTH
                    ? "placement-button-label is-compact"
                    : "placement-button-label";

                  return (
                    <PlacementDeviceButton
                      appHost={appHost}
                      button={button}
                      buttonLabel={buttonLabel}
                      deviceId={deviceId}
                      hotkey={hotkey}
                      isActive={isActive}
                      key={button.uiButtonId}
                      labelClassName={labelClassName}
                      onButtonPointerDown={handleButtonPointerDown}
                      onButtonPointerUp={handleButtonPointerUp}
                      showDeviceHotkey={showDeviceHotkey}
                    />
                  );
                })}
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
});

/** 按设备名称（当前语言）与设备 ID 过滤放置面板分组，空分组隐藏。 */
function filterPlacementDeviceSections(
  sections: readonly PlacementSectionDefinition[],
  normalizedQuery: string,
  translate: (key: string) => string,
): readonly PlacementSectionDefinition[] {
  if (normalizedQuery.length === 0) {
    return sections;
  }

  return sections
    .map((section) => ({
      ...section,
      buttons: section.buttons.filter((button) => (
        translate(button.labelKey).toLowerCase().includes(normalizedQuery)
        || button.uiButtonId.toLowerCase().includes(normalizedQuery)
        || (button.variantDefinitions ?? []).some((definition) => (
          translate(definition.nameKey).toLowerCase().includes(normalizedQuery)
        ))
      )),
    }))
    .filter((section) => section.buttons.length > 0);
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable
    || target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT";
}

// 最近放置的设备

const RECENT_PLACEMENT_STORAGE_KEY = "industrial-planner-recent-placements";
const MAX_RECENT_PLACEMENT_DEVICES = 8;

function readRecentPlacementDevices(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_PLACEMENT_STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RECENT_PLACEMENT_DEVICES)
      : [];
  } catch {
    return [];
  }
}

function recordRecentPlacementDevice(deviceId: string): readonly string[] {
  const next = [deviceId, ...readRecentPlacementDevices().filter((entry) => entry !== deviceId)]
    .slice(0, MAX_RECENT_PLACEMENT_DEVICES);
  try {
    window.localStorage.setItem(RECENT_PLACEMENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable in private contexts.
  }
  return next;
}

/** 将最近设备 ID 映射回当前基地可用的放置按钮；折叠模式下变体归并到同一按钮。 */
function resolveRecentPlacementButtons(
  sections: readonly PlacementSectionDefinition[],
  recentDeviceIds: readonly string[],
): readonly PlacementButtonDefinition[] {
  const buttons = sections.flatMap((section) => section.buttons);
  const resolved: PlacementButtonDefinition[] = [];
  for (const deviceId of recentDeviceIds) {
    const button = buttons.find((candidate) => (
      candidate.uiButtonId === `placement-${deviceId}`
      || candidate.variantDefinitions?.some((definition) => definition.id === deviceId) === true
    ));
    if (button !== undefined && !resolved.includes(button)) {
      resolved.push(button);
    }
  }
  return resolved;
}
