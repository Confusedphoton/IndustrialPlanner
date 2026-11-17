import { afterEach, describe, expect, it } from "vitest";

import { RecentPlacements } from "@/app/recent-placement-devices";

afterEach(() => {
  localStorage.clear();
});

describe("recent placements", () => {
  it("keeps the same machine with different recipes as separate entries and hands the recipe back", () => {
    const recents = new RecentPlacements();
    recents.record("furnance_1", { channelRecipes: { default: "r-carbon" } });
    recents.record("furnance_1", { channelRecipes: { default: "r-iron" } });
    recents.record("furnance_1", { channelRecipes: { default: "r-carbon" } });

    expect(recents.entries.map((entry) => entry.config?.channelRecipes)).toEqual([
      { default: "r-carbon" },
      { default: "r-iron" },
    ]);
    expect(new RecentPlacements().entries).toHaveLength(2);
  });

  it("still reads the older list of bare device ids", () => {
    localStorage.setItem("industrial-planner-recent-placements", JSON.stringify(["storager_1", "grinder_1"]));

    expect(new RecentPlacements().entries).toEqual([
      { deviceId: "storager_1", config: null },
      { deviceId: "grinder_1", config: null },
    ]);
  });
});
