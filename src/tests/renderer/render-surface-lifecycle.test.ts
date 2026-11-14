import { describe, expect, it, vi } from "vitest"

import { createRenderSurface, type RenderSurface } from "@/renderer/surface"





describe("RenderSurface lifecycle", () => {






  it("owns scene, render, and resource teardown as one idempotent surface boundary", () => {
    const calls: string[] = []
    const scene = {
      sync: vi.fn(() => calls.push("sync")),
      beforeRender: vi.fn(() => calls.push("before-render")),
      afterRender: vi.fn(() => calls.push("after-render")),
      destroy: vi.fn(() => calls.push("scene-destroy")),
    }
    const app = {
      canvas: document.createElement("canvas"),
      render: vi.fn(() => calls.push("render")),
    } as unknown as RenderSurface["app"]
    const destroyResources = vi.fn(() => calls.push("resources-destroy"))
    const surface = createRenderSurface({
      id: "surface",
      app,
      scene,
      destroyResources,
    })

    surface.renderFrame({ nowMs: 10, deltaMs: 5 })
    surface.destroy()
    surface.destroy()

    expect(calls).toEqual([
      "sync",
      "before-render",
      "render",
      "after-render",
      "scene-destroy",
      "resources-destroy",
    ])
    expect(scene.destroy).toHaveBeenCalledTimes(1)
    expect(destroyResources).toHaveBeenCalledTimes(1)
  })

  it("releases renderer resources even when scene teardown fails", () => {
    const failure = new Error("scene teardown failed")
    const destroyResources = vi.fn()
    const surface = createRenderSurface({
      id: "failing-surface",
      app: {
        canvas: document.createElement("canvas"),
        render: vi.fn(),
      } as unknown as RenderSurface["app"],
      scene: {
        sync: vi.fn(),
        destroy: vi.fn(() => {
          throw failure
        }),
      },
      destroyResources,
    })

    expect(() => surface.destroy()).toThrow(failure)
    expect(destroyResources).toHaveBeenCalledTimes(1)
    expect(() => surface.destroy()).not.toThrow()
  })
})
