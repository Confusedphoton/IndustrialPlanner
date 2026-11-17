import type {
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceRuntimeStatusReadModel,
} from "@/domain/simulation/types/simulation-types";
import LucideLock from "~icons/lucide/lock";
import LucideTrash2 from "~icons/lucide/trash-2";
import type { ProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition, RecipeChannelDefinition } from "@/domain/registry/types/entity-definition";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";
import { isAutomaticRecipeChannelMode } from "@/shared/recipe-channel-behavior";
import { isRecipeVisibleInToolbox } from "@/shared/registry/recipe-visibility";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { RecipeTileGrid } from "./recipe-tile-grid";
import styles from "@/app/shell/inspector/inspector.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { resolvePresentedRecipeProgressSeconds } from "@/shared/simulation-recipe-progress";
import { useSimulationRecipePresentation } from "./use-simulation-recipe-presentation";
import type { InspectorRuntimeSample } from "./selection-inspector-model";

export const SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY =
  "simulation-recipe-status-runtime-inspector";

function resolveChannelProgressPercent(
  channelStatus: SimulationDeviceRuntimeChannelRecipeStatus | null,
  presentedProgressSeconds = channelStatus?.progressSeconds ?? null,
): number | null {
  if (channelStatus === null) return null;
  const { desiredSeconds } = channelStatus;
  const progressSeconds = presentedProgressSeconds;
  if (progressSeconds === null || desiredSeconds === null || desiredSeconds <= 0) return null;
  const pct = progressSeconds / desiredSeconds * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}


export interface SimulationRecipeStatusRuntimeInspectorProps {
  /** 所有 recipe channel ID 列表 */
  channelIds: readonly string[];
  /** 设备声明的全部 recipe channel 定义 */
  channels: readonly RecipeChannelDefinition[];
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  runtimeSample: InspectorRuntimeSample | null;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
  appHost?: AppHost;
  entity?: WorldEntity;
  definition?: EntityDefinition;
}

