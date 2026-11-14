import { useEffect, useMemo, useState } from "react";

import LucideChevronsRight from "~icons/lucide/chevrons-right";
import LucideMinus from "~icons/lucide/minus";
import LucidePlus from "~icons/lucide/plus";
import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import { TOOLBOX_HIDDEN_RECIPE_TAG } from "@/shared/registry/recipe-visibility";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SlotConfigInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import {
  AnyDomain,
  resolveRecipeItemDomainFlags,
} from "@/domain/shared/item-domain-flags";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import {
  useInspectorDataScope,
  useInspectorRenderMode,
  type InspectorDataScope,
} from "@/app/shell/inspector/selection-inspector-model";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { NumberInput } from "@/app/shell/shared/number-input";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import {
  matchesItemDomainFilter,
  type InspectorItemDomainFilter,
} from "./item-domain";

type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];

interface EffectiveSlotRow {
  storageGroupId: string;
  groupIndex: number;
  slotId: string;
  slotIndex: number;
  displayIndex: number;
  itemPath: string;
  countPath: string;
  ignoreStockPath: string;
  capacity: number;
  count: number;
  ignoreStock: boolean;
  lockItemId: string | null;
  initialItemType: string | null;
  displayItemId: string | null;
  domain: InspectorItemDomainFilter;
  source: InspectorDataScope;
}

interface SlotConfigGroupView {
  storageGroup: StorageSlotGroupDefinition;
  groupIndex: number;
  rows: EffectiveSlotRow[];
}

type SlotConfigColumnRole = "input" | "output";
type SlotConfigResolvedRole = SlotConfigColumnRole | "shared";

interface SlotConfigRoleGroupView extends SlotConfigGroupView {
  role: SlotConfigResolvedRole;
}

