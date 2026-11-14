// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecipeActionMenu,
  resolveFlowNodeActionTarget,
  resolveLiveFlowNodeActionTarget,
  resolveMenuPlacement,
} from "@/app/shell/recipe-tree/recipe-action-menu";
import type { ProductionFlowNode } from "@/app/shell/production-planning/flow";
import type { ProductionPlanningRecipeNode } from "@/app/shell/production-planning/production-planning-model";
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
    // 底部还要让出 28px 状态栏。
    expect(placement.top + Math.min(326, placement.maxHeight)).toBeLessThanOrEqual(540 - 28 - 8);
    expect(placement.left + 280).toBeLessThanOrEqual(1172);
  });

  it("limits the menu height to the space above the status bar so it scrolls instead of clipping", () => {
    vi.stubGlobal("innerWidth", 1180);
    vi.stubGlobal("innerHeight", 300);

    const placement = resolveMenuPlacement(anchorAt(120), 280, 420);

    expect(placement.top).toBe(8);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(300 - 28 - 8);
  });
});

function flowNode(id: string, itemId: string, recipeId: string, machineCount: string): ProductionFlowNode {
  return {
    id, kind: "item", tone: "normal", title: itemId, subtitle: recipeId, machineCount, rate: "30/min",
    iconSrcs: [], itemId, recipeId, value: 30,
    recipeNode: { recipeId } as ProductionPlanningRecipeNode,
  };
}

describe("resolveLiveFlowNodeActionTarget", () => {
  it("keeps acting on the tapped card when the same item is produced by two machines", () => {
    const reactor = flowNode("row-reactor", "item_effluent", "recipe_reactor", "×2");
    const treatment = flowNode("row-treatment", "item_effluent", "recipe_treatment", "×5");
    const target = resolveFlowNodeActionTarget(treatment, anchorAt(100));

    const live = resolveLiveFlowNodeActionTarget(target, [reactor, { ...treatment, machineCount: "×6" }]);

    expect(live.recipeId).toBe("recipe_treatment");
    expect(live.details?.[0]).toContain("×6");
  });

  it("follows a recipe switch only when the item maps to a single card", () => {
    const before = flowNode("row-carbon-wood", "item_carbon", "recipe_wood", "×1");
    const after = flowNode("row-carbon-sandleaf", "item_carbon", "recipe_sandleaf", "×2");
    const target = resolveFlowNodeActionTarget(before, anchorAt(100));

    expect(resolveLiveFlowNodeActionTarget(target, [after]).recipeId).toBe("recipe_sandleaf");
    expect(resolveLiveFlowNodeActionTarget(target, [after, flowNode("row-other", "item_carbon", "recipe_x", "×1")])).toBe(target);
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