export function SimulationRecipeStatusRuntimeInspector({
  channelIds,
  channels,
  runtimeStatus,
  runtimeSample,
  index,
  t,
  appHost,
  entity,
  definition,
}: SimulationRecipeStatusRuntimeInspectorProps) {
  const shouldAnimate = Object.values(runtimeStatus?.channelRecipes ?? {})
    .some((status) => status?.isProgressing === true);
  const presentation = useSimulationRecipePresentation(runtimeSample, shouldAnimate);
  const resolveProgressPercent = (
    status: SimulationDeviceRuntimeChannelRecipeStatus | null,
  ): number | null => resolveChannelProgressPercent(
    status,
    resolvePresentedRecipeProgressSeconds({
      channelStatus: status,
      ...presentation,
    }),
  );
  // 气体环境 tag（必须在所有 early return 之前调用，遵循 hooks 规则）
  const gasEnvTag = (() => {
    if (!appHost || !entity || !definition) return null;

    // 先判断该设备是否有任意配方需要气体环境
    let needsGasEnv = false;
    for (const recipe of index.recipeById.values()) {
      if (recipe.machineId === definition.id && recipe.requiredEnvironmentAnyOf) {
        needsGasEnv = true;
        break;
      }
    }
    if (!needsGasEnv) return null;

    const gasItemIds = runtimeSample?.activeGasItemIds ?? null;
    const isInGas = gasItemIds !== null && gasItemIds.length > 0;
    const gasNames = gasItemIds?.map((itemId) => {
      const gasItem = index.itemById.get(itemId);
      return gasItem ? t(gasItem.nameKey) : itemId;
    }) ?? [];

    return (
      <span
        className={cm(
          styles,
          "recipe-gas-env-tag",
          isInGas ? "recipe-gas-env-tag--in-gas" : "recipe-gas-env-tag--no-gas",
        )}
      >
        {isInGas
          ? `${t("inspector.recipeStatus.inGas")}${gasNames.join(", ")}`
          : t("inspector.recipeStatus.noGas")}
      </span>
    );
  })();

  if (channelIds.length === 0) return null;

  const recipeChannelBehavior = definition?.recipeChannelBehavior;
  const modeConfigKey = recipeChannelBehavior?.automaticModeConfigKey;
  const modeSwitchable = modeConfigKey !== undefined;
  const automaticMode = isAutomaticRecipeChannelMode(
    recipeChannelBehavior,
    entity?.config ?? {},
  );

  // 分离 auto 与 manual channel
  const autoChannels = channels.filter(
    (ch) => channelIds.includes(ch.id) && (modeSwitchable ? automaticMode : !ch.manualRecipeOnly),
  );
  const manualChannels = channels.filter(
    (ch) => channelIds.includes(ch.id) && (modeSwitchable ? !automaticMode : ch.manualRecipeOnly),
  );

  const hasAuto = autoChannels.length > 0;
  const hasManual = manualChannels.length > 0;

  // 实体配置中已选配方
  const storedRecipes = (entity?.config?.channelRecipes as Record<string, string> | undefined) ?? {};

  // 运行时 channel 配方状态
  const channelRecipeStatus = runtimeStatus?.channelRecipes ?? {};

  // 设备可执行的生产配方，供单击磁贴选择。自动配方设备写入的 channelRecipes 与
  // 自动规划（EDA）产出一致，仅作为计划配方与画布标签，不改变仿真的自动匹配。
  const machineRecipes = definition === undefined
    ? []
    : resolveMachineRecipes(index, definition.id);
  const firstAutoChannel = autoChannels[0];
  const showPlannedPicker = runtimeStatus === null
    && firstAutoChannel !== undefined
    && machineRecipes.length > 0
    && appHost !== undefined
    && entity !== undefined;
  const assignChannelRecipe = (channelId: string, recipeId: string | null, allowDuplicates: boolean) => {
    const editor = appHost?.workspace.editor;
    if (!editor || !entity) return;
    const next = { ...storedRecipes };
    if (recipeId === null) {
      delete next[channelId];
    } else {
      if (!allowDuplicates) {
        for (const [storedChannelId, storedRecipeId] of Object.entries(next)) {
          if (storedChannelId !== channelId && storedRecipeId === recipeId) {
            delete next[storedChannelId];
          }
        }
      }
      next[channelId] = recipeId;
    }
    editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
  };

  if (runtimeStatus === null && !hasManual && !modeSwitchable && !showPlannedPicker) {
    return null;
  }

  const modeSwitch = modeConfigKey === undefined || entity === undefined
    ? null
    : (
        <label
          className={cm(styles, "recipe-channel-mode-switch")}
          title={t("inspector.recipeChannelMode.label")}
        >
          <input
            aria-label={t("inspector.recipeChannelMode.label")}
            checked={automaticMode}
            data-recipe-channel-mode-switch
            onChange={(event) => {
              appHost?.workspace.editor?.actions.patchEntityConfig(entity.id, {
                [modeConfigKey]: event.currentTarget.checked,
              });
            }}
            role="switch"
            type="checkbox"
          />
          <span>
            {t(automaticMode
              ? "inspector.recipeChannelMode.automatic"
              : "inspector.recipeChannelMode.manual")}
          </span>
        </label>
      );

  return (
    <InspectorCollapsiblePanel
      className={cm(styles, "simulation-recipe-status-runtime-inspector")}
      dataInspectorKey={SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY}
      title={t("inspector.recipeStatus.title")}
      titleClassName={cm(styles, "recipe-status-panel-title")}
      headerActions={gasEnvTag === null && modeSwitch === null ? undefined : (
        <>
          {gasEnvTag}
          {modeSwitch}
        </>
      )}
    >
      {hasAuto && showPlannedPicker && firstAutoChannel !== undefined && (
        <RecipeTileGrid
          index={index}
          onSelect={(recipeId) => assignChannelRecipe(
            firstAutoChannel.id,
            recipeId,
            recipeChannelBehavior?.allowDuplicateRecipesAcrossChannels ?? false,
          )}
          recipes={machineRecipes}
          selectedRecipeId={storedRecipes[firstAutoChannel.id] ?? null}
          t={t}
        />
      )}
      {hasAuto && !showPlannedPicker && (
        <AutoRecipeSection
          autoChannels={autoChannels}
          channelRecipeStatus={channelRecipeStatus}
          index={index}
          t={t}
          resolveProgressPercent={resolveProgressPercent}
        />
      )}
      {hasAuto && hasManual && (
        <div className={cm(styles, "recipe-section-divider")} />
      )}
      {hasManual && (
        <ManualRecipeSection
          manualChannels={manualChannels}
          storedRecipes={storedRecipes}
          channelRecipeStatus={channelRecipeStatus}
          index={index}
          t={t}
          appHost={appHost}
          entity={entity}
          resolveProgressPercent={resolveProgressPercent}
          allowDuplicateRecipesAcrossChannels={
            recipeChannelBehavior?.allowDuplicateRecipesAcrossChannels ?? false
          }
          machineRecipes={machineRecipes}
          onAssignRecipe={assignChannelRecipe}
        />
      )}
    </InspectorCollapsiblePanel>
  );
}

// ---------------------------------------------------------------------------
// 自动配方区域
// ---------------------------------------------------------------------------

interface AutoRecipeSectionProps {
  autoChannels: readonly RecipeChannelDefinition[];
  channelRecipeStatus: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null>;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
  resolveProgressPercent: (
    status: SimulationDeviceRuntimeChannelRecipeStatus | null,
  ) => number | null;
}

