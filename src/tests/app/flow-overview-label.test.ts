import { describe, expect, it } from "vitest";

import { truncateOverviewLabel } from "@/app/shell/production-planning/flow/production-flow-graph";

describe("truncateOverviewLabel", () => {
  it("keeps the distinguishing last word so items sharing a prefix stay apart", () => {
    const ore = truncateOverviewLabel("Originium Ore", 64);
    const powder = truncateOverviewLabel("Originium Powder", 64);

    expect(ore).not.toBe(powder);
    expect(powder.endsWith("Powder")).toBe(true);
  });

  it("leaves names that fit untouched", () => {
    expect(truncateOverviewLabel("Carbon", 120)).toBe("Carbon");
  });
});
