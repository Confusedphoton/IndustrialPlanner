import { makeAutoObservable } from "mobx";

const STORAGE_KEY = "industrial-planner-placement-shelf";

/** 窄设备架的宽度：一列笔可点的图标磁贴加上内边距。 */
export const PLACEMENT_SHELF_WIDTH_PX = 64;

/**
 * 放置面板的窄设备架模式：只剩一列图标，可以常开在画布旁而几乎不占画布宽度；仅存于本浏览器。
 * openGroupKey 为设备架上展开的分类，不持久化。
 */
export class PlacementShelfState {
  public enabled = readStoredEnabled();
  public openGroupKey: string | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // localStorage may be unavailable in private contexts.
    }
  }

  public toggleGroup(groupKey: string): void {
    this.openGroupKey = this.openGroupKey === groupKey ? null : groupKey;
  }
}

function readStoredEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export const placementShelfState = new PlacementShelfState();
