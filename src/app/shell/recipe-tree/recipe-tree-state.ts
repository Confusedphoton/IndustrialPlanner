import { makeAutoObservable, reaction } from "mobx";

import type {
  ProductionPlanningPort,
  ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";

/**
 * 配方树浮层的个人 UI 状态。
 *
 * 浮层固定在画布上方，可在摆放设备时持续查看已钉住的配方树；状态仅属于当前浏览器，
 * 与 useWarehousePinnedItems 一样写入 localStorage，不参与 WebDAV 同步。
 */
export interface RecipeTreePin {
  readonly id: string;
  readonly itemId: string;
  readonly perMinute: number;
  /** itemId -> 生产候选 ID（与产线规划器 recipeChoices 语义一致）。 */
  readonly recipeChoices: Readonly<Record<string, string>>;
  readonly collapsed: boolean;
}

export interface RecipeTreeOverlayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const RECIPE_TREE_STORAGE_KEY = "industrial-planner-recipe-tree-overlay";
const MAX_PINS = 12;
export const RECIPE_TREE_DEFAULT_PER_MINUTE = 30;
export const RECIPE_TREE_MIN_WIDTH = 280;
export const RECIPE_TREE_MIN_HEIGHT = 160;
export const RECIPE_TREE_DOCK_MIN_WIDTH = 300;
export const RECIPE_TREE_DOCK_MAX_WIDTH = 960;
const RECIPE_TREE_DOCK_DEFAULT_WIDTH = 440;
const RECIPE_TREE_STACK_DEFAULT_RATIO = 0.6;
const RECIPE_TREE_STACK_MIN_RATIO = 0.05;
const RECIPE_TREE_STACK_MAX_RATIO = 0.95;
const DEFAULT_RECT: RecipeTreeOverlayRect = { x: -1, y: 72, width: 380, height: 520 };

export type RecipeTreeViewMode = "tree" | "graph";

/** 规划的来源策略默认值：副产水与酸液回用、污水外部供给、不用净水节点、按比例计入设备最低消耗。 */
export const DEFAULT_RECIPE_TREE_SOURCE_CONFIG: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "fractional",
};

interface PersistedRecipeTreeState {
  readonly docked?: unknown;
  readonly dockWidth?: unknown;
  readonly stackRatio?: unknown;
  readonly viewMode?: unknown;
  readonly visible?: unknown;
  readonly minimized?: unknown;
  readonly rect?: unknown;
  readonly pins?: unknown;
  readonly collapsedNodeIds?: unknown;
  readonly supplies?: unknown;
  readonly sourceConfig?: unknown;
  readonly useModules?: unknown;
}

export class RecipeTreeOverlayState {
  public visible = false;
  public minimized = false;
  /** 树形或流程图（合并全部钉住目标，共用中间产物只出现一次）。 */
  public viewMode: RecipeTreeViewMode = "tree";
  /** 停靠为画布右侧独立栏（占用布局宽度、可拖动左缘调整宽度），否则为浮层。 */
  public docked = false;
  public dockWidth = RECIPE_TREE_DOCK_DEFAULT_WIDTH;
  /** 由工作台布局按画布最小宽度给出的停靠栏上限，不持久化。 */
  public dockWidthLimit = RECIPE_TREE_DOCK_MAX_WIDTH;
  /** 与属性面板叠放于同一右栏时（由工作台布局决定，不持久化）。 */
  public stacked = false;
  /** 叠放时配方树占右栏高度的比例。 */
  public stackRatio = RECIPE_TREE_STACK_DEFAULT_RATIO;
  /** 右栏高度不足以同时展开两栏时展开哪一栏，不持久化。 */
  public stackFocus: "inspector" | "recipe" = "inspector";
  /** x 为 -1 表示尚未定位，首次显示时贴靠画布右侧。 */
  public rect: RecipeTreeOverlayRect = DEFAULT_RECT;
  public pins: RecipeTreePin[] = [];
  /** 折叠的树节点：`${pinId}:${nodePath}`。 */
  public collapsedNodeIds: string[] = [];
  /** 外部供给：已有的原料来源，规划时先用它们再安排生产。 */
  public supplies: ProductionPlanningPort[] = [];
  public sourceConfig: ProductionPlanningSourceConfig = DEFAULT_RECIPE_TREE_SOURCE_CONFIG;
  /** 规划时可以用模块平衡里的模块代替整段生产。 */
  public useModules = false;
  /** 规划设置视图取代树/流程图（不持久化）。 */
  public settingsOpen = false;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public get canAddPin(): boolean {
    return this.pins.length < MAX_PINS;
  }

