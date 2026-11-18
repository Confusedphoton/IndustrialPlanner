import { makeAutoObservable } from "mobx";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";

const STORAGE_KEY = "industrial-planner-holding-tray";

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
