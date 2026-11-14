import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import LucideCheck from "~icons/lucide/check";
import LucideCircleDashed from "~icons/lucide/circle-dashed";
import LucideLock from "~icons/lucide/lock";
import LucideTrash2 from "~icons/lucide/trash-2";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity, SlotLinkDefinition } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { WarehouseItemLinkInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import { rotateGridRotation } from "@/shared/geometry/grid";
import {
  resolveOutputPortSideLabels,
  resolveSharedOutputGroupRows,
  type OutputGroupRow,
} from "@/app/shell/inspector/port-output-config-model";
import { PortOutputLocatorBadge } from "@/app/shell/inspector/port-output-locator-badge";
import {
  useInspectorRenderMode,
} from "@/app/shell/inspector/selection-inspector-model";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import {
  matchesItemDomainFilter,
  type InspectorItemDomainFilter,
} from "./item-domain";

type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];

interface WarehouseLinkRow {
  /** slot 在 config 中的 link 索引 */
  linkIndex: number;
  boundOutputRow: OutputGroupRow | null;
  storageGroupId: string;
  slotId: string;
  /** config key: storageSlotGroups[storageGroupIndex].slots[slotIndex].ignoreStock */
  ignoreStockPath: string;
  currentItemId: string | null;
  currentIgnoreStock: boolean;
  /** 槽位所属物品域 */
  domain: InspectorItemDomainFilter;
}

interface WarehouseLinkTooltipPosition {
  readonly left: number;
  readonly top: number;
}

const WAREHOUSE_LINK_TOOLTIP_GAP = 6;
const WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING = 8;

