import { makeAutoObservable } from "mobx";

const STORAGE_KEY = "industrial-planner-recent-placements";
const MAX_RECENT_PLACEMENT_DEVICES = 8;

/**
 * 最近进入放置的设备（新的在前），供放置面板与快速放置共用；仅存于本浏览器。
 * 由放置入口统一记录，面板、快速放置与快捷键选择的设备都会进入列表。
 */
export class RecentPlacementDevices {
  public deviceIds: readonly string[] = readStoredDeviceIds();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public record(deviceId: string): void {
    if (this.deviceIds[0] === deviceId) {
      return;
    }
    this.deviceIds = [deviceId, ...this.deviceIds.filter((entry) => entry !== deviceId)]
      .slice(0, MAX_RECENT_PLACEMENT_DEVICES);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.deviceIds));
    } catch {
      // localStorage may be unavailable in private contexts.
    }
  }
}

function readStoredDeviceIds(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RECENT_PLACEMENT_DEVICES)
      : [];
  } catch {
    return [];
  }
}

export const recentPlacementDevices = new RecentPlacementDevices();
