import { selectDocumentContent, sameDocumentContent } from "@/shared/snapshot/world-document-selection";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import { createPortal } from "react-dom";

import { useEditorDocumentSnapshot } from "../hooks";
import {
  fetchHelpMarkdownHtml,
  MarkdownTutorialOverlay,
} from "@/app/shell/dialogs";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { NumberInput } from "@/app/shell/shared/number-input";
import LucideTrash2 from "~icons/lucide/trash-2";
import type { AppHost } from "@/app/host/app-host";
import { DEFAULT_WORLD_BASE_ID } from "@/domain/document/world-document";
import {
  buildWarehouseStatsEntries,
  resolveCompactWarehouseEntries,
  useWarehousePinnedItems,
  useWarehouseStats,
  WarehouseStatsView,
} from "@/app/shell/shared/warehouse-stats-view";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import {
  isCustomPortPriorityGroupsEnabled,
  DEFAULT_PORT_PRIORITY_PROBLEM_TITLE,
  DEFAULT_PORT_PRIORITY_PROBLEM_DESCRIPTION,
} from "@/shared/port-priority-groups";
import { resolveBaseMaxPipeLogistics } from "@/shared/base-tags";
import {
  collectUnknownWorldEntityDefinitionIssues,
  type UnknownWorldEntityDefinitionIssue,
} from "@/shared/world-document-unknown-entities";
import { regionalSimulationUiState } from "@/app/state/regional-simulation-ui-state";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import {
  collectBaseConfigurationProblems,
  collectRuntimeInfiniteStorageEntityIds,
} from "@/app/shell/panels/base-configuration-problems";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { resolveBaseDisplayName, resolveBaseTagLabel } from "@/app/shell/shared/known-text-translation";
import { groupBaseDefinitionsByTag } from "@/app/shell/dialogs/base-select-dialog";
import panelStyles from "@/app/shell/panels/panels.module.scss";
import { RegionalResourcesCard } from "@/app/shell/panels/regional-resources-card";

const BASE_PANEL_POWER_INTERVAL_MS = 250;
const BASE_PANEL_PROBLEM_INTERVAL_MS = 250;
const REGIONAL_MULTI_BASE_HELP_PATH = createPublicAssetUrl(
  "help/config-guide/experimental-regional-multi-base.md",
);

interface RegionalUnknownEntityProblem {
  readonly baseId: string;
  readonly baseName: string;
  readonly issue: UnknownWorldEntityDefinitionIssue;
}

function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}


