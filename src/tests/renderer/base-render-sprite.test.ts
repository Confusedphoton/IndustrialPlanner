import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createRenderTestScene } from "@/tests/helpers/render-test-scene";
import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); });
import { afterEach, describe, expect, it, vi } from "vitest"

import { AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import { BaseRenderSprite } from "@/renderer/sprites/base-render-sprite"

import type {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "@/renderer/sprites/render-sprite"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: MockContainer | null = null
    public alpha = 1
    public visible = true

    public addChild<T extends { parent: MockContainer | null }>(child: T): T {
      child.parent = this
      this.children.push(child)
      return child
    }

    public removeChild(child: unknown): void {
      const index = this.children.indexOf(child)
      if (index >= 0) {
        this.children.splice(index, 1)
      }

      if (child && typeof child === "object" && "parent" in child) {
        (child as { parent: MockContainer | null }).parent = null
      }
    }

    public destroy(options?: { children?: boolean }): void {
      if (options?.children) {
        for (const child of this.children) {
          if (child && typeof child === "object" && "parent" in child) {
            (child as { parent: MockContainer | null }).parent = null
          }
        }
      }

      this.children.length = 0
      this.parent = null
    }
  }

  return {
    Container: MockContainer,
  }
})

class OverlayRecordingSprite extends BaseRenderSprite {
  public readonly overlayCalls: Array<readonly string[]> = []

  public constructor(entityId: string, invalidateView: () => void = () => {}) {
    super(entityId, undefined, invalidateView)
  }

  public resourceReady(): void { this.invalidateVisualSync(); }

  protected syncSpriteLayout(): void {}

  protected resetCollectionOverlay(): void {}

  protected drawGhostOverlay(): void {}

  protected drawPreviewOverlay(): void {}

  protected drawSelectionOverlay(): void {}

  protected drawRelatedOverlay(): void {}

  protected syncCollectionOverlay(collectionTypes: readonly string[]): void {
    this.overlayCalls.push([...collectionTypes])
  }
}

describe("BaseRenderSprite", () => {
  it("异步资源就绪唤醒静止视图并在同步后清除失效标记", () => {
    const wake = vi.fn(); const sprite = new OverlayRecordingSprite("entity-1", wake);
    const context = createContext({});
    sprite.syncLayout(createLayout(), context);
    sprite.resourceReady();
    expect(wake).toHaveBeenCalledTimes(1); expect(sprite.isVisualSyncInvalidated()).toBe(true);
    sprite.syncLayout(createLayout(), context);
    expect(sprite.isVisualSyncInvalidated()).toBe(false); sprite.destroy();
  });
  it("calls the overlay hook once with the active collection types in sync order", () => {
    const sprite = new OverlayRecordingSprite("entity-1")

    sprite.syncLayout(createLayout(), createContext({
      [EntityCollectionType.selection]: ["entity-1"],
      [EntityCollectionType.marquee]: ["entity-1"],
      [EntityCollectionType.reverseMarquee]: ["entity-1"],
      [EntityCollectionType.preview]: [],
      [EntityCollectionType.ghost]: ["entity-1"],
    }))

    expect(sprite.overlayCalls).toEqual([
      [
        EntityCollectionType.ghost,
        EntityCollectionType.marquee,
        EntityCollectionType.reverseMarquee,
        EntityCollectionType.selection,
      ],
    ])
  })
})

function createLayout(): RenderSpriteLayout {
  return {
    x: 10,
    y: 20,
    width: 36,
    height: 20,
    rotation: 0,
  }
}

function createContext(collections: Partial<Record<string, readonly string[]>>): RenderSpriteSyncContext {
  const test = createRenderTestScene({ document: createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-belt.schema7.json")) }); cleanups.push(test.dispose);
  for (const collectionType of Object.values(EntityCollectionType)) for (const entityId of collections[collectionType] ?? []) test.editor.actions.addToCollection({ collectionType, entityId });
  return { theme: AYU_LIGHT_THEME, input: test.input, logisticsPortOccupancy: null, suppressBelts: false, suppressPipes: false, time: { nowMs: 1000, deltaMs: 16.67 } };
}
