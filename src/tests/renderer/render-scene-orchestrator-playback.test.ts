import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EntityCollectionType } from "@/domain/editor/types/editor-types"



const orchestratorTestState = vi.hoisted(() => {
  let tickHandler: (() => void) | null = null
  const createdSprites: Array<{ kind: string; entityId: string; definitionId: string }> = []
  const destroyedSprites: Array<{ kind: string; entityId: string; definitionId: string }> = []
  const attachedSprites: Array<{
    kind: string;
    entityId: string;
    definitionId: string;
    entityLayer: unknown;
  }> = []
  const layoutSyncs: string[] = []
  const runtimeSyncs: string[] = []
  const animationSyncs: string[] = []
  const visualSyncInvalidatedEntityIds = new Set<string>()

  return {
    reset() {
      tickHandler = null
      createdSprites.length = 0
      destroyedSprites.length = 0
      attachedSprites.length = 0
      layoutSyncs.length = 0
      runtimeSyncs.length = 0
      animationSyncs.length = 0
      visualSyncInvalidatedEntityIds.clear()
    },
    setTickHandler(handler: () => void) {
      tickHandler = handler
    },
    getTickHandler() {
      return tickHandler
    },
    createDecoration() {
      return {
        container: {
          destroy: vi.fn(),
        },
        sync: vi.fn(),
        destroy: vi.fn(),
      }
    },
    recordCreatedSprite(kind: string, entityId: string, definitionId: string) {
      createdSprites.push({ kind, entityId, definitionId })
    },
    recordDestroyedSprite(kind: string, entityId: string, definitionId: string) {
      destroyedSprites.push({ kind, entityId, definitionId })
    },
    recordAttachedSprite(kind: string, entityId: string, definitionId: string, entityLayer: unknown) {
      attachedSprites.push({
        kind,
        entityId,
        definitionId,
        entityLayer,
      })
    },
    getCreatedSprites() {
      return [...createdSprites]
    },
    getDestroyedSprites() {
      return [...destroyedSprites]
    },
    getAttachedSprites() {
      return [...attachedSprites]
    },
    recordLayoutSync(entityId: string) {
      visualSyncInvalidatedEntityIds.delete(entityId)
      layoutSyncs.push(entityId)
    },
    invalidateVisualSync(entityId: string) {
      visualSyncInvalidatedEntityIds.add(entityId)
    },
    isVisualSyncInvalidated(entityId: string) {
      return visualSyncInvalidatedEntityIds.has(entityId)
    },
    recordRuntimeSync(entityId: string) {
      runtimeSyncs.push(entityId)
    },
    recordAnimationSync(entityId: string) {
      animationSyncs.push(entityId)
    },
    getLayoutSyncs() {
      return [...layoutSyncs]
    },
    getRuntimeSyncs() {
      return [...runtimeSyncs]
    },
    getAnimationSyncs() {
      return [...animationSyncs]
    },
  }
})

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public readonly position = { set: vi.fn() }
    public readonly pivot = { set: vi.fn() }
    public readonly scale = { set: vi.fn() }
    public rotation = 0
    public visible = true
    public readonly addChild = vi.fn((...children: unknown[]) => {
      this.children.push(...children)
      return children[0]
    })
    public readonly addChildAt = vi.fn()
    public readonly destroy = vi.fn()
  }

  return {
    Container: MockContainer,
    Graphics: class {
      public rect = vi.fn().mockReturnThis()
      public fill = vi.fn().mockReturnThis()
      public stroke = vi.fn().mockReturnThis()
      public clear = vi.fn()
      public destroy = vi.fn()
    },
    UPDATE_PRIORITY: {
      HIGH: 50,
      LOW: -25,
    },
  }
})

vi.mock("@/renderer/sprites/belt-sprite", () => ({
  BeltSprite: class {
    private readonly kind = "belt"
    public readonly attach = vi.fn((layers: { readonly entity: unknown }) => {
      orchestratorTestState.recordAttachedSprite(
        this.kind,
        this.entityId,
        this.definition.id,
        layers.entity,
      )
    })
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn(() => {
      orchestratorTestState.recordLayoutSync(this.entityId)
    })
    public readonly isVisualSyncInvalidated = vi.fn(() =>
      orchestratorTestState.isVisualSyncInvalidated(this.entityId))
    public readonly syncAnimation = vi.fn(() => {
      orchestratorTestState.recordAnimationSync(this.entityId)
    })

    public constructor(
      private readonly entityId: string,
      private readonly definition: { readonly id: string },
    ) {
      orchestratorTestState.recordCreatedSprite(this.kind, entityId, definition.id)
    }

    public destroy(): void {
      orchestratorTestState.recordDestroyedSprite(this.kind, this.entityId, this.definition.id)
    }
  },
}))

