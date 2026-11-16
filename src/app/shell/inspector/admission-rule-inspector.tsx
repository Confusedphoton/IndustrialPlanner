import { useState } from "react";

import LucideCircleDashed from "~icons/lucide/circle-dashed";
import LucideMinus from "~icons/lucide/minus";
import LucidePlus from "~icons/lucide/plus";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideTrash2 from "~icons/lucide/trash-2";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import { ADMISSION_RATE_WINDOWS_PER_MINUTE } from "@/domain/registry";
import type {
  EntityAcceptRuleDefinition,
  EntityAdmissionRuleDefinition,
  EntityDefinition,
} from "@/domain/registry/types/entity-definition";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import { INSPECTOR_TYPE, type AdmissionRuleInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import { useInspectorRenderMode } from "@/app/shell/inspector/selection-inspector-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { readAdmissionRule } from "@/shared/registry/admission-rule";
import { matchesItemAcceptRule } from "@/shared/registry/item-accept-rule";

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];

const LOG_ADMISSION_RATE_MAX_PER_MINUTE = 30;
const PIPE_ADMISSION_RATE_MAX_PER_MINUTE = 120;

interface AdmissionPortRow {
  readonly portGroup: PortGroupDefinition;
  readonly port: PortDefinition;
  readonly groupIndex: number;
  readonly portIndex: number;
  readonly acceptRulePath: string;
  readonly admissionRulePath: string;
  readonly selectedItemId: string | null;
  readonly limit: number | null;
  readonly perMinuteLimit: number | null;
  readonly maximumPerMinuteLimit: number;
  readonly runtimeCount: number;
  readonly runtimeRateWindowCount: number;
  readonly runtimeOneMinuteCount: number;
}

function resolveItemIconSrc(item: ItemDefinition | null): string | null {
  return item === null ? null : createItemIconAssetUrl(item.iconId);
}

