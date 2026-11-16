import { makeAutoObservable } from "mobx";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";

const STORAGE_KEY = "industrial-planner-holding-tray";
const MAX_TRAY_ITEMS = 12;

export interface HoldingTrayItem {
  readonly id: string;
  /** 放进托盘的整组设备：相对位置、配方与组内的传送带/管道和槽位连接都保留在蓝图里。 */
  readonly blueprint: BlueprintDocument;
  /** 组里数量最多的设备，用作托盘图标。 */
  readonly iconDeviceId: string;
  readonly deviceCount: number;
}

/**
 * 暂存托盘：重新排布时把选中的一组设备先收起来，之后再拿回画布。
 * 只有真正放下后才离开托盘，拿起后取消放置仍留在托盘里；仅存于本浏览器。
 */
export class HoldingTrayState {
  public items: readonly HoldingTrayItem[] = readStoredItems();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public get isFull(): boolean {
    return this.items.length >= MAX_TRAY_ITEMS;
  }

  /** 托盘已满时不收（返回 false），由调用方保留画布上的设备；不会挤掉还没放回去的组。 */
  public push(blueprint: BlueprintDocument): boolean {
    if (this.isFull) return false;
    const counts = new Map<string, number>();
    for (const entityId of blueprint.entityOrder) {
      const definitionId = blueprint.entities[entityId]?.definitionId;
      if (definitionId !== undefined) counts.set(definitionId, (counts.get(definitionId) ?? 0) + 1);
    }
    const iconDeviceId = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
    if (iconDeviceId === undefined) return false;
    this.items = [
      { id: blueprint.blueprintId, blueprint, iconDeviceId, deviceCount: blueprint.entityOrder.length },
      ...this.items,
    ];
    this.persist();
    return true;
  }

  /** 托盘里的一组已放回画布：从托盘移除。 */
  public markPlaced(blueprintId: string): void {
    if (!this.items.some((item) => item.blueprint.blueprintId === blueprintId)) return;
    this.items = this.items.filter((item) => item.blueprint.blueprintId !== blueprintId);
    this.persist();
  }

  public discard(itemId: string): void {
    this.items = this.items.filter((item) => item.id !== itemId);
    this.persist();
  }

  private persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // localStorage may be unavailable or full; the tray then lasts for this session only.
    }
  }
}

function readStoredItems(): readonly HoldingTrayItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is HoldingTrayItem => (
        typeof item === "object" && item !== null
        && typeof (item as HoldingTrayItem).id === "string"
        && typeof (item as HoldingTrayItem).blueprint === "object"
      ))
      : [];
  } catch {
    return [];
  }
}

export const holdingTrayState = new HoldingTrayState();