export function WarehouseItemLinkInspector({
  appHost,
  declaration,
  entity,
  definition,
  translate,
}: {
  appHost: AppHost;
  declaration: WarehouseItemLinkInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const [pendingLinkIndex, setPendingLinkIndex] = useState<number | null>(null);

  const editor = appHost.workspace.editor;
  const documentSnapshot = editor?.document?.getSnapshot() ?? null;
  const slotLinks = documentSnapshot?.slotLinks ?? [];

  const outputRows = resolveSharedOutputGroupRows(definition, entity);
  const rows = resolveWarehouseLinkRows(declaration, definition, entity, slotLinks, outputRows);
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";
  const displayRotation = appHost.mainCanvas.view.state.displayRotation;
  const locatorRotation = rotateGridRotation(entity.rotation, displayRotation);
  // 输出端口按屏幕方位命名（取代 P# 序号）。
  const outputSideLabels = resolveOutputPortSideLabels({ definition, rows: outputRows, rotation: locatorRotation, translate });

  if (rows.length === 0) {
    return (
      <InspectorCollapsiblePanel
        className="warehouse-item-link-inspector"
        dataInspectorKey="warehouse-item-link"
        title={translate("inspectorText.depotItemLink")}
      >
        <p>{translate("inspectorText.noLinkableSlots")}</p>
      </InspectorCollapsiblePanel>
    );
  }

  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const requestItemSelection = async (row: WarehouseLinkRow) => {
    setPendingLinkIndex(row.linkIndex);

    try {
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item) => matchesItemDomain(
          item,
          row.domain,
          appHost.workspace.registry.queries.resolveItemDomain,
        ),
      });

      if (itemId === null) {
        return;
      }

      editor?.actions.createWarehouseSlotLink({
        entityId: entity.id,
        storageSlotGroupId: row.storageGroupId,
        slotId: row.slotId,
        itemId,
      });

      // 自然资源物品默认开启无限供应
      const selectedItem = itemById.get(itemId);
      if (selectedItem?.tags.includes(translate("inspectorText.naturalResources"))) {
        patchEntityConfig({ [row.ignoreStockPath]: false });
      }
    } finally {
      setPendingLinkIndex((current) => current === row.linkIndex ? null : current);
    }
  };

  const toggleIgnoreStock = (row: WarehouseLinkRow) => {
    patchEntityConfig({
      [row.ignoreStockPath]: !row.currentIgnoreStock,
    });
  };

  const clearLink = (row: WarehouseLinkRow) => {
    editor?.actions.removeWarehouseSlotLink(entity.id, row.storageGroupId, row.slotId);
    // 同时重置 ignoreStock
    patchEntityConfig({
      [row.ignoreStockPath]: false,
    });
  };


  return (
    <InspectorCollapsiblePanel
      bodyClassName="warehouse-link-panel-body"
      className="warehouse-item-link-inspector"
      data-device-class={deviceClass}
      dataInspectorKey="warehouse-item-link"
      data-render-mode={mode}
      title={translate("inspectorText.depotItemLink")}
    >
      <div className={cm(styles, "warehouse-link-list")}>
        {rows.map((row) => {
          const itemDefinition = row.currentItemId === null
            ? null
            : itemById.get(row.currentItemId) ?? null;
          const itemIconSrc = resolveItemIconSrc(itemDefinition);
          const itemLabel = itemDefinition === null
            ? translate("inspector.warehouseItemLink.selectItem")
            : translate(itemDefinition.nameKey);
          const canClear = row.currentItemId !== null;
          const slotLabel = (row.boundOutputRow === null ? undefined : outputSideLabels.get(row.boundOutputRow.portGroup.id))
            ?? row.boundOutputRow?.portLabel
            ?? `${translate("inspectorText.slot")} ${row.linkIndex + 1}`;
          const slotTitle = `${row.storageGroupId} / ${row.slotId}`;
          const ignoreStockLabel = translate("inspector.warehouseItemLink.ignoreStock");

          return (
            <div
              className={cm(styles, "warehouse-link-row")}
              data-link-domain={row.domain}
              data-is-pipe={row.boundOutputRow?.portGroup.isPipe ? "true" : "false"}
              data-slot-id={row.slotId}
              data-storage-group-id={row.storageGroupId}
              key={`${row.storageGroupId}:${row.slotId}`}
            >
              {row.boundOutputRow === null ? (
                <div className={cm(styles, "warehouse-link-slot")} title={slotTitle}>
                  <span className={cm(styles, "warehouse-link-slot-label")}>{slotLabel}</span>
                </div>
              ) : (
                <button
                  className={cm(styles, "port-output-locator-button")}
                  disabled={pendingLinkIndex === row.linkIndex}
                  onClick={() => {
                    void requestItemSelection(row);
                  }}
                  type="button"
                >
                <PortOutputLocatorBadge
                  definition={definition}
                  portLabel={outputSideLabels.get(row.boundOutputRow.portGroup.id) ?? row.boundOutputRow.portLabel}
                  rows={outputRows}
                  rotation={locatorRotation}
                  targetPortGroupId={row.boundOutputRow.portGroup.id}
                  title={`${outputSideLabels.get(row.boundOutputRow.portGroup.id) ?? row.boundOutputRow.portLabel} · ${translate(row.boundOutputRow.label)}`}
                />
                </button>
              )}
              <button
                className={cm(styles, "warehouse-link-item-button")}
                data-slot-action="pick-item"
                disabled={pendingLinkIndex === row.linkIndex}
                onClick={() => {
                  void requestItemSelection(row);
                }}
                title={itemLabel}
                type="button"
              >
                <span className={cm(styles, "warehouse-link-item-icon")}>
                  {itemIconSrc === null ? (
                    <LucideCircleDashed aria-hidden="true" />
                  ) : (
                    <img alt="" src={itemIconSrc} />
                  )}
                </span>
                <span className={cm(styles, "warehouse-link-item-name")}>{itemLabel}</span>
              </button>
              {itemDefinition?.tags.includes(translate("inspectorText.naturalResources")) ? (
                <LockedNaturalResourceInfinityButton
                  ignoreStockLabel={ignoreStockLabel}
                  tooltip={translate("inspector.warehouseItemLink.naturalResourceControlled")}
                />
              ) : <button
                aria-label={`${slotLabel} ${ignoreStockLabel}`}
                aria-pressed={row.currentIgnoreStock}
                className={cm(styles, "warehouse-link-infinity-button")}
                disabled={row.currentItemId === null}
                onClick={() => {
                  toggleIgnoreStock(row);
                }}
                title={ignoreStockLabel}
                type="button"
              >
                <span aria-hidden="true">∞</span>
                {row.currentIgnoreStock && row.currentItemId !== null ? (
                  <LucideCheck
                    aria-hidden="true"
                    className={cm(styles, "warehouse-link-infinity-check-icon")}
                  />
                ) : null}
              </button>}
              <button
                aria-label={translate("inspectorText.clear")}
                className={cm(styles, "warehouse-link-action-button warehouse-link-clear-button")}
                data-slot-action="clear-item"
                disabled={!canClear}
                onClick={() => {
                  clearLink(row);
                }}
                title={translate("inspectorText.clear")}
                type="button"
              >
                <LucideTrash2 aria-hidden="true" />
                <span className={cm(styles, "warehouse-link-action-label")}>{translate("inspectorText.clear")}</span>
              </button>
            </div>
          );
        })}
      </div>
    </InspectorCollapsiblePanel>
  );
}

