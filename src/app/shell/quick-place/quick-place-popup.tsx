import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { observer } from "mobx-react-lite";
import LucideStar from "~icons/lucide/star";
import LucideStarOff from "~icons/lucide/star-off";
import { runInAction } from "mobx";

import { canPlaceEntityDefinitionInBase } from "@/app/placement-zone-availability";
import { createEntityIconAssetUrl, createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import LucideLayoutGrid from "~icons/lucide/layout-grid";
import { PLACEMENT_CATEGORIES } from "@/app/shell/panels/placement-catalog";
import { resolveEntityVariantName, resolveEntityCraftGroupKey } from "@/shared/entity-variants";
import {
  QUICK_PLACE_FAVORITE_LIMIT,
  QUICK_PLACE_SLOT_SHORTCUTS,
  buildQuickPlaceDeviceEntries,
  filterQuickPlaceDeviceEntries,
  moveQuickPlaceFavoriteToSlot,
  normalizeQuickPlaceFavorites,
  placeQuickPlaceFavoriteAtSlot,
  removeQuickPlaceFavoriteAtSlot,
  triggerQuickPlaceDeviceSelection,
  type QuickPlaceDeviceEntry,
} from "@/app/quick-place";
import type { AppHost } from "@/app/host/app-host";
import { recentPlacementDevices } from "@/app/recent-placement-devices";
import { useEditorDocumentSnapshot } from "../hooks";
import { cm } from "@/app/shell/shared/css-module-class";
import { avoidCanvasToolRail, type CanvasRect } from "@/app/shell/canvas/canvas-tool-rail-bounds";
import { resolveOverlayBottomLimit } from "@/app/shell/layout/status-bar-bounds";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import styles from "@/app/shell/app-shell.module.scss";

const QUICK_PLACE_DRAG_FORMAT = "application/x-industrial-planner-quick-place";
const QUICK_PLACE_RECENT_LIMIT = 4;

type QuickPlaceDragPayload =
  | {
    readonly source: "menu";
    readonly deviceId: string;
  }
  | {
    readonly source: "favorite";
    readonly deviceId: string;
    readonly index: number;
  };

export const QuickPlacePopup = observer(function QuickPlacePopup({ appHost }: { appHost: AppHost }) {
  const editor = appHost.workspace.editor;
  const documentBaseId = useEditorDocumentSnapshot(editor, selectDocumentBaseId, Object.is);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const favoritesRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const deviceButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeDragPayloadRef = useRef<QuickPlaceDragPayload | null>(null);
  const favoriteDropHandledRef = useRef(false);
  const dropTargetIndexRef = useRef<number | null>(null);
  const suppressPointerSelectionRef = useRef(false);
  const [draggingFavoriteIndex, setDraggingFavoriteIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
  const deviceListId = useId();
  const t = appHost.actions.translate;
  const runtime = appHost.mainCanvas.state.runtime.quickPlace;
  const activeResultId = runtime.activeResultId;
  const anchor = runtime.anchor;
  const visible = runtime.visible && anchor !== null;
  const currentBaseId = documentBaseId ?? null;
  const entries = useMemo(() =>
    buildQuickPlaceDeviceEntries({
      definitions: appHost.workspace.registry.entityDefinitions,
      translate: t,
      canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(appHost, definition, currentBaseId),
    }),
  [appHost, currentBaseId, t]);
  const categories = useMemo(() => PLACEMENT_CATEGORIES.flatMap((category) => {
    const first = entries.find((entry) => entry.definition.uiGroup === category.uiGroup);
    return first === undefined ? [] : [{ ...category, iconDeviceId: first.id }];
  }), [entries]);
  const availableEntityIds = useMemo(
    () => new Set(entries.map((entry) => entry.id)),
    [entries],
  );
  const registeredEntityIds = useMemo(
    () => new Set(appHost.workspace.registry.entityDefinitions.map((definition) => definition.id)),
    [appHost],
  );
  const favorites = normalizeQuickPlaceFavorites(
    appHost.internalState.workbench.quickPlaceFavoriteEntityIds,
    registeredEntityIds,
  );
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const variantById = useMemo(() => {
    const countsByGroup = new Map<string, number>();
    for (const entry of entries) {
      const group = resolveEntityCraftGroupKey(entry.definition);
      if (group !== null) countsByGroup.set(group, (countsByGroup.get(group) ?? 0) + 1);
    }
    return new Map(entries.map((entry) => {
      const variantName = resolveEntityVariantName(entry.definition);
      const group = resolveEntityCraftGroupKey(entry.definition);
      return [
        entry.id,
        variantName === null || group === null || (countsByGroup.get(group) ?? 0) <= 1
          ? undefined
          : appHost.workspace.registry.entityVariantDefinitions[variantName],
      ] as const;
    }));
  }, [appHost, entries]);
  // 状态栏位置只在弹出层打开和窗口尺寸变化时读取，避免每次渲染都强制布局。
  const viewportBounds = useMemo(
    () => (visible ? measurePopupViewportBounds() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 每次打开（新的 anchor）与窗口尺寸变化时重新测量。
    [anchor, viewportRevision, visible],
  );
  const filteredEntries = useMemo(
    () => filterQuickPlaceDeviceEntries(entries, runtime.searchQuery, runtime.category),
    [entries, runtime.searchQuery, runtime.category],
  );
  // 搜索为空时在设备列表顶部列出最近放置的设备，用笔在画布旁直接切换设备。
  const recentEntries = runtime.searchQuery.trim() === "" && runtime.category === null
    ? recentPlacementDevices.deviceIds
      .flatMap((deviceId) => entryById.get(deviceId) ?? [])
      .slice(0, QUICK_PLACE_RECENT_LIMIT)
    : [];

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (!arraysEqual(favorites, appHost.internalState.workbench.quickPlaceFavoriteEntityIds)) {
      runInAction(() => {
        appHost.internalState.workbench.quickPlaceFavoriteEntityIds = favorites;
      });
    }
  }, [appHost, favorites, visible]);


  // 快速放置键盘快捷键现在显式请求搜索焦点，以支持连续键盘搜索与选择。
  useEffect(() => {
    if (!visible) {
      return;
    }

    runInAction(() => {
      runtime.activeResultId = null;
    });
    if (runtime.openSource === "keyboard-shortcut") {
      searchInputRef.current?.focus({ preventScroll: true });
    }
  }, [runtime, runtime.openSource, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handleResize = () => setViewportRevision((revision) => revision + 1);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [visible]);

  useEffect(() => {
    if (activeResultId === null) {
      return;
    }

    deviceButtonRefs.current.get(activeResultId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeResultId]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const target = event.target as Node | null;

      if (target !== searchInputRef.current) {
        searchInputRef.current?.blur();
      }

      if (root === null || root.contains(target)) {
        return;
      }

      closeQuickPlace(appHost);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [appHost, visible]);

  if (!visible || anchor === null || viewportBounds === null) {
    return null;
  }

  const favoriteSlots = Array.from({ length: QUICK_PLACE_FAVORITE_LIMIT }, (_, index) => {
    const id = favorites[index];
    return id !== null && id !== undefined && availableEntityIds.has(id) ? id : null;
  });
  // 没有任何收藏时收起收藏格，把位置让给设备列表；行尾的星标会填入第一个空位，收藏格随之出现。
  const showsFavorites = favoriteSlots.some((id) => id !== null);
  const popupStyle = resolvePopupStyle(anchor.x, anchor.y, appHost.mainCanvas.view.state.clientRect, viewportBounds, showsFavorites);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (appHost.gestureAdapter.handleKeyDown(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (appHost.gestureAdapter.handleKeyUp(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function selectDevice(deviceId: string, options: {
    readonly source: "mouse" | "touch";
    readonly button?: number;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
    readonly sourceEvent: unknown;
  }): void {
    closeQuickPlace(appHost);
    triggerQuickPlaceDeviceSelection({
      appHost,
      deviceId,
      source: options.source,
      button: options.button,
      altKey: options.altKey,
      ctrlKey: options.ctrlKey,
      metaKey: options.metaKey,
      shiftKey: options.shiftKey,
      sourceEvent: options.sourceEvent,
    });
  }

  function selectDeviceFromPointer(deviceId: string, event: ReactPointerEvent<HTMLButtonElement>): void {
    if (suppressPointerSelectionRef.current) {
      suppressPointerSelectionRef.current = false;
      return;
    }

    selectDevice(deviceId, {
      source: event.pointerType === "mouse" ? "mouse" : "touch",
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  }

  function handleSelectablePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    suppressPointerSelectionRef.current = false;
    preventTouchPointerCompatibilityMouseEvents(event);
  }

  function selectDeviceFromKeyboardClick(deviceId: string, event: ReactMouseEvent<HTMLButtonElement>): void {
    if (event.detail !== 0) {
      return;
    }

    selectDevice(deviceId, {
      source: "mouse",
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  }

  function writeDragPayload(event: DragEvent<HTMLElement>, payload: QuickPlaceDragPayload): void {
    event.stopPropagation();
    activeDragPayloadRef.current = payload;
    updateDropTargetIndex(null);
    suppressPointerSelectionRef.current = true;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(QUICK_PLACE_DRAG_FORMAT, JSON.stringify(payload));
  }

  function updateDropTargetIndex(index: number | null): void {
    dropTargetIndexRef.current = index;
    setDropTargetIndex(index);
  }

  function commitFavorites(nextFavorites: readonly (string | null)[]): void {
    runInAction(() => {
      appHost.internalState.workbench.quickPlaceFavoriteEntityIds =
        normalizeQuickPlaceFavorites(nextFavorites, registeredEntityIds);
    });
  }

  function handleFavoriteDrop(event: DragEvent<HTMLElement>, slotIndex: number): void {
    event.preventDefault();
    event.stopPropagation();

    const payload = readDragPayload(event) ?? activeDragPayloadRef.current;
    if (payload === null) {
      return;
    }

    favoriteDropHandledRef.current = true;
    updateDropTargetIndex(null);
    commitDragPayloadAtSlot(payload, slotIndex);
  }

  function commitDragPayloadAtSlot(payload: QuickPlaceDragPayload, slotIndex: number): void {
    const nextFavorites = payload.source === "favorite"
      ? moveQuickPlaceFavoriteToSlot(favorites, payload.index, slotIndex)
      : placeQuickPlaceFavoriteAtSlot(favorites, payload.deviceId, slotIndex);

    commitFavorites(nextFavorites);
  }

  function finishDrag(): void {
    activeDragPayloadRef.current = null;
    favoriteDropHandledRef.current = false;
    setDraggingFavoriteIndex(null);
    updateDropTargetIndex(null);
  }

  function commitPendingDropAtDragEnd(): boolean {
    const payload = activeDragPayloadRef.current;
    const targetIndex = dropTargetIndexRef.current;
    if (favoriteDropHandledRef.current || payload === null || targetIndex === null) {
      return false;
    }

    commitDragPayloadAtSlot(payload, targetIndex);
    return true;
  }

  function handleMenuDragEnd(event: DragEvent<HTMLElement>): void {
    event.stopPropagation();
    commitPendingDropAtDragEnd();
    finishDrag();
  }

  function handleFavoriteDragEnd(event: DragEvent<HTMLElement>, slotIndex: number): void {
    event.stopPropagation();

    const droppedOnFavoriteSlot = favoriteDropHandledRef.current;
    const committedPendingDrop = commitPendingDropAtDragEnd();
    finishDrag();
    if (droppedOnFavoriteSlot || committedPendingDrop || isPointInsideElement(event, favoritesRef.current)) {
      return;
    }

    commitFavorites(removeQuickPlaceFavoriteAtSlot(favorites, slotIndex));
  }

  /** 设备行；isListOption 为 false 时是「最近」分组的快捷行，不参与列表框的键盘导航。 */
  /** compact：最近使用条里的图标按钮，名称以单行小字显示在图标下方。 */
  function renderDeviceRow(entry: QuickPlaceDeviceEntry, isListOption: boolean, compact = false) {
    const variant = variantById.get(entry.id);
    const label = `${entry.name}${variant === undefined ? "" : ` · ${t(variant.longNameKey)}`}`;
    const favoriteIndex = favoriteSlots.indexOf(entry.id);
    const isFavorite = favoriteIndex >= 0;
    const canAddFavorite = isFavorite || favoriteSlots.includes(null);
    const favoriteToggleLabel = t(isFavorite ? "workbench.quickPlace.removeFavorite" : "workbench.quickPlace.addFavorite");
    const isActive = isListOption && activeResultId === entry.id;
    return (
      <div className={cm(styles, "quick-place-device-row")} key={entry.id}>
        <button
          aria-label={label}
          aria-selected={isListOption ? isActive : undefined}
          className={cm(
            styles,
            "quick-place-device-button",
            isActive && "is-active",
            variant !== undefined && "has-variant",
          )}
          draggable
          id={isListOption ? `${deviceListId}-${entry.id}` : undefined}
          onClick={(event) => selectDeviceFromKeyboardClick(entry.id, event)}
          onDragEnd={handleMenuDragEnd}
          onPointerDown={handleSelectablePointerDown}
          onPointerUp={(event) => selectDeviceFromPointer(entry.id, event)}
          ref={isListOption ? (element) => {
            if (element === null) {
              deviceButtonRefs.current.delete(entry.id);
            } else {
              deviceButtonRefs.current.set(entry.id, element);
            }
          } : undefined}
          role={isListOption ? "option" : undefined}
          onDragStart={(event) => {
            favoriteDropHandledRef.current = false;
            setDraggingFavoriteIndex(null);
            writeDragPayload(event, {
              source: "menu",
              deviceId: entry.id,
            });
          }}
          title={label}
          type="button"
        >
          <img
            alt=""
            className={cm(styles, "quick-place-device-icon")}
            draggable={false}
            src={entry.iconSrc}
          />
          <span className={cm(styles, "quick-place-device-name")}>{entry.name}</span>
          {variant === undefined ? null : (
            <span
              aria-hidden="true"
              className={cm(styles, "quick-place-variant-badge")}
              data-entity-variant-name={variant.variantName}
              style={resolveQuickPlaceVariantIconStyle(variant.iconPath)}
            />
          )}
        </button>
        {compact ? null : (
          <button
            aria-label={favoriteToggleLabel}
            aria-pressed={isFavorite}
            className={cm(styles, "quick-place-favorite-toggle", isFavorite && "is-favorite")}
            disabled={!canAddFavorite}
            onClick={() => {
              commitFavorites(isFavorite
                ? removeQuickPlaceFavoriteAtSlot(favorites, favoriteIndex)
                : placeQuickPlaceFavoriteAtSlot(favorites, entry.id, favoriteSlots.indexOf(null)));
            }}
            title={favoriteToggleLabel}
            type="button"
          >
            {isFavorite ? <LucideStarOff aria-hidden="true" /> : <LucideStar aria-hidden="true" />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      aria-label={t("workbench.quickPlace.title")}
      className={cm(styles, "quick-place-popup panel-surface", !showsFavorites && "is-favorites-collapsed")}
      onKeyDownCapture={handleKeyDown}
      onKeyUpCapture={handleKeyUp}
      ref={rootRef}
      role="dialog"
      style={popupStyle}
    >
      {showsFavorites ? (
        <section
          aria-label={t("workbench.quickPlace.favoritesLabel")}
          className={cm(styles, "quick-place-favorites")}
          ref={favoritesRef}
        >
          {favoriteSlots.map((deviceId, index) => {
            const entry = deviceId === null ? null : entryById.get(deviceId) ?? null;
            const variant = entry === null ? undefined : variantById.get(entry.id);
            const shortcut = QUICK_PLACE_SLOT_SHORTCUTS[index];
            const label = entry === null
              ? `${t("workbench.quickPlace.emptyFavorite")} ${shortcut}`
              : `${shortcut} ${entry.name}${variant === undefined ? "" : ` · ${t(variant.longNameKey)}`}`;

            return (
              <button
                aria-label={label}
                className={cm(
                  styles,
                  "quick-place-favorite-slot",
                  entry === null && "is-empty",
                  draggingFavoriteIndex === index && "is-dragging",
                  dropTargetIndex === index && "is-drop-target",
                )}
                draggable={entry !== null}
                key={shortcut}
                onClick={(event) => {
                  if (entry !== null) {
                    selectDeviceFromKeyboardClick(entry.id, event);
                  }
                }}
                onPointerDown={handleSelectablePointerDown}
                onPointerUp={(event) => {
                  if (entry !== null) {
                    selectDeviceFromPointer(entry.id, event);
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = draggingFavoriteIndex === null ? "copy" : "move";
                  updateDropTargetIndex(index);
                }}
                onDragEnter={() => updateDropTargetIndex(index)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    if (dropTargetIndexRef.current === index) {
                      updateDropTargetIndex(null);
                    }
                  }
                }}
                onDragEnd={(event) => {
                  if (entry !== null) {
                    handleFavoriteDragEnd(event, index);
                  }
                }}
                onDragStart={(event) => {
                  if (entry !== null) {
                    favoriteDropHandledRef.current = false;
                    setDraggingFavoriteIndex(index);
                    writeDragPayload(event, {
                      source: "favorite",
                      deviceId: entry.id,
                      index,
                    });
                  }
                }}
                onDrop={(event) => handleFavoriteDrop(event, index)}
                title={label}
                type="button"
              >
                <span className={cm(styles, "quick-place-favorite-shortcut")}>{shortcut}</span>
                {entry === null ? null : (
                  <img
                    alt=""
                    className={cm(styles, "quick-place-device-icon")}
                    draggable={false}
                    src={entry.iconSrc}
                  />
                )}
                {variant === undefined ? null : (
                  <span
                    aria-hidden="true"
                    className={cm(styles, "quick-place-variant-badge")}
                    data-entity-variant-name={variant.variantName}
                    style={resolveQuickPlaceVariantIconStyle(variant.iconPath)}
                  />
                )}
              </button>
            );
          })}
        </section>
      ) : null}

      <section className={cm(styles, "quick-place-menu")}>
        <header className={cm(styles, "quick-place-menu-header")}>
          <h2>{t("workbench.quickPlace.title")}</h2>
          <input
            aria-activedescendant={activeResultId === null ? undefined : `${deviceListId}-${activeResultId}`}
            aria-autocomplete="list"
            aria-controls={deviceListId}
            aria-expanded="true"
            aria-label={t("workbench.quickPlace.searchPlaceholder")}
            className={cm(styles, "quick-place-search-input")}
            onChange={(event) => {
              const nextSearchQuery = event.currentTarget.value;
              runInAction(() => {
                runtime.activeResultId = null;
                runtime.searchQuery = nextSearchQuery;
              });
            }}
            placeholder={t("workbench.quickPlace.searchPlaceholder")}
            ref={searchInputRef}
            role="combobox"
            type="search"
            value={runtime.searchQuery}
          />
          {runtime.searchQuery.trim() === "" ? (
            <nav aria-label={t("placement.categoryFilter")} className={cm(styles, "quick-place-categories")}>
              {[null, ...categories].map((category) => {
                const key = category?.uiGroup ?? null;
                const label = t(category?.titleKey ?? "placement.allCategories");
                return (
                  <button
                    aria-label={label}
                    aria-pressed={runtime.category === key}
                    className={cm(styles, runtime.category === key ? "quick-place-category is-active" : "quick-place-category")}
                    key={key ?? "all"}
                    onClick={() => runInAction(() => {
                      runtime.category = runtime.category === key ? null : key;
                      runtime.activeResultId = null;
                    })}
                    title={label}
                    type="button"
                  >
                    {category === null
                      ? <LucideLayoutGrid aria-hidden />
                      : <img alt="" src={createEntityIconAssetUrl(appHost.workspace.registry.queries.findEntityDefinition(category.iconDeviceId)?.iconPath)} />}
                  </button>
                );
              })}
            </nav>
          ) : null}
        </header>
        <div className={cm(styles, "quick-place-device-scroll")}>
        {recentEntries.length === 0 ? null : (
          <section aria-labelledby={`${deviceListId}-recent`} className={cm(styles, "quick-place-recent")}>
            <h3 className={cm(styles, "quick-place-group-title")} id={`${deviceListId}-recent`}>{t("placement.recent")}</h3>
            <div className={cm(styles, "quick-place-recent-strip")}>
              {recentEntries.map((entry) => renderDeviceRow(entry, false, true))}
            </div>
          </section>
        )}
        <div className={cm(styles, "quick-place-device-list")} id={deviceListId} role="listbox">
          {filteredEntries.length === 0 ? (
            <div className={cm(styles, "quick-place-empty-results")}>
              {t("workbench.quickPlace.emptyResults")}
            </div>
          ) : filteredEntries.map((entry) => renderDeviceRow(entry, true))}
        </div>
        </div>
      </section>
    </div>
  );
});

function resolveQuickPlaceVariantIconStyle(iconPath: string): CSSProperties {
  const maskImage = `url("${createPublicAssetUrl(iconPath)}")`;
  return { maskImage, WebkitMaskImage: maskImage };
}

function closeQuickPlace(appHost: AppHost): void {
  runInAction(() => {
    appHost.mainCanvas.state.runtime.quickPlace.visible = false;
    appHost.mainCanvas.state.runtime.quickPlace.anchor = null;
    appHost.mainCanvas.state.runtime.quickPlace.searchQuery = "";
    appHost.mainCanvas.state.runtime.quickPlace.openSource = null;
    appHost.mainCanvas.state.runtime.quickPlace.activeResultId = null;
  });
}

function readDragPayload(event: DragEvent<HTMLElement>): QuickPlaceDragPayload | null {
  const raw = event.dataTransfer.getData(QUICK_PLACE_DRAG_FORMAT);
  if (raw === "") {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.deviceId !== "string") {
      return null;
    }

    if (parsed.source === "menu") {
      return {
        source: "menu",
        deviceId: parsed.deviceId,
      };
    }

    if (parsed.source === "favorite" && typeof parsed.index === "number") {
      return {
        source: "favorite",
        deviceId: parsed.deviceId,
        index: parsed.index,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isPointInsideElement(event: DragEvent<HTMLElement>, element: HTMLElement | null): boolean {
  if (element === null) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom
  );
}

interface PopupViewportBounds {
  readonly right: number;
  /** 底部状态栏不被弹出层覆盖。 */
  readonly bottom: number;
}

function measurePopupViewportBounds(): PopupViewportBounds {
  return { right: window.innerWidth, bottom: resolveOverlayBottomLimit() };
}

function resolvePopupStyle(
  anchorX: number,
  anchorY: number,
  canvas: CanvasRect,
  viewport: PopupViewportBounds,
  showsFavorites: boolean,
): CSSProperties {
  const viewportMargin = 8;
  const popupPaddingBlock = 20;
  const popupPaddingInline = 20;
  const contentGap = 10;
  const favoriteRows = 5;
  const favoriteGap = 8;
  const favoriteMinSlotSize = 50;
  const favoriteMaxSlotSize = 64;
  const menuMinWidth = 278;
  const menuMaxWidth = 418;
  const minHeight = popupPaddingBlock + favoriteRows * favoriteMinSlotSize + (favoriteRows - 1) * favoriteGap;
  const maxHeight = popupPaddingBlock + favoriteRows * favoriteMaxSlotSize + (favoriteRows - 1) * favoriteGap;
  const height = Math.min(maxHeight, Math.max(minHeight, viewport.bottom - viewportMargin * 2));
  const favoriteSlotSize = (height - popupPaddingBlock - (favoriteRows - 1) * favoriteGap) / favoriteRows;
  const favoriteColumnWidth = favoriteSlotSize * 2 + favoriteGap;
  const favoriteColumnSpan = favoriteColumnWidth + contentGap;
  // 始终按带收藏格的完整宽度定位，收起收藏格时只去掉左侧那一段：
  // 第一次收藏时收藏格向左长出，设备列表与笔下的那一行不移动。
  const expandedWidth = Math.min(
    popupPaddingInline + favoriteColumnSpan + menuMaxWidth,
    Math.max(popupPaddingInline + favoriteColumnSpan + menuMinWidth, viewport.right - viewportMargin * 2),
  );
  const top = clamp(anchorY - 20, viewportMargin, viewport.bottom - height - viewportMargin);
  const expandedLeft = avoidCanvasToolRail({
    canvas,
    left: anchorX - favoriteColumnSpan,
    width: expandedWidth,
    top,
    height,
    minLeft: viewportMargin,
    maxRight: viewport.right - viewportMargin,
  });
  const collapsedSpan = showsFavorites ? 0 : favoriteColumnSpan;

  return {
    "--quick-place-favorite-column-width": `${favoriteColumnWidth}px`,
    "--quick-place-favorite-slot-size": `${favoriteSlotSize}px`,
    height,
    left: expandedLeft + collapsedSpan,
    top,
    width: expandedWidth - collapsedSpan,
  } as CSSProperties;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function arraysEqual(left: readonly (string | null)[], right: readonly (string | null)[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
