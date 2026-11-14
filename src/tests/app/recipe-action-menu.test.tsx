// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeActionMenu, resolveMenuPlacement } from "@/app/shell/recipe-tree/recipe-action-menu";
import { buildProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createRegistryContract } from "@/registry";
import { createAppTestHost } from "@/tests/helpers/app-test-workspace";

function anchorAt(top: number, height = 54, left = 900): DOMRect {
  return { top, bottom: top + height, left, right: left + 150, width: 150, height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
    audio: null,
  };
}

describe("resolveMenuPlacement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { label: "below a card near the top", anchorTop: 40 },
    { label: "above a card near the bottom", anchorTop: 450 },
    { label: "clamped when neither side has room", anchorTop: 230 },
  ])("keeps a 326px menu inside a 1180x540 viewport when opened $label", ({ anchorTop }) => {
    vi.stubGlobal("innerWidth", 1180);
    vi.stubGlobal("innerHeight", 540);

    const placement = resolveMenuPlacement(anchorAt(anchorTop), 280, 326);

    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.top + Math.min(326, placement.maxHeight)).toBeLessThanOrEqual(532);
    expect(placement.left + 280).toBeLessThanOrEqual(1172);
  });

  it("limits the menu height to the viewport so it scrolls instead of clipping", () => {
    vi.stubGlobal("innerWidth", 1180);
    vi.stubGlobal("innerHeight", 300);

    const placement = resolveMenuPlacement(anchorAt(120), 280, 420);

    expect(placement.maxHeight).toBe(284);
    expect(placement.top).toBe(8);
  });
});

describe("RecipeActionMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("closes when the viewport resizes, because its anchor card has moved", () => {
    const workspace = createWorkspace();
    const appHost = createAppTestHost(workspace);
    const index = buildProductionPlanningIndex(workspace.registry);
    const onClose = vi.fn();

    act(() => {
      root.render(
        <RecipeActionMenu
          appHost={appHost}
          index={index}
          onClose={onClose}
          t={(key) => key}
          target={{ itemId: "item_iron_nugget", recipeId: null, anchor: anchorAt(120) }}
        />,
      );
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
