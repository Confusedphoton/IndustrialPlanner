import { observer } from "mobx-react-lite";
import { translateKnownText } from "@/app/shell/shared/known-text-translation";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import type { InspectorRuntimeSample } from "./selection-inspector-model";
import {
  hasActivityTags,
  isRecipeAvailableByActivity,
  resolveEffectiveActivityIds,
} from "@/shared/registry/activity-availability";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  DEFAULT_PORT_PRIORITY_PROBLEM_TITLE,
  DEFAULT_PORT_PRIORITY_PROBLEM_DESCRIPTION,
} from "@/shared/port-priority-groups";

export const PROBLEM_INSPECTOR_KEY = "problem-inspector";

interface DeviceProblem {
  readonly message: string;
  readonly severity: "error" | "warning" | "info";
  readonly description?: string;
}

function collectPlacementProblems(
  appHost: AppHost,
  entity: WorldEntity,
): DeviceProblem[] {
  const editor = appHost.workspace.editor;
  if (editor === null) return [];

  const validation = editor.queries.getEntityPlacementValidation(entity.id);
  if (validation.canPlace) return [];

  return validation.reasons.map((reason) => ({
    message: translateKnownText(reason.message, appHost.actions.translate),
    severity: "error" as const,
  }));
}

function collectPowerProblems(
  appHost: AppHost,
  entity: WorldEntity,
  definition: EntityDefinition,
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
  runtimeSample: InspectorRuntimeSample | null,
): DeviceProblem[] {
  const problems: DeviceProblem[] = [];
  const editor = appHost.workspace.editor;

  // 仿真运行时，以 Worker 编译期 powerStatus 为准
  if (runtimeStatus !== null) {
    // 设备不在供电范围
    if (runtimeStatus.powerStatus === "out-of-power-range") {
      problems.push({
        message: appHost.actions.translate("inspectorText.notInRangeOfAPower"),
        severity: "error",
      });
    }

    const docStatus = runtimeSample?.documentStatus;
    if (docStatus?.isPowerOutage && runtimeStatus.powerStatus !== "no-power-needed") {
      problems.push({
        message: appHost.actions.translate("inspectorText.insufficientPower"),
        severity: "error",
      });
    }

    return problems;
  }

  // 仿真未运行时，通过 Editor 的 powered collection 判断供电范围
  if (editor !== null && definition.powerDemand > 0) {
    if (!editor.state.collections.powered.includes(entity.id)) {
      problems.push({
        message: appHost.actions.translate("inspectorText.notInRangeOfAPower"),
        severity: "error",
      });
    }
  }

  return problems;
}

function collectRecipeProblems(
  appHost: AppHost,
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): DeviceProblem[] {
  if (runtimeStatus === null) return [];

  const problems: DeviceProblem[] = [];

  for (const chStatus of Object.values(runtimeStatus.channelRecipes)) {
    if (chStatus === null) continue;
    // waiting-output 且已累积满进度 → 产物堵塞
    if (
      chStatus.state === "waiting-output" &&
      chStatus.progressSeconds !== null &&
      chStatus.desiredSeconds !== null &&
      chStatus.progressSeconds >= chStatus.desiredSeconds
    ) {
      problems.push({
        message: appHost.actions.translate("inspectorText.outputBlocked"),
        severity: "error",
      });
    }
  }

  return problems;
}

function collectManualActivityRecipeProblems(
  appHost: AppHost,
  entity: WorldEntity,
  definition: EntityDefinition,
): DeviceProblem[] {
  const selectedRecipeIds = entity.config?.channelRecipes as Record<string, string> | undefined;
  if (selectedRecipeIds === undefined) {
    return [];
  }

  const effectiveActivityIds = resolveEffectiveActivityIds({
    selectedActivityIds: appHost.internalState.settings.selectedActivityIds,
  });
  const recipeDefinitions = appHost.workspace.registry.recipeDefinitions;

  for (const channel of definition.recipeChannels) {
    const selectedRecipeId = selectedRecipeIds[channel.id];
    if (selectedRecipeId === undefined) {
      continue;
    }

    const recipe = recipeDefinitions.find((candidate) => candidate.id === selectedRecipeId);
    if (
      recipe !== undefined
      && hasActivityTags(recipe.tags)
      && !isRecipeAvailableByActivity(recipe, effectiveActivityIds)
    ) {
      return [{
        message: appHost.actions.translate("inspectorText.theSelectedRecipeSEventIs"),
        severity: "warning",
      }];
    }
  }

  return [];
}

export const ProblemInspector = observer(function ProblemInspector({
  appHost,
  entity,
  definition,
  runtimeStatus,
  runtimeSample,
}: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  runtimeSample: InspectorRuntimeSample | null;
}) {
  const placementProblems = collectPlacementProblems(appHost, entity);
  const powerProblems = collectPowerProblems(appHost, entity, definition, runtimeStatus, runtimeSample);
  const recipeProblems = collectRecipeProblems(appHost, runtimeStatus);
  const manualActivityRecipeProblems = collectManualActivityRecipeProblems(appHost, entity, definition);
  const defaultPriorityProblems: DeviceProblem[] = appHost.portPriorityDefaults.get(entity.id) === null ? [] : [{
    message: DEFAULT_PORT_PRIORITY_PROBLEM_TITLE,
    severity: "info",
    description: DEFAULT_PORT_PRIORITY_PROBLEM_DESCRIPTION,
  }];

  const allProblems = [
    ...placementProblems,
    ...powerProblems,
    ...recipeProblems,
    ...manualActivityRecipeProblems,
    ...defaultPriorityProblems,
  ];

  if (allProblems.length === 0) {
    return null;
  }

  return (
    <InspectorCollapsiblePanel
      bodyClassName="problem-list"
      bodyRole="list"
      className="problem-inspector"
      dataInspectorKey={PROBLEM_INSPECTOR_KEY}
      title={appHost.actions.translate("inspectorText.problems")}
    >
      {allProblems.map((problem, index) => (
        <div
          aria-label={`${appHost.actions.translate(problem.severity === "error" ? "inspectorText.error" : problem.severity === "warning" ? "inspectorText.warning" : "inspectorText.notice")}${problem.message}`}
          className={cm(styles, "problem-row")}
          data-problem-row
          data-problem-severity={problem.severity}
          key={`${problem.severity}-${index}`}
          role="listitem"
        >
          <p>{problem.message}</p>
          {problem.description !== undefined ? <p>{problem.description}</p> : null}
        </div>
      ))}
    </InspectorCollapsiblePanel>
  );
});
