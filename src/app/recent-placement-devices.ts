import { makeAutoObservable, toJS } from "mobx";

const STORAGE_KEY = "industrial-planner-recent-placements";
const MAX_RECENT_PLACEMENTS = 12;

/** 最近放置的一台设备，连同当时带的配置（例如配方），从快捷栏拿起时原样交回。 */
export interface RecentPlacement {
  readonly deviceId: string;
  readonly config: Readonly<Record<string, unknown>> | null;
}

/**
 * 最近进入放置的设备（新的在前），供画布快捷栏使用；仅存于本浏览器。
 * 同一设备带不同配方算不同的条目，这样快捷栏能直接交回“精炼炉·碳块”而不只是“精炼炉”。
 */
export class RecentPlacements {
  public entries: readonly RecentPlacement[] = readStoredEntries();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public record(deviceId: string, config: Readonly<Record<string, unknown>> | null): void {
    const entry: RecentPlacement = { deviceId, config: config === null ? null : toJS(config) };
    const key = recentPlacementKey(entry);
    if (this.entries[0] !== undefined && recentPlacementKey(this.entries[0]) === key) {
      return;
    }
    this.entries = [entry, ...this.entries.filter((existing) => recentPlacementKey(existing) !== key)]
      .slice(0, MAX_RECENT_PLACEMENTS);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // localStorage may be unavailable in private contexts.
    }
  }
}

/** 设备与配方的组合键：只看配方，其余配置不影响是否同一条目。 */
export function recentPlacementKey(entry: RecentPlacement): string {
  return `${entry.deviceId}|${JSON.stringify(entry.config?.channelRecipes ?? null)}`;
}

function readStoredEntries(): readonly RecentPlacement[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 旧版只存设备 id。
    return parsed.flatMap((entry): RecentPlacement[] => {
      if (typeof entry === "string") return [{ deviceId: entry, config: null }];
      if (typeof entry !== "object" || entry === null || typeof (entry as { deviceId?: unknown }).deviceId !== "string") return [];
      const config = (entry as { config?: unknown }).config;
      return [{
        deviceId: (entry as { deviceId: string }).deviceId,
        config: typeof config === "object" && config !== null ? config as Record<string, unknown> : null,
      }];
    }).slice(0, MAX_RECENT_PLACEMENTS);
  } catch {
    return [];
  }
}

export const recentPlacements = new RecentPlacements();
