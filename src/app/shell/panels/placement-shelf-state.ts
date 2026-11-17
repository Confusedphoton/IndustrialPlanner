import { makeAutoObservable } from "mobx";

/** 窄设备架的宽度：一列笔可点的图标磁贴加上内边距。 */
export const PLACEMENT_SHELF_WIDTH_PX = 64;
/** 放置面板要被挤到这个宽度以下时改用窄设备架。 */
export const PLACEMENT_SHELF_BELOW_PX = 260;

/**
 * 放置面板的窄设备架：其他停靠栏占去空间、面板放不下常规宽度时，自动收成一列图标，几乎不占画布宽度。
 * narrow 由工作台按停靠栏预算设置；openGroupKey 为设备架上展开的分类。
 */
export class PlacementShelfState {
  public narrow = false;
  public openGroupKey: string | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public setNarrow(narrow: boolean): void {
    this.narrow = narrow;
  }

  public toggleGroup(groupKey: string): void {
    this.openGroupKey = this.openGroupKey === groupKey ? null : groupKey;
  }
}

export const placementShelfState = new PlacementShelfState();
