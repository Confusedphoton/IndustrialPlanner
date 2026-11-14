import LucideUpload from "~icons/lucide/upload";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { resolvePresentedRecipeProgressSeconds } from "@/shared/simulation-recipe-progress";
import { useSimulationRecipePresentation } from "./use-simulation-recipe-presentation";
import type { InspectorRuntimeSample } from "./selection-inspector-model";

export const SUBMIT_TO_WAREHOUSE_INSPECTOR_KEY = "submit-to-warehouse";
const WAREHOUSE_SUBMIT_CHANNEL_ID = "warehouse_submit";
const WAREHOUSE_SUBMIT_RECIPE_ID = "r_warehouse_submit";

export interface SubmitToWarehouseInspectorProps {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  runtimeSample: InspectorRuntimeSample | null;
  translate: (key: string) => string;
}

export function SubmitToWarehouseInspector({
  appHost,
  entity,
  definition,
  runtimeStatus,
  runtimeSample,
  translate,
}: SubmitToWarehouseInspectorProps) {
  const registry = appHost.workspace.registry;
  const storedRecipes = (entity.config?.channelRecipes as Record<string, string> | undefined) ?? {};
  const submitRuntimeStatus = resolveSubmitChannelStatus(runtimeStatus);
  const presentation = useSimulationRecipePresentation(
    runtimeSample,
    submitRuntimeStatus?.isProgressing === true,
  );
  const submitChannel = definition.recipeChannels.find(
    (ch) => ch.id === WAREHOUSE_SUBMIT_CHANNEL_ID && ch.manualRecipeOnly,
  );
  const hasSubmitRecipe = registry.recipeDefinitions.some(
    (recipe) =>
      recipe.id === WAREHOUSE_SUBMIT_RECIPE_ID
      && recipe.machineId === definition.id,
  );

  if (submitChannel === undefined || !hasSubmitRecipe) {
    return null;
  }

  const isSelected = storedRecipes[submitChannel.id] === WAREHOUSE_SUBMIT_RECIPE_ID;
  const remainingSeconds = isSelected
    ? resolveSubmitRemainingSeconds(
        submitRuntimeStatus,
        resolvePresentedRecipeProgressSeconds({
          channelStatus: submitRuntimeStatus,
          ...presentation,
        }),
      )
    : null;

  const handleToggle = () => {
    const editor = appHost.workspace.editor;
    if (editor === null) return;

    const next: Record<string, string> = { ...storedRecipes };
    if (isSelected) {
      delete next[submitChannel.id];
    } else {
      next[submitChannel.id] = WAREHOUSE_SUBMIT_RECIPE_ID;
    }
    editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
  };

  return (
    <InspectorCollapsiblePanel
      className="submit-to-warehouse-inspector"
      dataInspectorKey={SUBMIT_TO_WAREHOUSE_INSPECTOR_KEY}
      bodyClassName="submit-to-warehouse-panel-body"
      title={translate("inspector.submitToWarehouse.label")}
    >
      <div
        className={cm(styles, "submit-to-warehouse-row")}
        data-channel-id={submitChannel.id}
        data-submit-enabled={isSelected ? "true" : "false"}
      >
        <span className={cm(styles, "submit-to-warehouse-icon")} aria-hidden="true">
          <LucideUpload />
        </span>
        <span className={cm(styles, "submit-to-warehouse-label")}>{translate("inspectorText.autoSubmit")}</span>
        {remainingSeconds === null ? null : (
          <span
            className={cm(styles, "submit-to-warehouse-countdown")}
            data-countdown={submitChannel.id}
          >
            {remainingSeconds}s
          </span>
        )}
        <button
          aria-checked={isSelected}
          aria-label={translate("inspector.submitToWarehouse.label")}
          className={cm(styles, "submit-to-warehouse-toggle")}
          data-recipe-select={submitChannel.id}
          onClick={handleToggle}
          role="switch"
          title={translate("inspector.submitToWarehouse.label")}
          type="button"
        >
          <span className={cm(styles, "submit-to-warehouse-toggle-knob")} aria-hidden="true" />
        </button>
      </div>
    </InspectorCollapsiblePanel>
  );
}

function resolveSubmitChannelStatus(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): SimulationDeviceRuntimeStatusReadModel["channelRecipes"][string] | null {
  const submitChannelEntry = runtimeStatus?.channelRecipes
    ? Object.entries(runtimeStatus.channelRecipes).find(
        ([, chStatus]) => chStatus?.recipeId === WAREHOUSE_SUBMIT_RECIPE_ID,
      )
    : undefined;
  return submitChannelEntry?.[1] ?? null;
}

function resolveSubmitRemainingSeconds(
  submitChannelStatus: SimulationDeviceRuntimeStatusReadModel["channelRecipes"][string] | null,
  presentedProgressSeconds: number | null,
): number | null {
  const isRunning = submitChannelStatus !== null;
  const progressSeconds = presentedProgressSeconds ?? 0;
  const desiredSeconds = submitChannelStatus?.desiredSeconds ?? 0;

  return isRunning && desiredSeconds > 0
    ? Math.max(0, Math.ceil(desiredSeconds - progressSeconds))
    : null;
}