function LockedNaturalResourceInfinityButton({
  ignoreStockLabel,
  tooltip,
}: {
  readonly ignoreStockLabel: string;
  readonly tooltip: string;
}) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<WarehouseLinkTooltipPosition | null>(null);
  const tooltipVisible = hovered || pinned;

  useEffect(() => {
    if (!pinned) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target !== null && buttonRef.current?.contains(target)) {
        return;
      }
      setPinned(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [pinned]);

  useLayoutEffect(() => {
    if (!tooltipVisible) {
      return;
    }

    const updateTooltipPosition = () => {
      const button = buttonRef.current;
      const tooltipElement = tooltipRef.current;
      if (button === null || tooltipElement === null) {
        return;
      }
      setTooltipPosition(resolveWarehouseLinkTooltipPosition(
        button.getBoundingClientRect(),
        tooltipElement.getBoundingClientRect(),
      ));
    };

    updateTooltipPosition();
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);
    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [tooltipVisible]);

  return (
    <>
      <button
        aria-describedby={tooltipVisible ? tooltipId : undefined}
        aria-disabled="true"
        aria-expanded={tooltipVisible}
        aria-label={`${ignoreStockLabel}：${tooltip}`}
        className={cm(styles, "warehouse-link-infinity-button is-locked")}
        data-warehouse-link-natural-resource-lock
        onClick={(event) => {
          event.stopPropagation();
          setPinned((current) => !current);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        ref={buttonRef}
        type="button"
      >
        <span className={cm(styles, "warehouse-link-infinity-symbol")} aria-hidden="true">∞</span>
        <LucideLock
          aria-hidden="true"
          className={cm(styles, "warehouse-link-infinity-lock-icon")}
        />
      </button>
      {tooltipVisible
        ? createPortal(
          <div
            className={cm(styles, "warehouse-link-natural-resource-tooltip")}
            data-warehouse-link-natural-resource-tooltip
            id={tooltipId}
            ref={tooltipRef}
            role="tooltip"
            style={{
              left: tooltipPosition === null ? "0px" : `${tooltipPosition.left}px`,
              top: tooltipPosition === null ? "0px" : `${tooltipPosition.top}px`,
              visibility: tooltipPosition === null ? "hidden" : "visible",
            }}
          >
            {tooltip}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

// =========================================================================
// Helpers
// =========================================================================

function resolveWarehouseLinkTooltipPosition(
  anchorRect: DOMRect,
  tooltipRect: DOMRect,
): WarehouseLinkTooltipPosition {
  const maxLeft = Math.max(
    WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING,
    window.innerWidth - WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING - tooltipRect.width,
  );
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
  const left = Math.min(
    maxLeft,
    Math.max(WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING, centeredLeft),
  );
  const spaceAbove = anchorRect.top
    - WAREHOUSE_LINK_TOOLTIP_GAP
    - WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING;
  const spaceBelow = window.innerHeight
    - anchorRect.bottom
    - WAREHOUSE_LINK_TOOLTIP_GAP
    - WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING;
  const placeBelow = spaceBelow >= tooltipRect.height || spaceBelow >= spaceAbove;
  const preferredTop = placeBelow
    ? anchorRect.bottom + WAREHOUSE_LINK_TOOLTIP_GAP
    : anchorRect.top - WAREHOUSE_LINK_TOOLTIP_GAP - tooltipRect.height;
  const maxTop = Math.max(
    WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING,
    window.innerHeight - WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING - tooltipRect.height,
  );
  const top = Math.min(
    maxTop,
    Math.max(WAREHOUSE_LINK_TOOLTIP_VIEWPORT_PADDING, preferredTop),
  );

  return { left, top };
}

function resolveWarehouseLinkRows(
  declaration: WarehouseItemLinkInspectorDeclaration,
  definition: EntityDefinition,
  entity: WorldEntity,
  slotLinks: readonly SlotLinkDefinition[],
  outputRows: readonly OutputGroupRow[],
): WarehouseLinkRow[] {
  const slotDefinitions = expandSlotDefinitions(declaration, definition);
  const outputRowsByPortGroupId = new Map(
    outputRows.map((row) => [row.portGroup.id, row]),
  );

  // 构建 warehouse slot link 查找表：key = storageSlotGroupId:slotId
  const warehouseLinkBySlotKey = new Map<string, SlotLinkDefinition>();
  for (const link of slotLinks) {
    if (link.target.entityId === "warehouse" && link.source.entityId === entity.id) {
      warehouseLinkBySlotKey.set(`${link.source.storageSlotGroupId}:${link.source.slotId}`, link);
    }
  }

  return slotDefinitions.map((slotDef, index) => {
    const slotKey = `${slotDef.storageGroupId}:${slotDef.slotId}`;
    const slotLink = warehouseLinkBySlotKey.get(slotKey);
    return {
      linkIndex: index,
      boundOutputRow: resolveFirstBoundOutputRow(definition, outputRowsByPortGroupId, slotDef.storageGroupId),
      storageGroupId: slotDef.storageGroupId,
      slotId: slotDef.slotId,
      ignoreStockPath: `storageSlotGroups[${slotDef.storageGroupIndex}].slots[${slotDef.slotIndex}].ignoreStock`,
      currentItemId: slotLink?.target.slotId ?? null,
      currentIgnoreStock: readSlotConfigBoolean(entity.config, `storageSlotGroups[${slotDef.storageGroupIndex}].slots[${slotDef.slotIndex}].ignoreStock`),
      domain: slotDef.domain,
    };
  });
}

function resolveFirstBoundOutputRow(
  definition: EntityDefinition,
  outputRowsByPortGroupId: ReadonlyMap<string, OutputGroupRow>,
  storageGroupId: string,
): OutputGroupRow | null {
  for (const binding of definition.portStorageBindings) {
    if (binding.storageSlotGroupId !== storageGroupId) {
      continue;
    }

    const outputRow = outputRowsByPortGroupId.get(binding.portGroupId);
    if (outputRow !== undefined) {
      return outputRow;
    }
  }

  return null;
}

interface ExpandedSlotDef {
  storageGroupId: string;
  storageGroupIndex: number;
  slotId: string;
  /** 槽位在所属 storageGroup 中的索引（用于 slots[N]） */
  slotIndex: number;
  domain: InspectorItemDomainFilter;
}

function expandSlotDefinitions(
  declaration: WarehouseItemLinkInspectorDeclaration,
  definition: EntityDefinition,
): ExpandedSlotDef[] {
  const result: ExpandedSlotDef[] = [];
  const explicitSlotIds = new Set(declaration.slotIds ?? []);

  for (const groupId of declaration.slotGroupIds) {
    const storageGroup = definition.storageSlotGroups.find((g) => g.id === groupId);
    const groupIndex = definition.storageSlotGroups.indexOf(storageGroup!);

    if (storageGroup === undefined) {
      continue;
    }

    for (let slotIndex = 0; slotIndex < storageGroup.slots.length; slotIndex += 1) {
      const slot = storageGroup.slots[slotIndex];
      if (slot === undefined) {
        continue;
      }
      if (explicitSlotIds.size > 0 && !explicitSlotIds.has(slot.id)) {
        continue;
      }

      result.push({
        storageGroupId: groupId,
        storageGroupIndex: groupIndex,
        slotId: slot.id,
        slotIndex,
        domain: resolveSlotGroupDomain(storageGroup),
      });
    }
  }

  return result;
}

function resolveSlotGroupDomain(
  storageGroup: StorageSlotGroupDefinition,
): InspectorItemDomainFilter {
  return storageGroup.kind;
}

function matchesItemDomain(
  item: ItemDefinition,
  domain: InspectorItemDomainFilter,
  resolveItemDomain: Parameters<typeof matchesItemDomainFilter>[2],
): boolean {
  return matchesItemDomainFilter(item, domain, resolveItemDomain);
}

function resolveItemIconSrc(item: ItemDefinition | null): string | null {
  return item === null ? null : createItemIconAssetUrl(item.iconId);
}

function readSlotConfigBoolean(
  config: WorldEntity["config"],
  path: string,
): boolean {
  const value = config[path];
  return typeof value === "boolean" ? value : false;
}
