import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { applicationState, createRenderSceneOrchestrator } = vi.hoisted(() => ({
  applicationState: {
    init: vi.fn(async () => undefined),
    canvas: document.createElement("canvas"),
    stage: {
      roundPixels: false,
    },
    renderer: {
      generateTexture: vi.fn(),
    },
    destroy: vi.fn(),
    render: vi.fn(),
  },
  createRenderSceneOrchestrator: vi.fn(),
}))

vi.mock("pixi.js", () => {
  class MockApplication {
    public readonly init = applicationState.init
    public readonly canvas = applicationState.canvas
    public readonly stage = applicationState.stage
    public readonly renderer = applicationState.renderer
    public readonly destroy = applicationState.destroy
    public readonly render = applicationState.render
  }

  return {
    Application: MockApplication,
  }
})

vi.mock("@/renderer/scene/render-scene-orchestrator", () => ({
  createRenderSceneOrchestrator,
}))

import { createRenderHost } from "@/renderer/renderer-host"
import { createWorldDocument } from "@/domain/document/world-document"
import { createSimulationHost } from "@/simulation/simulation-host"
import { createRenderTestScene } from "@/tests/helpers/render-test-scene"
import { runInAction } from "mobx"
const cleanups: Array<() => void> = []

describe("createRenderHost", () => {
  beforeEach(() => {
    applicationState.init.mockClear()
    applicationState.destroy.mockClear()
    applicationState.render.mockClear()
    applicationState.stage.roundPixels = false
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    createRenderSceneOrchestrator.mockReset()
    createRenderSceneOrchestrator.mockReturnValue({
      sync: vi.fn(),
      beforeRender: vi.fn(),
      afterRender: vi.fn(),
      destroy: vi.fn(),
    })
  })

  afterEach(() => {
    for (const dispose of cleanups.splice(0).reverse()) dispose()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("初始化中取消会释放迟到的 Application，不交付已失效的 View", async () => {
    const scene = createRenderTestScene(); cleanups.push(scene.dispose)
    const host = createRenderHost(); cleanups.push(() => host.destroy())
    let finish!: () => void
    applicationState.init.mockImplementationOnce(() => new Promise<undefined>(resolve => { finish = () => resolve(undefined) }))
    const abort = new AbortController()
    const pending = host.actions.mountView({ input: scene.input, time: { kind: "fixed", sampleTimeMs: 0 }, signal: abort.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    abort.abort(); finish(); await rejected
    expect(createRenderSceneOrchestrator).not.toHaveBeenCalled()
    expect(applicationState.destroy).toHaveBeenCalledTimes(1)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it("调用方决定更新顺序，固定时间 View 只在失效时补画且不推进播放", async () => {
    const scene = createRenderTestScene(); cleanups.push(scene.dispose)
    const host = createRenderHost(); cleanups.push(() => host.destroy())
    const frames: unknown[] = []
    createRenderSceneOrchestrator.mockImplementation(context => ({
      sync: (time: { nowMs: number; deltaMs: number }) => frames.push([context.input.id, time]), destroy: vi.fn(),
    }))
    const first = await host.actions.mountView({ input: { ...scene.input, id: "first" }, time: { kind: "fixed", sampleTimeMs: 5 } })
    const second = await host.actions.mountView({ input: { ...scene.input, id: "second" }, time: { kind: "fixed", sampleTimeMs: 19 } })
    frames.length = 0
    host.actions.updateViews([{ handle: first }, { handle: second }])
    expect(frames).toEqual([])
    host.actions.invalidateView(first); host.actions.invalidateView(second)
    host.actions.updateViews([{ handle: second }, { handle: first }])
    expect(frames).toEqual([["second", { nowMs: 19, deltaMs: 0 }], ["first", { nowMs: 5, deltaMs: 0 }]])
    expect(host.queries.getViewStatus(first)?.needsContinuousFrame).toBe(false)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it("keeps drawing blueprint belt cargo between simulation ticks", async () => {
    const document = createWorldDocument({ baseId: "draft_box" })
    document.entities.belt = { id: "belt", definitionId: "belt_straight_1x1", position: { x: 0, y: 0 },
      rotation: 0, tags: [], config: {} }
    document.entityOrder.push("belt")
    const scene = createRenderTestScene({ document })
    cleanups.push(scene.dispose)
    scene.view.actions.setViewportClientRect({ left: 0, top: 0, width: 640, height: 480 })
    const simulation = createSimulationHost(scene.workspace)
    cleanups.push(() => simulation.dispose())
    runInAction(() => { scene.app.internalState.settings.gameUseBlueprintStyleDeviceImages = true })
    const host = createRenderHost()
    cleanups.push(() => host.destroy())
    const handle = await host.actions.mountView({ input: { ...scene.input, simulation },
      time: { kind: "advancing", clockId: "test", initialTimeMs: 0 } })

    runInAction(() => { simulation.internalState.runningState = "start" })
    host.actions.updateViews([{ handle, sample: { clockId: "test", timeMs: 0 } }])
    expect(host.queries.getViewStatus(handle)).toMatchObject({ dirty: false, needsContinuousFrame: true })

    runInAction(() => { simulation.internalState.runningState = "pause" })
    expect(host.queries.getViewStatus(handle)?.needsContinuousFrame).toBe(false)
  })

  it("mounts the interactive canvas while scene assets are pending and redraws when they arrive", async () => {
    const scene = createRenderTestScene()
    cleanups.push(scene.dispose)
    const host = createRenderHost()
    cleanups.push(() => host.destroy())
    let finishLoading!: () => void
    const asset = new Promise<void>(resolve => { finishLoading = resolve })
    let assetReady = false
    const rendered = vi.fn()
    createRenderSceneOrchestrator.mockImplementationOnce(({ resources }) => {
      void resources.track(asset).then(() => { assetReady = true })
      return { sync: () => rendered(assetReady), destroy: vi.fn() }
    })

    const handle = await host.actions.mountView({
      input: scene.input,
      time: { kind: "advancing", clockId: "test", initialTimeMs: 0 },
      loadResourcesProgressively: true,
    })
    expect(host.queries.getViewCanvas(handle)).toBe(applicationState.canvas)
    expect(rendered).toHaveBeenLastCalledWith(false)

    const redraw = new Promise<void>(resolve => {
      const unsubscribe = host.queries.subscribeFrameDemand(() => {
        unsubscribe()
        resolve()
      })
    })
    finishLoading()
    await redraw
    host.actions.updateViews([{ handle }])
    expect(rendered).toHaveBeenLastCalledWith(true)
  })

  it("一个视图销毁失败仍释放其他视图及它们的资源", async () => {
    const scene = createRenderTestScene(); cleanups.push(scene.dispose)
    const host = createRenderHost(); cleanups.push(() => host.destroy())
    const failed = vi.fn(() => { throw new Error("scene cleanup failed") })
    const next = vi.fn()
    createRenderSceneOrchestrator.mockReturnValueOnce({ sync: vi.fn(), destroy: failed })
      .mockReturnValueOnce({ sync: vi.fn(), destroy: next })
    const first = await host.actions.mountView({ input: scene.input, time: { kind: "fixed", sampleTimeMs: 0 } })
    const second = await host.actions.mountView({ input: { ...scene.input, id: "second" }, time: { kind: "fixed", sampleTimeMs: 0 } })
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    host.destroy(); host.destroy()
    expect(failed).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(1)
    expect(applicationState.destroy).toHaveBeenCalledTimes(2)
    expect(host.queries.getViewStatus(first)).toBeNull(); expect(host.queries.getViewStatus(second)).toBeNull()
    expect(errors).toHaveBeenCalledWith("Scene view cleanup failed", expect.any(Error))
  })

  it("工厂与已取消挂载不创建 GPU 或注册帧循环", async () => {
    const scene = createRenderTestScene(); cleanups.push(scene.dispose)
    const host = createRenderHost(); cleanups.push(() => host.destroy())
    const abort = new AbortController(); abort.abort()
    await expect(host.actions.mountView({ input: scene.input, time: { kind: "fixed", sampleTimeMs: 0 }, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(applicationState.init).not.toHaveBeenCalled()
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    host.destroy(); host.destroy()
    await expect(host.actions.mountView({ input: scene.input, time: { kind: "fixed", sampleTimeMs: 0 } })).rejects.toThrow("Renderer disposed")
  })

  it("enables autoDensity and roundPixels for high-dpr canvas rendering", async () => {
const scene = createRenderTestScene(); cleanups.push(scene.dispose)
    scene.app.internalActions.setScreenProfile({ ...scene.app.state.screenProfile, devicePixelRatio: 3 })
    scene.view.actions.setViewportClientRect({ left: 0, top: 0, width: 640, height: 480 })

    const renderHost = createRenderHost(); cleanups.push(() => renderHost.destroy())
    const handle = await renderHost.actions.mountView({ input: scene.input, time: { kind: "fixed", sampleTimeMs: 0 } })
    const context = createRenderSceneOrchestrator.mock.calls.at(-1)![0]

    expect(applicationState.init).toHaveBeenCalledWith({
      width: 640,
      height: 480,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      autoStart: false,
      resolution: 3,
      preference: "webgl",
    })
    expect(applicationState.stage.roundPixels).toBe(true)
    expect(renderHost.queries.getViewContainer(handle)).toBeInstanceOf(HTMLDivElement)
    expect(renderHost.queries.getViewContainer(handle)!.contains(applicationState.canvas)).toBe(true)
    expect(context.internalState.textureConfig).toEqual({
      renderResolution: 3,
      bitmap: {
        scaleLimit: 2,
        sampling: {
          scaleMode: "linear",
          autoGenerateMipmaps: true,
          mipmapFilter: "linear",
          maxAnisotropy: 4,
        },
      },
    })
    expect(createRenderSceneOrchestrator).toHaveBeenCalledWith(
      context,
      context.textureManager.performanceDiagnostics,
    )
    expect(renderHost.queries.getViewStatus(handle)?.phase).toBe("ready")
    renderHost.destroy()
  })

  it("owns orchestrator, texture manager, and app teardown from host.destroy", async () => {
    const orchestratorDestroy = vi.fn()
    createRenderSceneOrchestrator.mockReturnValueOnce({
      sync: vi.fn(),
      beforeRender: vi.fn(),
      afterRender: vi.fn(),
      destroy: orchestratorDestroy,
    })

const scene = createRenderTestScene(); cleanups.push(scene.dispose)
    scene.app.internalActions.setScreenProfile({ ...scene.app.state.screenProfile, devicePixelRatio: 2 })
    scene.view.actions.setViewportClientRect({ left: 0, top: 0, width: 320, height: 240 })

    const renderHost = createRenderHost(); cleanups.push(() => renderHost.destroy())
    const handle = await renderHost.actions.mountView({ input: scene.input, time: { kind: "fixed", sampleTimeMs: 0 } })
    const context = createRenderSceneOrchestrator.mock.calls.at(-1)![0]
    const textureManagerDestroy = vi.spyOn(context.textureManager, "destroy")

    renderHost.destroy()

    expect(orchestratorDestroy).toHaveBeenCalledTimes(1)
    expect(textureManagerDestroy).toHaveBeenCalledTimes(1)
    expect(applicationState.destroy).toHaveBeenCalledTimes(1)
    expect(renderHost.queries.getViewStatus(handle)).toBeNull()
    expect(applicationState.destroy).toHaveBeenCalledWith({ removeView: true, releaseGlobalResources: false }, { children: true })
  })
})
