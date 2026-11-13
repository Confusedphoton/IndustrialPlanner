import { makeAutoObservable, reaction } from "mobx";

/**
 * 2026-11-13：配方树浮层的个人 UI 状态。
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
const DEFAULT_RECT: RecipeTreeOverlayRect = { x: -1, y: 72, width: 380, height: 520 };

interface PersistedRecipeTreeState {
  readonly visible?: unknown;
  readonly minimized?: unknown;
  readonly rect?: unknown;
  readonly pins?: unknown;
  readonly collapsedNodeIds?: unknown;
}

export class RecipeTreeOverlayState {
  public visible = false;
  public minimized = false;
  /** x 为 -1 表示尚未定位，首次显示时贴靠画布右侧。 */
  public rect: RecipeTreeOverlayRect = DEFAULT_RECT;
  public pins: RecipeTreePin[] = [];
  /** 折叠的树节点：`${pinId}:${nodePath}`。 */
  public collapsedNodeIds: string[] = [];

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
    this.minimized = raw.minimized === true;
    this.rect = normalizeRect(raw.rect) ?? DEFAULT_RECT;
    this.pins = Array.isArray(raw.pins)
      ? raw.pins.map(normalizePin).filter((pin): pin is RecipeTreePin => pin !== null).slice(0, MAX_PINS)
      : [];
    this.collapsedNodeIds = Array.isArray(raw.collapsedNodeIds)
      ? raw.collapsedNodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string")
      : [];
  }

  public toPersisted(): PersistedRecipeTreeState {
    return {
      visible: this.visible,
      minimized: this.minimized,
      rect: this.rect,
      pins: this.pins,
      collapsedNodeIds: this.collapsedNodeIds,
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

function createPinId(): string {
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