export function AdmissionRuleInspector({
  appHost,
  declaration,
  entity,
  definition,
  runtimeStatus,
  translate,
}: {
  appHost: AppHost;
  declaration: AdmissionRuleInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const [pending, setPending] = useState(false);
  const row = resolveAdmissionPortRow(
    definition,
    entity,
    declaration,
    runtimeStatus,
    appHost.workspace.registry.queries,
  );
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";

  if (row === null) {
    return (
      <InspectorCollapsiblePanel
        className="admission-rule-inspector"
        dataInspectorKey="admission-rule"
        title={translate("inspectorText.itemAdmission")}
      >
        <p>{translate("inspectorText.noConfigurableAdmissionPorts")}</p>
      </InspectorCollapsiblePanel>
    );
  }

  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const itemDefinition = row.selectedItemId === null
    ? null
    : itemById.get(row.selectedItemId) ?? null;
  const itemIconSrc = resolveItemIconSrc(itemDefinition);
  const itemLabel = itemDefinition === null ? translate("inspectorText.notSet") : translate(itemDefinition.nameKey);
  const limitValue = row.limit === null ? "" : String(row.limit);
  const limitEnabled = row.limit !== null;
  const rateEnabled = row.perMinuteLimit !== null;
  const canReset = runtimeStatus !== null && row.selectedItemId !== null;

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const requestItemSelection = async () => {
    setPending(true);

    try {
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item: ItemDefinition) =>
          matchesItemAcceptRule(
            item.id,
            row.port.acceptRule,
            appHost.workspace.registry.queries.resolveItemDomain,
          ),
      });

      if (itemId === null) {
        return;
      }

      patchEntityConfig({
        [row.acceptRulePath]: createItemAcceptRule(itemId),
        [row.admissionRulePath]: {
          itemId,
          limit: row.limit,
          perMinuteLimit: row.perMinuteLimit,
        } satisfies EntityAdmissionRuleDefinition,
      });
    } finally {
      setPending(false);
    }
  };

  const clearSelection = () => {
    appHost.workspace.editor?.actions.deleteEntityConfigKeys(entity.id, [
      row.acceptRulePath,
      row.admissionRulePath,
    ]);
  };

  const changeLimit = (rawValue: string) => {
    if (row.selectedItemId === null || !limitEnabled) {
      return;
    }

    const nextLimit = normalizeEnabledLimit(rawValue);
    if (nextLimit === null) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: nextLimit,
        perMinuteLimit: row.perMinuteLimit,
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const toggleLimit = (enabled: boolean) => {
    if (row.selectedItemId === null) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: enabled ? 1 : null,
        perMinuteLimit: row.perMinuteLimit,
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const toggleRate = (enabled: boolean) => {
    if (row.selectedItemId === null) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: row.limit,
        perMinuteLimit: enabled ? ADMISSION_RATE_WINDOWS_PER_MINUTE : null,
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const stepRate = (delta: -1 | 1) => {
    if (row.selectedItemId === null || row.perMinuteLimit === null) {
      return;
    }

    const nextRate = Math.min(
      row.maximumPerMinuteLimit,
      Math.max(
        ADMISSION_RATE_WINDOWS_PER_MINUTE,
        row.perMinuteLimit + delta * ADMISSION_RATE_WINDOWS_PER_MINUTE,
      ),
    );
    if (nextRate === row.perMinuteLimit) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: row.limit,
        perMinuteLimit: nextRate,
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const resetTotalCounter = () => {
    void appHost.workspace.simulation?.actions.resetAdmissionCounter({
      entityId: entity.id,
      portGroupId: row.portGroup.id,
      portId: row.port.id,
      scope: "total",
    });
  };

  const resetRateWindowCounter = () => {
    void appHost.workspace.simulation?.actions.resetAdmissionCounter({
      entityId: entity.id,
      portGroupId: row.portGroup.id,
      portId: row.port.id,
      scope: "rate-window",
    });
  };

  return (
    <InspectorCollapsiblePanel
      bodyClassName="admission-rule-panel-body"
      className="admission-rule-inspector"
      data-device-class={deviceClass}
      dataInspectorKey="admission-rule"
      data-render-mode={mode}
      title={translate("inspectorText.itemAdmission")}
    >
      <div
        className={cm(styles, "admission-rule-row")}
        data-admission-port-group-id={row.portGroup.id}
        data-admission-port-id={row.port.id}
        data-is-pipe={row.portGroup.isPipe ? "true" : "false"}
      >
        <div className={cm(styles, "admission-rule-item-row")}>
          <button
            className={cm(styles, "admission-rule-item-button")}
            data-admission-action="pick-item"
            disabled={pending}
            onClick={() => {
              void requestItemSelection();
            }}
            title={itemLabel}
            type="button"
          >
            <span className={cm(styles, "admission-rule-item-icon")}>
              {itemIconSrc === null ? (
                <LucideCircleDashed aria-hidden="true" />
              ) : (
                <img alt="" src={itemIconSrc} />
              )}
            </span>
            <span className={cm(styles, "admission-rule-item-name")}>{itemLabel}</span>
          </button>

          <button
            aria-label={translate("inspectorText.clear")}
            className={cm(styles, "admission-rule-action-button admission-rule-clear-button")}
            data-admission-action="clear-item"
            disabled={row.selectedItemId === null}
            onClick={clearSelection}
            title={translate("inspectorText.clear")}
            type="button"
          >
            <LucideTrash2 aria-hidden="true" />
          </button>
        </div>

        <div
          className={cm(styles, "admission-rule-controls-row")}
          data-admission-controls
          data-admission-counter-scope="total"
        >
          <div className={cm(styles, "admission-rule-limit")}>
            <label className={cm(styles, "admission-rule-limit-header")}>
              <span>{translate("inspectorText.countLimit")}</span>
              <input
                aria-label={translate("inspectorText.countLimitSwitch")}
                checked={limitEnabled}
                className={cm(styles, "admission-rule-switch")}
                data-admission-limit-switch
                disabled={row.selectedItemId === null}
                onChange={(event) => {
                  toggleLimit(event.currentTarget.checked);
                }}
                role="switch"
                type="checkbox"
              />
            </label>
            <input
              aria-label={translate("inspectorText.countLimitCap")}
              className={cm(styles, "admission-rule-limit-value-input")}
              data-admission-limit-input
              disabled={row.selectedItemId === null || !limitEnabled}
              inputMode="numeric"
              min={1}
              onChange={(event) => {
                changeLimit(event.currentTarget.value);
              }}
              step={1}
              type="number"
              value={limitValue}
            />
          </div>

          <div className={cm(styles, "admission-rule-count")} data-admission-current-count>
            <span>{translate("inspectorText.total")}</span>
            <strong>{row.runtimeCount}</strong>
          </div>

          <div className={cm(styles, "admission-rule-actions")}>
            <button
              aria-label={translate("inspectorText.resetTotal")}
              className={cm(styles, "admission-rule-action-button")}
              data-admission-action="reset-total-count"
              disabled={!canReset}
              onClick={resetTotalCounter}
              title={translate("inspectorText.resetTotal")}
              type="button"
            >
              <LucideRotateCcw aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          className={cm(styles, "admission-rule-controls-row")}
          data-admission-counter-scope="rate-window"
        >
          <div className={cm(styles, "admission-rule-limit")}>
            <label className={cm(styles, "admission-rule-limit-header")}>
              <span>{translate("inspectorText.rateLimit")}</span>
              <input
                aria-label={translate("inspectorText.rateLimitSwitch")}
                checked={rateEnabled}
                className={cm(styles, "admission-rule-switch")}
                data-admission-rate-switch
                disabled={row.selectedItemId === null}
                onChange={(event) => {
                  toggleRate(event.currentTarget.checked);
                }}
                role="switch"
                type="checkbox"
              />
            </label>
            <div
              aria-label={translate("inspectorText.admissionsPerMinute")}
              className={cm(styles, "admission-rule-rate-stepper")}
              data-admission-per-minute-limit={row.perMinuteLimit ?? ""}
              role="group"
            >
              <button
                aria-label={translate("inspectorText.lowerRatePerMinute")}
                className={cm(styles, "admission-rule-step-button")}
                data-admission-rate-action="decrease"
                disabled={
                  row.selectedItemId === null
                  || !rateEnabled
                  || (row.perMinuteLimit ?? 0) <= ADMISSION_RATE_WINDOWS_PER_MINUTE
                }
                onClick={() => {
                  stepRate(-1);
                }}
                type="button"
              >
                <LucideMinus aria-hidden="true" />
              </button>
              <output data-admission-per-minute-limit-output>
                {row.perMinuteLimit === null ? translate("inspectorText.unlimited") : `${row.perMinuteLimit}/min`}
              </output>
              <button
                aria-label={translate("inspectorText.raiseRatePerMinute")}
                className={cm(styles, "admission-rule-step-button")}
                data-admission-rate-action="increase"
                disabled={
                  row.selectedItemId === null
                  || !rateEnabled
                  || (row.perMinuteLimit ?? row.maximumPerMinuteLimit) >= row.maximumPerMinuteLimit
                }
                onClick={() => {
                  stepRate(1);
                }}
                type="button"
              >
                <LucidePlus aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className={cm(styles, "admission-rule-count")} data-admission-current-rate-window-count>
            <span>{translate("inspectorText.lastMinute")}</span>
            <strong>{row.runtimeOneMinuteCount}</strong>
          </div>

          <div className={cm(styles, "admission-rule-actions")}>
            <button
              aria-label={translate("inspectorText.resetThis10SWindow")}
              className={cm(styles, "admission-rule-action-button")}
              data-admission-action="reset-rate-window-count"
              disabled={!canReset}
              onClick={resetRateWindowCounter}
              title={translate("inspectorText.resetThis10SWindow")}
              type="button"
            >
              <LucideRotateCcw aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </InspectorCollapsiblePanel>
  );
}

function resolveAdmissionPortRow(
  definition: EntityDefinition,
  entity: WorldEntity,
  declaration: AdmissionRuleInspectorDeclaration,
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
  registryQueries: RegistryQuery,
): AdmissionPortRow | null {
  const groupIndex = definition.portGroups.findIndex((group) => group.id === declaration.portGroupId);
  const portGroup = definition.portGroups[groupIndex];
  if (portGroup === undefined || portGroup.direction !== "input") {
    return null;
  }

  const portIndex = portGroup.ports.findIndex((port) => port.id === declaration.portId);
  const port = portGroup.ports[portIndex];
  if (port === undefined) {
    return null;
  }

  const acceptRulePath = `portGroups[${groupIndex}].ports[${portIndex}].acceptRule`;
  const admissionRulePath = `portGroups[${groupIndex}].ports[${portIndex}].admissionRule`;
  const admissionRule = readAdmissionRule(entity.config[admissionRulePath])
    ?? port.admissionRule
    ?? null;
  const selectedItemId = admissionRule?.itemId
    ?? readAcceptRuleItemId(entity.config[acceptRulePath])
    ?? readAcceptRuleItemId(port.acceptRule)
    ?? null;
  const runtimeCounter = runtimeStatus?.admissionCounters?.[`${portGroup.id}:${port.id}`] ?? null;

  return {
    portGroup,
    port,
    groupIndex,
    portIndex,
    acceptRulePath,
    admissionRulePath,
    selectedItemId,
    limit: admissionRule?.limit ?? null,
    perMinuteLimit: admissionRule?.perMinuteLimit ?? null,
    // 管道物流设备不包括管道节；这里只对角色为准入口的管道物流设备应用管道上限。
    maximumPerMinuteLimit:
      registryQueries.resolveLogisticsRole(definition.id) === "admission"
      && registryQueries.isPipeLogistics(definition.id)
      ? PIPE_ADMISSION_RATE_MAX_PER_MINUTE
      : LOG_ADMISSION_RATE_MAX_PER_MINUTE,
    runtimeCount: runtimeCounter?.count ?? 0,
    runtimeRateWindowCount: runtimeCounter?.rateWindowCount ?? 0,
    runtimeOneMinuteCount: runtimeCounter?.oneMinuteCount ?? 0,
  };
}


function readAcceptRuleItemId(value: unknown): string | null {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }

  const base = (value as EntityAcceptRuleDefinition).base;
  return base?.kind === "item" ? base.itemId : null;
}

function createItemAcceptRule(itemId: string): EntityAcceptRuleDefinition {
  return {
    base: { kind: "item", itemId },
    exclude: [],
  };
}

function normalizeEnabledLimit(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(1, Math.floor(parsed));
}

/**
 * 把物品写入实体全部准入口（配方树快捷操作“设为所选准入口的物品”）。
 * 仅写入接受该物品的端口，保留原有计数/速率上限；返回实际写入的端口数。
 */
export function applyAdmissionItemToEntity(options: {
  readonly appHost: AppHost;
  readonly entity: WorldEntity;
  readonly item: ItemDefinition;
}): number {
  const { appHost, entity, item } = options;
  const registry = appHost.workspace.registry;
  const definition = registry.queries.findEntityDefinition(entity.definitionId);
  const editor = appHost.workspace.editor;
  if (definition === null || editor === null) {
    return 0;
  }

  const patch: Record<string, unknown> = {};
  let applied = 0;
  for (const declaration of definition.inspectors) {
    if (declaration.type !== INSPECTOR_TYPE.admissionRule) {
      continue;
    }
    const row = resolveAdmissionPortRow(definition, entity, declaration, null, registry.queries);
    if (row === null || !matchesItemAcceptRule(item.id, row.port.acceptRule, registry.queries.resolveItemDomain)) {
      continue;
    }
    patch[row.acceptRulePath] = createItemAcceptRule(item.id);
    patch[row.admissionRulePath] = {
      itemId: item.id,
      limit: row.limit,
      perMinuteLimit: row.perMinuteLimit,
    } satisfies EntityAdmissionRuleDefinition;
    applied += 1;
  }

  if (applied > 0) {
    editor.actions.patchEntityConfig(entity.id, patch);
  }
  return applied;
}
