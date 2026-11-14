import { useCallback, useEffect, useState } from "react";
import { runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type {
  EntityInspectorDeclaration,
  EntityInspectorType,
  RecipeStatusInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import {
  buildProductionPlanningIndex,
  type ProductionPlanningIndex,
} from "@/app/shell/production-planning/production-planning-model";
import {
  InspectorDataScopeContext,
  type InspectorDataScope,
  type InspectorRuntimeSample,
} from "./selection-inspector-model";

import { SelectionInspectorActionStrip } from "./selection-inspector-action-strip";
import { SELECTION_LOGISTICS_SEGMENT_BUTTON_IDS } from "./selection-inspector-action-strip";
import { SimulationRecipeStatusRuntimeInspector } from "./simulation-recipe-status-runtime-inspector";
import { DeviceStateInspector } from "./device-state-inspector";
import { SlotConfigInspector } from "./slot-config-inspector";
import { WarehouseItemLinkInspector } from "./warehouse-item-link-inspector";
import { InfiniteStorageInspector } from "./infinite-storage-inspector";
import { DarkPipeLinkInspector } from "./dark-pipe-link-inspector";
import { SubmitToWarehouseInspector } from "./submit-to-warehouse-inspector";
import { ProblemInspector } from "./problem-inspector";
import { PortOutputConfigInspector } from "./port-output-config-inspector";
import { PortPriorityGroupInspector } from "./port-priority-group-inspector";
import {
  canConfigurePortPriorityGroups,
} from "./port-priority-group-model";
import { AdmissionRuleInspector } from "./admission-rule-inspector";
import { BlockageAutoClearanceInspector } from "./blockage-auto-clearance-inspector";
import { LogisticsItemInspector } from "./logistics-item-inspector";
import { InspectorCollapsiblePanel } from "./inspector-collapsible-panel";
import { WaterPurifierNodeInspector } from "./water-purifier-node-inspector";
import { MeteredConsumptionInspector } from "./metered-consumption-inspector";
import { CanvasFloatingToolbarButtonStrip } from "@/app/shell/shared/canvas-floating-toolbar-button-strip";
import {
  findDarkPipeSlotLinkForEntity,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import {
  LOGISTICS_ROLE_ORDER,
  resolveLogisticsDeviceIdForRole,
  resolveLogisticsDeviceKind,
  swapLogisticsDeviceRole,
} from "@/app/logistics-role-swap";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const INSPECTOR_SLOT_INTERVAL_MS = 50;

type Translate = (key: string) => string;

interface InspectorDescriptor {
  id: string;
  declaration: EntityInspectorDeclaration;
}

interface InspectorSlotState {
  selectedEntity: WorldEntity;
  selectedDefinition: EntityDefinition;
  inspectors: InspectorDescriptor[];
  simulationRuntimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  runtimeSample: InspectorRuntimeSample | null;
  showSimulationRuntimeInspector: boolean;
  debugEntityJson: string | null;
}

const INSPECTOR_LABELS: Partial<Record<EntityInspectorType, string>> = {
  [INSPECTOR_TYPE.genericDevice]: "inspectorText.deviceOverview",
  [INSPECTOR_TYPE.runtimeStatistics]: "inspectorText.runtimeStatistics",
  [INSPECTOR_TYPE.meteredConsumption]: "inspectorText.runningConsumption",
  [INSPECTOR_TYPE.logisticsItem]: "inspectorText.itemInTransit",
  [INSPECTOR_TYPE.storageManagement]: "inspectorText.bufferManagement",
  [INSPECTOR_TYPE.storageTypeFilter]: "inspectorText.bufferTypeFilter",
  [INSPECTOR_TYPE.portFilter]: "inspectorText.portFilter",
  [INSPECTOR_TYPE.admissionRule]: "inspectorText.itemAdmission",
  [INSPECTOR_TYPE.submitToWarehouse]: "inspectorText.timedSubmitToDepot",
  [INSPECTOR_TYPE.slotConfig]: "inspectorText.slots",
  [INSPECTOR_TYPE.linkConfig]: "inspectorText.linkSettings",
  [INSPECTOR_TYPE.routing]: "inspectorText.splittingPriority",
  [INSPECTOR_TYPE.structure]: "inspectorText.structure",
  [INSPECTOR_TYPE.behaviorToggle]: "inspectorText.behaviorToggles",
  [INSPECTOR_TYPE.warehouseItemLink]: "inspectorText.depotItemLink",
  [INSPECTOR_TYPE.infiniteStorage]: "inspectorText.infiniteStorage",
  [INSPECTOR_TYPE.portOutputConfig]: "inspectorText.outputPortSettings",
  [INSPECTOR_TYPE.darkPipeLink]: "inspectorText.conduitLink",
  [INSPECTOR_TYPE.waterPurifierNode]: "inspectorText.purificationNode",
  [INSPECTOR_TYPE.blockageAutoClearance]: "inspectorText.autoClearMultiRecipeBlockage",
};

function EmptyInspector({
  declaration,
  translate,
}: {
  declaration: EntityInspectorDeclaration;
  translate: Translate;
}) {
  return (
    <InspectorCollapsiblePanel
      data-inspector-label={translate(INSPECTOR_LABELS[declaration.type] ?? declaration.type)}
      dataInspectorKey={declaration.type}
      title={translate(INSPECTOR_LABELS[declaration.type] ?? declaration.type)}
    >
      <p>{translate("inspectorText.thisSettingIsNotAvailableYet")}</p>
    </InspectorCollapsiblePanel>
  );
}

const recipeStatusIndexCache = new WeakMap<AppHost["workspace"]["registry"], Map<boolean, ProductionPlanningIndex>>();

export function resolveCachedRecipeStatusIndex(
  registry: AppHost["workspace"]["registry"],
  debugMode: boolean,
): ProductionPlanningIndex {
  let byMode = recipeStatusIndexCache.get(registry);
  if (byMode === undefined) {
    byMode = new Map();
    recipeStatusIndexCache.set(registry, byMode);
  }
  const cached = byMode.get(debugMode);
  if (cached !== undefined) {
    return cached;
  }

  const index = buildProductionPlanningIndex(registry);
  if (debugMode) {
    for (const recipe of registry.recipeDefinitions) {
      if (recipe.tags.includes(CONSUMPTION_RECIPE_TAG)) {
        index.recipeById.set(recipe.id, recipe);
      }
    }
  }
  byMode.set(debugMode, index);
  return index;
}

function renderRecipeStatusInspector(options: {
  appHost: AppHost;
  declaration: RecipeStatusInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  runtimeSample: InspectorRuntimeSample | null;
  translate: Translate;
}) {
  const registry = options.appHost.workspace.registry;
  const debugMode = options.appHost.state.settings.debugMode === true;
  const index = resolveCachedRecipeStatusIndex(registry, debugMode);
  const channelIds = debugMode
    ? options.definition.recipeChannels.map((channel) => channel.id)
    : options.declaration.channelIds.filter((channelId) =>
        options.definition.recipeChannels.find((channel) => channel.id === channelId)?.type
          !== "consumption-channel",
      );

  return (
    <SimulationRecipeStatusRuntimeInspector
      channelIds={channelIds}
      channels={options.definition.recipeChannels}
      runtimeStatus={options.runtimeStatus}
      runtimeSample={options.runtimeSample}
      index={index}
      t={options.translate}
      appHost={options.appHost}
      entity={options.entity}
      definition={options.definition}
    />
  );
}

function renderInspector(options: {
  appHost: AppHost;
  declaration: EntityInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  runtimeSample: InspectorRuntimeSample | null;
  translate: Translate;
}) {
  switch (options.declaration.type) {
    case INSPECTOR_TYPE.slotConfig:
      if (
        options.appHost.state.settings.debugMode !== true
        && options.declaration.slotGroupIds.length === 0
      ) {
        return null;
      }
      return (
        <SlotConfigInspector
          appHost={options.appHost}
          declaration={options.declaration}
          definition={options.definition}
          entity={options.entity}
          runtimeStatus={options.runtimeStatus}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.logisticsItem:
      return (
        <LogisticsItemInspector
          appHost={options.appHost}
          runtimeStatus={options.runtimeStatus}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.warehouseItemLink:
      if (isWarehouseItemLinkSuppressedByDarkPipeLink(options)) {
        return null;
      }

      return (
        <WarehouseItemLinkInspector
          appHost={options.appHost}
          declaration={options.declaration}
          definition={options.definition}
          entity={options.entity}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.infiniteStorage:
      return (
        <InfiniteStorageInspector
          appHost={options.appHost}
          declaration={options.declaration}
          definition={options.definition}
          entity={options.entity}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.darkPipeLink:
      return (
        <DarkPipeLinkInspector
          appHost={options.appHost}
          definition={options.definition}
          entity={options.entity}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.submitToWarehouse:
      return (
        <SubmitToWarehouseInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
          runtimeStatus={options.runtimeStatus}
          runtimeSample={options.runtimeSample}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.recipeStatus:
      return renderRecipeStatusInspector({
        ...options,
        declaration: options.declaration as RecipeStatusInspectorDeclaration,
      });
    case INSPECTOR_TYPE.deviceState:
      return (
        <DeviceStateInspector
          definition={options.definition}
          runtimeStatus={options.runtimeStatus}
          runtimeSample={options.runtimeSample}
          recipes={options.appHost.workspace.registry.recipeDefinitions}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.problem:
      return (
        <ProblemInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
          runtimeStatus={options.runtimeStatus}
          runtimeSample={options.runtimeSample}
        />
      );
    case INSPECTOR_TYPE.portOutputConfig:
      return (
        <PortOutputConfigInspector
          appHost={options.appHost}
          declaration={options.declaration}
          entity={options.entity}
          definition={options.definition}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.admissionRule:
      return (
        <AdmissionRuleInspector
          appHost={options.appHost}
          declaration={options.declaration}
          entity={options.entity}
          definition={options.definition}
          runtimeStatus={options.runtimeStatus}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.waterPurifierNode:
      return (
        <WaterPurifierNodeInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
        />
      );
    case INSPECTOR_TYPE.blockageAutoClearance:
      return (
        <BlockageAutoClearanceInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
        />
      );
    case INSPECTOR_TYPE.meteredConsumption:
      return (
        <MeteredConsumptionInspector
          appHost={options.appHost}
          definition={options.definition}
          entity={options.entity}
          runtimeStatus={options.runtimeStatus}
        />
      );
    default:
      return <EmptyInspector declaration={options.declaration} translate={options.translate} />;
  }
}

function isWarehouseItemLinkSuppressedByDarkPipeLink(options: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
}): boolean {
  if (resolveDarkPipeRole(options.definition.id) !== "outlet") {
    return false;
  }

  const documentSnapshot = options.appHost.workspace.editor?.document.getSnapshot() ?? null;
  if (documentSnapshot === null) {
    return false;
  }

  return findDarkPipeSlotLinkForEntity(documentSnapshot, options.entity.id) !== null;
}


function resolveSelectedDeviceLabel(
  definition: EntityDefinition,
  translate: Translate,
): string {
  const translated = translate(definition.nameKey);

  return translated === definition.nameKey ? definition.id : translated;
}

function SelectionInspectorDeviceHeader({
  appHost,
  selectedDefinition,
  selectedEntity,
  translate,
}: {
  appHost: AppHost;
  selectedDefinition: EntityDefinition;
  selectedEntity: WorldEntity;
  translate: Translate;
}) {
  const canOpenEncyclopedia = selectedDefinition.uiGroup !== "cheat";
  const handleDeviceNameClick = useCallback(() => {
    if (!canOpenEncyclopedia) {
      return;
    }

    const wikiState = appHost.internalState.workbench.toolbox.wiki;

    appHost.internalActions.openDialog("toolbox");
    appHost.internalActions.setDialogTab("toolbox", "item-encyclopedia");

    runInAction(() => {
      wikiState.navigationStack = [{ type: "entity", id: selectedDefinition.id }];
      wikiState.openedPage = { kind: "entity", id: selectedDefinition.id };
    });
  }, [appHost, canOpenEncyclopedia, selectedDefinition.id]);

  return (
    <section className={cm(styles, "selection-inspector-device-header")}>
      <div
        className={cm(styles, "selection-inspector-device-copy")}
        onClick={canOpenEncyclopedia ? handleDeviceNameClick : undefined}
        role={canOpenEncyclopedia ? "button" : undefined}
        tabIndex={canOpenEncyclopedia ? 0 : undefined}
      >
        <div className={cm(styles, "selection-inspector-device-title-row")}>
          <h3>{resolveSelectedDeviceLabel(selectedDefinition, translate)}</h3>
        </div>
        {appHost.state.settings.debugMode ? <p>{selectedEntity.id}</p> : null}
      </div>
      <SelectionInspectorActionStrip appHost={appHost} variant="inline" />
    </section>
  );
}

export function SelectionInspectorSlot({
  appHost,
  translate,
}: {
  appHost: AppHost;
  translate: Translate;
}) {
  const [slotState, setSlotState] = useState<InspectorSlotState | null>(null);
  const [scopeByInspectorId, setScopeByInspectorId] = useState<Record<string, InspectorDataScope>>({});

  useEffect(() => {
    const hideSlot = () => {
      setSlotState((current) => current === null ? current : null);
    };

    const tick = () => {
      const editor = appHost.workspace.editor;

      if (editor === null) {
        hideSlot();
        return;
      }

      const selection = [...editor.state.collections.selection];

      if (selection.length !== 1) {
        hideSlot();
        return;
      }

      const selectedEntityId = selection[0];

      if (selectedEntityId === undefined) {
        hideSlot();
        return;
      }

      const selectedEntity = editor.queries.getEntityById(selectedEntityId);

      if (selectedEntity === null || selectedEntity === undefined) {
        hideSlot();
        return;
      }

      const selectedDefinition = appHost.workspace.registry.entityDefinitions.find(
        (definition) => definition.id === selectedEntity.definitionId,
      );

      if (selectedDefinition === undefined) {
        hideSlot();
        return;
      }

      const inspectorDeclarations = selectedDefinition.inspectors;
      const inspectors = inspectorDeclarations.map((declaration, declarationIndex) => {
        const id = [
          selectedEntity.id,
          declaration.type,
          resolveInspectorDiscriminator(declaration, declarationIndex),
        ].join(":");

        return {
          id,
          declaration,
        };
      });
      const simulation = appHost.workspace.simulation;
      const showSimulationRuntimeInspector = simulation !== null && simulation.state.runningState !== "stop";
      if (!showSimulationRuntimeInspector) {
        setScopeByInspectorId((current) => Object.keys(current).length === 0 ? current : {});
      }

      const needsGasEnvironment = appHost.workspace.registry.recipeDefinitions.some((recipe) =>
        recipe.machineId === selectedDefinition.id && recipe.requiredEnvironmentAnyOf,
      );
      const runtimeSample: InspectorRuntimeSample | null = showSimulationRuntimeInspector && simulation !== null
        ? {
            entityId: selectedEntity.id,
            documentStatus: simulation.queries.getDocumentRuntimeStatus(),
            activeGasItemIds: needsGasEnvironment
              ? simulation.queries.getDeviceActiveGasItemIds(selectedEntity.id)
              : null,
            simulationState: {
              runningState: simulation.state.runningState,
              simulationSpeed: simulation.state.simulationSpeed,
              timeline: { isSeeking: simulation.state.timeline.isSeeking },
            },
            sampledAtMs: performance.now(),
          }
        : null;

      setSlotState({
        selectedEntity,
        selectedDefinition,
        inspectors,
        simulationRuntimeStatus: showSimulationRuntimeInspector
          ? simulation?.queries.getDeviceRuntimeStatus(selectedEntity.id) ?? null
          : null,
        runtimeSample,
        showSimulationRuntimeInspector,
        debugEntityJson: appHost.state.settings.debugMode
          ? JSON.stringify(selectedEntity, null, 2)
          : null,
      });
    };

    tick();
    const intervalId = window.setInterval(tick, INSPECTOR_SLOT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  if (slotState === null) {
    return null;
  }



  return (
    <div
      className={cm(styles, "cluster")}
      data-selected-definition-id={slotState.selectedDefinition.id}
      data-selected-entity-id={slotState.selectedEntity.id}
      data-selection-inspector-slot
    >
      <SelectionInspectorDeviceHeader
        appHost={appHost}
        selectedDefinition={slotState.selectedDefinition}
        selectedEntity={slotState.selectedEntity}
        translate={translate}
      />
      <LogisticsRoleSwitcher
        appHost={appHost}
        definition={slotState.selectedDefinition}
        entity={slotState.selectedEntity}
        translate={translate}
      />
      <div className={cm(styles, "definition-list")}>
        {(() => {
          const renderedInspectors = slotState.inspectors.flatMap((inspector) => {
            const inspectorScope = slotState.showSimulationRuntimeInspector
              ? scopeByInspectorId[inspector.id] ?? "runtime-state"
              : "initial-config";
            const renderedInspector = renderInspector({
              appHost,
              declaration: inspector.declaration,
              entity: slotState.selectedEntity,
              definition: slotState.selectedDefinition,
              runtimeStatus: slotState.simulationRuntimeStatus,
              runtimeSample: slotState.runtimeSample,
              translate,
            });

            if (renderedInspector === null) {
              return [];
            }

            return [(
              <InspectorDataScopeContext.Provider
                key={inspector.id}
                value={{
                  scope: inspectorScope,
                  simulationRunning: slotState.showSimulationRuntimeInspector,
                  canUseRuntimeState: slotState.showSimulationRuntimeInspector,
                  setScope: (nextScope: InspectorDataScope) => {
                    if (!slotState.showSimulationRuntimeInspector && nextScope === "runtime-state") {
                      return;
                    }

                    setScopeByInspectorId((current) => ({
                      ...current,
                      [inspector.id]: nextScope,
                    }));
                  },
                }}
              >
                <div>
                  {renderedInspector}
                </div>
              </InspectorDataScopeContext.Provider>
            )];
          });
          const portPriorityInspector = canConfigurePortPriorityGroups(slotState.selectedDefinition)
            ? (
                <PortPriorityGroupInspector
                  appHost={appHost}
                  definition={slotState.selectedDefinition}
                  entity={slotState.selectedEntity}
                  key="port-priority-group"
                />
              )
            : null;
          const renderedInspectorsWithBehaviors = portPriorityInspector === null
            ? renderedInspectors
            : [...renderedInspectors, portPriorityInspector];

          const isDedicatedLogistics = appHost.workspace.registry.queries.isDedicatedLogisticsDevice(
            slotState.selectedDefinition.id,
          );

          if (isDedicatedLogistics && renderedInspectorsWithBehaviors.length > 0) {
            return [
              renderedInspectorsWithBehaviors[0],
              <div
                key="logistics-segment-delete"
                className={cm(styles, "selection-inspector-action-button-list")}
                style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
              >
                <CanvasFloatingToolbarButtonStrip
                  canvas={appHost.mainCanvas}
                  buttonClassName={cm(styles, "selection-inspector-action-button")}
                  buttonIds={SELECTION_LOGISTICS_SEGMENT_BUTTON_IDS}
                  iconClassName={cm(styles, "selection-inspector-action-icon")}
                  labelClassName={cm(styles, "selection-inspector-action-label")}
                  showLabels
                />
              </div>,
              ...renderedInspectorsWithBehaviors.slice(1),
            ];
          }

          return renderedInspectorsWithBehaviors;
        })()}
        {slotState.debugEntityJson !== null ? (
          <article className={cm(styles, "definition-card")} data-inspector-key="json-debug">
            <textarea
              className={cm(styles, "json-debug-textarea")}
              readOnly
              value={slotState.debugEntityJson}
              rows={20}
            />
          </article>
        ) : null}
      </div>
    </div>
  );
}

function resolveInspectorDiscriminator(
  declaration: EntityInspectorDeclaration,
  fallbackIndex: number,
): string {
  switch (declaration.type) {
    case INSPECTOR_TYPE.slotConfig:
      return declaration.slotGroupIds.join(",");
    case INSPECTOR_TYPE.warehouseItemLink:
      return [
        ...declaration.slotGroupIds,
        ...(declaration.slotIds ?? []),
      ].join(",");
    case INSPECTOR_TYPE.infiniteStorage:
      return declaration.slotGroupIds.join(",");
    case INSPECTOR_TYPE.darkPipeLink:
      return "dark-pipe-link";
    case INSPECTOR_TYPE.portFilter:
    case INSPECTOR_TYPE.routing:
      return declaration.portRef;
    case INSPECTOR_TYPE.admissionRule:
      return `${declaration.portGroupId}:${declaration.portId}`;
    case INSPECTOR_TYPE.linkConfig:
      return String(declaration.cacheLinkIndex);
    case INSPECTOR_TYPE.portOutputConfig:
      return declaration.portGroupIds.join(",");
    case INSPECTOR_TYPE.waterPurifierNode:
      return "water-purifier-node";
    case INSPECTOR_TYPE.blockageAutoClearance:
      return "blockage-auto-clearance";
    case INSPECTOR_TYPE.meteredConsumption:
      return "metered-consumption";
    default:
      return String(fallbackIndex);
  }
}


const LOGISTICS_ROLE_SHORTCUT_IDS = {
  splitter: SHORTCUT_KEY.INSERT_SPLITTER,
  converger: SHORTCUT_KEY.INSERT_CONVERGER,
  connector: SHORTCUT_KEY.INSERT_CONNECTOR,
  admission: SHORTCUT_KEY.INSERT_ADMISSION,
} as const;

/** 物流设备（分流器/汇流器/桥接器/准入口）类型原位切换；非物流设备不渲染。 */
export function LogisticsRoleSwitcher({
  appHost,
  definition,
  entity,
  translate,
}: {
  appHost: AppHost;
  definition: EntityDefinition;
  entity: WorldEntity;
  translate: Translate;
}) {
  const registry = appHost.workspace.registry;
  const kind = resolveLogisticsDeviceKind(registry, definition.id);
  const currentRole = registry.queries.resolveLogisticsRole(definition.id);
  const editor = appHost.workspace.editor;
  if (kind === null || currentRole === null || editor === null) {
    return null;
  }

  return (
    <div aria-label={translate("inspectorText.logisticsType")} className={cm(styles, "logistics-role-switcher")} role="group">
      {LOGISTICS_ROLE_ORDER.map((role) => {
        const definitionId = resolveLogisticsDeviceIdForRole(registry, kind, role);
        const roleDefinition = definitionId === null ? undefined : registry.entityDefinitions.find((entry) => entry.id === definitionId);
        if (definitionId === null || roleDefinition === undefined) {
          return null;
        }
        const name = translate(roleDefinition.nameKey);
        const shortcut = appHost.internalActions.getKeyboardShortcutFor(LOGISTICS_ROLE_SHORTCUT_IDS[role]).split(";")[0] ?? "";
        return (
          <button
            aria-pressed={role === currentRole}
            className={cm(styles, role === currentRole ? "logistics-role-option is-current" : "logistics-role-option")}
            key={role}
            onClick={() => swapLogisticsDeviceRole({ editor, registry, entityId: entity.id, role })}
            title={shortcut.length > 0 ? `${name} (${shortcut})` : name}
            type="button"
          >
            <img alt="" src={createEntityIconAssetUrl(roleDefinition.iconPath)} />
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