vi.mock("@/renderer/sprites/generic-device-sprite", () => ({
  GenericDeviceSprite: class {
    private readonly kind = "generic"
    public readonly attach = vi.fn((layers: { readonly entity: unknown }) => {
      orchestratorTestState.recordAttachedSprite(
        this.kind,
        this.entityId,
        this.definition.id,
        layers.entity,
      )
    })
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn(() => {
      orchestratorTestState.recordLayoutSync(this.entityId)
    })
    public readonly isVisualSyncInvalidated = vi.fn(() =>
      orchestratorTestState.isVisualSyncInvalidated(this.entityId))
    public readonly syncRuntime = vi.fn(() => {
      orchestratorTestState.recordRuntimeSync(this.entityId)
    })
    public readonly syncAnimation = vi.fn(() => {
      orchestratorTestState.recordAnimationSync(this.entityId)
    })

    public constructor(
      private readonly entityId: string,
      private readonly definition: { readonly id: string },
    ) {
      orchestratorTestState.recordCreatedSprite(this.kind, entityId, definition.id)
    }

    public destroy(): void {
      orchestratorTestState.recordDestroyedSprite(this.kind, this.entityId, this.definition.id)
    }
  },
}))

vi.mock("@/renderer/sprites/pipe-sprite", () => ({
  PipeSprite: class {
    private readonly kind = "pipe"
    public readonly attach = vi.fn((layers: { readonly entity: unknown }) => {
      orchestratorTestState.recordAttachedSprite(
        this.kind,
        this.entityId,
        this.definition.id,
        layers.entity,
      )
    })
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn(() => {
      orchestratorTestState.recordLayoutSync(this.entityId)
    })
    public readonly isVisualSyncInvalidated = vi.fn(() =>
      orchestratorTestState.isVisualSyncInvalidated(this.entityId))
    public readonly syncRuntime = vi.fn(() => {
      orchestratorTestState.recordRuntimeSync(this.entityId)
    })
    public readonly syncAnimation = vi.fn(() => {
      orchestratorTestState.recordAnimationSync(this.entityId)
    })

    public constructor(
      private readonly entityId: string,
      private readonly definition: { readonly id: string },
    ) {
      orchestratorTestState.recordCreatedSprite(this.kind, entityId, definition.id)
    }

    public destroy(): void {
      orchestratorTestState.recordDestroyedSprite(this.kind, this.entityId, this.definition.id)
    }
  },
}))

vi.mock("@/renderer/sprites/render-sprite", () => ({
  RenderLayerMap: {},
  RenderSprite: class {},
}))

vi.mock("@/renderer/scene/decorations/GridLineDecoration", () => ({
  createGridLineDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BaseBoundaryDecoration", () => ({
  createBaseBoundaryDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/DiagnosticsDecoration", () => ({
  createDiagnosticsDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BlueprintPlacementCanvasDecoration", () => ({
  createBlueprintPlacementCanvasDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/LogisticsPlacementCanvasDecoration", () => ({
  createLogisticsPlacementCanvasDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/MarqueeRectDecoration", () => ({
  createMarqueeRectDecoration: () => orchestratorTestState.createDecoration(),
  resolveMarqueeGridRectLayout: () => null,
  resolveWorldAuxiliaryStrokeWidth: () => 1,
}))

vi.mock("@/renderer/scene/decorations/MarqueeCanvasDecoration", () => ({
  createMarqueeCanvasDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PreviewRectDecoration", () => ({
  createPreviewRectDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/InvalidPlacementDecoration", () => ({
  createInvalidPlacementDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/GrassBackgroundDecoration", () => ({
  createGrassBackgroundDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BeltCargoDecoration", () => ({
  createBeltCargoDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BeltPortInsertionDecoration", () => ({
  createBeltPortInsertionDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BeltFlowDecoration", () => ({
  createBeltFlowDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PipeFlowDecoration", () => ({
  createPipeFlowDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PowerRangeDecoration", () => ({
  createPowerRangeDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PortOverlayDecoration", () => ({
  createPortOverlayDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PipePortGhostDecoration", () => ({
  createPipePortGhostDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/RegionalDarkPipeLinkDecoration", () => ({
  createRegionalDarkPipeLinkDecoration: () => orchestratorTestState.createDecoration(),
}))