  public toggleVisible(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.minimized = false;
    }
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
  }

  /** 停靠栏实际占用的布局宽度（未显示或未停靠时为 0）。 */
  public get dockLayoutWidth(): number {
    return this.visible && this.docked ? Math.min(this.dockWidth, this.dockWidthLimit) : 0;
  }

  public setStacked(stacked: boolean): void {
    this.stacked = stacked;
  }

  public setStackFocus(focus: "inspector" | "recipe"): void {
    this.stackFocus = focus;
  }

  public setStackRatio(ratio: number): void {
    this.stackRatio = Math.min(RECIPE_TREE_STACK_MAX_RATIO, Math.max(RECIPE_TREE_STACK_MIN_RATIO, ratio));
  }

  /** 由工作台布局给出；矮窄窗口里可能低于 RECIPE_TREE_DOCK_MIN_WIDTH，此时拖动条没有可调范围。 */
  public setDockWidthLimit(limit: number): void {
    this.dockWidthLimit = Math.round(limit);
  }

  public toggleDocked(): void {
    this.docked = !this.docked;
    if (this.docked) {
      this.minimized = false;
    }
  }

  public setDockWidth(width: number): void {
    const maxWidth = Math.min(RECIPE_TREE_DOCK_MAX_WIDTH, this.dockWidthLimit);
    this.dockWidth = Math.round(Math.min(maxWidth, Math.max(RECIPE_TREE_DOCK_MIN_WIDTH, width)));
  }

  public setViewMode(viewMode: RecipeTreeViewMode): void {
    this.viewMode = viewMode;
  }

  public toggleMinimized(): void {
    this.minimized = !this.minimized;
  }

  public setRect(rect: RecipeTreeOverlayRect): void {
    this.rect = rect;
  }

  public addPin(itemId: string): void {
    const existing = this.pins.find((pin) => pin.itemId === itemId);
    if (existing !== undefined) {
      this.updatePin(existing.id, { collapsed: false });
      return;
    }
    if (!this.canAddPin) {
      return;
    }

    this.pins = [...this.pins, {
      id: createPinId(),
      itemId,
      perMinute: RECIPE_TREE_DEFAULT_PER_MINUTE,
      recipeChoices: {},
      collapsed: false,
    }];
  }

  public removePin(pinId: string): void {
    this.pins = this.pins.filter((pin) => pin.id !== pinId);
    const prefix = `${pinId}:`;
    this.collapsedNodeIds = this.collapsedNodeIds.filter((nodeId) => !nodeId.startsWith(prefix));
  }

  public movePin(pinId: string, offset: -1 | 1): void {
    const index = this.pins.findIndex((pin) => pin.id === pinId);
    const targetIndex = index + offset;
    if (index < 0 || targetIndex < 0 || targetIndex >= this.pins.length) {
      return;
    }

    const next = [...this.pins];
    const [pin] = next.splice(index, 1);
    if (pin !== undefined) {
      next.splice(targetIndex, 0, pin);
    }
    this.pins = next;
  }

  public updatePin(pinId: string, patch: Partial<Omit<RecipeTreePin, "id" | "itemId">>): void {
    this.pins = this.pins.map((pin) => (pin.id === pinId ? { ...pin, ...patch } : pin));
  }

  public setRecipeChoice(pinId: string, itemId: string, candidateId: string | null): void {
    const pin = this.pins.find((candidate) => candidate.id === pinId);
    if (pin === undefined) {
      return;
    }

    const recipeChoices = { ...pin.recipeChoices };
    if (candidateId === null) {
      delete recipeChoices[itemId];
    } else {
      recipeChoices[itemId] = candidateId;
    }
    this.updatePin(pinId, { recipeChoices });
  }

  public setSettingsOpen(open: boolean): void {
    this.settingsOpen = open;
  }

  public addSupply(itemId: string, perMinute: number): void {
    if (this.supplies.some((supply) => supply.itemId === itemId)) {
      return;
    }
    this.supplies = [...this.supplies, { id: createSupplyId(), itemId, perMinute }];
  }

  public updateSupply(supplyId: string, patch: Partial<Omit<ProductionPlanningPort, "id">>): void {
    this.supplies = this.supplies.map((supply) => (supply.id === supplyId ? { ...supply, ...patch } : supply));
  }

  public removeSupply(supplyId: string): void {
    this.supplies = this.supplies.filter((supply) => supply.id !== supplyId);
  }

  public setSourceConfig(patch: Partial<ProductionPlanningSourceConfig>): void {
    this.sourceConfig = { ...this.sourceConfig, ...patch };
  }

  public setUseModules(useModules: boolean): void {
    this.useModules = useModules;
  }

  public isNodeCollapsed(nodeId: string): boolean {
    return this.collapsedNodeIds.includes(nodeId);
  }

  public toggleNodeCollapsed(nodeId: string): void {
    this.collapsedNodeIds = this.isNodeCollapsed(nodeId)
      ? this.collapsedNodeIds.filter((candidate) => candidate !== nodeId)
      : [...this.collapsedNodeIds, nodeId];
  }

  public hydrate(raw: PersistedRecipeTreeState | null): void {
    if (raw === null) {
      return;
    }

    this.visible = raw.visible === true;
    this.viewMode = raw.viewMode === "graph" ? "graph" : "tree";
    this.docked = raw.docked === true;
    if (typeof raw.dockWidth === "number" && Number.isFinite(raw.dockWidth)) {
      this.setDockWidth(raw.dockWidth);
    }
    if (typeof raw.stackRatio === "number" && Number.isFinite(raw.stackRatio)) {
      this.setStackRatio(raw.stackRatio);
    }
    this.minimized = raw.minimized === true;
    this.rect = normalizeRect(raw.rect) ?? DEFAULT_RECT;
    this.pins = Array.isArray(raw.pins)
      ? raw.pins.map(normalizePin).filter((pin): pin is RecipeTreePin => pin !== null).slice(0, MAX_PINS)
      : [];
    this.collapsedNodeIds = Array.isArray(raw.collapsedNodeIds)
      ? raw.collapsedNodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string")
      : [];
    this.supplies = Array.isArray(raw.supplies)
      ? raw.supplies.map(normalizeSupply).filter((supply): supply is ProductionPlanningPort => supply !== null)
      : [];
    this.sourceConfig = normalizeSourceConfig(raw.sourceConfig);
    this.useModules = raw.useModules === true;
  }

  public toPersisted(): PersistedRecipeTreeState {
    return {
      viewMode: this.viewMode,
      docked: this.docked,
      dockWidth: this.dockWidth,
      stackRatio: this.stackRatio,
      visible: this.visible,
      minimized: this.minimized,
      rect: this.rect,
      pins: this.pins,
      collapsedNodeIds: this.collapsedNodeIds,
      supplies: this.supplies,
      sourceConfig: this.sourceConfig,
      useModules: this.useModules,
    };
  }
}