export const BasePanel = observer(function BasePanel({ appHost, active = true }: { appHost: AppHost; active?: boolean }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  const currentDocument = useEditorDocumentSnapshot(editor, selectDocumentContent, sameDocumentContent);
  const activeDocumentBaseId = currentDocument?.baseId ?? null;
  const currentBaseId = currentDocument?.baseId ?? DEFAULT_WORLD_BASE_ID;
  const currentBase = appHost.workspace.registry.baseDefinitions.find(
    (definition) => definition.id === currentBaseId,
  ) ?? appHost.workspace.registry.baseDefinitions[0] ?? null;
  const currentBaseName = currentBase?.name ?? currentBaseId;
  // 界面显示用译名；currentBaseName 仍作为地区资源标签的回退键。
  const currentBaseLabel = currentBase === undefined || currentBase === null
    ? currentBaseId
    : resolveBaseDisplayName(currentBase, t);
  const [regionalHelpTutorialVisible, setRegionalHelpTutorialVisible] = useState(false);
  const warehouseStats = useWarehouseStats(appHost, active);
  const pinnedItems = useWarehousePinnedItems(appHost);
  const warehouseEntries = buildWarehouseStatsEntries({
    appHost,
    stats: warehouseStats,
    pinnedItemIds: pinnedItems.pinnedItemIds,
  });
  const compactWarehouseEntries = resolveCompactWarehouseEntries(warehouseEntries);

  const deviceStats = useMemo(() => {
    if (currentDocument === null) {
      return { totalDevices: 0, pipeLogisticsDevices: 0 };
    }
    const entities = Object.values(currentDocument.entities);
    const totalDevices = entities.length;
    // 管道物流设备仅包含四种物流角色，明确不包括管道节。
    const pipeLogisticsDevices = entities.filter((e) =>
      appHost.workspace.registry.queries.isPipeLogistics(e.definitionId),
    ).length;
    return { totalDevices, pipeLogisticsDevices };
  }, [appHost.workspace.registry.queries, currentDocument]);

  // -------------------------------------------------------------------------
  // 基地问题收集
  // -------------------------------------------------------------------------

  interface BaseProblem {
    readonly message: string;
    readonly severity: "error" | "warning" | "info";
    readonly tooltip: string;
    /** 关联的设备 ID，用于点击聚焦 */
    readonly entityId?: string;
    readonly unknownEntity?: {
      readonly baseId: string;
      readonly entityId: string;
    };
  }

  /** 根据 definitionId 解析设备中文名 */
  const resolveDeviceName = useCallback(
    (definitionId: string): string => {
      const definition = appHost.workspace.registry.entityDefinitions.find(
        (d) => d.id === definitionId,
      );
      if (definition === undefined) return definitionId;
      const translated = t(definition.nameKey);
      return translated === definition.nameKey ? definitionId : translated;
    },
    [appHost.workspace.registry.entityDefinitions, t],
  );

  const [runtimeInfiniteStorageEntityIds, setRuntimeInfiniteStorageEntityIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const simulation = appHost.workspace.simulation;
      if (currentDocument === null || simulation === null) {
        setRuntimeInfiniteStorageEntityIds((current) =>
          current.size === 0 ? current : new Set(),
        );
        return;
      }

      const entities = Object.values(currentDocument.entities);
      const runtimeSlotItemsByEntityId = new Map(
        entities.flatMap((entity) => {
          const runtimeStatus = simulation.queries.getDeviceRuntimeStatus(entity.id);
          return runtimeStatus === null
            ? []
            : [[entity.id, runtimeStatus.slotItems] as const];
        }),
      );
      const next = collectRuntimeInfiniteStorageEntityIds({
        entities,
        entityDefinitions: appHost.workspace.registry.entityDefinitions,
        runtimeSlotItemsByEntityId,
      });
      setRuntimeInfiniteStorageEntityIds((current) =>
        areStringSetsEqual(current, next) ? current : next,
      );
    };

    tick();
    const intervalId = window.setInterval(tick, BASE_PANEL_PROBLEM_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [active, appHost, appHost.workspace.registry.entityDefinitions, currentDocument]);

  const multiBaseEnabled = appHost.state.settings.regionalMultiBaseEnabled;
  const regionalMultiBaseSupported = false;
  const currentUnknownEntityProblems = useMemo<RegionalUnknownEntityProblem[]>(() => {
    if (currentDocument === null) return [];
    return collectUnknownWorldEntityDefinitionIssues({
      document: currentDocument,
      entityDefinitions: appHost.workspace.registry.entityDefinitions,
    })
      .filter((issue) => issue.origin === "document")
      .map((issue) => ({
        baseId: currentDocument.baseId,
        baseName: currentBaseLabel,
        issue,
      }));
  }, [
    appHost.workspace.registry.entityDefinitions,
    currentBaseLabel,
    currentDocument,
  ]);
  const [siblingUnknownEntityProblems, setSiblingUnknownEntityProblems] = useState<
    readonly RegionalUnknownEntityProblem[]
  >([]);
  useEffect(() => {
    if (
      !multiBaseEnabled
      || activeDocumentBaseId === null
      || currentBase === null
      || editor === null
    ) {
      setSiblingUnknownEntityProblems([]);
      return;
    }

    const siblingBases = appHost.workspace.registry.baseDefinitions.filter((definition) =>
      definition.tag === currentBase.tag
      && definition.id !== activeDocumentBaseId
    );
    if (siblingBases.length === 0) {
      setSiblingUnknownEntityProblems([]);
      return;
    }

    let cancelled = false;
    void editor.queries.readLatestBaseDocuments(
      siblingBases.map((definition) => definition.id),
    ).then((documents) => {
      if (cancelled) return;
      const problems = siblingBases.flatMap((definition, index) => {
        const document = documents[index];
        if (document === undefined) return [];
        return collectUnknownWorldEntityDefinitionIssues({
          document,
          entityDefinitions: appHost.workspace.registry.entityDefinitions,
        })
          .filter((issue) => issue.origin === "document")
          .map((issue) => ({
            baseId: definition.id,
            baseName: resolveBaseDisplayName(definition, t),
            issue,
          }));
      });
      setSiblingUnknownEntityProblems(problems);
    }).catch(() => {
      if (!cancelled) setSiblingUnknownEntityProblems([]);
    });

    return () => {
      cancelled = true;
    };
  }, [
    appHost.workspace.registry.baseDefinitions,
    appHost.workspace.registry.entityDefinitions,
    activeDocumentBaseId,
    currentBase,
    t,
    editor,
    multiBaseEnabled,
  ]);

  const invalidDocumentEntityIds = JSON.stringify(
    editor?.state.collections[EntityCollectionType.invalidPlacement]
      .filter((id) => currentDocument?.entities[id] !== undefined) ?? [],
  );
  const defaultPortPriorities = appHost.portPriorityDefaults.getAll();
  const baseProblems = useMemo<BaseProblem[]>(() => {
    const problems: BaseProblem[] = [];
    if (currentDocument === null || editor === null) return problems;

    const entities = Object.values(currentDocument.entities);
    const invalidIds: string[] = JSON.parse(invalidDocumentEntityIds);

    for (const problem of [
      ...currentUnknownEntityProblems,
      ...siblingUnknownEntityProblems,
    ]) {
      const prefix = problem.baseId === currentDocument.baseId
        ? ""
        : `${problem.baseName}${t("baseProblem.basePrefixSeparator")}`;
      const message = prefix + t("baseProblem.unknownEntity").replace("{entityId}", problem.issue.entityId);
      const relatedLinkText = problem.issue.relatedSlotLinkCount === 0
        ? t("baseProblem.noRelatedLinks")
        : t("baseProblem.relatedLinks").replace("{count}", String(problem.issue.relatedSlotLinkCount));
      const handlingText = problem.baseId === currentDocument.baseId
        ? t("baseProblem.deleteHere")
        : t("baseProblem.switchBaseFirst").replace("{base}", problem.baseName);
      problems.push({
        message,
        severity: "error",
        tooltip: t("baseProblem.unknownEntityTooltip")
          .replace("{definitionId}", problem.issue.definitionId)
          .replace("{x}", String(problem.issue.position.x))
          .replace("{y}", String(problem.issue.position.y))
          .replace("{related}", relatedLinkText)
          .replace("{handling}", handlingText),
        unknownEntity: {
          baseId: problem.baseId,
          entityId: problem.issue.entityId,
        },
      });
    }

    // ① 无效放置
    for (const entityId of invalidIds) {
      const entity = entities.find((e) => e.id === entityId);
      if (entity === undefined) continue;
      const deviceName = resolveDeviceName(entity.definitionId);
      const msg = t("baseProblem.invalidPlacement").replace("{device}", deviceName);
      problems.push({ message: msg, severity: "error", tooltip: msg, entityId: entity.id });
    }

    // ② 管道物流数超限
    const maxPipe = currentBase !== null
      ? resolveBaseMaxPipeLogistics(currentBase.tags)
      : null;
    if (maxPipe !== null && deviceStats.pipeLogisticsDevices > maxPipe) {
      const msg = t("baseProblem.pipeLogisticsLimit")
        .replace("{count}", String(deviceStats.pipeLogisticsDevices))
        .replace("{max}", String(maxPipe));
      problems.push({ message: msg, severity: "error", tooltip: msg });
    }

    // ③ 端口优先级组
    for (const entity of entities) {
      if (defaultPortPriorities.has(entity.id)) {
        problems.push({
          message: DEFAULT_PORT_PRIORITY_PROBLEM_TITLE,
          severity: "info",
          tooltip: DEFAULT_PORT_PRIORITY_PROBLEM_DESCRIPTION,
          entityId: entity.id,
        });
      }
      if (isCustomPortPriorityGroupsEnabled(entity.config)) {
        const deviceName = resolveDeviceName(entity.definitionId);
        const msg = t("baseProblem.customPortPriority").replace("{device}", deviceName);
        problems.push({ message: msg, severity: "warning", tooltip: msg });
      }
    }

    // ④ 作弊设备、无效无限资源与普通槽位无限配置
    problems.push(...collectBaseConfigurationProblems({
      entities,
      entityDefinitions: appHost.workspace.registry.entityDefinitions,
      itemDefinitions: appHost.workspace.registry.itemDefinitions,
      slotLinks: currentDocument.slotLinks,
      multiBaseEnabled,
      runtimeInfiniteStorageEntityIds,
      translate: t,
      registryQueries: appHost.workspace.registry.queries,
    }));

    return problems;
  }, [
    t,
    appHost.workspace.registry.entityDefinitions,
    appHost.workspace.registry.itemDefinitions,
    appHost.workspace.registry.queries,
    currentDocument,
    currentBase,
    currentUnknownEntityProblems,
    deviceStats.pipeLogisticsDevices,
    defaultPortPriorities,
    editor,
    multiBaseEnabled,
    resolveDeviceName,
    runtimeInfiniteStorageEntityIds,
    siblingUnknownEntityProblems,
    invalidDocumentEntityIds,
  ]);

  const [activeProblemTooltip, setActiveProblemTooltip] = useState<number | null>(null);
  const [popoverRect, setPopoverRect] = useState<{ top: number; left: number } | null>(null);
  const [pendingUnknownEntityDeleteId, setPendingUnknownEntityDeleteId] = useState<
    string | null
  >(null);
  const problemRowRefs = useRef<Map<number, HTMLElement>>(new Map());
  const problemPopoverRef = useRef<HTMLDivElement | null>(null);

  const deleteUnknownEntity = useCallback((entityId: string) => {
    if (editor === null) return;
    const document = editor.document.getSnapshot();
    const entity = document.entities[entityId];
    if (
      entity === undefined
      || appHost.workspace.registry.entityDefinitions.some(
        (definition) => definition.id === entity.definitionId,
      )
    ) {
      setPendingUnknownEntityDeleteId(null);
      return;
    }

    const preservedSelection = [...editor.state.collections.selection]
      .filter((selectedEntityId) => selectedEntityId !== entityId);
    runInAction(() => {
      editor.actions.clearCollection(EntityCollectionType.selection);
      editor.actions.addToCollection({
        collectionType: EntityCollectionType.selection,
        entityId,
      });
      editor.actions.deleteCollection(EntityCollectionType.selection);
      for (const selectedEntityId of preservedSelection) {
        editor.actions.addToCollection({
          collectionType: EntityCollectionType.selection,
          entityId: selectedEntityId,
        });
      }
    });
    setPendingUnknownEntityDeleteId(null);
    setActiveProblemTooltip(null);
    setPopoverRect(null);
  }, [appHost.workspace.registry.entityDefinitions, editor]);

  // 点击外部关闭 popover
  const handleDocumentPointerDown = useCallback((e: PointerEvent) => {
    const target = e.target as Node | null;
    if (target === null) return;
    if (problemPopoverRef.current?.contains(target)) return;
    // 点击在触发按钮所在行上 → 不关闭
    if (activeProblemTooltip !== null) {
      const rowEl = problemRowRefs.current.get(activeProblemTooltip);
      if (rowEl?.contains(target)) return;
    }
    setPendingUnknownEntityDeleteId(null);
    setActiveProblemTooltip(null);
    setPopoverRect(null);
  }, [activeProblemTooltip]);

  useEffect(() => {
    if (activeProblemTooltip === null) return;
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  }, [activeProblemTooltip, handleDocumentPointerDown]);

  // 主动轮询仿真文档级运行时数据（非 MobX 被动响应）
  const [totalPowerDemand, setTotalPowerDemand] = useState<number | null>(null);
  const [currentPowerGeneration, setCurrentPowerGeneration] = useState<number | null>(null);
  const [isPowerOutage, setIsPowerOutage] = useState<boolean>(false);
  const [baseBatteryJoules, setBaseBatteryJoules] = useState<number | null>(null);
  const [baseBatteryCapacity, setBaseBatteryCapacity] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const docStatus = appHost.workspace.simulation?.queries.getDocumentRuntimeStatus() ?? null;
      setTotalPowerDemand(docStatus?.totalPowerDemand ?? null);
      setCurrentPowerGeneration(docStatus?.currentPowerGeneration ?? null);
      setIsPowerOutage(docStatus?.isPowerOutage ?? false);
      setBaseBatteryJoules(docStatus?.baseBatteryJoules ?? null);
      setBaseBatteryCapacity(docStatus?.baseBatteryCapacity ?? null);
    };

    tick();
    const intervalId = window.setInterval(tick, BASE_PANEL_POWER_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [active, appHost]);

  const powerMode: "real" | "infinite" =
    currentDocument?.documentSettings?.powerMode === "real" ? "real" : "infinite";

  const handleTogglePowerMode = () => {
    if (editor === null) return;
    const nextMode: "real" | "infinite" = powerMode === "real" ? "infinite" : "real";
    // 写入 documentSettings（silent）→ simulation 自动监听到并同步到 worker
    editor.actions.writeDocumentSettings({ powerMode: nextMode });
  };

  // 手动覆盖总耗电
  const powerConsumptionOverride: number | undefined = (() => {
    const raw = currentDocument?.documentSettings?.powerConsumptionOverride;
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  })();
  const hasOverride = powerConsumptionOverride !== undefined;

  const handleOverrideCommit = (value: number) => {
    if (editor === null) return;
    editor.actions.writeDocumentSettings({ powerConsumptionOverride: Math.max(0, value) });
  };

  const handleClearOverride = () => {
    if (editor === null) return;
    editor.actions.writeDocumentSettings({ powerConsumptionOverride: undefined });
  };

  // 电力横条数据
  const demandDisplay = totalPowerDemand !== null ? `${totalPowerDemand} kW` : "-- kW";
  const isInfinite = powerMode === "infinite";
  const generationDisplay = isInfinite
    ? "∞"
    : currentPowerGeneration !== null
      ? `${currentPowerGeneration} kW`
      : "-- kW";

  // 电池剩余百分比
  let percentageText = "--%";
  if (baseBatteryJoules !== null && baseBatteryCapacity !== null && baseBatteryCapacity > 0) {
    const rawPct = (baseBatteryJoules / baseBatteryCapacity) * 100;
    // 99.5~99.9 强制显示 99%，防止四舍五入虚标 100%
    const pct = (rawPct >= 99.995 && rawPct < 100) ? 99.99 : Math.min(100, rawPct);
    percentageText = `${pct.toFixed(2)}%`;
  }

  // 停电时文字变红
  const powerRowClassName = isPowerOutage && !isInfinite
    ? cm(styles, "power-bar-label", "power-bar-outage")
    : cm(styles, "power-bar-label");
  const activeBaseProblem = activeProblemTooltip === null
    ? null
    : (baseProblems[activeProblemTooltip] ?? null);
  const activeUnknownEntity = activeBaseProblem?.unknownEntity ?? null;
  const activeUnknownEntityId = activeUnknownEntity?.entityId ?? null;

  return (
    <div className={cm(styles, "stack")}>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("rightDock.base")}</h3>
        </div>
        <BaseInlinePicker appHost={appHost} currentBaseId={currentBaseId} />
        {regionalSimulationUiState.experimentalEnabled && (
          <div className={cm(styles, "base-regional-switch")}>
            <label className={cm(styles, "base-regional-switch-control")}>
              <input
                checked={multiBaseEnabled}
                disabled={
                  !regionalMultiBaseSupported
                  || appHost.workspace.simulation?.state.runningState !== "stop"
                }
                onChange={(event) => {
                  const simulation = appHost.workspace.simulation;
                  if (simulation === null || !regionalMultiBaseSupported) return;

                  const enabled = event.target.checked;
                  if (
                    enabled
                    && (
                      appHost.internalState.workbench.dialogState.timeline.visible
                      || simulation.state.timeline.enabled
                    )
                  ) {
                    simulation.actions.disableTimeline();
                  }

                  appHost.regionalSettings.setMultiBaseEnabled(enabled);
                  if (enabled) {
                    setRegionalHelpTutorialVisible(true);
                  }
                }}
                role="switch"
                type="checkbox"
              />
              <span className={cm(styles, "base-regional-switch-track")} aria-hidden="true">
                <span className={cm(styles, "base-regional-switch-thumb")} />
              </span>
              <span className={cm(styles, "base-regional-switch-label")}>
                {t("basePanel.runAllBases")}
              </span>
            </label>
            <RegionalMultiBaseHelp
              compactLayout={appHost.state.screenProfile.deviceClass === "mobile"}
              legacyUnsupported={!regionalMultiBaseSupported}
              onCloseTutorial={() => setRegionalHelpTutorialVisible(false)}
              t={t}
              tutorialVisible={regionalHelpTutorialVisible}
            />
          </div>
        )}
      </article>
      <RegionalResourcesCard
        appHost={appHost}
        regionTag={currentBase?.tag ?? currentBaseName}
      />
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("rightDock.power")}</h3>
        </div>
        <div className={cm(styles, "power-bar-shell")}>
          <div className={powerRowClassName}>
            <span className={cm(styles, "power-bar-values")}>
              {demandDisplay}
              <span className={cm(styles, "power-bar-separator")}>/</span>
              {generationDisplay}
            </span>
            <span className={cm(styles, "power-bar-percent")}>{percentageText}</span>
          </div>
        </div>
        <label className={cm(styles, "power-infinite-switch")}>
          <span className={cm(styles, "power-infinite-switch-label")}>
            {t("workbench.power.infiniteSwitch")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isInfinite}
            className={cm(styles, isInfinite ? "power-switch-on" : "power-switch-off")}
            onClick={handleTogglePowerMode}
          >
            <span className={cm(styles, "power-switch-thumb")} />
          </button>
        </label>
        {!isInfinite ? (
          <div className={cm(panelStyles, "power-override-row")}>
            <label className={cm(panelStyles, "power-override-label")}>
              {t("workbench.power.covered")}
            </label>
            <div className={cm(panelStyles, "power-override-controls")}>
              <NumberInput
                className={cm(panelStyles, "power-override-input")}
                min={0}
                placeholder={t("workbench.powerValue.covered")}
                value={hasOverride ? powerConsumptionOverride : ""}
                onCommit={handleOverrideCommit}
              />
              {hasOverride ? (
                <button
                  aria-label={t("workbench.power.clearOverride")}
                  className={cm(panelStyles, "power-override-clear")}
                  type="button"
                  onClick={handleClearOverride}
                >
                  <LucideTrash2 aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </article>
      <article className={cm(styles, "inspector-card")}> 
        <div className={cm(styles, "card-header warehouse-stats-card-header")}> 
          <h3>{t("warehouseStats.title")}</h3>
          <button
            className={cm(styles, "warehouse-stats-more-button")}
            disabled={warehouseStats === null}
            onClick={() => appHost.internalActions.openDialog("warehouse-stats")}
            type="button"
          >
            {t("warehouseStats.more")}
          </button>
        </div>
        {warehouseStats === null ? (
          <div className={cm(styles, "warehouse-stats-placeholder")}>{t("warehouseStats.runToView")}</div>
        ) : (
          <WarehouseStatsView
            appHost={appHost}
            entries={compactWarehouseEntries}
            mode="compact"
            onTogglePinned={pinnedItems.togglePinned}
            pinnedItemIds={pinnedItems.pinnedItemIds}
          />
        )}
      </article>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("deviceStats.title")}</h3>
        </div>
        <div className={cm(styles, "device-stats-row")}>
          <span>{t("deviceStats.totalDevices")}</span>
          <span>{deviceStats.totalDevices}</span>
        </div>
        <div className={cm(styles, "device-stats-row")}>
          <span>{t("deviceStats.pipeLogisticsDevices")}</span>
          <span>{deviceStats.pipeLogisticsDevices}</span>
        </div>
      </article>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("baseProblem.title")}</h3>
        </div>
        <div className={cm(panelStyles, "base-problem-list")} role="list">
          {baseProblems.length > 0 ? (
            baseProblems.map((problem, index) => (
              <div
                className={cm(panelStyles, "base-problem-row")}
                data-problem-severity={problem.severity}
                key={index}
                ref={(el) => {
                  if (el !== null) {
                    problemRowRefs.current.set(index, el);
                  } else {
                    problemRowRefs.current.delete(index);
                  }
                }}
                role="listitem"
              >
                <button
                  className={cm(panelStyles, "base-problem-button")}
                  onClick={(e) => {
                    e.stopPropagation();
                    const problem = baseProblems[index];
                    if (problem === undefined) return;
                    setPendingUnknownEntityDeleteId(null);
                    // 若关联了设备，聚焦到该设备
                    if (problem.entityId !== undefined && editor !== null) {
                      appHost.mainCanvas.focusOnEntity(problem.entityId);
                    }
                    if (activeProblemTooltip === index) {
                      setActiveProblemTooltip(null);
                      setPopoverRect(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setPopoverRect({
                        top: rect.top,
                        left: rect.right + 6,
                      });
                      setActiveProblemTooltip(index);
                    }
                  }}
                  type="button"
                >
                  {problem.message}
                </button>
              </div>
            ))
          ) : (
            <div className={cm(panelStyles, "base-problem-empty")}>{t("baseProblem.none")}</div>
          )}
        </div>
        {activeProblemTooltip !== null && popoverRect !== null
          ? createPortal(
            <div
              className={cm(panelStyles, "base-problem-popover")}
              ref={problemPopoverRef}
              style={{
                position: "fixed",
                top: `${popoverRect.top}px`,
                left: `${popoverRect.left}px`,
              }}
            >
              <div className={cm(panelStyles, "base-problem-popover-text")}>
                {activeBaseProblem?.tooltip}
              </div>
              {activeUnknownEntity?.baseId === currentDocument?.baseId ? (
                <button
                  className={cm(
                    panelStyles,
                    pendingUnknownEntityDeleteId === activeUnknownEntityId
                      ? "base-problem-delete-button is-confirm"
                      : "base-problem-delete-button",
                  )}
                  onClick={() => {
                    const entityId = activeUnknownEntityId;
                    if (entityId === null) return;
                    if (pendingUnknownEntityDeleteId !== entityId) {
                      setPendingUnknownEntityDeleteId(entityId);
                      return;
                    }
                    deleteUnknownEntity(entityId);
                  }}
                  type="button"
                >
                  <LucideTrash2 aria-hidden="true" />
                  {pendingUnknownEntityDeleteId === activeUnknownEntityId
                    ? t("baseProblem.confirmDeletingTheStaleData")
                    : t("baseProblem.removeFromBase")}
                </button>
              ) : null}
            </div>,
            document.body,
          )
          : null}
      </article>
    </div>
  );
});