function AutoRecipeSection({
  autoChannels,
  channelRecipeStatus,
  index,
  t,
  resolveProgressPercent,
}: AutoRecipeSectionProps) {
  // 收集运行时正在运行的自动 channel
  const runningChannels: { ch: RecipeChannelDefinition; status: SimulationDeviceRuntimeChannelRecipeStatus }[] = [];
  for (const ch of autoChannels) {
    const status = channelRecipeStatus[ch.id] ?? null;
    if (status !== null && status.recipeId !== null) {
      runningChannels.push({ ch, status });
    }
  }

  // 始终至少显示 1 行（占位或运行中）
  const displayCount = Math.max(1, runningChannels.length);

  return (
    <div className={cm(styles, "recipe-auto-section")}>
      {Array.from({ length: displayCount }).map((_, i) => {
        const running = runningChannels[i] ?? null;
        if (running !== null) {
          const pct = resolveProgressPercent(running.status);
          return (
            <div key={running.ch.id} className={cm(styles, "recipe-channel-row")} data-recipe-row-mode="locked">
              <RecipeDisplay
                recipeId={running.status.recipeId!}
                index={index}
                showDevice={false}
                variant="inspectorStatus"
                progressPercent={pct}
                progressKind="ring"
                t={t}
              />
              <span
                className={cm(styles, "recipe-locked-control")}
                title={t("productionPlanning.autoRecipeReadonly")}
                aria-label={t("productionPlanning.autoRecipeReadonly")}
              >
                <LucideLock aria-hidden="true" />
              </span>
            </div>
          );
        }
        return (
          <div key={`auto-placeholder-${i}`} className={cm(styles, "recipe-channel-row")}>
            <div className={cm(styles, "recipe-status-placeholder")} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 手动配方区域
// ---------------------------------------------------------------------------

interface ManualRecipeSectionProps {
  manualChannels: readonly RecipeChannelDefinition[];
  storedRecipes: Record<string, string>;
  channelRecipeStatus: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null>;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
  appHost?: AppHost;
  entity?: WorldEntity;
  allowDuplicateRecipesAcrossChannels: boolean;
  resolveProgressPercent: (
    status: SimulationDeviceRuntimeChannelRecipeStatus | null,
  ) => number | null;
  machineRecipes: readonly RecipeDefinition[];
  onAssignRecipe: (channelId: string, recipeId: string | null, allowDuplicates: boolean) => void;
}

function ManualRecipeSection({
  manualChannels,
  storedRecipes,
  channelRecipeStatus,
  index,
  t,
  appHost,
  entity,
  allowDuplicateRecipesAcrossChannels,
  resolveProgressPercent,
  machineRecipes,
  onAssignRecipe,
}: ManualRecipeSectionProps) {
  // 已填充的手动 channel（在 entity config 中有配方记录）
  const filledChannels = manualChannels.filter(
    (ch) => storedRecipes[ch.id] !== undefined && storedRecipes[ch.id] !== null,
  );
  const unfilledChannels = manualChannels.filter(
    (ch) => storedRecipes[ch.id] === undefined || storedRecipes[ch.id] === null,
  );

  const handleRemoveRecipe = (channelId: string) => {
    if (!appHost || !entity) return;
    const editor = appHost.workspace.editor;
    if (!editor) return;
    const next = { ...storedRecipes };
    delete next[channelId];
    editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
  };

  return (
    <div className={cm(styles, "recipe-manual-section")}>
      {filledChannels.map((ch) => {
        const recipeId = storedRecipes[ch.id];
        const status = channelRecipeStatus[ch.id] ?? null;
        const pct = resolveProgressPercent(status);
        return (
          <div key={ch.id} className={cm(styles, "recipe-channel-row")} data-recipe-row-mode="removable">
            <RecipeDisplay
              recipeId={recipeId!}
              index={index}
              showDevice={false}
              variant="inspectorStatus"
              progressPercent={pct}
              progressKind="ring"
              t={t}
            />
            <button
              className={cm(styles, "recipe-remove-button")}
              onClick={() => handleRemoveRecipe(ch.id)}
              type="button"
              title={t("productionPlanning.remove")}
              aria-label={t("productionPlanning.remove")}
            >
              <LucideTrash2 aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {/* 未填写的频道直接内嵌配方磁贴，单击即写入；配方较多时磁贴网格自带筛选框。 */}
      {unfilledChannels.length > 0 && machineRecipes.length > 0 && (() => {
        const nextChannel = unfilledChannels[0]!;
        return (
          <RecipeTileGrid
            key={`tiles-${nextChannel.id}`}
            index={index}
            onSelect={(recipeId) => onAssignRecipe(nextChannel.id, recipeId, allowDuplicateRecipesAcrossChannels)}
            recipes={machineRecipes}
            selectedRecipeId={null}
            t={t}
          />
        );
      })()}
    </div>
  );
}


/** 设备可平铺选择的生产配方（排除工具箱隐藏配方与运行消耗配方）。 */
export function resolveMachineRecipes(index: ProductionPlanningIndex, machineId: string): RecipeDefinition[] {
  const recipes: RecipeDefinition[] = [];
  for (const recipe of index.recipeById.values()) {
    if (
      recipe.machineId === machineId
      && isRecipeVisibleInToolbox(recipe)
      && !recipe.tags.includes(CONSUMPTION_RECIPE_TAG)
    ) {
      recipes.push(recipe);
    }
  }
  return recipes;
}
