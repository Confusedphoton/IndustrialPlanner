import { createAppTestWorkspace } from "@/tests/helpers/app-test-workspace";
import { createScenePresentation } from "@/app/canvas";
import { describe, expect, it } from "vitest"

import {
  DEFAULT_RENDER_RESOLUTION,
  resolveRenderResolutionFromPresentation,
  resolveRenderResolutionValue,
} from "@/renderer/render-resolution"

describe("resolveRenderResolutionValue", () => {
  it("keeps finite positive render resolutions", () => {
    expect(resolveRenderResolutionValue(2)).toBe(2)
    expect(resolveRenderResolutionValue(1.5)).toBe(1.5)
  })

  it("falls back when the candidate resolution is invalid", () => {
    expect(resolveRenderResolutionValue(0, 2)).toBe(2)
    expect(resolveRenderResolutionValue(Number.NaN, 2)).toBe(2)
    expect(resolveRenderResolutionValue(Number.POSITIVE_INFINITY, 2)).toBe(2)
  })
})

describe("resolveRenderResolutionFromPresentation", () => {
  it("reads DPR from explicit scene presentation and normalizes invalid fallbacks", () => {
    const { app } = createAppTestWorkspace();
    const presentation = createScenePresentation({ app, readTools: () => app.mainCanvas.state, showBaseBoundary: true });
    try {
      const snapshot = presentation.snapshot.getSnapshot();
      expect(resolveRenderResolutionFromPresentation({ ...snapshot, screenProfile: { ...snapshot.screenProfile, devicePixelRatio: 3 } })).toBe(3);
      expect(resolveRenderResolutionFromPresentation(null, 2)).toBe(2);
      expect(resolveRenderResolutionFromPresentation({ ...snapshot, screenProfile: { ...snapshot.screenProfile, devicePixelRatio: Number.NaN } }, Number.NaN)).toBe(DEFAULT_RENDER_RESOLUTION);
    } finally { presentation.dispose(); app.dispose(); }
  });
});