export const recipeTreeOverlayState = new RecipeTreeOverlayState();

let persistenceDisposer: (() => void) | null = null;

/** 由工作台挂载时调用：恢复本地状态并在之后自动写回；重复调用复用同一订阅。 */
export function hookRecipeTreeOverlayPersistence(): () => void {
  if (persistenceDisposer !== null) {
    return persistenceDisposer;
  }

  recipeTreeOverlayState.hydrate(readPersistedState());
  const dispose = reaction(
    () => JSON.stringify(recipeTreeOverlayState.toPersisted()),
    (serialized) => {
      try {
        window.localStorage.setItem(RECIPE_TREE_STORAGE_KEY, serialized);
      } catch {
        // localStorage may be unavailable in private contexts.
      }
    },
  );
  persistenceDisposer = () => {
    dispose();
    persistenceDisposer = null;
  };
  return persistenceDisposer;
}

function readPersistedState(): PersistedRecipeTreeState | null {
  try {
    const raw = window.localStorage.getItem(RECIPE_TREE_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed as PersistedRecipeTreeState : null;
  } catch {
    return null;
  }
}

function normalizeRect(value: unknown): RecipeTreeOverlayRect | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every((part) => typeof part === "number" && Number.isFinite(part))) {
    return null;
  }

  return {
    x: x as number,
    y: y as number,
    width: Math.max(RECIPE_TREE_MIN_WIDTH, width as number),
    height: Math.max(RECIPE_TREE_MIN_HEIGHT, height as number),
  };
}

function normalizePin(value: unknown): RecipeTreePin | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { id, itemId, perMinute, recipeChoices, collapsed } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof itemId !== "string") {
    return null;
  }

  const normalizedChoices: Record<string, string> = {};
  if (typeof recipeChoices === "object" && recipeChoices !== null) {
    for (const [choiceItemId, candidateId] of Object.entries(recipeChoices)) {
      if (typeof candidateId === "string") {
        normalizedChoices[choiceItemId] = candidateId;
      }
    }
  }

  return {
    id,
    itemId,
    perMinute: typeof perMinute === "number" && Number.isFinite(perMinute) && perMinute > 0
      ? perMinute
      : RECIPE_TREE_DEFAULT_PER_MINUTE,
    recipeChoices: normalizedChoices,
    collapsed: collapsed === true,
  };
}

function normalizeSupply(value: unknown): ProductionPlanningPort | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { id, itemId, perMinute, isInfinite } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof itemId !== "string") {
    return null;
  }
  return {
    id,
    itemId,
    perMinute: typeof perMinute === "number" && Number.isFinite(perMinute) && perMinute >= 0 ? perMinute : 0,
    ...(isInfinite === true ? { isInfinite: true } : {}),
  };
}

function pickOption<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback;
}

function normalizeSourceConfig(value: unknown): ProductionPlanningSourceConfig {
  const raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const fallback = DEFAULT_RECIPE_TREE_SOURCE_CONFIG;
  return {
    waterPolicy: pickOption(raw.waterPolicy, ["use-byproduct", "dump-byproduct"], fallback.waterPolicy),
    acidPolicy: pickOption(raw.acidPolicy, ["use-byproduct", "dump-byproduct"], fallback.acidPolicy),
    sewagePolicy: pickOption(raw.sewagePolicy, ["external-supply", "self-produce"], fallback.sewagePolicy),
    waterPurifierPolicy: pickOption(raw.waterPurifierPolicy, ["disabled", "use-when-available"], fallback.waterPurifierPolicy),
    includeDeviceMinimumConsumption: pickOption(
      raw.includeDeviceMinimumConsumption,
      ["none", "fractional", "ceil"],
      fallback.includeDeviceMinimumConsumption,
    ),
  };
}

function createSupplyId(): string {
  return `supply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPinId(): string {
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