function RegionalMultiBaseHelp({
  compactLayout,
  legacyUnsupported,
  onCloseTutorial,
  t,
  tutorialVisible,
}: {
  compactLayout: boolean;
  legacyUnsupported: boolean;
  onCloseTutorial: () => void;
  t: AppHost["actions"]["translate"];
  tutorialVisible: boolean;
}) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipHtml, setTooltipHtml] = useState<string | null>(null);
  const [tooltipLoadFailed, setTooltipLoadFailed] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const title = t("basePanel.runAllBasesHelp");

  useEffect(() => {
    if (legacyUnsupported || !tooltipVisible || tooltipHtml !== null || tooltipLoadFailed) return;

    let cancelled = false;
    void fetchHelpMarkdownHtml(REGIONAL_MULTI_BASE_HELP_PATH, {
      stripLeadingH1: true,
    }).then((html) => {
      if (!cancelled) {
        setTooltipHtml(html);
      }
    }).catch(() => {
      if (!cancelled) {
        setTooltipLoadFailed(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [legacyUnsupported, tooltipHtml, tooltipLoadFailed, tooltipVisible]);

  useEffect(() => {
    if (!tooltipVisible) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target === null
        || buttonRef.current?.contains(target)
        || tooltipRef.current?.contains(target)
      ) {
        return;
      }
      setTooltipVisible(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setTooltipVisible(false);
      }
    };
    const handleViewportChange = () => {
      setTooltipVisible(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [tooltipVisible]);

  const handleToggleTooltip = () => {
    if (tooltipVisible) {
      setTooltipVisible(false);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;

    const horizontalPadding = 8;
    const popoverWidth = Math.min(360, window.innerWidth - horizontalPadding * 2);
    const left = Math.max(
      horizontalPadding,
      Math.min(
        rect.right - popoverWidth,
        window.innerWidth - popoverWidth - horizontalPadding,
      ),
    );
    const gap = 8;
    const spaceAbove = Math.max(0, rect.top - gap - horizontalPadding);
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - horizontalPadding);
    setTooltipPosition(spaceBelow >= spaceAbove
      ? { left, maxHeight: spaceBelow, top: rect.bottom + gap }
      : { left, maxHeight: spaceAbove, bottom: window.innerHeight - rect.top + gap });
    setTooltipVisible(true);
  };

  return (
    <>
      <button
        aria-controls={tooltipVisible ? tooltipId : undefined}
        aria-expanded={tooltipVisible}
        aria-label={title}
        className={cm(panelStyles, "base-regional-help-button")}
        onClick={handleToggleTooltip}
        ref={buttonRef}
        title={title}
        type="button"
      >
        <WorkbenchIcon kind="help" />
      </button>
      {tooltipVisible && tooltipPosition !== null
        ? createPortal(
          <div
            className={cm(panelStyles, "base-regional-help-tooltip")}
            id={tooltipId}
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: "fixed",
              ...tooltipPosition,
            }}
          >
            {legacyUnsupported ? (
              <p>{t("basePanel.runAllBasesLegacyUnsupported")}</p>
            ) : tooltipLoadFailed ? (
              <p>{t("basePanel.runAllBasesHelpLoadFailed")}</p>
            ) : tooltipHtml === null ? (
              <p>{t("basePanel.runAllBasesHelpLoading")}</p>
            ) : (
              <div
                className={cm(panelStyles, "base-regional-help-markdown")}
                dangerouslySetInnerHTML={{ __html: tooltipHtml }}
              />
            )}
          </div>,
          document.body,
        )
        : null}
      <MarkdownTutorialOverlay
        compactLayout={compactLayout}
        dialogKey="regional-multi-base-guide"
        dismissHint={t("baseProblem.clickAnywhereToClose")}
        notice={t("baseProblem.headsUp")}
        onClose={onCloseTutorial}
        path={REGIONAL_MULTI_BASE_HELP_PATH}
        title={title}
        visible={tutorialVisible}
      />
    </>
  );
}

/**
 * 基地内联选择器。按地区分组列出全部基地及其尺寸，单击即切换，
 * 当前基地高亮；不再经过“当前名称 + 铅笔”入口与确认对话框。
 */
const BaseInlinePicker = observer(function BaseInlinePicker({
  appHost,
  currentBaseId,
}: {
  appHost: AppHost;
  currentBaseId: string;
}) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  const [pendingBaseId, setPendingBaseId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const groups = useMemo(
    () => groupBaseDefinitionsByTag(appHost.workspace.registry.baseDefinitions),
    [appHost.workspace.registry.baseDefinitions],
  );

  const switchBase = async (baseId: string) => {
    if (editor === null || baseId === currentBaseId || pendingBaseId !== null) {
      return;
    }
    setPendingBaseId(baseId);
    setFailed(false);
    try {
      const didLoad = await editor.actions.loadLatestBaseDocument(baseId);
      setFailed(!didLoad);
    } finally {
      setPendingBaseId(null);
    }
  };

  return (
    <div className={cm(panelStyles, "base-inline-picker")} data-ui-button-id="base-current-select">
      {groups.map((group) => (
        <section className={cm(panelStyles, "base-inline-group")} key={group.tag}>
          <h4>{resolveBaseTagLabel(group.tag, t)}</h4>
          <div className={cm(panelStyles, "base-inline-options")}>
            {group.bases.map((base) => {
              const bounds = base.areas[0]?.bounds;
              const size = bounds === undefined
                || bounds.minX === null || bounds.maxX === null || bounds.minY === null || bounds.maxY === null
                ? null
                : `${bounds.maxX - bounds.minX}×${bounds.maxY - bounds.minY}`;
              const isCurrent = base.id === currentBaseId;
              return (
                <button
                  aria-pressed={isCurrent}
                  className={cm(panelStyles, isCurrent ? "base-inline-option is-current" : "base-inline-option")}
                  data-base-id={base.id}
                  disabled={editor === null || pendingBaseId !== null}
                  key={base.id}
                  onClick={() => void switchBase(base.id)}
                  type="button"
                >
                  <span className={cm(panelStyles, "base-inline-option-name")}>{resolveBaseDisplayName(base, t)}</span>
                  {size === null ? null : <span className={cm(panelStyles, "base-inline-option-size")}>{size}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {failed ? <p className={cm(panelStyles, "base-inline-error")}>{t("basePicker.loadFailed")}</p> : null}
    </div>
  );
});
