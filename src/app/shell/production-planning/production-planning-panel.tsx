import { ProductionPlanningTreeTableView } from "./production-planning-tree-table";
import { RecipeChoiceControls } from "./recipe-choice-controls";
import { formatPlannerCycleIssue } from "@/shared/planner-cycle";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { runInAction } from "mobx";
import { observer, useLocalObservable } from "mobx-react-lite";
import LucideBox from "~icons/lucide/box";
import LucideBoxes from "~icons/lucide/boxes";
import LucideSprout from "~icons/lucide/sprout";
import LucideArrowLeft from "~icons/lucide/arrow-left";
import LucideCalculator from "~icons/lucide/calculator";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideChevronRight from "~icons/lucide/chevron-right";
import LucideFactory from "~icons/lucide/factory";
import LucideInfinity from "~icons/lucide/infinity";
import LucideListTree from "~icons/lucide/list-tree";
import LucidePackagePlus from "~icons/lucide/package-plus";
import LucidePlus from "~icons/lucide/plus";
import LucideTarget from "~icons/lucide/target";
import LucideRepeat from "~icons/lucide/repeat";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideWorkflow from "~icons/lucide/workflow";
import LucideGitBranch from "~icons/lucide/git-branch";

import type { AppHost } from "@/app/host/app-host";
import { DEFAULT_PLANNER_FLOW_VIEWPORT_STATE, type PlannerFlowViewportState } from "@/shared/storage/planner-storage";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type {
  ModuleBalancingCustomModule,
  ModuleBalancingRecommendedModule,
} from "@/app/toolbox-types";
import { readRecommendedModuleLibrary } from "@/app/shell/module-balancing";
import {
  isItemAvailableByActivity,
  isRecipeAvailableByActivity,
  resolveEffectiveActivityIds,
} from "@/shared/registry/activity-availability";
import {
  BELT_TRANSPORT_DURATION_SECONDS,
  PIPE_TRANSPORT_DURATION_SECONDS,
} from "@/domain/registry";
import {
  LOGISTICS_KIND,
  type LogisticsKind,
} from "@/domain/shared/logistics";
import {
  buildProductionPlanningIndex,
  computeItemDefaultPerMinute,
  computeProductionPlan,
  createProductionPlanningId,
  formatProductionDeviceCount,
  formatProductionFlow,
  isWaterPurifierNodeRecipe,
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningModuleIconSrcs,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  resolveProductionPlanningRecipeName,
  type ProductionPlanningByproductPolicy,
  type ProductionPlanningDeviceMinimumConsumptionMode,
  type ProductionPlanningDisplayMode,
  type ProductionPlanningIndex,
  type ProductionPlanningItemNode,
  type ProductionPlanningPort,
  type ProductionPlanningRecipeNode,
  type ProductionPlanningResult,
  type ProductionPlanningSewagePolicy,
  type ProductionPlanningSourceConfig,
  type ProductionPlanningWaterPurifierPolicy,
  type ProductionPlanningViewMode,
} from "@/app/shell/production-planning/production-planning-model";
import {
  createProductionPlanningRecipeCandidateId,
  normalizeProductionPlanningCandidateChoiceId,
} from "./production-planning-candidate";
import { ProductionFlowGraph } from "@/app/shell/production-planning/flow";
import { RecipeActionMenu, resolveFlowNodeActionTarget, type RecipeActionTarget } from "@/app/shell/recipe-tree/recipe-action-menu";
import {
  buildProductionPlanningDeviceMinimumConsumptionRecipeId,
  isProductionPlanningDeviceMinimumConsumptionRecipeId,
  resolveProductionPlanningDeviceMinimumConsumptionHostRecipeId,
  resolveProductionPlanningRecipeInputPorts,
} from "@/app/shell/production-planning/production-planning-ledger";
import { ProcessGraphView } from "@/app/shell/production-planning/process";
import { createProductionPlanningModule } from "./production-planning-module";
import { ProductionPlanningInputStore } from "./production-planning-state";
import { hookPlannerIndexedDbPersistence } from "./production-planning-persist";
import { reconcileProductionPlanningRecipeChoices } from "./production-planning-preferences";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { CompositeItemIcon } from "@/app/shell/shared";
import { NumberInput } from "@/app/shell/shared/number-input";
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";
import { createEntityIconAssetUrl, createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import { WATER_PURIFIER_BYPRODUCT_RECIPE_ID } from "@/shared/water-purifier-node";

type ProductionPlanningScreen = "input" | "result";

type ProductionPlanningCalculation = {
  readonly targets: readonly ProductionPlanningPort[];
  readonly supplies: readonly ProductionPlanningPort[];
  readonly infiniteItemIds: ReadonlySet<string>;
  readonly recipeChoices: Readonly<Record<string, string>>;
  readonly sourceConfig: ProductionPlanningSourceConfig;
  readonly useModules: boolean;
  readonly plan: ProductionPlanningResult;
};

type ProductionPlanningSwipeState = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
};

type ProductionPlanningTreeRow = {
  readonly id: string;
  readonly depth: number;
  readonly parentIds: readonly string[];
  readonly childIds: readonly string[];
  readonly demandReferenceIds: readonly string[];
  readonly recipeId: string;
  readonly targetItemId: string;
  readonly recipeNode: ProductionPlanningRecipeNode;
  readonly recipeNodes: readonly ProductionPlanningRecipeNode[];
  readonly total: ProductionPlanningResult["recipeTotals"][number] | null;
  readonly inputItemIds: readonly string[];
  readonly outputItemIds: readonly string[];
  readonly isByproduct: boolean;
  readonly isShared: boolean;
  readonly isSharedDemandReference: boolean;
  readonly isPlantCycle: boolean;
  readonly isPlantCycleReference: boolean;
  readonly isDeviceMinimumConsumption: boolean;
  readonly consumedPerMinute: number;
  readonly sourceRowId: string | null;
};


const PRODUCTION_PLANNING_EPSILON = 0.0001;
const EXTERNAL_SUPPLY_RECIPE_ID_PREFIX = "external-supply:";
const SHARED_DEMAND_RECIPE_ID_PREFIX = "shared-demand:";
const EXTERNAL_SUPPLY_ENTITY_ID = "sp_hub_1";