import { createRenderSceneOrchestrator } from "@/renderer/scene/render-scene-orchestrator"
import type { RenderSurfaceContext } from "@/renderer/render-surface-context"
import { createRenderTestScene } from "@/tests/helpers/render-test-scene"
import { loadBlueprintFromFile, createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers"
import { createSimulationHost } from "@/simulation/simulation-host"
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry"

const cleanups: Array<() => void> = []
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks() })

function createOrchestratorTestHost(fixture?: "device" | "layers", withSimulation = false) {
  const scene = createRenderTestScene({ document: fixture === undefined ? undefined : createWorldDocumentFromBlueprint(
    loadBlueprintFromFile(`src/tests/fixtures/blueprints/collections/req048/orchestrator-${fixture}.schema7.json`)) })
  cleanups.push(scene.dispose)
  scene.view.actions.setViewportClientRect({ left: 0, top: 0, width: 640, height: 480 })
  // 相机按真实场景聚焦，设备位于 (20,20)，物流场景与空场景起笔在原点。
  const box = resolveEntityGridGeometry({ entities: scene.editor.queries.listEntities(),
    entityDefinitionMap: new Map(scene.workspace.registry.entityDefinitions.map(definition => [definition.id, definition])) })?.boundingBox
  scene.view.actions.focusOnBounds({ x: box?.left ?? 0, y: box?.top ?? 0, width: box?.width ?? 1, height: box?.height ?? 1 },
    { durationMs: 0, gridSize: 1 })
  scene.workspace.editor = scene.editor
  const simulation = withSimulation ? createSimulationHost(scene.workspace, { workerMode: "runtime" }) : null
  if (simulation !== null) cleanups.push(simulation.dispose)
  const ticker = { add: vi.fn(), remove: vi.fn() }
  const stage = { addChild: vi.fn(), addChildAt: vi.fn() }
  const host: RenderSurfaceContext = {
    input: { ...scene.input, simulation }, resources: scene.resources, invalidate: vi.fn(),
    container: document.createElement("div"), internalState: { textureConfig: null },
    dom: { placementGlowOverlay: document.createElement("div"), blueprintGlowOverlay: document.createElement("div"), marqueeGlowOverlay: document.createElement("div") },
    app: { stage, ticker, renderer: { width: 640, height: 480, resolution: 1, resize: vi.fn(), background: { color: 0, alpha: 1 } } } as unknown as RenderSurfaceContext["app"],
    textureManager: {
      supportsLogisticsAnimation: vi.fn(() => false),
      acquireLogisticsDynamic: vi.fn(() => { throw new Error("Disabled logistics animation must not acquire dynamic assets") }),
    } as unknown as RenderSurfaceContext["textureManager"],
  }
  const orchestrator = createRenderSceneOrchestrator(host)
  cleanups.push(orchestrator.destroy)
  return { scene, host, simulation, ticker, stage, orchestrator }
}