export function SlotConfigInspector({
  appHost,
  declaration,
  entity,
  definition,
  runtimeStatus,
  translate,
}: {
  appHost: AppHost;
  declaration: SlotConfigInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus?: SimulationDeviceRuntimeStatusReadModel | null;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const { scope, canUseRuntimeState, setScope } = useInspectorDataScope();
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<EffectiveSlotRow | null>(null);
  const [draftItemId, setDraftItemId] = useState<string | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [draftIgnoreStock, setDraftIgnoreStock] = useState(false);

  const activeScope = canUseRuntimeState ? scope : "initial-config";
  const editModeEnabled = activeScope === "initial-config";
  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  // 计算该设备可以运行的所有配方的原料与产物物品 ID 集合
  const slotCustomFilters = useMemo(() => {
    const recipeDefs = appHost.workspace.registry.recipeDefinitions;
    const machineId = definition.id;
    const itemIdSet = new Set<string>();
    for (const recipe of recipeDefs) {
      if (recipe.machineId !== machineId) continue;
      if (recipe.tags.includes(TOOLBOX_HIDDEN_RECIPE_TAG)) continue;
      // 跳过 fluid 通配符等非具体物品
      for (const input of recipe.inputs) {
        if (resolveRecipeItemDomainFlags(input.itemId) === null) {
          itemIdSet.add(input.itemId);
        }
      }
      for (const output of recipe.outputs) {
        if (resolveRecipeItemDomainFlags(output.itemId) === null) {
          itemIdSet.add(output.itemId);
        }
      }
    }
    if (itemIdSet.size === 0) return [];
    return [{ i18nKey: "pickerCustomFilter.rawMaterialsAndProducts", itemIds: [...itemIdSet] }];
  }, [appHost.workspace.registry.recipeDefinitions, definition.id]);
  const runtimeSlotByKey = buildRuntimeSlotMap(runtimeStatus ?? null);
  const debugMode = appHost.state?.settings?.debugMode === true;
  const slotGroupIds = debugMode
    ? definition.storageSlotGroups.map((storageGroup) => storageGroup.id)
    : declaration.slotGroupIds;
  const groupViews = resolveSlotConfigGroupViews({
    slotGroupIds,
    definition,
    entity,
    runtimeSlotByKey,
    scope: activeScope,
  });

  useEffect(() => {
    setEditingSlot(null);
  }, [activeScope, entity.id]);

  const scopeSwitch = (
    <label
      className={cm(styles, "slot-config-scope-switch", canUseRuntimeState ? "" : "is-disabled")}
      title={canUseRuntimeState ? undefined : translate("inspectorText.liveStateIsOnlyAvailableWhile")}
    >
      <span className={cm(styles, "slot-config-scope-switch-copy")}>
        <span>{translate("inspectorText.editMode")}</span>
      </span>
      <input
        aria-label={translate("inspectorText.editMode")}
        checked={editModeEnabled}
        className={cm(styles, "slot-config-scope-switch-input")}
        data-inspector-scope-switch
        disabled={!canUseRuntimeState}
        onChange={(event) => {
          setScope(event.currentTarget.checked ? "initial-config" : "runtime-state");
        }}
        type="checkbox"
      />
    </label>
  );

  if (groupViews.length === 0) {
    return (
      <InspectorCollapsiblePanel
        className="slot-config-inspector"
        dataInspectorKey="slot-config"
        headerActions={scopeSwitch}
        title={translate("inspectorText.slots")}
        titleClassName="slot-config-panel-title"
      >
        <div className={cm(styles, "slot-config-empty")}>{translate("inspectorText.noEditableSlots")}</div>
      </InspectorCollapsiblePanel>
    );
  }

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const openSlotEditor = (row: EffectiveSlotRow) => {
    const itemId = row.lockItemId ?? row.displayItemId;
    setEditingSlot(row);
    setDraftItemId(itemId);
    setDraftCount(row.count);
    setDraftIgnoreStock(itemId === null ? false : row.ignoreStock);
  };

  const requestDraftItemSelection = async (
    row: EffectiveSlotRow,
    rows: readonly EffectiveSlotRow[],
  ) => {
    if (row.lockItemId !== null) {
      return;
    }

    setPendingSlotId(row.slotId);

    try {
      const rowsForFilter = rows.map((candidate) =>
        candidate.slotId === row.slotId
          ? { ...candidate, displayItemId: draftItemId }
          : candidate,
      );
      const rowForFilter = rowsForFilter.find((candidate) => candidate.slotId === row.slotId) ?? row;
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        customFilters: slotCustomFilters,
        filterItem: (item) => canSelectItemForRow(
          item,
          rowForFilter,
          rowsForFilter,
          appHost.workspace.registry.queries.resolveItemDomain,
        ),
      });

      if (itemId === null) {
        return;
      }

      setDraftItemId(itemId);
      setDraftCount((current) => current > 0 ? current : Math.min(1, row.capacity));
    } finally {
      setPendingSlotId((current) => current === row.slotId ? null : current);
    }
  };

  // 空槽位单击直接打开物品选择，选中后按槽位容量填满并立即写入，跳过槽位配置器。
  const quickFillEmptySlot = async (
    row: EffectiveSlotRow,
    rows: readonly EffectiveSlotRow[],
  ) => {
    setPendingSlotId(row.slotId);
    try {
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        customFilters: slotCustomFilters,
        filterItem: (item) => canSelectItemForRow(
          item,
          row,
          rows,
          appHost.workspace.registry.queries.resolveItemDomain,
        ),
      });
      if (itemId === null) {
        return;
      }

      const count = clampCount(row.capacity, row.capacity);
      if (row.source === "runtime-state") {
        await appHost.workspace.simulation?.actions.patchRuntimeSlot({
          entityId: entity.id,
          storageGroupId: row.storageGroupId,
          slotId: row.slotId,
          itemType: itemId,
          count,
          ignoreStock: false,
        });
        return;
      }

      patchEntityConfig({
        [row.itemPath]: itemId,
        [row.countPath]: count,
        [row.ignoreStockPath]: false,
      });
    } finally {
      setPendingSlotId((current) => current === row.slotId ? null : current);
    }
  };

  const applySlotDraft = async () => {
    if (editingSlot === null) {
      return;
    }

    const itemType = editingSlot.lockItemId ?? draftItemId;
    const count = itemType === null ? 0 : clampCount(draftCount, editingSlot.capacity);
    const ignoreStock = itemType === null ? false : draftIgnoreStock;

    if (editingSlot.source === "runtime-state") {
      await appHost.workspace.simulation?.actions.patchRuntimeSlot({
        entityId: entity.id,
        storageGroupId: editingSlot.storageGroupId,
        slotId: editingSlot.slotId,
        itemType,
        count,
        ignoreStock,
      });
      setEditingSlot(null);
      return;
    }

    patchEntityConfig({
      [editingSlot.itemPath]: itemType,
      [editingSlot.countPath]: count,
      [editingSlot.ignoreStockPath]: ignoreStock,
    });
    setEditingSlot(null);
  };

  const clearDraft = () => {
    if (editingSlot?.lockItemId !== null && editingSlot?.lockItemId !== undefined) {
      setDraftItemId(editingSlot.lockItemId);
      setDraftCount(0);
      setDraftIgnoreStock(false);
      return;
    }

    setDraftItemId(null);
    setDraftCount(0);
    setDraftIgnoreStock(false);
  };

  const editingGroupRows = editingSlot === null
    ? []
    : groupViews.find((groupView) => groupView.storageGroup.id === editingSlot.storageGroupId)?.rows ?? [editingSlot];
  const editingItemDefinition = draftItemId === null ? null : itemById.get(draftItemId) ?? null;
  const editingItemLabel = editingItemDefinition === null
    ? translate("inspectorText.noItemSelected")
    : translate(editingItemDefinition.nameKey);
  const roleGroupViews = resolveSlotConfigRoleGroupViews(definition, groupViews);
  const inputGroupViews = roleGroupViews.filter((groupView) => groupView.role === "input");
  const outputGroupViews = roleGroupViews.filter((groupView) => groupView.role === "output");
  const sharedGroupViews = roleGroupViews.filter((groupView) => groupView.role === "shared");

  const renderSlotColumn = (
    role: SlotConfigColumnRole,
    roleGroupViews: readonly SlotConfigRoleGroupView[],
  ) => {
    const rows = roleGroupViews.flatMap((groupView) => groupView.rows);
    const roleIndexBySlotKey = new Map(
      rows.map((row, rowIndex) => [createRuntimeSlotKey(row.storageGroupId, row.slotId), rowIndex + 1]),
    );
    const roleTitle = role === "input" ? translate("inspectorText.inputs") : translate("inspectorText.outputs");

    return (
      <section
        className={cm(styles, `slot-config-flow-column is-${role}`)}
        data-slot-config-role={role}
      >
        <div className={cm(styles, "slot-config-flow-column-header")}>
          <div>
            <strong>{roleTitle}</strong>
          </div>
        </div>
        <div className={cm(styles, "slot-config-flow-slot-list")}>
          {roleGroupViews.length === 0 ? (
            <div className={cm(styles, "slot-config-flow-empty")}>{translate(role === "input" ? "inspectorText.noInputSlots" : "inspectorText.noOutputSlots")}</div>
          ) : roleGroupViews.map((groupView) => (
            <section
              className={cm(styles, "slot-config-group")}
              data-slot-config-group={groupView.storageGroup.id}
              data-slot-config-group-role={groupView.role}
              data-slot-config-group-size={groupView.rows.length > 1 ? "multi" : "single"}
              key={groupView.storageGroup.id}
            >
              {groupView.rows.map((row) => {
                const roleIndex = roleIndexBySlotKey.get(createRuntimeSlotKey(row.storageGroupId, row.slotId)) ?? row.displayIndex;
                const emptySlotLabel = `${translate(role === "input" ? "inspectorText.inputSlot" : "inspectorText.outputSlot")} ${roleIndex}`;
                const itemDefinition = row.displayItemId === null
                  ? null
                  : itemById.get(row.displayItemId) ?? null;
                const itemLabel = itemDefinition === null ? emptySlotLabel : translate(itemDefinition.nameKey);
                const iconSrc = itemDefinition === null ? null : resolveItemIconSrc(itemDefinition);

                return (
                  <button
                    aria-label={itemLabel}
                    className={cm(styles, "slot-config-flow-slot")}
                    data-slot-action="open-slot-editor"
                    data-slot-number={row.displayIndex}
                    key={row.slotId}
                    onClick={() => {
                      if (row.displayItemId === null && row.lockItemId === null) {
                        void quickFillEmptySlot(row, groupView.rows);
                        return;
                      }
                      openSlotEditor(row);
                    }}
                    title={itemLabel}
                    type="button"
                  >
                    {iconSrc === null ? (
                      <>
                        <span className={cm(styles, "slot-config-flow-slot-label")}>
                          {emptySlotLabel}
                        </span>
                        <span className={cm(styles, "slot-config-flow-slot-value")}>
                          <span className={cm(styles, "slot-config-flow-empty-button")}>
                            <LucidePlus aria-hidden="true" />
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className={cm(styles, "slot-config-flow-slot-item")}>
                        <img
                          alt=""
                          className={cm(styles, "slot-config-flow-item-icon")}
                          draggable={false}
                          src={iconSrc}
                        />
                        <span className={cm(styles, "slot-config-flow-slot-label")}>
                          {itemLabel}
                        </span>
                        <span className={cm(styles, "slot-config-flow-item-count-inline")}>
                          {row.ignoreStock ? "∞" : row.count}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    );
  };

  const renderSharedColumn = (
    roleGroupViews: readonly SlotConfigRoleGroupView[],
  ) => {
    const rows = roleGroupViews.flatMap((groupView) => groupView.rows);
    const roleIndexBySlotKey = new Map(
      rows.map((row, rowIndex) => [createRuntimeSlotKey(row.storageGroupId, row.slotId), rowIndex + 1]),
    );

    return (
      <section
        className={cm(styles, `slot-config-flow-column is-shared`)}
        data-slot-config-role="shared"
      >
        <div className={cm(styles, "slot-config-flow-column-header")}>
          <div>
            <strong>{translate("inspectorText.mixedBuffer")}</strong>
          </div>
        </div>
        <div className={cm(styles, "slot-config-flow-slot-list")}>
          {roleGroupViews.length === 0 ? (
            <div className={cm(styles, "slot-config-flow-empty")}>{translate("inspectorText.noSharedSlots")}</div>
          ) : roleGroupViews.map((groupView) => (
            <section
              className={cm(styles, "slot-config-group")}
              data-slot-config-group={groupView.storageGroup.id}
              data-slot-config-group-role={groupView.role}
              data-slot-config-group-size={groupView.rows.length > 1 ? "multi" : "single"}
              key={groupView.storageGroup.id}
            >
              {groupView.rows.map((row) => {
                const roleIndex = roleIndexBySlotKey.get(createRuntimeSlotKey(row.storageGroupId, row.slotId)) ?? row.displayIndex;
                const emptySlotLabel = `${translate("inspectorText.slot")} ${roleIndex}`;
                const itemDefinition = row.displayItemId === null
                  ? null
                  : itemById.get(row.displayItemId) ?? null;
                const itemLabel = itemDefinition === null ? emptySlotLabel : translate(itemDefinition.nameKey);
                const iconSrc = itemDefinition === null ? null : resolveItemIconSrc(itemDefinition);

                return (
                  <button
                    aria-label={itemLabel}
                    className={cm(styles, "slot-config-flow-slot")}
                    data-slot-action="open-slot-editor"
                    data-slot-number={row.displayIndex}
                    key={row.slotId}
                    onClick={() => {
                      if (row.displayItemId === null && row.lockItemId === null) {
                        void quickFillEmptySlot(row, groupView.rows);
                        return;
                      }
                      openSlotEditor(row);
                    }}
                    title={itemLabel}
                    type="button"
                  >
                    {iconSrc === null ? (
                      <>
                        <span className={cm(styles, "slot-config-flow-slot-label")}>
                          {emptySlotLabel}
                        </span>
                        <span className={cm(styles, "slot-config-flow-slot-value")}>
                          <span className={cm(styles, "slot-config-flow-empty-button")}>
                            <LucidePlus aria-hidden="true" />
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className={cm(styles, "slot-config-flow-slot-item")}>
                        <img
                          alt=""
                          className={cm(styles, "slot-config-flow-item-icon")}
                          draggable={false}
                          src={iconSrc}
                        />
                        <span className={cm(styles, "slot-config-flow-slot-label")}>
                          {itemLabel}
                        </span>
                        <span className={cm(styles, "slot-config-flow-item-count-inline")}>
                          {row.ignoreStock ? "∞" : row.count}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    );
  };

  return (
    <InspectorCollapsiblePanel
      bodyClassName="slot-config-panel-body"
      className="slot-config-inspector"
      data-inspector-scope={activeScope}
      dataInspectorKey="slot-config"
      data-render-mode={mode}
      headerActions={scopeSwitch}
      title={translate("inspectorText.slots")}
      titleClassName="slot-config-panel-title"
    >
      {(inputGroupViews.length > 0 || outputGroupViews.length > 0) && (
        <>
          <div className={cm(styles, "slot-config-flow-layout")}>
            {renderSlotColumn("input", inputGroupViews)}
            <div className={cm(styles, "slot-config-flow-direction")} aria-label={translate("inspectorText.processingFlow")}>
              <LucideChevronsRight aria-hidden="true" />
            </div>
            {renderSlotColumn("output", outputGroupViews)}
          </div>
        </>
      )}
      {sharedGroupViews.length > 0 && (
        <div className={cm(styles, "slot-config-shared-section")}>
          {renderSharedColumn(sharedGroupViews)}
        </div>
      )}
      {editingSlot !== null ? (
        <OverlayStackLayer
          layerId={`slot-config:${entity.id}:${editingSlot.storageGroupId}:${editingSlot.slotId}`}
          visible
        >
          {({ zIndex }) => (
            <div
              className={cm(styles, "slot-config-dialog-backdrop")}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setEditingSlot(null);
                }
              }}
              style={{ zIndex }}
            >
              <div
                aria-label={translate("inspectorText.slotEditor")}
                aria-modal="true"
                className={cm(styles, "slot-config-dialog")}
                role="dialog"
              >
            <div className={cm(styles, "slot-config-dialog-header")}>
              <h3>{translate("inspectorText.slotEditor")}</h3>
              <button
                aria-label={translate("inspectorText.close")}
                className={cm(styles, "slot-config-dialog-icon-button")}
                onClick={() => setEditingSlot(null)}
                title={translate("inspectorText.close")}
                type="button"
              >
                <LucideX aria-hidden="true" />
              </button>
            </div>
            <button
              className={cm(styles, "slot-config-dialog-item-button")}
              data-slot-dialog-action="pick-item"
              disabled={pendingSlotId === editingSlot.slotId || editingSlot.lockItemId !== null}
              onClick={() => {
                void requestDraftItemSelection(editingSlot, editingGroupRows);
              }}
              type="button"
            >
              {editingItemDefinition === null ? (
                <span className={cm(styles, "slot-config-empty-frame")}>
                  <LucidePlus aria-hidden="true" />
                </span>
              ) : (
                <img
                  alt=""
                  className={cm(styles, "slot-config-dialog-item-icon")}
                  draggable={false}
                  src={resolveItemIconSrc(editingItemDefinition)}
                />
              )}
            </button>
            <div className={cm(styles, "slot-config-dialog-item-name")}>{editingItemLabel}</div>
            <label className={cm(styles, "slot-config-dialog-field")}>
              <div className={cm(styles, "slot-config-dialog-count-row")}>
                <span>{translate("inspectorText.quantity")}</span>
                <NumberInput
                  className={cm(styles, "slot-config-count-input")}
                  data-slot-dialog-input="count"
                  disabled={draftItemId === null}
                  max={editingSlot.capacity}
                  min={0}
                  value={draftCount}
                  onCommit={(next) => {
                    setDraftCount(clampCount(next, editingSlot.capacity));
                  }}
                  onRawChange={(raw) => {
                    const next = Number(raw);
                    if (Number.isFinite(next)) {
                      setDraftCount(clampCount(next, editingSlot.capacity));
                    }
                  }}
                />
              </div>
              <div className={cm(styles, "slot-config-dialog-slider-row")}>
                <button
                  aria-label={translate("inspectorText.decreaseQuantity")}
                  className={cm(styles, "slot-config-step-button")}
                  disabled={draftItemId === null || draftCount <= 0}
                  onClick={() => setDraftCount(clampCount(draftCount - 1, editingSlot.capacity))}
                  title={translate("inspectorText.decreaseQuantity")}
                  type="button"
                >
                  <LucideMinus aria-hidden="true" />
                </button>
                <input
                  aria-label={translate("inspectorText.quantitySlider")}
                  className={cm(styles, "slot-config-dialog-range")}
                  disabled={draftItemId === null}
                  max={editingSlot.capacity}
                  min={0}
                  onChange={(event) => {
                    setDraftCount(clampCount(Number(event.currentTarget.value), editingSlot.capacity));
                  }}
                  type="range"
                  value={draftCount}
                />
                <button
                  aria-label={translate("inspectorText.increaseQuantity")}
                  className={cm(styles, "slot-config-step-button")}
                  disabled={draftItemId === null || draftCount >= editingSlot.capacity}
                  onClick={() => setDraftCount(clampCount(draftCount + 1, editingSlot.capacity))}
                  title={translate("inspectorText.increaseQuantity")}
                  type="button"
                >
                  <LucidePlus aria-hidden="true" />
                </button>
              </div>
            </label>
            <label className={cm(styles, "slot-config-dialog-switch")}>
              <input
                checked={draftIgnoreStock}
                disabled={draftItemId === null}
                onChange={(event) => {
                  setDraftIgnoreStock(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              <span className={cm(styles, "slot-config-dialog-switch-track")} aria-hidden="true" />
              <span>{translate("inspectorText.infinite")}</span>
            </label>
            <button
              className={cm(styles, "slot-config-dialog-clear")}
              data-slot-dialog-action="clear-item"
              onClick={clearDraft}
              type="button"
            >
              清除
            </button>
            <div className={cm(styles, "slot-config-dialog-actions")}>
              <button
                data-slot-dialog-action="cancel"
                onClick={() => setEditingSlot(null)}
                type="button"
              >
                取消
              </button>
              <button
                data-slot-dialog-action="confirm"
                onClick={() => {
                  void applySlotDraft();
                }}
                type="button"
              >
                确定
              </button>
            </div>
              </div>
            </div>
          )}
        </OverlayStackLayer>
      ) : null}
    </InspectorCollapsiblePanel>
  );
}

interface RuntimeSlotView {
  readonly itemType: string | null;
  readonly count: number;
  readonly ignoreStock: boolean;
}

function buildRuntimeSlotMap(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): Map<string, RuntimeSlotView> {
  const runtimeSlotByKey = new Map<string, RuntimeSlotView>();
  if (runtimeStatus === null) {
    return runtimeSlotByKey;
  }

  for (const slotItem of runtimeStatus.slotItems) {
    const key = createRuntimeSlotKey(slotItem.storageGroupId, slotItem.slotId);
    const existing = runtimeSlotByKey.get(key);
    runtimeSlotByKey.set(key, {
      itemType: existing?.itemType ?? slotItem.itemType,
      count: Math.max(existing?.count ?? 0, slotItem.count),
      ignoreStock: (existing?.ignoreStock ?? false) || slotItem.ignoreStock,
    });
  }

  return runtimeSlotByKey;
}

function resolveSlotConfigRoleGroupViews(
  definition: EntityDefinition,
  groupViews: readonly SlotConfigGroupView[],
): SlotConfigRoleGroupView[] {
  return groupViews.map((groupView) => ({
    ...groupView,
    role: resolveStorageGroupFlowRole(definition, groupView.storageGroup.id),
  }));
}

function resolveStorageGroupFlowRole(
  definition: EntityDefinition,
  storageGroupId: string,
): SlotConfigResolvedRole {
  if (definition.recipeChannels.length === 0) {
    return "shared";
  }

  let hasIngredientRole = false;
  let hasProductRole = false;

  for (const channel of definition.recipeChannels) {
    hasIngredientRole ||= channel.ingredientStorageGroupIds.includes(storageGroupId);
    hasProductRole ||= channel.productStorageGroupIds.includes(storageGroupId);
  }

  if (hasIngredientRole && hasProductRole) {
    return "shared";
  }

  if (hasProductRole) {
    return "output";
  }

  if (hasIngredientRole) {
    return "input";
  }

  return "shared";
}

function resolveSlotConfigGroupViews(options: {
  slotGroupIds: readonly string[];
  definition: EntityDefinition;
  entity: WorldEntity;
  runtimeSlotByKey: ReadonlyMap<string, RuntimeSlotView>;
  scope: InspectorDataScope;
}): SlotConfigGroupView[] {
  let displayIndex = 1;

  return options.slotGroupIds.flatMap((groupId) => {
    const definition = options.definition;
    const groupIndex = definition.storageSlotGroups.findIndex((g) => g.id === groupId);

    if (groupIndex === -1) {
      return [];
    }

    const storageGroup = definition.storageSlotGroups[groupIndex];

    if (storageGroup === undefined) {
      return [];
    }

    const targetPath = `storageSlotGroups[${groupIndex}].slots`;

    return [{
      storageGroup,
      groupIndex,
      rows: storageGroup.slots.map((slot, slotIndex) => {
        const row = resolveEffectiveSlotRow({
          slot,
          slotIndex,
          displayIndex,
          storageGroup,
          groupIndex,
          targetPath,
          config: options.entity.config,
          runtimeSlot: options.runtimeSlotByKey.get(createRuntimeSlotKey(storageGroup.id, slot.id)) ?? null,
          scope: options.scope,
        });
        displayIndex += 1;
        return row;
      }),
    }];
  });
}

function resolveEffectiveSlotRow(options: {
  slot: StorageSlotDefinition;
  slotIndex: number;
  displayIndex: number;
  storageGroup: StorageSlotGroupDefinition;
  groupIndex: number;
  targetPath: string;
  config: WorldEntity["config"];
  runtimeSlot: RuntimeSlotView | null;
  scope: InspectorDataScope;
}): EffectiveSlotRow {
  const basePath = `${options.targetPath}[${options.slotIndex}]`;
  const capacity = readNumberOverride(options.config, `${basePath}.capacity`, options.slot.capacity);
  const lockItemId = readNullableStringOverride(options.config, `${basePath}.lock`, options.slot.lock);
  const initialItemType = readNullableStringOverride(
    options.config,
    `${basePath}.initialItemType`,
    options.slot.initialItemType,
  );
  const count = clampCount(
    readNumberOverride(options.config, `${basePath}.initialCount`, options.slot.initialCount),
    capacity,
  );
  const ignoreStock = readBooleanOverride(options.config, `${basePath}.ignoreStock`, options.slot.ignoreStock);
  const effectiveItemFilterType = readFilterTypeOverride(
    options.config,
    `${basePath}.itemFilterType`,
    options.slot.itemFilterType,
  );
  const runtimeItemType = options.runtimeSlot?.itemType ?? lockItemId;
  const runtimeCount = clampCount(options.runtimeSlot?.count ?? 0, capacity);
  const runtimeIgnoreStock = options.runtimeSlot?.ignoreStock ?? ignoreStock;
  const useRuntimeState = options.scope === "runtime-state";

  return {
    storageGroupId: options.storageGroup.id,
    groupIndex: options.groupIndex,
    slotId: options.slot.id,
    slotIndex: options.slotIndex,
    displayIndex: options.displayIndex,
    itemPath: `${basePath}.initialItemType`,
    countPath: `${basePath}.initialCount`,
    ignoreStockPath: `${basePath}.ignoreStock`,
    capacity,
    count: useRuntimeState ? runtimeCount : count,
    ignoreStock: useRuntimeState ? runtimeIgnoreStock : ignoreStock,
    lockItemId,
    initialItemType,
    displayItemId: useRuntimeState ? runtimeItemType : initialItemType ?? lockItemId,
    domain: resolveSlotDomain(options.storageGroup, effectiveItemFilterType),
    source: options.scope,
  };
}

function createRuntimeSlotKey(storageGroupId: string, slotId: string): string {
  return `${storageGroupId}:${slotId}`;
}

function readNumberOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: number,
): number {
  const value = config[path];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableStringOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: string | null,
): string | null {
  const value = config[path];

  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : fallback;
}

function readBooleanOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: boolean,
): boolean {
  const value = config[path];
  return typeof value === "boolean" ? value : fallback;
}

function readFilterTypeOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: StorageSlotDefinition["itemFilterType"],
): StorageSlotDefinition["itemFilterType"] {
  const value = config[path];
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && (value & ~AnyDomain) === 0
    ? value
    : fallback;
}

function resolveSlotDomain(
  storageGroup: StorageSlotGroupDefinition,
  itemFilterType: StorageSlotDefinition["itemFilterType"],
): InspectorItemDomainFilter {
  return itemFilterType ?? storageGroup.kind;
}

function resolveItemIconSrc(item: ItemDefinition): string {
  return createItemIconAssetUrl(item.iconId);
}

function canSelectItemForRow(
  item: ItemDefinition,
  row: EffectiveSlotRow,
  rows: readonly EffectiveSlotRow[],
  resolveItemDomain: (itemId: string) => ReturnType<AppHost["workspace"]["registry"]["queries"]["resolveItemDomain"]>,
): boolean {
  if (!matchesItemDomain(item, row.domain, resolveItemDomain)) {
    return false;
  }

  if (item.id === row.displayItemId) {
    return true;
  }

  return !rows.some((candidate) =>
    candidate.slotIndex !== row.slotIndex && candidate.displayItemId === item.id,
  );
}

function matchesItemDomain(
  item: ItemDefinition,
  domain: EffectiveSlotRow["domain"],
  resolveItemDomain: (itemId: string) => ReturnType<AppHost["workspace"]["registry"]["queries"]["resolveItemDomain"]>,
): boolean {
  return matchesItemDomainFilter(item, domain, resolveItemDomain);
}

function clampCount(value: number, capacity: number): number {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, Math.trunc(capacity)) : 0;
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(Math.max(safeValue, 0), safeCapacity);
}