export const ProductionPlanningPanel = observer(function ProductionPlanningPanel({
  appHost,
  isTouch,
  onOpenGeneratedModuleEditor,
}: {
  appHost: AppHost;
  isTouch: boolean;
  onOpenGeneratedModuleEditor: (module: ModuleBalancingCustomModule) => void;
}) {
  const t = appHost.actions.translate;
  const balancingState = appHost.internalState.workbench.toolbox.moduleBalancing;
  const showAllActivityContent = appHost.internalState.settings.toolboxShowAllActivityContent;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  const [recommendedModules, setRecommendedModules] = useState<ModuleBalancingRecommendedModule[]>([]);
  const [recommendedModulesReady, setRecommendedModulesReady] = useState(false);
  const customModuleSignature = JSON.stringify(balancingState.customModules.map((module) => ({
    id: module.id,
    name: module.name,
    color: module.color,
    iconItemIds: module.iconItemIds,
    notes: module.notes,
    inputs: module.inputs,
    outputs: module.outputs,
  })));
  const index = useMemo(
    () => {
      void customModuleSignature;
      return buildProductionPlanningIndex(appHost.workspace.registry, {
        includeInactiveActivityContent: showAllActivityContent,
        activeActivityIds: resolveEffectiveActivityIds({ selectedActivityIds }),
        modules: [
          ...balancingState.customModules,
          ...recommendedModules.filter((module) => (
            !balancingState.customModules.some((custom) => custom.id === module.id)
          )),
        ],
      });
    },
    [
      appHost.workspace.registry,
      balancingState,
      customModuleSignature,
      recommendedModules,
      selectedActivityIds,
      showAllActivityContent,
    ],
  );
  const store = useLocalObservable(() => new ProductionPlanningInputStore());
  useEffect(() => hookPlannerIndexedDbPersistence(store), [store]);
  useEffect(() => {
    let active = true;
    void readRecommendedModuleLibrary()
      .then((library) => {
        if (active) {
          setRecommendedModules([...library.modules]);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setRecommendedModulesReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const {
    targets,
    supplies,
    displayMode,
    viewMode,
    useModules,
    recipeChoices,
    sourceConfig,
    session,
    hydrated,
  } = store;
  const activeScreen = session.activeScreen;
  const runtime = appHost.internalState.runtime;
  const newSessionRequested = runtime.productionPlanningNewSessionRequested;
  const [calculation, setCalculation] = useState<ProductionPlanningCalculation | null>(null);
  useEffect(() => appHost.productionPlanningDiagnostics.connect(() => ({
    hydrated: store.hydrated,
    input: { targets: store.targets.map(clonePort), supplies: store.supplies.map(clonePort), recipeChoices: { ...store.recipeChoices } },
    calculation: calculation ? { targets: calculation.targets.map(clonePort), supplies: calculation.supplies.map(clonePort),
      recipeChoices: { ...calculation.recipeChoices } } : null,
  })), [appHost, store, calculation]);
  const swipeStateRef = useRef<ProductionPlanningSwipeState | null>(null);

  // 等持久化读取完成再消费新建意图，避免迟到的旧会话覆盖空白任务。
  useLayoutEffect(() => {
    if (!hydrated || !newSessionRequested) return;
    runInAction(() => {
      store.startNewSession();
      runtime.productionPlanningNewSessionRequested = false;
    });
    setCalculation(null);
  }, [hydrated, newSessionRequested, store, runtime]);
  // 自然资源不再从 infiniteItemIds 补齐；缺失时走 null 配方（矿机/水泵）生产。
  // infiniteItemIds 现在仅包含 external-supply 模式下的污水。
  const infiniteItemIds = useMemo(() => {
    const result = new Set<string>();
    if (sourceConfig.sewagePolicy === "external-supply") {
      result.add("item_liquid_sewage");
    }
    return result;
  }, [sourceConfig.sewagePolicy]);
  const resultRecipeChoiceMap = useMemo(
    () => new Map(Object.entries(calculation?.recipeChoices ?? recipeChoices)),
    [calculation?.recipeChoices, recipeChoices],
  );

  useEffect(() => {
    if (!hydrated || showAllActivityContent) {
      return;
    }

    const activeActivityIds = resolveEffectiveActivityIds({ selectedActivityIds });
    if (!hasInactiveProductionPlanningContent(store, appHost.workspace.registry, activeActivityIds)) {
      return;
    }

    runInAction(() => {
      store.reset();
    });
    setCalculation(null);
  }, [
    appHost.workspace.registry,
    hydrated,
    selectedActivityIds,
    showAllActivityContent,
    store,
  ]);

  const setActiveScreen = (nextScreen: ProductionPlanningScreen) => {
    if (store.session.activeScreen === nextScreen) {
      return;
    }

    runInAction(() => {
      store.session = { ...store.session, activeScreen: nextScreen };
    });
  };

  const setFlowViewport = (flowViewport: PlannerFlowViewportState) => {
    runInAction(() => {
      store.session = { ...store.session, flowViewport };
    });
  };

  const setProcessViewport = (processViewport: PlannerFlowViewportState) => {
    runInAction(() => {
      store.session = { ...store.session, processViewport };
    });
  };

  const toggleProcessBranch = (branchId: string) => {
    runInAction(() => {
      const current = store.session.processExpandedItems;
      const next = current.includes(branchId)
        ? current.filter((id) => id !== branchId)
        : [...current, branchId];
      store.session = { ...store.session, processExpandedItems: next };
    });
  };

  const setTreeScrollTop = (scrollTop: number) => {
    const treeScrollTop = Math.max(0, scrollTop);
    if (store.session.treeScrollTop === treeScrollTop) {
      return;
    }

    runInAction(() => {
      store.session = { ...store.session, treeScrollTop };
    });
  };


  const updateDemandInput = (mutate: () => void) => {
    const previousTargets = store.targets.map(clonePort);
    runInAction(() => {
      mutate();
      const recipeChoices = new Map(Object.entries(store.recipeChoices));
      const retained = reconcileProductionPlanningRecipeChoices(previousTargets, {
        targets: store.targets, supplies: store.supplies, infiniteItemIds,
        recipeChoices, sourceConfig: store.sourceConfig, useModules: store.useModules,
      }, index);
      if (retained !== recipeChoices) store.recipeChoices = Object.fromEntries(retained);
    });
  };

  useEffect(() => {
    if (
      !hydrated
      || newSessionRequested
      || activeScreen !== "result"
      || calculation !== null
      || (useModules && !recommendedModulesReady)
    ) {
      return;
    }

    if (targets.length === 0) {
      runInAction(() => {
        store.session = { ...store.session, activeScreen: "input" };
      });
      return;
    }

    const calculationTargets = targets.map(clonePort);
    const calculationSupplies = supplies.map(clonePort);
    const calculationInfiniteItemIds = new Set(infiniteItemIds);
    const calculationRecipeChoices = { ...recipeChoices };
    const calculationSourceConfig: ProductionPlanningSourceConfig = {
      waterPolicy: sourceConfig.waterPolicy,
      acidPolicy: sourceConfig.acidPolicy,
      sewagePolicy: sourceConfig.sewagePolicy,
      waterPurifierPolicy: sourceConfig.waterPurifierPolicy,
      includeDeviceMinimumConsumption: sourceConfig.includeDeviceMinimumConsumption,
    };
    const plan = computeProductionPlan({
      targets: calculationTargets,
      supplies: calculationSupplies,
      infiniteItemIds: calculationInfiniteItemIds,
      recipeChoices: new Map(Object.entries(calculationRecipeChoices)),
      sourceConfig: calculationSourceConfig,
      useModules,
    }, index);

    setCalculation({
      targets: calculationTargets,
      supplies: calculationSupplies,
      infiniteItemIds: calculationInfiniteItemIds,
      recipeChoices: calculationRecipeChoices,
      sourceConfig: calculationSourceConfig,
      useModules,
      plan,
    });

    runInAction(() => {
      store.session = { ...store.session, processExpandedItems: [] };
    });
  }, [
    activeScreen,
    calculation,
    hydrated,
    newSessionRequested,
    index,
    infiniteItemIds,
    recipeChoices,
    recommendedModulesReady,
    sourceConfig.acidPolicy,
    sourceConfig.includeDeviceMinimumConsumption,
    sourceConfig.sewagePolicy,
    sourceConfig.waterPolicy,
    sourceConfig.waterPurifierPolicy,
    store,
    supplies,
    targets,
    useModules,
  ]);

  const requestItemSelection = async (onSelect: (itemId: string) => void) => {
    const itemId = await appHost.encyclopediaPicker.pickItem({
      includeInactiveActivityItems: showAllActivityContent,
      title: t("encyclopediaPicker.title.item"),
    });

    if (itemId !== null) {
      onSelect(itemId);
    }
  };

  const addTarget = () => {
    void requestItemSelection((itemId) => {
      updateDemandInput(() => {
        store.targets = [...store.targets, createPort(itemId, computeItemDefaultPerMinute(itemId, index))];
      });
    });
  };

  const addSupply = () => {
    void requestItemSelection((itemId) => {
      updateDemandInput(() => {
        store.supplies = [...store.supplies, createPort(itemId, computeItemDefaultPerMinute(itemId, index))];
      });
    });
  };

  const updateTarget = (id: string, patch: Partial<ProductionPlanningPort>) => {
    updateDemandInput(() => {
      store.targets = updatePort(store.targets, id, patch);
    });
  };

  const updateSupply = (id: string, patch: Partial<ProductionPlanningPort>) => {
    updateDemandInput(() => {
      store.supplies = updatePort(store.supplies, id, patch);
    });
  };

  const toggleSupplyInfinite = (id: string, isInfinite: boolean) => {
    const supply = store.supplies.find((line) => line.id === id);
    if (supply === undefined) {
      return;
    }

    updateSupply(id, { isInfinite });
  };

  const selectRecipe = (itemId: string, recipeId: string | null) => {
    const candidateId = recipeId === null
      ? null
      : normalizeProductionPlanningCandidateChoiceId(recipeId);
    const nextRecipeChoices = updateRecipeChoices(store.recipeChoices, itemId, candidateId);
    runInAction(() => {
      store.recipeChoices = nextRecipeChoices;
    });
    setCalculation((current) => {
      if (current === null) {
        return null;
      }

      const nextPlan = computeProductionPlan({
        targets: current.targets,
        supplies: current.supplies,
        infiniteItemIds: current.infiniteItemIds,
        recipeChoices: new Map(Object.entries(nextRecipeChoices)),
        sourceConfig: current.sourceConfig,
        useModules: current.useModules,
      }, index);

      return {
        ...current,
        recipeChoices: nextRecipeChoices,
        plan: nextPlan,
      };
    });
  };

  const requestRecipeSelection = async (itemId: string, recipes: readonly RecipeDefinition[]) => {
    const selectedRecipeId = await appHost.recipePicker.pickRecipe({
      includeInactiveActivityRecipes: showAllActivityContent,
      title: `${t("productionPlanning.chooseRecipe")} · ${resolveProductionPlanningItemName(itemId, index, t)}`,
      recipes,
    });

    if (selectedRecipeId !== null) {
      selectRecipe(itemId, createProductionPlanningRecipeCandidateId(selectedRecipeId));
    }
  };

  const updateCalculatedSupplies = (nextSupplies: ProductionPlanningPort[]) => {
    const nextCalculation = calculation === null ? null : {
      ...calculation,
      supplies: nextSupplies,
      plan: computeProductionPlan({
        targets: calculation.targets,
        supplies: nextSupplies,
        infiniteItemIds: calculation.infiniteItemIds,
        recipeChoices: new Map(Object.entries(calculation.recipeChoices)),
        sourceConfig: calculation.sourceConfig,
        useModules: calculation.useModules,
      }, index),
    };
    runInAction(() => {
      store.supplies = nextSupplies;
      if (nextCalculation !== null) {
        store.session = { ...store.session,
          processExpandedItems: [] };
      }
    });
    setCalculation(nextCalculation);
  };

  const handleCoverDemand = (itemId: string) => {
    const demandPerMinute = calculation?.plan.itemTotals.find((total) => total.itemId === itemId)?.demandPerMinute ?? 0;
    if (demandPerMinute <= 0) return;
    updateCalculatedSupplies([...store.supplies, createPort(itemId, demandPerMinute)]);
  };

  const handleRemoveExternalSupply = (itemId: string) => {
    updateCalculatedSupplies(store.supplies.filter((supply) => supply.itemId !== itemId));
  };

  const updateSourceConfig = (patch: Partial<ProductionPlanningSourceConfig>) => {
    updateDemandInput(() => {
      store.sourceConfig = { ...store.sourceConfig, ...patch };
    });
  };

  const calculate = () => {
    if (useModules && !recommendedModulesReady) {
      return;
    }
    const calculationTargets = targets.map(clonePort);
    const calculationSupplies = supplies.map(clonePort);
    const calculationInfiniteItemIds = new Set(infiniteItemIds);
    const calculationRecipeChoices = { ...recipeChoices };
    const calculationSourceConfig: ProductionPlanningSourceConfig = {
      waterPolicy: sourceConfig.waterPolicy,
      acidPolicy: sourceConfig.acidPolicy,
      sewagePolicy: sourceConfig.sewagePolicy,
      waterPurifierPolicy: sourceConfig.waterPurifierPolicy,
      includeDeviceMinimumConsumption: sourceConfig.includeDeviceMinimumConsumption,
    };
    const plan = computeProductionPlan({
      targets: calculationTargets,
      supplies: calculationSupplies,
      infiniteItemIds: calculationInfiniteItemIds,
      recipeChoices: new Map(Object.entries(calculationRecipeChoices)),
      sourceConfig: calculationSourceConfig,
      useModules,
    }, index);

    setCalculation({
      targets: calculationTargets,
      supplies: calculationSupplies,
      infiniteItemIds: calculationInfiniteItemIds,
      recipeChoices: calculationRecipeChoices,
      sourceConfig: calculationSourceConfig,
      useModules,
      plan,
    });
    runInAction(() => {
      store.viewMode = "process";
      store.session = {
        ...store.session,
        processExpandedItems: [],
      };
    });
    setActiveScreen("result");
  };

  const handleSwipePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isTouch || event.pointerType !== "touch" || shouldIgnoreProductionPlanningSwipeStart(event.target)) {
      return;
    }

    swipeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleSwipePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const state = swipeStateRef.current;
    swipeStateRef.current = null;

    if (!isTouch || event.pointerId !== state?.pointerId) {
      return;
    }

    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) {
      return;
    }

    if (deltaX < 0 && activeScreen === "input" && store.targets.length > 0) {
      calculate();
    } else if (deltaX > 0 && activeScreen === "result") {
      setActiveScreen("input");
    }
  };

  const handleSwipePointerCancel = () => {
    swipeStateRef.current = null;
  };

  const convertToModule = () => {
    if (calculation === null) {
      return;
    }

    const nextModule = createProductionPlanningModule({
      index,
      plan: calculation.plan,
      targets: calculation.targets,
      translate: t,
    });
    onOpenGeneratedModuleEditor(nextModule);
    appHost.internalActions.setDialogTab("toolbox", "module-balancing");
    appHost.internalActions.setToolboxBottomDockCollapsed(false);
  };

  const panelClassName = [
    "production-planning-panel",
    activeScreen === "result" ? "is-result-screen" : "is-input-screen",
    isTouch ? "is-touch" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={cm(styles, panelClassName)}
      onPointerDown={handleSwipePointerDown}
      onPointerUp={handleSwipePointerUp}
      onPointerCancel={handleSwipePointerCancel}
    >
      <div className={cm(styles, "production-planning-toolbar")}>
        <div className={cm(styles, "production-planning-toolbar-views")}>
          {activeScreen === "result" && <>
            <button type="button" className={cm(styles, "production-planning-back-button")}
              onClick={() => setActiveScreen("input")}>
              <LucideArrowLeft /><span>{t("productionPlanning.modify")}</span>
            </button>
            <SegmentedControl<ProductionPlanningDisplayMode>
              label={t("productionPlanning.displayMode")} value={displayMode}
              options={[
                { value: "item", label: t("productionPlanning.modeItem"), icon: <LucideBox /> },
                { value: "device", label: t("productionPlanning.modeDevice"), icon: <LucideFactory /> },
              ]} onChange={value => { runInAction(() => { store.displayMode = value; }); }} />
            <SegmentedControl<ProductionPlanningViewMode>
              label={t("productionPlanning.viewMode")} value={viewMode}
              options={[
                { value: "tree", label: t("productionPlanning.viewTree"), icon: <LucideListTree /> },
                { value: "flow", label: t("productionPlanning.viewFlow"), icon: <LucideWorkflow /> },
                { value: "process", label: t("productionPlanning.viewProcess"), icon: <LucideGitBranch /> },
              ]} onChange={value => { runInAction(() => { store.viewMode = value; }); }} />
          </>}
        </div>
        <div className={cm(styles, "production-planning-toolbar-controls")}>
          {activeScreen === "input" ? <>
            <label className={cm(styles, "production-planning-module-toggle")}>
              <input type="checkbox" role="switch" checked={useModules}
                onChange={event => { runInAction(() => { store.useModules = event.currentTarget.checked; }); }} />
              <span className={cm(styles, "production-planning-switch-track")} aria-hidden="true">
                <span className={cm(styles, "production-planning-switch-thumb")} />
              </span>
              <span>{t("productionPlanning.useModules")}</span>
            </label>
            <button type="button" className={cm(styles, "production-planning-primary-button")}
              disabled={!hydrated || newSessionRequested || targets.length === 0 || (useModules && !recommendedModulesReady)}
              onClick={calculate}>
              <LucideCalculator /><span>{t("productionPlanning.calculate")}</span>
            </button>
          </> : <>
            <button type="button"
              className={cm(styles, "production-planning-icon-text-button production-planning-convert-module-button")}
              disabled={calculation === null || calculation.plan.cycleIssues.length > 0} onClick={convertToModule}>
              <LucideBoxes /><span>{t("productionPlanning.convertToModule")}</span>
            </button>
          </>}
        </div>
      </div>
      <div className={cm(styles, "production-planning-stage")}>
        <section className={cm(styles, "production-planning-screen production-planning-input-screen")}>
          <div className={cm(styles, "production-planning-config")}>
            <LineSection
              icon={<LucideTarget />}
              title={t("productionPlanning.targets")}
              addLabel={t("productionPlanning.addTarget")}
              lines={targets}
              index={index}
              onAdd={addTarget}
              onPickItem={(id) => {
                void requestItemSelection((itemId) => updateTarget(id, { itemId }));
              }}
              onRemove={(id) => {
                updateDemandInput(() => {
                  store.targets = store.targets.filter((line) => line.id !== id);
                });
              }}
              onUpdateRate={(id, perMinute) => updateTarget(id, { perMinute })}
              t={t}
            />
            <LineSection
              icon={<LucidePackagePlus />}
              title={t("productionPlanning.supplies")}
              addLabel={t("productionPlanning.addSupply")}
              lines={supplies}
              index={index}
              onAdd={addSupply}
              onPickItem={(id) => {
                void requestItemSelection((itemId) => updateSupply(id, {
                  itemId,
                }));
              }}
              onRemove={(id) => {
                updateDemandInput(() => {
                  store.supplies = store.supplies.filter((line) => line.id !== id);
                });
              }}
              onUpdateRate={(id, perMinute) => updateSupply(id, { perMinute })}
              onToggleInfinite={toggleSupplyInfinite}
              canToggleInfinite
              emptyContent={<RawMaterialGuide index={index} t={t} />}
              t={t}
            />
            <SourcePolicyPanel
              index={index}
              sourceConfig={sourceConfig}
              onUpdate={updateSourceConfig}
              t={t}
            />
          </div>
        </section>

        <section className={cm(styles, "production-planning-screen production-planning-workspace")}>


          <div className={cm(styles, "production-planning-main", calculation !== null && calculation.plan.cycleIssues.length > 0 ? "has-cycle-errors" : "")}>
            {calculation !== null && calculation.plan.cycleIssues.length > 0 && (
              <ul className={cm(styles, "production-planning-cycle-errors")} role="alert">
                {calculation.plan.cycleIssues.map((issue, issueIndex) => <li key={issueIndex}>
                  {formatPlannerCycleIssue(issue, itemId => resolveProductionPlanningItemName(itemId, index, t), {
                    cycle: t("productionPlanning.invalidCycle"), missing: t("productionPlanning.cycleShortfall"),
                  })}
                </li>)}
              </ul>
            )}
            <div className={cm(styles, "production-planning-graph", viewMode === "tree" ? "is-tree-view" : viewMode === "flow" ? "is-flow-view" : "is-process-view")}>
              {calculation === null ? (
                <div className={cm(styles, "production-planning-empty")}>{t("productionPlanning.noResult")}</div>
              ) : (
                <PlanGraph
                  appHost={appHost}
                  displayMode={displayMode}
                  invertWheelZoom={appHost.internalState.settings.invertWheelZoom}
                  flowViewport={session.flowViewport}
                  processViewport={session.processViewport}
                  viewMode={viewMode}
                  plan={calculation.plan}
                  index={index}
                  useModules={calculation.useModules}
                  recipeChoices={resultRecipeChoiceMap}
                  externalItemIds={new Set(calculation.supplies.map((supply) => supply.itemId))}
                  treeScrollTop={session.treeScrollTop}
                  processExpandedItems={session.processExpandedItems}
                  isTouch={isTouch}
                  onFlowViewportChange={setFlowViewport}
                  onSelectRecipe={selectRecipe}
                  onRequestRecipeSelection={requestRecipeSelection}
                  onCoverDemand={handleCoverDemand}
                  onRemoveExternalSupply={handleRemoveExternalSupply}
                  onTreeScrollTopChange={setTreeScrollTop}
                  onToggleProcessBranch={toggleProcessBranch}
                  onProcessViewportChange={setProcessViewport}
                  t={t}
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
});

function RawMaterialGuide({ index, t }: { index: ProductionPlanningIndex; t: (key: string) => string }) {
  const itemIcon = resolveProductionPlanningItemIconSrc("item_gas_xiranite", index);
  const machineIcon = resolveProductionPlanningEntityIconSrc("transmuter_2_gastrans", index);
  const itemName = t("registry.item.item_gas_xiranite.name");
  const machineName = t("registry.entity.transmuter_2_gastrans.name");
  return (
    <div className={cm(styles, "production-planning-material-guide")}>
      <p>{t("productionPlanning.materialGuide")}</p>
      <div className={cm(styles, "production-planning-material-guide-paths")}>
        <figure>
          <figcaption><LucideListTree aria-hidden="true" />{t("productionPlanning.viewTree")}<span>{t("productionPlanning.materialGuideTreeLocation")}</span></figcaption>
          <div className={cm(styles, "production-planning-material-illustration is-tree-example")}
            role="img" aria-label={`${t("productionPlanning.viewTree")} · ${t("productionPlanning.materialGuideTreeLocation")}`}>
            <div className={cm(styles, "production-planning-guide-tree")} aria-hidden="true">
              <LucideListTree /><i /><i /><i />
            </div>
            <div className={cm(styles, "production-planning-guide-detail")} aria-hidden="true">
              <div className={cm(styles, "production-planning-guide-detail-header")}>
                <img src={itemIcon} alt="" /><strong>{itemName}</strong>
                <span className={cm(styles, "production-planning-guide-action")}><LucideRepeat />{t("productionPlanning.coverDemand")}</span>
              </div>
              <div className={cm(styles, "production-planning-guide-recipe")}><img src={machineIcon} alt="" /><span>{machineName}</span><span>⌄</span></div>
              <div className={cm(styles, "production-planning-guide-formula")}><i /><span>→</span><img src={itemIcon} alt="" /><i /></div>
            </div>
          </div>
        </figure>
        <figure>
          <figcaption><LucideGitBranch aria-hidden="true" />{t("productionPlanning.viewProcess")}<span>{t("productionPlanning.materialGuideProcessLocation")}</span></figcaption>
          <div className={cm(styles, "production-planning-material-illustration is-process-example")}
            role="img" aria-label={`${t("productionPlanning.viewProcess")} · ${t("productionPlanning.materialGuideProcessLocation")}`}>
            <div className={cm(styles, "production-planning-guide-nodes")} aria-hidden="true"><span /><i /><span /></div>
            <div className={cm(styles, "production-planning-guide-popup")} aria-hidden="true">
              <strong><img src={itemIcon} alt="" />{itemName}</strong>
              <div className={cm(styles, "production-planning-guide-popup-actions")}>
                <span className={cm(styles, "production-planning-guide-action")}><LucideRepeat />{t("productionPlanning.coverDemand")}</span>
                <span className={cm(styles, "production-planning-guide-choice")}><LucideListTree />{t("productionPlanning.chooseRecipe")}</span>
              </div>
              <div className={cm(styles, "production-planning-guide-formula")}><i /><span>→</span><img src={itemIcon} alt="" /><i /></div>
            </div>
          </div>
        </figure>
      </div>
      <p>{t("productionPlanning.materialGuideResult")}</p>
    </div>
  );
}

function LineSection({
  icon,
  title,
  addLabel,
  lines,
  index,
  onAdd,
  onPickItem,
  onRemove,
  onUpdateRate,
  onToggleInfinite,
  canToggleInfinite = false,
  emptyContent,
  t,
}: {
  icon: ReactNode;
  title: string;
  addLabel: string;
  lines: readonly ProductionPlanningPort[];
  index: ProductionPlanningIndex;
  onAdd: () => void;
  onPickItem: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdateRate: (id: string, perMinute: number) => void;
  onToggleInfinite?: (id: string, isInfinite: boolean) => void;
  canToggleInfinite?: boolean;
  emptyContent?: ReactNode;
  t: (key: string) => string;
}) {
  return (
    <section className={cm(styles, "production-planning-config-section",
      lines.length === 0 && emptyContent != null ? "has-empty-guide" : "")}>
      <div className={cm(styles, "production-planning-section-header")}>
        <h3>{icon}<span>{title}</span></h3>
        <button type="button" className={cm(styles, "production-planning-icon-text-button")} onClick={onAdd}>
          <LucidePlus />
          <span>{addLabel}</span>
        </button>
      </div>
      <div className={cm(styles, "production-planning-line-list")}>
        {lines.length === 0 ? (
          emptyContent ?? <p className={cm(styles, "production-planning-muted")}>{t("productionPlanning.emptyLines")}</p>
        ) : lines.map((line) => (
          <PortEditorRow
            key={line.id}
            line={line}
            index={index}
            onPickItem={() => onPickItem(line.id)}
            onRemove={() => onRemove(line.id)}
            onUpdateRate={(perMinute) => onUpdateRate(line.id, perMinute)}
            onToggleInfinite={onToggleInfinite === undefined ? undefined : (isInfinite) => onToggleInfinite(line.id, isInfinite)}
            canToggleInfinite={canToggleInfinite}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function PortEditorRow({
  line,
  index,
  onPickItem,
  onRemove,
  onUpdateRate,
  onToggleInfinite,
  canToggleInfinite = false,
  t,
}: {
  line: ProductionPlanningPort;
  index: ProductionPlanningIndex;
  onPickItem: () => void;
  onRemove: () => void;
  onUpdateRate: (perMinute: number) => void;
  onToggleInfinite?: (isInfinite: boolean) => void;
  canToggleInfinite?: boolean;
  t: (key: string) => string;
}) {
  const isInfinite = canToggleInfinite && line.isInfinite === true;
  const rowClassName = [
    "production-planning-line-row",
    canToggleInfinite ? "has-infinite-toggle" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={cm(styles, rowClassName)}>
      <button
        type="button"
        className={cm(styles, "production-planning-item-picker-button")}
        onClick={onPickItem}
      >
        <img alt="" src={resolveProductionPlanningItemIconSrc(line.itemId, index)} />
        <span>{resolveProductionPlanningItemName(line.itemId, index, t)}</span>
      </button>
      <label className={cm(styles, "production-planning-rate-input")}>
        <span>{t("productionPlanning.perMinute")}</span>
        {isInfinite ? (
          <input
            type="text"
            value="∞"
            disabled
            readOnly
          />
        ) : (
          <NumberInput
            min={0}
            emptyFallback={0}
            value={line.perMinute}
            onCommit={(next) => onUpdateRate(next)}
          />
        )}
      </label>
      {canToggleInfinite && (
        <button
          type="button"
          className={cm(styles, [
            "production-planning-icon-button production-planning-infinite-toggle",
            isInfinite ? "is-active" : "",
          ].filter(Boolean).join(" "))}
          aria-label={t("productionPlanning.infinite")}
          aria-pressed={isInfinite}
          title={t("productionPlanning.infinite")}
          disabled={onToggleInfinite === undefined}
          onClick={() => onToggleInfinite?.(!isInfinite)}
        >
          <LucideInfinity />
        </button>
      )}
      <button
        type="button"
        className={cm(styles, "production-planning-icon-button")}
        aria-label={t("productionPlanning.remove")}
        title={t("productionPlanning.remove")}
        onClick={onRemove}
      >
        <LucideTrash2 />
      </button>
    </div>
  );
}

function SourcePolicyPanel({
  index,
  sourceConfig,
  onUpdate,
  t,
}: {
  index: ProductionPlanningIndex;
  sourceConfig: ProductionPlanningSourceConfig;
  onUpdate: (patch: Partial<ProductionPlanningSourceConfig>) => void;
  t: (key: string) => string;
}) {
  const resourceListId = useId();
  const [expandedCategories, setExpandedCategories] = useState<readonly string[]>([]);

  return (
    <section className={cm(styles, "production-planning-config-section")}>
      <div className={cm(styles, "production-planning-section-header")}>
        <h3><LucideInfinity /><span>{t("productionPlanning.sourcePolicy")}</span></h3>
      </div>
      <div className={cm(styles, "production-planning-source-policy")}>
        {[
          { label: "productionPlanning.naturalResources", items: index.naturalResourceItemIds, icon: <LucideBoxes /> },
          { label: "productionPlanning.crops", items: index.cropItemIds, icon: <LucideSprout /> },
        ].map(({ label, items, icon }) => {
          const expanded = items.size > 0 && expandedCategories.includes(label);
          const contentId = `${resourceListId}-${label}`;
          return (
            <div key={label} role="group" aria-label={t(label)} className={cm(styles, "production-planning-source-pill")}>
              <button
                type="button"
                className={cm(styles, "production-planning-resource-label")}
                aria-expanded={expanded}
                aria-controls={contentId}
                disabled={items.size === 0}
                onClick={() => setExpandedCategories(current => current.includes(label)
                  ? current.filter(category => category !== label)
                  : [...current, label])}
              >
                <span className={cm(styles, "production-planning-resource-category")}>
                  <span aria-hidden="true">{icon}</span>
                  <span className={cm(styles, "production-planning-resource-summary")}>
                    <span>{t(label)}</span>
                    <span className={cm(styles, "production-planning-resource-count")}>
                      {t("productionPlanning.itemCount").replace("{count}", String(items.size))}
                    </span>
                  </span>
                </span>
                <span className={cm(styles, "production-planning-resource-disclosure")}>
                  <span>{t(expanded ? "productionPlanning.collapseItems" : "productionPlanning.viewItems")}</span>
                  {expanded ? <LucideChevronDown aria-hidden="true" /> : <LucideChevronRight aria-hidden="true" />}
                </span>
              </button>
              <div id={contentId} hidden={!expanded} className={cm(styles, "production-planning-natural-resource-icons")}>
                {expanded && Array.from(items).map((itemId) => (
                  <img key={itemId} alt={resolveProductionPlanningItemName(itemId, index, t)}
                    src={resolveProductionPlanningItemIconSrc(itemId, index)}
                    title={resolveProductionPlanningItemName(itemId, index, t)} />
                ))}
              </div>
            </div>
          );
        })}
        <ByproductPolicyToggle
          itemId="item_liquid_water"
          index={index}
          policy={sourceConfig.waterPolicy}
          optionA="use-byproduct"
          optionALabel={t("productionPlanning.byproductUse")}
          optionB="dump-byproduct"
          optionBLabel={t("productionPlanning.byproductDump")}
          onChange={(policy) => onUpdate({ waterPolicy: policy })}
          t={t}
        />
        <ByproductPolicyToggle
          itemId="item_liquid_acid"
          index={index}
          policy={sourceConfig.acidPolicy}
          optionA="use-byproduct"
          optionALabel={t("productionPlanning.byproductUse")}
          optionB="dump-byproduct"
          optionBLabel={t("productionPlanning.byproductDump")}
          onChange={(policy) => onUpdate({ acidPolicy: policy })}
          t={t}
        />
        <SewagePolicyToggle
          index={index}
          policy={sourceConfig.sewagePolicy}
          onChange={(policy) => onUpdate({ sewagePolicy: policy })}
          t={t}
        />
        <WaterPurifierPolicyToggle
          index={index}
          policy={sourceConfig.waterPurifierPolicy}
          onChange={(policy) => onUpdate({ waterPurifierPolicy: policy })}
          t={t}
        />
        <DeviceMinimumConsumptionToggle
          mode={sourceConfig.includeDeviceMinimumConsumption}
          onChange={(mode) => onUpdate({ includeDeviceMinimumConsumption: mode })}
          t={t}
        />
      </div>
    </section>
  );
}

function ByproductPolicyToggle({
  itemId,
  index,
  policy,
  optionA,
  optionALabel,
  optionB,
  optionBLabel,
  onChange,
  t: _t,
}: {
  itemId: string;
  index: ProductionPlanningIndex;
  policy: ProductionPlanningByproductPolicy;
  optionA: ProductionPlanningByproductPolicy;
  optionALabel: string;
  optionB: ProductionPlanningByproductPolicy;
  optionBLabel: string;
  onChange: (policy: ProductionPlanningByproductPolicy) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-special-source")}>
      <div className={cm(styles, "production-planning-special-source-label")}>
        <img alt="" src={resolveProductionPlanningItemIconSrc(itemId, index)} />
        <span>{resolveProductionPlanningItemName(itemId, index, _t)}</span>
      </div>
      <div className={cm(styles, "production-planning-two-option-toggle")}>
        <button
          type="button"
          className={cm(styles, policy === optionA ? "is-active" : "")}
          onClick={() => onChange(optionA)}
        >
          {optionALabel}
        </button>
        <button
          type="button"
          className={cm(styles, policy === optionB ? "is-active" : "")}
          onClick={() => onChange(optionB)}
        >
          {optionBLabel}
        </button>
      </div>
    </div>
  );
}

function SewagePolicyToggle({
  index,
  policy,
  onChange,
  t: _t,
}: {
  index: ProductionPlanningIndex;
  policy: ProductionPlanningSewagePolicy;
  onChange: (policy: ProductionPlanningSewagePolicy) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-special-source")}>
      <div className={cm(styles, "production-planning-special-source-label")}>
        <img alt="" src={resolveProductionPlanningItemIconSrc("item_liquid_sewage", index)} />
        <span>{resolveProductionPlanningItemName("item_liquid_sewage", index, _t)}</span>
      </div>
      <div className={cm(styles, "production-planning-two-option-toggle")}>
        <button
          type="button"
          className={cm(styles, policy === "external-supply" ? "is-active" : "")}
          onClick={() => onChange("external-supply")}
        >
          {_t("productionPlanning.externalSupply")}
        </button>
        <button
          type="button"
          className={cm(styles, policy === "self-produce" ? "is-active" : "")}
          onClick={() => onChange("self-produce")}
        >
          {_t("productionPlanning.selfProduce")}
        </button>
      </div>
    </div>
  );
}

function WaterPurifierPolicyToggle({
  index,
  policy,
  onChange,
  t,
}: {
  index: ProductionPlanningIndex;
  policy: ProductionPlanningWaterPurifierPolicy;
  onChange: (policy: ProductionPlanningWaterPurifierPolicy) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-special-source")}>
      <div className={cm(styles, "production-planning-special-source-label")}>
        <img alt="" src={resolveProductionPlanningEntityIconSrc("water_purifier_node_1", index)} />
        <span>{t("productionPlanning.waterPurifierNode")}</span>
      </div>
      <div className={cm(styles, "production-planning-two-option-toggle")}>
        <button
          type="button"
          className={cm(styles, policy === "disabled" ? "is-active" : "")}
          onClick={() => onChange("disabled")}
        >
          {t("productionPlanning.waterPurifierDisabled")}
        </button>
        <button
          type="button"
          className={cm(styles, policy === "use-when-available" ? "is-active" : "")}
          onClick={() => onChange("use-when-available")}
        >
          {t("productionPlanning.waterPurifierUseWhenAvailable")}
        </button>
      </div>
    </div>
  );
}

function DeviceMinimumConsumptionToggle({
  mode,
  onChange,
  t,
}: {
  mode: ProductionPlanningDeviceMinimumConsumptionMode;
  onChange: (mode: ProductionPlanningDeviceMinimumConsumptionMode) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-special-source")}>
      <div className={cm(styles, "production-planning-special-source-label")}>
        <LucideFactory />
        <span>{t("productionPlanning.deviceMinimumConsumption")}</span>
      </div>
      <div className={cm(styles, "production-planning-two-option-toggle")}>
        <button
          type="button"
          className={cm(styles, mode === "none" ? "is-active" : "")}
          aria-pressed={mode === "none"}
          onClick={() => onChange("none")}
        >
          {t("productionPlanning.deviceMinimumConsumptionDisabled")}
        </button>
        <button
          type="button"
          className={cm(styles, mode === "fractional" ? "is-active" : "")}
          aria-pressed={mode === "fractional"}
          onClick={() => onChange("fractional")}
        >
          {t("productionPlanning.deviceMinimumConsumptionEnabled")}
        </button>
        <button
          type="button"
          className={cm(styles, mode === "ceil" ? "is-active" : "")}
          aria-pressed={mode === "ceil"}
          onClick={() => onChange("ceil")}
        >
          {t("productionPlanning.deviceMinimumConsumptionRoundedUp")}
        </button>
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className={cm(styles, "production-planning-segmented")} aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cm(styles, value === option.value ? "is-active" : "")}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PlanGraph({
  appHost,
  displayMode,
  invertWheelZoom,
  flowViewport,
  processViewport,
  viewMode,
  plan,
  index,
  useModules,
  recipeChoices,
  externalItemIds,
  treeScrollTop,
  processExpandedItems,
  isTouch,
  onFlowViewportChange,
  onSelectRecipe,
  onRequestRecipeSelection,
  onCoverDemand,
  onRemoveExternalSupply,
  onTreeScrollTopChange,
  onToggleProcessBranch,
  onProcessViewportChange,
  t,
}: {
  appHost: AppHost;
  displayMode: ProductionPlanningDisplayMode;
  invertWheelZoom: boolean;
  flowViewport: PlannerFlowViewportState;
  processViewport: PlannerFlowViewportState;
  viewMode: ProductionPlanningViewMode;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  useModules: boolean;
  recipeChoices: ReadonlyMap<string, string>;
  externalItemIds: ReadonlySet<string>;
  treeScrollTop: number;
  processExpandedItems: readonly string[];
  isTouch: boolean;
  onFlowViewportChange: (viewport: PlannerFlowViewportState) => void;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  onRequestRecipeSelection: (itemId: string, recipes: readonly RecipeDefinition[]) => void;
  onCoverDemand: (itemId: string) => void;
  onRemoveExternalSupply: (itemId: string) => void;
  onTreeScrollTopChange: (scrollTop: number) => void;
  onToggleProcessBranch: (branchId: string) => void;
  onProcessViewportChange: (viewport: PlannerFlowViewportState) => void;
  t: (key: string) => string;
}) {
  if (viewMode === "process") {
    const expandedSet = new Set(processExpandedItems);
    return (
      <ProcessGraphView
        plan={plan}
        invertWheelZoom={invertWheelZoom}
        index={index}
        recipeChoices={recipeChoices}
        externalItemIds={externalItemIds}
        expandedBranchIds={expandedSet}
        displayMode={displayMode}
        initialViewport={processViewport}
        onToggleBranch={onToggleProcessBranch}
        onCoverDemand={onCoverDemand}
        onRemoveExternalSupply={onRemoveExternalSupply}
        onRequestRecipeSelection={onRequestRecipeSelection}
        onViewportChange={onProcessViewportChange}
        t={t}
      />
    );
  }

  if (viewMode === "flow") {
    return (
      <FlowGraph
        appHost={appHost}
        displayMode={displayMode}
        invertWheelZoom={invertWheelZoom}
        flowViewport={flowViewport}
        plan={plan}
        index={index}
        recipeChoices={recipeChoices}
        onFlowViewportChange={onFlowViewportChange}
        onSelectRecipe={onSelectRecipe}
        onRequestRecipeSelection={onRequestRecipeSelection}
        t={t}
      />
    );
  }

  return (
    <ProductionPlanningTreeTable
      displayMode={displayMode}
      plan={plan}
      index={index}
      useModules={useModules}
      recipeChoices={recipeChoices}
      treeScrollTop={treeScrollTop}
      isTouch={isTouch}
      onSelectRecipe={onSelectRecipe}
      onRequestRecipeSelection={onRequestRecipeSelection}
      onCoverDemand={onCoverDemand}
      onRemoveExternalSupply={onRemoveExternalSupply}
      onTreeScrollTopChange={onTreeScrollTopChange}
      t={t}
    />
  );
}


function ProductionPlanningTreeTable({
  displayMode,
  plan,
  index,
  useModules,
  recipeChoices,
  treeScrollTop,
  isTouch,
  onSelectRecipe,
  onRequestRecipeSelection,
  onCoverDemand,
  onRemoveExternalSupply,
  onTreeScrollTopChange,
  t,
}: {
  displayMode: ProductionPlanningDisplayMode;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  useModules: boolean;
  recipeChoices: ReadonlyMap<string, string>;
  treeScrollTop: number;
  isTouch: boolean;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  onRequestRecipeSelection: (itemId: string, recipes: readonly RecipeDefinition[]) => void;
  onCoverDemand: (itemId: string) => void;
  onRemoveExternalSupply: (itemId: string) => void;
  onTreeScrollTopChange: (scrollTop: number) => void;
  t: (key: string) => string;
}) {
  const rows = useMemo(() => buildProductionPlanningTreeRows(plan, displayMode), [displayMode, plan]);
  return <ProductionPlanningTreeTableView rows={rows} styles={styles}
    className={displayMode === "device" ? "is-device-mode" : "is-item-mode"}
    treeScrollTop={treeScrollTop} onTreeScrollTopChange={onTreeScrollTopChange} t={t}
    renderIdentity={row => <>
            {row.isSharedDemandReference || row.isPlantCycleReference ? (
              <div className={cm(styles, "production-planning-recipe-identity")}>
                <img alt="" src={resolveProductionPlanningItemIconSrc(row.targetItemId, index)} />
                <div>
                  <strong>{resolveProductionPlanningItemName(row.targetItemId, index, t)}</strong>
                  <span>
                    {row.isDeviceMinimumConsumption
                      ? `${t("productionPlanning.minimumConsumption")} · ${t("productionPlanning.sharedDemand")}`
                      : t(row.isPlantCycleReference ? "productionPlanning.plantCycle" : "productionPlanning.sharedDemand")}
                  </span>
                </div>
              </div>
            ) : isProductionPlanningDeviceMinimumConsumptionRecipeId(row.recipeId) ? (
              <div className={cm(styles, "production-planning-recipe-identity")}>
                <img alt="" src={resolveProductionPlanningItemIconSrc(row.targetItemId, index)} />
                <div>
                  <strong>{resolveProductionPlanningItemName(row.targetItemId, index, t)}</strong>
                  <span>{t("productionPlanning.deviceMinimumConsumptionNode")}</span>
                </div>
              </div>
            ) : (
              <RecipeIdentity
                recipeNode={row.recipeNode}
                targetItemId={row.targetItemId}
                displayMode={displayMode}
                isDeviceMinimumConsumption={row.isDeviceMinimumConsumption}
                index={index}
                t={t}
              />
            )}
            <span className={cm(styles, "production-planning-tree-table-chips")}>
            {row.isShared && (
              <span className={cm(styles, "production-planning-tree-table-chip")}>
                {t("productionPlanning.shared")}
              </span>
            )}
            {ProductionPlanningTreeRowChip({ row, index, useModules, t })}
            </span>
    </>}
    renderRate={row => <ProductionPlanningTreeRowRate row={row} index={index} t={t} />}
    renderDetail={(row, rowById, selectRow) => <ProductionPlanningTreeDetail row={row} rowById={rowById}
      index={index} useModules={useModules} displayMode={displayMode} recipeChoices={recipeChoices}
      isTouch={isTouch} onSelectRow={selectRow} onSelectRecipe={onSelectRecipe}
      onRequestRecipeSelection={onRequestRecipeSelection} onCoverDemand={onCoverDemand}
      onRemoveExternalSupply={onRemoveExternalSupply} t={t} />} />;
}

function ProductionPlanningTreeRowChip({
  row,
  index: _index,
  useModules,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  useModules: boolean;
  t: (key: string) => string;
}): ReactNode {
  if (row.isPlantCycle && !row.isPlantCycleReference) {
    return <span className={cm(styles, "production-planning-tree-table-chip")}>
      {t("productionPlanning.plantCycle")}
    </span>;
  }

  if (useModules && row.recipeNode.module !== null) {
    return (
      <span className={cm(styles, "production-planning-tree-table-chip")}>
        {t("productionPlanning.modules")}
      </span>
    );
  }

  if (!row.isByproduct) {
    return null;
  }

  return (
    <span className={cm(styles, "production-planning-tree-table-chip")}>
      {t("productionPlanning.byproduct")}
    </span>
  );
}





function ProductionPlanningTreeRowRate({
  row,
  index,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  if (row.isSharedDemandReference || row.isPlantCycleReference || isProductionPlanningDeviceMinimumConsumptionRecipeId(row.recipeId)) {
    const consumedPerMinute = row.isSharedDemandReference || row.isPlantCycleReference
      ? row.consumedPerMinute
      : row.recipeNode.inputs.find((input) => input.itemId === row.targetItemId)?.perMinute ?? 0;
    return (
      <div className={cm(styles, "production-planning-tree-table-rate")}>
        <span className={cm(styles, "production-planning-tree-rate-piece")}>
          <span>{t("productionPlanning.consumed")}</span>
          <strong>{formatProductionFlow(consumedPerMinute)}/min</strong>
        </span>
        <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
        <ProductionPlanningLogisticsRate flowPerMinute={consumedPerMinute} itemId={row.targetItemId} index={index} t={t} />
      </div>
    );
  }

  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    const outputFlow = resolveProductionPlanningRecipeDisplayFlow(row);
    const logisticsItemId = resolveProductionPlanningRecipeDisplayItemId(row);

    return (
      <div className={cm(styles, "production-planning-tree-table-rate")}>
        <span className={cm(styles, "production-planning-tree-rate-piece")}>
          <strong>{formatProductionFlow(outputFlow)}/min</strong>
        </span>
        {logisticsItemId !== null && (
          <>
            <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
            <ProductionPlanningLogisticsRate flowPerMinute={outputFlow} itemId={logisticsItemId} index={index} t={t} />
          </>
        )}
      </div>
    );
  }

  const module = row.recipeNode.module;
  const recipe = module === null ? index.recipeById.get(row.recipeId) : undefined;
  const machineId = recipe?.machineId ?? row.recipeNode.recipeId ?? row.recipeNode.candidateId;
  const outputFlow = resolveProductionPlanningRecipeDisplayFlow(row);
  const logisticsItemId = resolveProductionPlanningRecipeDisplayItemId(row);
  const productionUnitName = module?.name
    ?? (recipe === undefined ? row.recipeId : t(index.entityById.get(machineId)?.nameKey ?? recipe.nameKey));
  const productionUnitIconSrcs = module === null
    ? [recipe === undefined
      ? createEntityIconAssetUrl(undefined)
      : resolveProductionPlanningEntityIconSrc(machineId, index)]
    : resolveProductionPlanningModuleIconSrcs(module, index);

  return (
    <div className={cm(styles, "production-planning-tree-table-rate")}>
      <span className={cm(styles, "production-planning-tree-rate-piece")} title={productionUnitName}>
        <strong>{formatProductionDeviceCount(row.total?.deviceCount ?? row.recipeNode.deviceCount)}</strong>
        <CompositeItemIcon iconSrcs={productionUnitIconSrcs} size={18} />
      </span>
      <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
      <span className={cm(styles, "production-planning-tree-rate-piece")}>
        <strong>{formatProductionFlow(outputFlow)}/min</strong>
      </span>
      {logisticsItemId !== null && (
        <>
          <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
          <ProductionPlanningLogisticsRate flowPerMinute={outputFlow} itemId={logisticsItemId} index={index} t={t} />
        </>
      )}
    </div>
  );
}

function ProductionPlanningLogisticsRate({
  flowPerMinute,
  itemId,
  index,
  t,
}: {
  flowPerMinute: number;
  itemId: string;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  const logisticsKind = resolveProductionPlanningLogisticsKind(itemId, index);
  const count = Math.ceil(flowPerMinute / resolveProductionPlanningLogisticsThroughput(logisticsKind));
  const entityId = index.registryQueries.resolveLogisticsDefinitionId(
    logisticsKind,
    "straight",
  );
  const entity = index.entityById.get(entityId);

  return (
    <span
      className={cm(styles, "production-planning-tree-rate-piece")}
      title={entity === undefined ? entityId : t(entity.nameKey)}
    >
      <strong>{formatProductionDeviceCount(count)}</strong>
      <img alt="" src={resolveProductionPlanningEntityIconSrc(entityId, index)} />
    </span>
  );
}

function ProductionPlanningTreeDetail({
  row,
  rowById,
  index,
  useModules,
  displayMode,
  recipeChoices,
  isTouch,
  onSelectRow,
  onSelectRecipe,
  onRequestRecipeSelection,
  onCoverDemand,
  onRemoveExternalSupply,
  t,
}: {
  row: ProductionPlanningTreeRow;
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>;
  index: ProductionPlanningIndex;
  useModules: boolean;
  displayMode: ProductionPlanningDisplayMode;
  recipeChoices: ReadonlyMap<string, string>;
  isTouch: boolean;
  onSelectRow: (rowId: string) => void;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  onRequestRecipeSelection: (itemId: string, recipes: readonly RecipeDefinition[]) => void;
  onCoverDemand: (itemId: string) => void;
  onRemoveExternalSupply: (itemId: string) => void;
  t: (key: string) => string;
}) {
  const isStandaloneDeviceMinimumConsumption = isProductionPlanningDeviceMinimumConsumptionRecipeId(row.recipeId);
  const detailRef = useRef<HTMLElement | null>(null);
  const [detailWidth, setDetailWidth] = useState(0);
  const actionContainerRef = useRef<HTMLDivElement | null>(null);
  const actionLabelRef = useRef<HTMLSpanElement | null>(null);
  const [actionLayout, setActionLayout] = useState({ fullWidth: 0, compact: false });

  useLayoutEffect(() => {
    const element = detailRef.current;
    if (element === null) {
      return;
    }

    const measure = () => {
      const width = Math.floor(element.getBoundingClientRect().width || element.clientWidth);
      setDetailWidth((current) => current === width ? current : width);
      const container = actionContainerRef.current;
      const label = actionLabelRef.current;
      const button = container?.querySelector("button");
      const icon = button?.querySelector("svg");
      if (container && label && button && icon) {
        const css = getComputedStyle(button);
        const fullWidth = Math.ceil(label.scrollWidth + icon.getBoundingClientRect().width
          + parseFloat(css.columnGap || "0") + parseFloat(css.paddingLeft || "0")
          + parseFloat(css.paddingRight || "0") + parseFloat(css.borderLeftWidth || "0")
          + parseFloat(css.borderRightWidth || "0"));
        const compact = container.clientWidth < fullWidth;
        setActionLayout((current) => current.fullWidth === fullWidth && current.compact === compact
          ? current : { fullWidth, compact });
      }
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    if (actionContainerRef.current) resizeObserver.observe(actionContainerRef.current);
    if (actionLabelRef.current) resizeObserver.observe(actionLabelRef.current);
    return () => resizeObserver.disconnect();
  }, [isStandaloneDeviceMinimumConsumption, row.isSharedDemandReference, row.isPlantCycleReference, row.recipeId, t]);

  if (row.isSharedDemandReference || row.isPlantCycleReference) {
    return (
      <ProductionPlanningSharedDemandDetail
        row={row}
        rowById={rowById}
        index={index}
        onSelectRow={onSelectRow}
        t={t}
      />
    );
  }

  if (isStandaloneDeviceMinimumConsumption) {
    return (
      <ProductionPlanningDeviceMinimumConsumptionDetail
        row={row}
        rowById={rowById}
        index={index}
        onSelectRow={onSelectRow}
        t={t}
      />
    );
  }

  const module = row.recipeNode.module;
  const recipe = module === null && row.recipeNode.recipeId !== null
    ? index.recipeById.get(row.recipeNode.recipeId)
    : undefined;
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const isExternal = isProductionPlanningExternalSupplyRecipeId(row.recipeId);
  const productName = row.targetItemId.length > 0
    ? resolveProductionPlanningItemName(row.targetItemId, index, t)
    : isExternal
      ? ""
      : module !== null
        ? module.name
        : recipe === undefined ? row.recipeId : resolveProductionPlanningRecipeName(recipe, index, t);
  const machineName = isExternal
    ? t("productionPlanning.externalSupply")
    : module !== null
      ? module.name
      : machine === null ? row.recipeNode.recipeId ?? row.recipeNode.candidateId : t(machine.nameKey);
  const title = displayMode === "item" ? productName : machineName;
  const moduleSourceName = module === null
    ? null
    : t(
      module.sourceType === "custom-module"
        ? "moduleBalancing.customModules"
        : "moduleBalancing.recommendedModules",
    );
  const normalSubtitle = displayMode === "item"
    ? (isExternal
      ? t("productionPlanning.externalSupply")
      : `${moduleSourceName === null ? "" : `${moduleSourceName} · `}${t("productionPlanning.producedBy").replace("{machine}", machineName)}`)
    : (isExternal
      ? `${t("productionPlanning.produced")} ${productName}`
      : `${moduleSourceName === null ? "" : `${moduleSourceName} · `}${t("productionPlanning.produced")} ${productName}`);
  const subtitle = row.isDeviceMinimumConsumption
    ? `${t("productionPlanning.minimumConsumption")} · ${normalSubtitle}`
    : normalSubtitle;
  const iconSrcs = displayMode === "item" && row.targetItemId.length > 0
    ? [resolveProductionPlanningItemIconSrc(row.targetItemId, index)]
    : isExternal
      ? [resolveProductionPlanningExternalSupplyIconSrc()]
      : module !== null
        ? resolveProductionPlanningModuleIconSrcs(module, index)
        : machine === null
          ? [createEntityIconAssetUrl(undefined)]
          : [resolveProductionPlanningEntityIconSrc(machine.id, index)];
  const availableRecipes = row.targetItemId.length > 0
    ? (index.recipesByOutputItem.get(row.targetItemId) ?? [])
      .filter((candidate) => !isWaterPurifierNodeRecipe(candidate))
    : [];
  const availableCandidates = row.targetItemId.length > 0
    ? (index.candidatesByOutputItem.get(row.targetItemId) ?? []).filter((candidate) => (
      candidate.sourceType === "system-recipe" || useModules
    ))
    : [];
  const detailClassName = [
    "production-planning-tree-detail-stack",
    detailWidth < 340 ? "is-compact" : "",
    detailWidth < 260 ? "is-tight" : "",
  ].filter(Boolean).join(" ");
  const externalSupplyActionLabel = isExternal
    ? t("productionPlanning.removeExternalSupply")
    : t("productionPlanning.coverDemand");

  return (
    <article ref={detailRef} className={cm(styles, detailClassName)}>
      <div className={cm(styles, "production-planning-recipe-header")}>
        <CompositeItemIcon iconSrcs={iconSrcs} size={24} />
        <div>
          <h4>{title}</h4>
          <span>{subtitle}</span>
        </div>
        <div
          ref={actionContainerRef}
          className={cm(styles, "production-planning-supply-action-container", actionLayout.compact ? "is-icon-only" : "")}
          style={actionLayout.fullWidth > 0 ? { flexBasis: actionLayout.fullWidth } : undefined}
        >
          <button
            type="button"
            className={cm(styles, "production-planning-icon-text-button production-planning-external-supply-action")}
            aria-label={externalSupplyActionLabel}
            title={externalSupplyActionLabel}
            onClick={() => isExternal ? onRemoveExternalSupply(row.targetItemId) : onCoverDemand(row.targetItemId)}
          >
            <LucideRepeat />
            <span ref={actionLabelRef}>{externalSupplyActionLabel}</span>
          </button>
        </div>
      </div>
      <RecipeChoiceControls styles={styles}
        itemId={row.targetItemId}
        recipes={availableRecipes}
        candidates={availableCandidates}
        index={index}
        selectedRecipeId={row.targetItemId.length > 0 ? recipeChoices.get(row.targetItemId) ?? null : null}
        onRequestRecipeSelection={onRequestRecipeSelection}
        onSelectRecipe={onSelectRecipe}
        t={t}
      />
      {recipe !== undefined && (
        <RecipeDisplay recipeId={recipe.id} index={index} isTouch={isTouch} t={t} />
      )}
      <div className={cm(styles, "production-planning-recipe-ports")}>
        <PortChipList title={t("productionPlanning.requiredInputs")} ports={row.recipeNode.inputs} index={index} t={t} />
        <PortChipList title={t("productionPlanning.totalOutputs")} ports={row.recipeNode.outputs} index={index} t={t} />
      </div>
      <ProductionPlanningTreeRelations
        groups={[
          {
            label: t("productionPlanning.inputSources"),
            rowIds: row.childIds,
          },
          {
            label: t("productionPlanning.outputTargets"),
            rowIds: [...row.parentIds, ...row.demandReferenceIds],
          },
        ]}
        rowById={rowById}
        index={index}
        onSelectRow={onSelectRow}
        t={t}
      />
    </article>
  );
}

function ProductionPlanningSharedDemandDetail({
  row,
  rowById,
  index,
  onSelectRow,
  t,
}: {
  row: ProductionPlanningTreeRow;
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>;
  index: ProductionPlanningIndex;
  onSelectRow: (rowId: string) => void;
  t: (key: string) => string;
}) {
  const subtitle = row.isDeviceMinimumConsumption
    ? `${t("productionPlanning.minimumConsumption")} · ${t("productionPlanning.sharedDemand")}`
    : t(row.isPlantCycleReference ? "productionPlanning.plantCycle" : "productionPlanning.sharedDemand");

  return (
    <article className={cm(styles, "production-planning-tree-detail-stack")}>
      <div className={cm(styles, "production-planning-recipe-header")}>
        <img alt="" src={resolveProductionPlanningItemIconSrc(row.targetItemId, index)} />
        <div>
          <h4>{resolveProductionPlanningItemName(row.targetItemId, index, t)}</h4>
          <span>{subtitle}</span>
        </div>
      </div>
      <div className={cm(styles, "production-planning-recipe-ports")}>
        <PortChipList title={t("productionPlanning.consumed")} ports={row.recipeNode.inputs} index={index} t={t} />
      </div>
      <ProductionPlanningTreeRelations
        groups={[
          {
            label: t("productionPlanning.inputSources"),
            rowIds: row.sourceRowId === null ? [] : [row.sourceRowId],
          },
          {
            label: t("productionPlanning.outputTargets"),
            rowIds: row.parentIds,
          },
        ]}
        rowById={rowById}
        index={index}
        onSelectRow={onSelectRow}
        t={t}
      />
    </article>
  );
}

function ProductionPlanningDeviceMinimumConsumptionDetail({
  row,
  rowById,
  index,
  onSelectRow,
  t,
}: {
  row: ProductionPlanningTreeRow;
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>;
  index: ProductionPlanningIndex;
  onSelectRow: (rowId: string) => void;
  t: (key: string) => string;
}) {
  const hostRecipeId = resolveProductionPlanningDeviceMinimumConsumptionHostRecipeId(row.recipeId);
  const hostRecipe = hostRecipeId === null ? undefined : index.recipeById.get(hostRecipeId);
  const hostMachine = hostRecipe === undefined ? undefined : index.entityById.get(hostRecipe.machineId);
  const machineName = hostMachine === undefined ? hostRecipeId : t(hostMachine.nameKey);

  return (
    <article className={cm(styles, "production-planning-tree-detail-stack")}>
      <div className={cm(styles, "production-planning-recipe-header")}>
        <img alt="" src={resolveProductionPlanningItemIconSrc(row.targetItemId, index)} />
        <div>
          <h4>{resolveProductionPlanningItemName(row.targetItemId, index, t)}</h4>
          <span>
            {t("productionPlanning.deviceMinimumConsumptionNode")}
            {machineName === null ? "" : ` · ${machineName}`}
          </span>
        </div>
      </div>
      <div className={cm(styles, "production-planning-recipe-ports")}>
        <PortChipList title={t("productionPlanning.consumed")} ports={row.recipeNode.inputs} index={index} t={t} />
      </div>
      <ProductionPlanningTreeRelations
        groups={[
          {
            label: t("productionPlanning.inputSources"),
            rowIds: row.childIds,
          },
          {
            label: t("productionPlanning.outputTargets"),
            rowIds: row.parentIds,
          },
        ]}
        rowById={rowById}
        index={index}
        onSelectRow={onSelectRow}
        t={t}
      />
    </article>
  );
}





function ProductionPlanningTreeRelations({
  groups,
  rowById,
  index,
  onSelectRow,
  t,
}: {
  groups: readonly { readonly label: string; readonly rowIds: readonly string[] }[];
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>;
  index: ProductionPlanningIndex;
  onSelectRow: (rowId: string) => void;
  t: (key: string) => string;
}) {
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      rows: uniqueProductionPlanningTreeRowIds(group.rowIds)
        .map((rowId) => rowById.get(rowId) ?? null)
        .filter((relatedRow): relatedRow is ProductionPlanningTreeRow => relatedRow !== null),
    }))
    .filter((group) => group.rows.length > 0);

  if (visibleGroups.length === 0) {
    return null;
  }

  return (
    <div className={cm(styles, "production-planning-tree-relations")}>
      {visibleGroups.map((group) => (
        <div key={group.label} className={cm(styles, "production-planning-tree-relation-group")}>
          <span>{group.label}</span>
          <div>
            {group.rows.map((relatedRow) => (
              <button
                key={relatedRow.id}
                type="button"
                className={cm(styles, "production-planning-tree-relation-button")}
                title={resolveProductionPlanningTreeRowTitle(relatedRow, index, t)}
                onClick={() => onSelectRow(relatedRow.id)}
              >
                <ProductionPlanningTreeRelationIdentity row={relatedRow} index={index} t={t} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductionPlanningTreeRelationIdentity({
  row,
  index,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  if (row.isSharedDemandReference || row.isPlantCycleReference) {
    return (
      <>
        <img alt="" src={resolveProductionPlanningItemIconSrc(row.targetItemId, index)} />
        <span>
          {resolveProductionPlanningItemName(row.targetItemId, index, t)}
          {` · ${row.isDeviceMinimumConsumption ? `${t("productionPlanning.minimumConsumption")} · ` : ""}${t(row.isPlantCycleReference ? "productionPlanning.plantCycle" : "productionPlanning.sharedDemand")}`}
        </span>
      </>
    );
  }

  if (isProductionPlanningDeviceMinimumConsumptionRecipeId(row.recipeId)) {
    return (
      <>
        <img alt="" src={resolveProductionPlanningItemIconSrc(row.targetItemId, index)} />
        <span>
          {t("productionPlanning.deviceMinimumConsumptionNode")}
          {` · ${resolveProductionPlanningItemName(row.targetItemId, index, t)}`}
        </span>
      </>
    );
  }

  const recipe = index.recipeById.get(row.recipeId);
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const isExternal = isProductionPlanningExternalSupplyRecipeId(row.recipeId);
  const machineId = isExternal ? EXTERNAL_SUPPLY_ENTITY_ID : (recipe?.machineId ?? "");
  const machineName = isExternal
    ? t("productionPlanning.externalSupply")
    : machine === null ? row.recipeId : t(machine.nameKey);
  const iconSrc = isExternal
    ? resolveProductionPlanningExternalSupplyIconSrc()
    : machineId.length > 0
      ? resolveProductionPlanningEntityIconSrc(machineId, index)
      : createEntityIconAssetUrl(undefined);

  return (
    <>
      <img alt="" src={iconSrc} />
      <span>
        {row.isDeviceMinimumConsumption ? `${t("productionPlanning.minimumConsumption")} · ` : ""}
        {machineName}
        {row.targetItemId.length > 0 ? ` · ${resolveProductionPlanningItemName(row.targetItemId, index, t)}` : ""}
      </span>
    </>
  );
}

function RecipeIdentity({
  recipeNode,
  targetItemId,
  displayMode,
  isDeviceMinimumConsumption = false,
  index,
  t,
}: {
  recipeNode: ProductionPlanningRecipeNode;
  targetItemId?: string;
  displayMode: ProductionPlanningDisplayMode;
  isDeviceMinimumConsumption?: boolean;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  const module = recipeNode.module;
  const recipe = module === null && recipeNode.recipeId !== null
    ? index.recipeById.get(recipeNode.recipeId)
    : undefined;
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const productItemId = targetItemId ?? recipeNode.targetItemId;
  const isExternal = isProductionPlanningExternalSupplyRecipeId(recipeNode.recipeId ?? "");

  const productName = productItemId.length > 0
    ? resolveProductionPlanningItemName(productItemId, index, t)
    : module !== null
      ? module.name
      : recipe === undefined
        ? recipeNode.recipeId ?? recipeNode.candidateId
        : resolveProductionPlanningRecipeName(recipe, index, t);
  const machineName = isExternal
    ? t("productionPlanning.externalSupply")
    : module !== null
      ? module.name
      : machine === null ? recipeNode.recipeId ?? recipeNode.candidateId : t(machine.nameKey);
  const title = displayMode === "item" ? productName : machineName;
  const normalSubtitle = displayMode === "item" ? machineName : productName;
  const subtitle = isDeviceMinimumConsumption
    ? `${t("productionPlanning.minimumConsumption")} · ${normalSubtitle}`
    : normalSubtitle;
  const iconSrcs = (() => {
    if (displayMode === "item" && productItemId.length > 0) {
      return [resolveProductionPlanningItemIconSrc(productItemId, index)];
    }
    if (isExternal) {
      return [resolveProductionPlanningExternalSupplyIconSrc()];
    }
    if (module !== null) {
      return resolveProductionPlanningModuleIconSrcs(module, index);
    }
    return recipe === undefined
      ? [createEntityIconAssetUrl(undefined)]
      : [resolveProductionPlanningEntityIconSrc(recipe.machineId, index)];
  })();

  return (
    <div className={cm(styles, "production-planning-recipe-identity")}>
      <CompositeItemIcon iconSrcs={iconSrcs} size={26} />
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}


type MutableProductionPlanningTreeRow = {
  id: string;
  depth: number;
  order: number;
  parentIds: Set<string>;
  childIds: Set<string>;
  demandReferenceIds: Set<string>;
  recipeId: string;
  targetItemId: string;
  recipeNode: ProductionPlanningRecipeNode;
  recipeNodes: ProductionPlanningRecipeNode[];
  total: ProductionPlanningResult["recipeTotals"][number] | null;
  inputItemIds: Set<string>;
  outputItemIds: Set<string>;
  isByproduct: boolean;
  isShared: boolean;
  isSharedDemandReference: boolean;
  isPlantCycle: boolean;
  isPlantCycleReference: boolean;
  isDeviceMinimumConsumption: boolean;
  consumedPerMinute: number;
  sourceRowId: string | null;
};


// 物品模式折叠 recipe 行（只保留 item 行），设备模式折叠中间 item 行（只保留 recipe + raw item 行）。
// 非共享设备最低消耗则直接复用真实供给节点，只增加最低消耗身份。
export function buildProductionPlanningTreeRows(
  plan: ProductionPlanningResult,
  _displayMode: ProductionPlanningDisplayMode,
): ProductionPlanningTreeRow[] {
  return buildLedgerProductionPlanningTreeRows(plan);
}

function buildLedgerProductionPlanningTreeRows(plan: ProductionPlanningResult): ProductionPlanningTreeRow[] {
  const recipeTotals = new Map(plan.recipeTotals.map((total) => [
    total.recipeId ?? total.candidateId,
    total,
  ]));
  const rowById = new Map<string, MutableProductionPlanningTreeRow>();
  const producerRowIdsByItem = new Map<string, Set<string>>();
  const surplusProducerRowIdsByItem = new Map<string, Set<string>>();
  const plantCycleSourceRowIds = new Set<string>();
  const byproductRowIds = new Set<string>();
  let nextOrder = 0;

  const addRowIdByItem = (target: Map<string, Set<string>>, itemId: string, rowId: string) => {
    const existing = target.get(itemId);
    if (existing === undefined) {
      target.set(itemId, new Set([rowId]));
      return;
    }
    existing.add(rowId);
  };

  const ensureRecipeRow = (
    recipeId: string,
    targetItemId: string,
    recipeNode: ProductionPlanningRecipeNode | null,
    rowIdOverride?: string,
  ): MutableProductionPlanningTreeRow => {
    const rowId = rowIdOverride ?? buildProductionPlanningTreeDeviceProductRowId(recipeId, targetItemId);
    const existing = rowById.get(rowId);
    const total = recipeTotals.get(recipeId) ?? null;
    const targetRecipeNode = recipeNode === null
      ? createProductionPlanningTreeSyntheticRecipeNode(recipeId, total, null, targetItemId)
      : createProductionPlanningTreeTargetedRecipeNode(recipeNode, targetItemId);

    if (existing !== undefined) {
      existing.total = total;
      if (recipeNode === null && existing.recipeNodes.length > 0) {
        if (targetItemId.length > 0) {
          existing.outputItemIds.add(targetItemId);
        }
        return existing;
      }
      if (!existing.recipeNodes.some((candidate) => candidate.id === targetRecipeNode.id)) {
        existing.recipeNodes.push(targetRecipeNode);
        existing.recipeNode = mergeProductionPlanningTreeRecipeNodes(existing.recipeNode, targetRecipeNode);
      }
      if (targetItemId.length > 0) {
        existing.outputItemIds.add(targetItemId);
      }
      for (const input of resolveProductionPlanningRecipeInputPorts(targetRecipeNode)) {
        existing.inputItemIds.add(input.itemId);
      }
      return existing;
    }

    const recipeRow: MutableProductionPlanningTreeRow = {
      id: rowId,
      depth: 0,
      order: nextOrder,
      parentIds: new Set(),
      childIds: new Set(),
      demandReferenceIds: new Set(),
      recipeId,
      targetItemId,
      recipeNode: targetRecipeNode,
      recipeNodes: [targetRecipeNode],
      total,
      inputItemIds: new Set(resolveProductionPlanningRecipeInputPorts(targetRecipeNode).map((input) => input.itemId)),
      outputItemIds: targetItemId.length > 0 ? new Set([targetItemId]) : new Set(),
      isByproduct: false,
      isShared: false,
      isSharedDemandReference: false,
      isPlantCycle: false,
      isPlantCycleReference: false,
      isDeviceMinimumConsumption: false,
      consumedPerMinute: 0,
      sourceRowId: null,
    };
    nextOrder += 1;
    rowById.set(rowId, recipeRow);
    return recipeRow;
  };

  const ensureExternalSupplyRow = (node: ProductionPlanningItemNode): MutableProductionPlanningTreeRow | null => {
    const perMinute = resolveProductionPlanningExternalSupplyPerMinute(node);
    if (perMinute <= PRODUCTION_PLANNING_EPSILON) {
      return null;
    }

    const recipeNode = createProductionPlanningExternalSupplyRecipeNode(node, perMinute);
    return ensureRecipeRow(recipeNode.recipeId ?? recipeNode.candidateId, recipeNode.targetItemId, recipeNode);
  };

  const registerRecipeOutputs = (recipeNode: ProductionPlanningRecipeNode) => {
    for (const output of recipeNode.outputs) {
      if (output.perMinute <= PRODUCTION_PLANNING_EPSILON) {
        continue;
      }
      const row = ensureRecipeRow(recipeNode.recipeId ?? recipeNode.candidateId, output.itemId, recipeNode);
      if (!isProductionPlanningDisposalRecipeId(row.recipeId) && !isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
        addRowIdByItem(producerRowIdsByItem, output.itemId, row.id);
        if (output.itemId !== recipeNode.targetItemId) {
          addRowIdByItem(surplusProducerRowIdsByItem, output.itemId, row.id);
          if (plan.byproductItemIds.has(output.itemId)) {
            byproductRowIds.add(row.id);
          }
        }
      }
    }
  };

  const collectRowsFromItemNode = (node: ProductionPlanningItemNode): void => {
    ensureExternalSupplyRow(node);

    if (node.recipeNode === null) {
      return;
    }

    registerRecipeOutputs(node.recipeNode);
    for (const child of node.recipeNode.inputItems) {
      collectRowsFromItemNode(child);
    }
    for (const child of node.recipeNode.deviceMinimumConsumptionItems) {
      collectRowsFromItemNode(child);
    }
  };

  for (const root of plan.roots) {
    collectRowsFromItemNode(root);
  }

  for (const total of plan.recipeTotals) {
    const targetItemIds = total.outputs.length > 0
      ? total.outputs.map((output) => output.itemId)
      : total.inputs.slice(0, 1).map((input) => input.itemId);

    for (const targetItemId of targetItemIds) {
      const row = ensureRecipeRow(total.recipeId ?? total.candidateId, targetItemId, null);
      for (const input of total.inputs) {
        row.inputItemIds.add(input.itemId);
      }
      row.outputItemIds.add(targetItemId);
      if (
        total.outputs.some((output) => output.itemId === targetItemId)
        && !isProductionPlanningDisposalRecipeId(total.recipeId ?? total.candidateId)
      ) {
        addRowIdByItem(producerRowIdsByItem, targetItemId, row.id);
      }
    }
  }

  const addProducerEdges = (
    parentRow: MutableProductionPlanningTreeRow,
    itemId: string,
    producerRowIdsByItemMap: ReadonlyMap<string, ReadonlySet<string>>,
  ) => {
    const producerRowIds = producerRowIdsByItemMap.get(itemId);
    if (producerRowIds === undefined) {
      return;
    }

    for (const producerRowId of producerRowIds) {
      addProductionPlanningTreeEdge(rowById, parentRow.id, producerRowId);
    }
  };

  const connectItemSources = (
    node: ProductionPlanningItemNode,
    parentRow: MutableProductionPlanningTreeRow,
  ): void => {
    parentRow.inputItemIds.add(node.itemId);

    const externalRow = ensureExternalSupplyRow(node);
    if (externalRow !== null) {
      addProductionPlanningTreeEdge(rowById, parentRow.id, externalRow.id);
    }

    if (node.supply.surplus > PRODUCTION_PLANNING_EPSILON) {
      addProducerEdges(parentRow, node.itemId, surplusProducerRowIdsByItem);
    }

    if (node.isCycleSource && !node.blockedByCycle && node.supply.cycle <= PRODUCTION_PLANNING_EPSILON) {
      addProducerEdges(parentRow, node.itemId, producerRowIdsByItem);
      for (const rowId of producerRowIdsByItem.get(node.itemId) ?? []) {
        plantCycleSourceRowIds.add(rowId);
      }
    }

    if (node.recipeNode !== null) {
      const childRow = ensureRecipeRow(
        node.recipeNode.recipeId ?? node.recipeNode.candidateId,
        node.recipeNode.targetItemId,
        node.recipeNode,
      );
      addProductionPlanningTreeEdge(rowById, parentRow.id, childRow.id);
      connectRecipeInputs(node.recipeNode);
    }
  };

  function connectRecipeInputs(recipeNode: ProductionPlanningRecipeNode): void {
    const parentRow = ensureRecipeRow(
      recipeNode.recipeId ?? recipeNode.candidateId,
      recipeNode.targetItemId,
      recipeNode,
    );
    for (const child of recipeNode.inputItems) {
      connectItemSources(child, parentRow);
    }
    for (const [index, input] of recipeNode.deviceMinimumConsumptionInputs.entries()) {
      const consumptionItem = recipeNode.deviceMinimumConsumptionItems[index];
      if (consumptionItem === undefined) {
        continue;
      }

      const consumptionNode = createProductionPlanningTreeDeviceMinimumConsumptionRecipeNode(recipeNode, input);
      const consumptionRow = ensureRecipeRow(
        consumptionNode.recipeId ?? consumptionNode.candidateId,
        input.itemId,
        consumptionNode,
        `${parentRow.id}:device-minimum-consumption:${input.itemId}`,
      );
      addProductionPlanningTreeEdge(rowById, parentRow.id, consumptionRow.id);
      if (
        consumptionItem.isCycleSource
        && consumptionItem.itemId === recipeNode.targetItemId
      ) {
        addProductionPlanningTreeEdge(rowById, consumptionRow.id, parentRow.id);
      } else {
        connectItemSources(consumptionItem, consumptionRow);
      }
    }
  }

  for (const root of plan.roots) {
    if (root.recipeNode !== null) {
      connectRecipeInputs(root.recipeNode);
    } else {
      ensureExternalSupplyRow(root);
    }
  }

  markLedgerByproductRows(rowById, byproductRowIds);
  connectDisposalRowsToByproductSources(rowById, surplusProducerRowIdsByItem, plan, nextOrder);
  connectWaterPurifierRowToSewageSources(rowById, surplusProducerRowIdsByItem, plan);
  const rootSourceRowIds = new Set<string>();
  for (const root of plan.roots) {
    if (resolveProductionPlanningExternalSupplyPerMinute(root) > PRODUCTION_PLANNING_EPSILON) {
      rootSourceRowIds.add(buildProductionPlanningTreeDeviceProductRowId(
        buildProductionPlanningExternalSupplyRecipeId(root.itemId),
        root.itemId,
      ));
    }
    if (root.recipeNode !== null) {
      rootSourceRowIds.add(buildProductionPlanningTreeDeviceProductRowId(
        root.recipeNode.recipeId ?? root.recipeNode.candidateId,
        root.recipeNode.targetItemId,
      ));
    }
  }
  normalizeProductionPlanningTreePlantCycles(rowById, rootSourceRowIds, plantCycleSourceRowIds);
  normalizeProductionPlanningTreeDemandRows(rowById, rootSourceRowIds);

  const rootRowIds = new Set(
    Array.from(rowById.values())
      .filter((row) => row.parentIds.size !== 1)
      .map((row) => row.id),
  );

  return finalizeProductionPlanningTreeRows(rowById, rootRowIds);
}

/** 先把自持循环投影为有限树；循环外入口保留真实节点，内部闭合边用循环引用表达。 */
function normalizeProductionPlanningTreePlantCycles(
  rowById: Map<string, MutableProductionPlanningTreeRow>,
  rootSourceRowIds: ReadonlySet<string>,
  plantCycleSourceRowIds: ReadonlySet<string>,
): void {
  const collectReachable = (startId: string, direction: "parentIds" | "childIds"): Set<string> => {
    const result = new Set<string>();
    const pending = [startId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (result.has(id)) continue;
      result.add(id);
      for (const nextId of rowById.get(id)?.[direction] ?? []) pending.push(nextId);
    }
    return result;
  };
  const processed = new Set<string>();
  let nextOrder = Math.max(0, ...Array.from(rowById.values()).map((row) => row.order + 1));
  // 在修改连边前找齐循环分量，避免前一个循环的投影影响后续识别。
  const components: Set<string>[] = [];
  for (const sourceId of plantCycleSourceRowIds) {
    if (processed.has(sourceId)) continue;
    const descendants = collectReachable(sourceId, "childIds");
    const ancestors = collectReachable(sourceId, "parentIds");
    const component = new Set(Array.from(descendants).filter((id) => ancestors.has(id)));
    if (component.size < 2) continue;
    for (const id of component) processed.add(id);
    components.push(component);
  }

  for (const component of components) {
    const rows = Array.from(component, (id) => rowById.get(id)!).sort(compareMutableProductionPlanningTreeRows);
    const entryIds = new Set(rows.filter((row) => rootSourceRowIds.has(row.id)
      || Array.from(row.parentIds).some((id) => !component.has(id))).map((row) => row.id));
    const visited = new Set<string>();
    const visit = (row: MutableProductionPlanningTreeRow): void => {
      if (visited.has(row.id)) return;
      visited.add(row.id);
      row.isPlantCycle = true;
      for (const childId of Array.from(row.childIds)) {
        if (!component.has(childId)) continue;
        const child = rowById.get(childId)!;
        if (!entryIds.has(childId) && !visited.has(childId)) {
          visit(child);
          continue;
        }
        const reference = createProductionPlanningTreeDemandReferenceRow({
          parentRow: row, sourceRow: child,
          consumedPerMinute: resolveProductionPlanningTreeRowConsumedPerMinute(row, child.targetItemId),
          isDeviceMinimumConsumption: false, isPlantCycleReference: true, order: nextOrder++,
        });
        removeProductionPlanningTreeEdge(rowById, row.id, child.id);
        rowById.set(reference.id, reference);
        addProductionPlanningTreeEdge(rowById, row.id, reference.id);
        child.demandReferenceIds.add(reference.id);
      }
    };
    for (const row of rows) if (entryIds.has(row.id)) visit(row);
    for (const row of rows) visit(row);
  }
}

function normalizeProductionPlanningTreeDemandRows(
  rowById: Map<string, MutableProductionPlanningTreeRow>,
  rootSourceRowIds: ReadonlySet<string>,
): void {
  let nextOrder = Math.max(0, ...Array.from(rowById.values()).map((row) => row.order + 1));
  const minimumRowsReplacedBySharedReferences = new Set<string>();
  const sharedSourceRows = Array.from(rowById.values()).filter((row) => {
    if (isProductionPlanningDeviceMinimumConsumptionRecipeId(row.recipeId)) {
      return false;
    }

    const hasSelfMinimumConsumption = Array.from(row.parentIds).some((parentId) => {
      const parent = rowById.get(parentId);
      return parent !== undefined
        && isProductionPlanningDeviceMinimumConsumptionRecipeId(parent.recipeId)
        && parent.parentIds.has(row.id);
    });
    return row.parentIds.size > 1
      || (rootSourceRowIds.has(row.id) && row.parentIds.size > 0)
      || hasSelfMinimumConsumption;
  });

  for (const sourceRow of sharedSourceRows) {
    sourceRow.isShared = true;
    for (const parentId of Array.from(sourceRow.parentIds)) {
      const parentRow = rowById.get(parentId);
      if (parentRow === undefined) {
        continue;
      }

      const isMinimumConsumption = isProductionPlanningDeviceMinimumConsumptionRecipeId(parentRow.recipeId);
      const demandParentIds = isMinimumConsumption ? Array.from(parentRow.parentIds) : [parentRow.id];
      const consumedPerMinute = resolveProductionPlanningTreeRowConsumedPerMinute(
        parentRow,
        sourceRow.targetItemId,
      );

      removeProductionPlanningTreeEdge(rowById, parentRow.id, sourceRow.id);
      for (const demandParentId of demandParentIds) {
        const demandParent = rowById.get(demandParentId);
        if (demandParent === undefined) {
          continue;
        }

        const referenceRow = createProductionPlanningTreeDemandReferenceRow({
          parentRow: demandParent,
          sourceRow,
          consumedPerMinute,
          isDeviceMinimumConsumption: isMinimumConsumption,
          order: nextOrder,
        });
        nextOrder += 1;
        rowById.set(referenceRow.id, referenceRow);
        addProductionPlanningTreeEdge(rowById, demandParent.id, referenceRow.id);
        sourceRow.demandReferenceIds.add(referenceRow.id);
      }

      if (isMinimumConsumption) {
        minimumRowsReplacedBySharedReferences.add(parentRow.id);
      }
    }
  }

  for (const minimumRow of Array.from(rowById.values())) {
    if (!isProductionPlanningDeviceMinimumConsumptionRecipeId(minimumRow.recipeId)) {
      continue;
    }

    const hostParentIds = Array.from(minimumRow.parentIds);
    const sourceChildIds = Array.from(minimumRow.childIds);
    if (
      sourceChildIds.length === 0
      && !minimumRowsReplacedBySharedReferences.has(minimumRow.id)
    ) {
      continue;
    }

    for (const hostParentId of hostParentIds) {
      removeProductionPlanningTreeEdge(rowById, hostParentId, minimumRow.id);
    }

    for (const sourceChildId of sourceChildIds) {
      const sourceRow = rowById.get(sourceChildId);
      if (sourceRow === undefined) {
        continue;
      }

      removeProductionPlanningTreeEdge(rowById, minimumRow.id, sourceRow.id);
      sourceRow.isDeviceMinimumConsumption = true;
      sourceRow.consumedPerMinute = resolveProductionPlanningTreeRowConsumedPerMinute(
        minimumRow,
        sourceRow.targetItemId,
      );
      for (const hostParentId of hostParentIds) {
        addProductionPlanningTreeEdge(rowById, hostParentId, sourceRow.id);
      }
    }

    if (sourceChildIds.length > 0 || minimumRowsReplacedBySharedReferences.has(minimumRow.id)) {
      rowById.delete(minimumRow.id);
    }
  }
}


function createProductionPlanningTreeDemandReferenceRow({
  parentRow,
  sourceRow,
  consumedPerMinute,
  isDeviceMinimumConsumption,
  isPlantCycleReference = false,
  order,
}: {
  parentRow: MutableProductionPlanningTreeRow;
  sourceRow: MutableProductionPlanningTreeRow;
  consumedPerMinute: number;
  isDeviceMinimumConsumption: boolean;
  isPlantCycleReference?: boolean;
  order: number;
}): MutableProductionPlanningTreeRow {
  const recipeId = `${isPlantCycleReference ? "plant-cycle:" : SHARED_DEMAND_RECIPE_ID_PREFIX}${sourceRow.recipeId}`;
  const rowId = `${parentRow.id}:${recipeId}:target:${sourceRow.targetItemId}:${isDeviceMinimumConsumption ? "minimum" : "input"}`;
  const recipeNode = createProductionPlanningTreeDemandRecipeNode(
    rowId,
    recipeId,
    sourceRow.targetItemId,
    consumedPerMinute,
  );

  return {
    id: rowId,
    depth: 0,
    order,
    parentIds: new Set(),
    childIds: new Set(),
    demandReferenceIds: new Set(),
    recipeId,
    targetItemId: sourceRow.targetItemId,
    recipeNode,
    recipeNodes: [recipeNode],
    total: null,
    inputItemIds: new Set([sourceRow.targetItemId]),
    outputItemIds: new Set(),
    isByproduct: false,
    isShared: false,
    isSharedDemandReference: !isPlantCycleReference,
    isPlantCycle: isPlantCycleReference,
    isPlantCycleReference,
    isDeviceMinimumConsumption,
    consumedPerMinute,
    sourceRowId: sourceRow.id,
  };
}

function createProductionPlanningTreeDemandRecipeNode(
  rowId: string,
  recipeId: string,
  itemId: string,
  consumedPerMinute: number,
): ProductionPlanningRecipeNode {
  return {
    id: `${rowId}:recipe-node`,
    kind: "recipe",
    candidateId: recipeId,
    candidateSourceType: "system-recipe",
    module: null,
    recipeId,
    targetItemId: itemId,
    durationSeconds: 0,
    cyclesPerMinute: 0,
    deviceCount: 0,
    inputs: [{
      id: `${rowId}:input:${itemId}`,
      itemId,
      perMinute: consumedPerMinute,
    }],
    deviceMinimumConsumptionInputs: [],
    outputs: [],
    inputItems: [],
    deviceMinimumConsumptionItems: [],
  };
}

function resolveProductionPlanningTreeRowConsumedPerMinute(
  row: MutableProductionPlanningTreeRow,
  itemId: string,
): number {
  return resolveProductionPlanningRecipeInputPorts(row.recipeNode)
    .find((input) => input.itemId === itemId)?.perMinute
    ?? row.recipeNode.inputs.find((input) => input.itemId === itemId)?.perMinute
    ?? row.total?.inputs.find((input) => input.itemId === itemId)?.perMinute
    ?? 0;
}

function createProductionPlanningTreeTargetedRecipeNode(
  recipeNode: ProductionPlanningRecipeNode,
  targetItemId: string,
): ProductionPlanningRecipeNode {
  if (recipeNode.targetItemId === targetItemId) {
    return recipeNode;
  }

  return {
    ...recipeNode,
    id: `${recipeNode.id}:target:${targetItemId}`,
    targetItemId,
  };
}

function markLedgerByproductRows(
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
  byproductRowIds: ReadonlySet<string>,
): void {
  for (const row of rowById.values()) {
    row.isByproduct = byproductRowIds.has(row.id) || isProductionPlanningDisposalRecipeId(row.recipeId);
  }
}

function connectDisposalRowsToByproductSources(
  rowById: Map<string, MutableProductionPlanningTreeRow>,
  producerRowIdsByItem: ReadonlyMap<string, ReadonlySet<string>>,
  plan: ProductionPlanningResult,
  nextOrderStart: number,
): void {
  let nextOrder = nextOrderStart;

  for (const row of Array.from(rowById.values())) {
    if (!isProductionPlanningDisposalRecipeId(row.recipeId)) {
      continue;
    }

    const itemId = row.targetItemId || row.recipeNode.inputs[0]?.itemId || row.total?.inputs[0]?.itemId || "";
    if (itemId.length === 0 || !plan.byproductItemIds.has(itemId)) {
      continue;
    }

    const producerRowIds = producerRowIdsByItem.get(itemId);
    if (producerRowIds === undefined) {
      continue;
    }

    for (const producerRowId of producerRowIds) {
      const producerRow = rowById.get(producerRowId);
      if (producerRow === undefined || producerRow.id === row.id) {
        continue;
      }

      if (producerRow.parentIds.size === 0) {
        addProductionPlanningTreeEdge(rowById, row.id, producerRow.id);
        producerRow.isByproduct = true;
        continue;
      }

      const cloneRowId = buildProductionPlanningTreeDisposalSourceRowId(row.id, producerRow.id);
      if (rowById.has(cloneRowId)) {
        addProductionPlanningTreeEdge(rowById, row.id, cloneRowId);
        continue;
      }

      const cloneRow: MutableProductionPlanningTreeRow = {
        id: cloneRowId,
        depth: 0,
        order: nextOrder,
        parentIds: new Set(),
        childIds: new Set(),
        demandReferenceIds: new Set(),
        recipeId: producerRow.recipeId,
        targetItemId: producerRow.targetItemId,
        recipeNode: producerRow.recipeNode,
        recipeNodes: [...producerRow.recipeNodes],
        total: producerRow.total,
        inputItemIds: new Set(producerRow.inputItemIds),
        outputItemIds: new Set([producerRow.targetItemId]),
        isByproduct: true,
        isShared: false,
        isSharedDemandReference: false,
        isPlantCycle: false,
        isPlantCycleReference: false,
        isDeviceMinimumConsumption: false,
        consumedPerMinute: 0,
        sourceRowId: null,
      };
      nextOrder += 1;
      rowById.set(cloneRowId, cloneRow);
      addProductionPlanningTreeEdge(rowById, row.id, cloneRow.id);
    }
  }
}

function connectWaterPurifierRowToSewageSources(
  rowById: Map<string, MutableProductionPlanningTreeRow>,
  producerRowIdsByItem: ReadonlyMap<string, ReadonlySet<string>>,
  plan: ProductionPlanningResult,
): void {
  const sewageItemId = "item_liquid_sewage";
  // 只要仍有污水需要处置，就维持“废水处理机 -> 污水来源”的现有树关系。
  if (plan.byproductItemIds.has(sewageItemId)) {
    return;
  }

  const waterPurifierRow = Array.from(rowById.values()).find((row) => (
    row.recipeId === WATER_PURIFIER_BYPRODUCT_RECIPE_ID
    && row.recipeNode.inputs.some((input) => (
      input.itemId === sewageItemId && input.perMinute > PRODUCTION_PLANNING_EPSILON
    ))
  ));
  const producerRowIds = producerRowIdsByItem.get(sewageItemId);
  if (waterPurifierRow === undefined || producerRowIds === undefined) {
    return;
  }

  let nextOrder = Math.max(0, ...Array.from(rowById.values()).map((row) => row.order + 1));
  for (const producerRowId of producerRowIds) {
    const producerRow = rowById.get(producerRowId);
    if (producerRow === undefined || producerRow.id === waterPurifierRow.id) {
      continue;
    }

    if (producerRow.parentIds.size === 0) {
      addProductionPlanningTreeEdge(rowById, waterPurifierRow.id, producerRow.id);
      continue;
    }

    const cloneRowId = buildProductionPlanningTreeWaterPurifierSourceRowId(
      waterPurifierRow.id,
      producerRow.id,
    );
    if (rowById.has(cloneRowId)) {
      addProductionPlanningTreeEdge(rowById, waterPurifierRow.id, cloneRowId);
      continue;
    }

    const cloneRow: MutableProductionPlanningTreeRow = {
      id: cloneRowId,
      depth: 0,
      order: nextOrder,
      parentIds: new Set(),
      childIds: new Set(),
      demandReferenceIds: new Set(),
      recipeId: producerRow.recipeId,
      targetItemId: producerRow.targetItemId,
      recipeNode: producerRow.recipeNode,
      recipeNodes: [...producerRow.recipeNodes],
      total: producerRow.total,
      inputItemIds: new Set(producerRow.inputItemIds),
      outputItemIds: new Set(producerRow.outputItemIds),
      isByproduct: producerRow.isByproduct,
      isShared: false,
      isSharedDemandReference: false,
      isPlantCycle: false,
      isPlantCycleReference: false,
      isDeviceMinimumConsumption: false,
      consumedPerMinute: 0,
      sourceRowId: null,
    };
    nextOrder += 1;
    rowById.set(cloneRowId, cloneRow);
    addProductionPlanningTreeEdge(rowById, waterPurifierRow.id, cloneRow.id);
  }
}

function isProductionPlanningDisposalRecipeId(recipeId: string): boolean {
  return recipeId.startsWith("r_dumper_void_") || recipeId.startsWith("r_chrono_wastewater_treatment");
}

function buildProductionPlanningTreeDisposalSourceRowId(disposalRowId: string, producerRowId: string): string {
  return `disposal-source:${disposalRowId}:${producerRowId}`;
}

function buildProductionPlanningTreeWaterPurifierSourceRowId(
  waterPurifierRowId: string,
  producerRowId: string,
): string {
  return `water-purifier-source:${waterPurifierRowId}:${producerRowId}`;
}




function finalizeProductionPlanningTreeRows(
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
  rootRowIds: ReadonlySet<string>,
): ProductionPlanningTreeRow[] {
  const result: ProductionPlanningTreeRow[] = [];
  const emittedRowIds = new Set<string>();
  const orderedRows = Array.from(rowById.values()).sort(compareMutableProductionPlanningTreeRows);

  const emitRow = (row: MutableProductionPlanningTreeRow, depth: number) => {
    if (emittedRowIds.has(row.id)) {
      return;
    }

    emittedRowIds.add(row.id);
    result.push(finalizeProductionPlanningTreeRow(row, depth, rowById));

    const childRows = Array.from(row.childIds)
      .map((childId) => rowById.get(childId) ?? null)
      .filter((childRow): childRow is MutableProductionPlanningTreeRow => childRow !== null && childRow.parentIds.size === 1)
      .sort(compareMutableProductionPlanningTreeRows);
    for (const childRow of childRows) {
      emitRow(childRow, depth + 1);
    }
  };

  for (const row of orderedRows) {
    if (rootRowIds.has(row.id)) {
      emitRow(row, 0);
    }
  }

  for (const row of orderedRows) {
    emitRow(row, 0);
  }

  return result;
}

function resolveProductionPlanningRecipeDisplayFlow(row: ProductionPlanningTreeRow): number {
  const itemId = resolveProductionPlanningRecipeDisplayItemId(row);
  if (itemId !== null) {
    const outputPort = row.total?.outputs.find((port) => port.itemId === itemId)
      ?? row.recipeNode.outputs.find((port) => port.itemId === itemId);
    if (outputPort !== undefined) {
      return outputPort.perMinute;
    }
  }

  return row.total?.outputs[0]?.perMinute
    ?? row.recipeNode.outputs[0]?.perMinute
    ?? row.total?.inputs[0]?.perMinute
    ?? row.recipeNode.inputs[0]?.perMinute
    ?? row.total?.cyclesPerMinute
    ?? row.recipeNode.cyclesPerMinute;
}

function resolveProductionPlanningRecipeDisplayItemId(row: ProductionPlanningTreeRow): string | null {
  if (
    row.recipeNode.targetItemId.length > 0
    && (row.outputItemIds.includes(row.recipeNode.targetItemId)
      || row.total?.outputs.some((port) => port.itemId === row.recipeNode.targetItemId)
      || row.recipeNode.outputs.some((port) => port.itemId === row.recipeNode.targetItemId))
  ) {
    return row.recipeNode.targetItemId;
  }

  return row.outputItemIds[0]
    ?? row.total?.outputs[0]?.itemId
    ?? row.recipeNode.outputs[0]?.itemId
    ?? row.total?.inputs[0]?.itemId
    ?? row.recipeNode.inputs[0]?.itemId
    ?? null;
}

function resolveProductionPlanningLogisticsKind(
  itemId: string,
  index: ProductionPlanningIndex,
): LogisticsKind {
  const tags = index.itemById.get(itemId)?.tags ?? [];
  return tags.includes("liquid") || tags.includes("gas")
    ? LOGISTICS_KIND.pipe
    : LOGISTICS_KIND.belt;
}

function resolveProductionPlanningLogisticsThroughput(kind: LogisticsKind): number {
  const secondsPerCell = kind === LOGISTICS_KIND.pipe
    ? PIPE_TRANSPORT_DURATION_SECONDS
    : BELT_TRANSPORT_DURATION_SECONDS;
  const itemsPerCycle = 1;
  return (60 * itemsPerCycle) / secondsPerCell;
}



function finalizeProductionPlanningTreeRow(
  row: MutableProductionPlanningTreeRow,
  depth: number,
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
): ProductionPlanningTreeRow {
  const parentIds = sortProductionPlanningTreeRowIds(row.parentIds, rowById);
  const childIds = sortProductionPlanningTreeRowIds(row.childIds, rowById);

  return {
    id: row.id,
    depth,
    parentIds,
    childIds,
    demandReferenceIds: sortProductionPlanningTreeRowIds(row.demandReferenceIds, rowById),
    recipeId: row.recipeId,
    targetItemId: row.targetItemId,
    recipeNode: row.recipeNode,
    recipeNodes: row.recipeNodes,
    total: row.total,
    inputItemIds: sortProductionPlanningTreeItemIds(row.inputItemIds, rowById),
    outputItemIds: sortProductionPlanningTreeItemIds(row.outputItemIds, rowById),
    isByproduct: row.isByproduct,
    isShared: row.isShared,
    isSharedDemandReference: row.isSharedDemandReference,
    isPlantCycle: row.isPlantCycle,
    isPlantCycleReference: row.isPlantCycleReference,
    isDeviceMinimumConsumption: row.isDeviceMinimumConsumption,
    consumedPerMinute: row.consumedPerMinute,
    sourceRowId: row.sourceRowId,
  };
}

function addProductionPlanningTreeEdge(
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
  parentId: string,
  childId: string,
): void {
  if (parentId === childId) {
    return;
  }

  const parent = rowById.get(parentId);
  const child = rowById.get(childId);
  if (parent === undefined || child === undefined) {
    return;
  }

  parent.childIds.add(childId);
  child.parentIds.add(parentId);
}

function removeProductionPlanningTreeEdge(
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
  parentId: string,
  childId: string,
): void {
  rowById.get(parentId)?.childIds.delete(childId);
  rowById.get(childId)?.parentIds.delete(parentId);
}



function buildProductionPlanningTreeDeviceProductRowId(recipeId: string, targetItemId: string): string {
  return `recipe:${recipeId}:target:${targetItemId}`;
}


function createProductionPlanningTreeSyntheticRecipeNode(
  recipeId: string,
  total: ProductionPlanningResult["recipeTotals"][number] | null,
  fallback: ProductionPlanningRecipeNode | null,
  targetItemId: string = fallback?.targetItemId ?? total?.outputs[0]?.itemId ?? total?.inputs[0]?.itemId ?? "",
): ProductionPlanningRecipeNode {
  if (total === null) {
    return fallback ?? {
      id: `total:${recipeId}`,
      kind: "recipe",
      candidateId: recipeId,
      candidateSourceType: "system-recipe",
      module: null,
      recipeId,
      targetItemId,
      durationSeconds: 0,
      cyclesPerMinute: 0,
      deviceCount: 0,
      inputs: [],
      deviceMinimumConsumptionInputs: [],
      outputs: [],
      inputItems: [],
      deviceMinimumConsumptionItems: [],
    };
  }

  return {
    id: fallback?.id ?? `total:${recipeId}`,
    kind: "recipe",
    candidateId: total.candidateId,
    candidateSourceType: total.candidateSourceType,
    module: total.module,
    recipeId: total.recipeId,
    targetItemId,
    durationSeconds: total.durationSeconds,
    cyclesPerMinute: total.cyclesPerMinute,
    deviceCount: total.deviceCount,
    inputs: total.inputs.map(clonePort),
    deviceMinimumConsumptionInputs: total.deviceMinimumConsumptionInputs.map(clonePort),
    outputs: total.outputs.map(clonePort),
    inputItems: fallback?.inputItems ?? [],
    deviceMinimumConsumptionItems: fallback?.deviceMinimumConsumptionItems ?? [],
  };
}

function mergeProductionPlanningTreeRecipeNodes(
  left: ProductionPlanningRecipeNode,
  right: ProductionPlanningRecipeNode,
): ProductionPlanningRecipeNode {
  return {
    id: left.id,
    kind: "recipe",
    candidateId: left.candidateId,
    candidateSourceType: left.candidateSourceType,
    module: left.module,
    recipeId: left.recipeId,
    targetItemId: left.targetItemId,
    durationSeconds: left.durationSeconds || right.durationSeconds,
    cyclesPerMinute: left.cyclesPerMinute + right.cyclesPerMinute,
    deviceCount: left.deviceCount + right.deviceCount,
    inputs: mergeProductionPlanningTreePorts(left.inputs, right.inputs),
    deviceMinimumConsumptionInputs: mergeProductionPlanningTreePorts(
      left.deviceMinimumConsumptionInputs,
      right.deviceMinimumConsumptionInputs,
    ),
    outputs: mergeProductionPlanningTreePorts(left.outputs, right.outputs),
    inputItems: left.inputItems,
    deviceMinimumConsumptionItems: left.deviceMinimumConsumptionItems,
  };
}

function mergeProductionPlanningTreePorts(
  left: readonly ProductionPlanningPort[],
  right: readonly ProductionPlanningPort[],
): ProductionPlanningPort[] {
  const result = new Map<string, ProductionPlanningPort>();
  for (const port of [...left, ...right]) {
    const existing = result.get(port.itemId);
    if (existing === undefined) {
      result.set(port.itemId, clonePort(port));
      continue;
    }

    result.set(port.itemId, {
      ...existing,
      perMinute: existing.perMinute + port.perMinute,
    });
  }
  return Array.from(result.values());
}

function compareMutableProductionPlanningTreeRows(
  left: MutableProductionPlanningTreeRow,
  right: MutableProductionPlanningTreeRow,
): number {
  return left.order - right.order;
}

function sortProductionPlanningTreeRowIds(
  rowIds: ReadonlySet<string>,
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
): string[] {
  return Array.from(rowIds).sort((left, right) => {
    const leftRow = rowById.get(left);
    const rightRow = rowById.get(right);
    return (leftRow?.order ?? Number.MAX_SAFE_INTEGER) - (rightRow?.order ?? Number.MAX_SAFE_INTEGER);
  });
}

function sortProductionPlanningTreeItemIds(
  itemIds: ReadonlySet<string>,
  _rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
): string[] {
  return Array.from(itemIds).sort((left, right) => left.localeCompare(right));
}

function uniqueProductionPlanningTreeRowIds(rowIds: readonly string[]): string[] {
  return Array.from(new Set(rowIds));
}

function resolveProductionPlanningTreeRowTitle(
  row: ProductionPlanningTreeRow,
  index: ProductionPlanningIndex,
  t: (key: string) => string,
): string {
  if (row.isSharedDemandReference || row.isPlantCycleReference) {
    const itemName = resolveProductionPlanningItemName(row.targetItemId, index, t);
    const demandLabel = row.isDeviceMinimumConsumption
      ? `${t("productionPlanning.minimumConsumption")} · ${t("productionPlanning.sharedDemand")}`
      : t(row.isPlantCycleReference ? "productionPlanning.plantCycle" : "productionPlanning.sharedDemand");
    return `${itemName} · ${demandLabel}`;
  }

  const isExternal = isProductionPlanningExternalSupplyRecipeId(row.recipeId);
  if (isProductionPlanningDeviceMinimumConsumptionRecipeId(row.recipeId)) {
    return `${t("productionPlanning.deviceMinimumConsumptionNode")} · ${resolveProductionPlanningItemName(row.targetItemId, index, t)}`;
  }
  const recipe = index.recipeById.get(row.recipeId);
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const title = isExternal
    ? t("productionPlanning.externalSupply")
    : machine === null ? row.recipeId : t(machine.nameKey);
  const productName = row.targetItemId.length > 0 ? resolveProductionPlanningItemName(row.targetItemId, index, t) : null;
  const normalTitle = productName === null ? title : `${title} · ${productName}`;
  return row.isDeviceMinimumConsumption
    ? `${t("productionPlanning.minimumConsumption")} · ${normalTitle}`
    : normalTitle;
}

function FlowGraph({
  appHost,
  displayMode,
  invertWheelZoom,
  flowViewport,
  plan,
  index,
  recipeChoices: _recipeChoices,
  onFlowViewportChange,
  onSelectRecipe: _onSelectRecipe,
  onRequestRecipeSelection: _onRequestRecipeSelection,
  t,
}: {
  appHost: AppHost;
  displayMode: ProductionPlanningDisplayMode;
  invertWheelZoom: boolean;
  flowViewport: PlannerFlowViewportState;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  onFlowViewportChange: (viewport: PlannerFlowViewportState) => void;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  onRequestRecipeSelection: (itemId: string, recipes: readonly RecipeDefinition[]) => void;
  t: (key: string) => string;
}) {
  const [actionTarget, setActionTarget] = useState<RecipeActionTarget | null>(null);
  const closeActionMenu = useCallback(() => setActionTarget(null), []);
  if (plan.roots.length === 0) {
    return <div className={cm(styles, "production-planning-empty")}>{t("productionPlanning.noRecipes")}</div>;
  }

  return (
    <>
      <ProductionFlowGraph
        displayMode={displayMode}
        invertWheelZoom={invertWheelZoom}
        initialViewport={isDefaultPlannerViewport(flowViewport) ? undefined : flowViewport}
        plan={plan}
        index={index}
        onNodeActivate={(node, anchor) => setActionTarget(resolveFlowNodeActionTarget(node, anchor))}
        onViewportChange={onFlowViewportChange}
        t={t}
      />
      {actionTarget === null ? null : (
        <RecipeActionMenu
          appHost={appHost}
          index={index}
          onClose={closeActionMenu}
          t={t}
          target={actionTarget}
        />
      )}
    </>
  );
}



function resolveProductionPlanningExternalSupplyPerMinute(node: ProductionPlanningItemNode): number {
  return node.supply.manual + node.supply.infinite + node.supply.cycle;
}

function buildProductionPlanningExternalSupplyRecipeId(itemId: string): string {
  return `${EXTERNAL_SUPPLY_RECIPE_ID_PREFIX}${itemId}`;
}

function isProductionPlanningExternalSupplyRecipeId(recipeId: string): boolean {
  return recipeId.startsWith(EXTERNAL_SUPPLY_RECIPE_ID_PREFIX);
}

function createProductionPlanningExternalSupplyRecipeNode(
  node: ProductionPlanningItemNode,
  perMinute: number,
): ProductionPlanningRecipeNode {
  return {
    id: `${EXTERNAL_SUPPLY_RECIPE_ID_PREFIX}${node.id}`,
    kind: "recipe",
    candidateId: buildProductionPlanningExternalSupplyRecipeId(node.itemId),
    candidateSourceType: "system-recipe",
    module: null,
    recipeId: buildProductionPlanningExternalSupplyRecipeId(node.itemId),
    targetItemId: node.itemId,
    durationSeconds: 0,
    cyclesPerMinute: 0,
    deviceCount: 0,
    inputs: [],
    deviceMinimumConsumptionInputs: [],
    outputs: [{ id: `${node.id}-external-supply-out-${node.itemId}`, itemId: node.itemId, perMinute }],
    inputItems: [],
    deviceMinimumConsumptionItems: [],
  };
}

function createProductionPlanningTreeDeviceMinimumConsumptionRecipeNode(
  hostRecipeNode: ProductionPlanningRecipeNode,
  input: ProductionPlanningPort,
): ProductionPlanningRecipeNode {
  const recipeId = buildProductionPlanningDeviceMinimumConsumptionRecipeId(
    hostRecipeNode.recipeId ?? hostRecipeNode.candidateId,
  );
  return {
    id: `${recipeId}:${hostRecipeNode.id}:${input.itemId}`,
    kind: "recipe",
    candidateId: recipeId,
    candidateSourceType: "system-recipe",
    module: null,
    recipeId,
    targetItemId: input.itemId,
    durationSeconds: 0,
    cyclesPerMinute: 0,
    deviceCount: 0,
    inputs: [clonePort(input)],
    deviceMinimumConsumptionInputs: [],
    outputs: [],
    inputItems: [],
    deviceMinimumConsumptionItems: [],
  };
}



function resolveProductionPlanningExternalSupplyIconSrc(): string {
  return createPublicAssetUrl(`3d-top-view/sprites/${EXTERNAL_SUPPLY_ENTITY_ID}.webp`);
}



function PortChipList({
  title,
  ports,
  index,
  t,
}: {
  title: string;
  ports: readonly ProductionPlanningPort[];
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-port-chip-list")}>
      <span>{title}</span>
      <div>
        {ports.length === 0 ? (
          <span className={cm(styles, "production-planning-muted")}>{t("productionPlanning.none")}</span>
        ) : ports.map((port) => (
          <span key={`${port.id}-${port.itemId}`} className={cm(styles, "production-planning-port-chip")}>
            <img alt="" src={resolveProductionPlanningItemIconSrc(port.itemId, index)} />
            <span>{resolveProductionPlanningItemName(port.itemId, index, t)}</span>
            <strong>{formatProductionFlow(port.perMinute)}/min</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function hasInactiveProductionPlanningContent(
  store: ProductionPlanningInputStore,
  registry: AppHost["workspace"]["registry"],
  activeActivityIds: readonly string[],
): boolean {
  const itemById = new Map(registry.itemDefinitions.map((item) => [item.id, item]));
  const recipeById = new Map(registry.recipeDefinitions.map((recipe) => [recipe.id, recipe]));
  const hasInactivePortItem = [...store.targets, ...store.supplies].some((port) => {
    const item = itemById.get(port.itemId);
    return item !== undefined && !isItemAvailableByActivity(item, activeActivityIds);
  });

  if (hasInactivePortItem) {
    return true;
  }

  return Object.values(store.recipeChoices).some((candidateId) => {
    if (candidateId.startsWith("module:")) {
      return false;
    }
    const recipeId = candidateId.startsWith("recipe:")
      ? candidateId.slice("recipe:".length)
      : candidateId;
    const recipe = recipeById.get(recipeId);
    return recipe !== undefined && !isRecipeAvailableByActivity(recipe, activeActivityIds);
  });
}

function createPort(itemId: string, perMinute: number): ProductionPlanningPort {
  return {
    id: createProductionPlanningId("port"),
    itemId,
    perMinute,
  };
}

function clonePort(port: ProductionPlanningPort): ProductionPlanningPort {
  return {
    id: port.id,
    itemId: port.itemId,
    perMinute: port.perMinute,
    ...(port.isInfinite === true ? { isInfinite: true } : {}),
  };
}

function updateRecipeChoices(
  current: Readonly<Record<string, string>>,
  itemId: string,
  recipeId: string | null,
): Record<string, string> {
  const next = { ...current };
  if (recipeId === null) {
    delete next[itemId];
  } else {
    next[itemId] = recipeId;
  }
  return next;
}

function updatePort(
  ports: readonly ProductionPlanningPort[],
  id: string,
  patch: Partial<ProductionPlanningPort>,
): ProductionPlanningPort[] {
  return ports.map((port) => port.id === id ? { ...port, ...patch } : port);
}

function _normalizeFlowInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function shouldIgnoreProductionPlanningSwipeStart(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  // 2026-05-20 订正：流程图画布内触控拖拽用于平移/缩放，不应被误判为切屏滑动手势
  if (target.closest("[class*='production-flow-canvas']") !== null) {
    return true;
  }

  // 2026-07-25 订正：工序图画布同样需要平移/缩放，豁免滑动手势
  if (target.closest("[class*='process-graph-canvas']") !== null) {
    return true;
  }

  return target.closest("button, input, select, textarea, [role='button'], [role='tab']") !== null;
}

/** 从未平移缩放过的规划流程图首次打开时适配到目标产物，而不是停在左上角原点。 */
function isDefaultPlannerViewport(viewport: PlannerFlowViewportState): boolean {
  return viewport.x === DEFAULT_PLANNER_FLOW_VIEWPORT_STATE.x
    && viewport.y === DEFAULT_PLANNER_FLOW_VIEWPORT_STATE.y
    && viewport.scale === DEFAULT_PLANNER_FLOW_VIEWPORT_STATE.scale;
}