describe("createRenderSceneOrchestrator", () => {
  beforeEach(() => { orchestratorTestState.reset() })

  it("leaves simulation playback advancement to the host scheduler", async () => {
    const { simulation, ticker, stage, orchestrator } = createOrchestratorTestHost("device", true)
    await simulation!.actions.start()
    expect(simulation!.state.runningState).toBe("start")
    const advancePlaybackByDeltaMs = vi.spyOn(simulation!.actions, "advancePlaybackByDeltaMs")
    expect(ticker.add).not.toHaveBeenCalled()
    expect(stage.addChild).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    )
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    expect(advancePlaybackByDeltaMs).not.toHaveBeenCalled()
    orchestrator.destroy()
    expect(ticker.remove).not.toHaveBeenCalled()
  })

  it("reuses entity layout while runtime, animation, and sprite visuals keep separate invalidation paths", async () => {
    const { simulation, orchestrator } = createOrchestratorTestHost("device", true)
    await simulation!.actions.start()
    expect(simulation!.state.runningState).toBe("start")
    expect((await simulation!.internalActions.syncToTick(10)).status).toBe("ready")
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
    expect((await simulation!.internalActions.syncToTick(11)).status).toBe("ready")
    orchestrator.sync({ nowMs: 1233.34, deltaMs: 16.67 })
    orchestratorTestState.invalidateVisualSync("entity-a")
    orchestrator.sync({ nowMs: 1250.01, deltaMs: 16.67 })
    expect(orchestratorTestState.getLayoutSyncs()).toEqual(["entity-a", "entity-a"])
    expect(orchestratorTestState.getRuntimeSyncs()).toEqual(["entity-a"])
    expect(orchestratorTestState.getAnimationSyncs()).toEqual(["entity-a", "entity-a", "entity-a", "entity-a"])
  })

  it("recreates an entity sprite when an entity keeps its id but changes definition", () => {
    const { scene, orchestrator } = createOrchestratorTestHost("device")
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    expect(scene.editor.actions.replaceEntityDefinition("entity-a", "filling_pd_mc_1" )).toBe(true)
    orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
    expect(orchestratorTestState.getCreatedSprites()).toEqual([
      { kind: "generic", entityId: "entity-a", definitionId: "storager_1" },
      { kind: "generic", entityId: "entity-a", definitionId: "filling_pd_mc_1" },
    ])
    expect(orchestratorTestState.getDestroyedSprites()).toEqual([
      { kind: "generic", entityId: "entity-a", definitionId: "storager_1" },
    ])
  })

  it("keeps pipes above belts when entity order is reversed", () => {
    const { stage, orchestrator } = createOrchestratorTestHost("layers")
    const stageLayers = stage.addChild.mock.calls[0] ?? []
    const beltLayer = stageLayers[4] as { readonly children: readonly unknown[] }
    const pipeLayer = stageLayers[5] as { readonly children: readonly unknown[] }
    const beltSubEntity = beltLayer.children[0]
    const pipeSubEntity = pipeLayer.children[2]
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    expect(orchestratorTestState.getCreatedSprites()).toEqual([
      { kind: "pipe", entityId: "pipe-entity", definitionId: "pipe_straight_1x1" },
      { kind: "belt", entityId: "belt-entity", definitionId: "belt_straight_1x1" },
    ])
    expect(orchestratorTestState.getAttachedSprites()).toEqual([
      { kind: "pipe", entityId: "pipe-entity", definitionId: "pipe_straight_1x1", entityLayer: pipeSubEntity },
      { kind: "belt", entityId: "belt-entity", definitionId: "belt_straight_1x1", entityLayer: beltSubEntity },
    ])
    expect(stageLayers.indexOf(beltLayer)).toBeLessThan(stageLayers.indexOf(pipeLayer))
  })

  it("reattaches a logistics draft belt sprite when the same id becomes a formal belt entity", () => {
    const { scene, stage, orchestrator } = createOrchestratorTestHost()
    expect(scene.editor.actions.createLogisticsDraftStart({ kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 0, y: 0 } } }).canApply).toBe(true)
    const beltEntityId = scene.editor.state.collections[EntityCollectionType.preview][0]!
    expect(beltEntityId).toBeTruthy()
    const stageLayers = stage.addChild.mock.calls[0] ?? []
    const logisticsBeltLayer = stageLayers[4] as { readonly children: readonly unknown[] }
    const beltSubEntity = logisticsBeltLayer.children[0]
    const draftLayer = stageLayers[6]
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    expect(scene.editor.actions.applyLogisticDraft()).toBe(true)
    expect(scene.editor.document.getSnapshot().entityOrder).toContain(beltEntityId)
    orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
    expect(orchestratorTestState.getCreatedSprites()).toEqual([
      { kind: "belt", entityId: beltEntityId, definitionId: "belt_straight_1x1" },
    ])
    expect(orchestratorTestState.getDestroyedSprites()).toEqual([])
    expect(orchestratorTestState.getAttachedSprites()).toMatchObject([
      { kind: "belt", entityId: beltEntityId, definitionId: "belt_straight_1x1", entityLayer: draftLayer },
      { kind: "belt", entityId: beltEntityId, definitionId: "belt_straight_1x1", entityLayer: beltSubEntity },
    ])
  })

  it("samples placement glow from the explicit view time", () => {
    const { scene, host, orchestrator } = createOrchestratorTestHost()
    scene.canvas.actions.setActiveTool("single-placement")
    orchestrator.sync({ nowMs: 1234, deltaMs: 0 })
    expect(host.dom.placementGlowOverlay.style.animationPlayState).toBe("paused")
    expect(host.dom.placementGlowOverlay.style.animationDelay).toBe("-1234ms")
    expect(orchestrator.needsContinuousFrame()).toBe(true)
    orchestrator.sync({ nowMs: 1234, deltaMs: 0 })
    expect(host.dom.placementGlowOverlay.style.animationDelay).toBe("-1234ms")
    scene.canvas.actions.setActiveTool("select")
    orchestrator.sync({ nowMs: 1234, deltaMs: 0 })
    expect(orchestrator.needsContinuousFrame()).toBe(false)
  })
})
