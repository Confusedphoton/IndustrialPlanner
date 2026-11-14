import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public visible = true
    public mask: unknown = null

    public addChild<T>(child: T): T {
      this.children.push(child)
      return child
    }

    public destroy = vi.fn()
  }

  class MockGraphics {
    public readonly drawCommands: Array<{
      type: "poly" | "rect";
      points?: number[];
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      fill?: unknown;
      stroke?: unknown;
    }> = []
    public visible = true
    public mask: unknown = null
    public roundPixels = false
    public readonly context: { instructions: unknown[] }
    public destroy = vi.fn()

    public constructor(options?: { roundPixels?: boolean }) {
      this.roundPixels = options?.roundPixels ?? false
      // 提供 context.instructions 兼容旧断言（drawCommands.length 映射）
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- getter 内需要捕获外部 this
      const self = this
      this.context = {
        get instructions() {
          return Array.from({ length: self.drawCommands.length })
        },
      }
    }

    public clear(): this {
      this.drawCommands.length = 0
      return this
    }

    public rect(x: number, y: number, width: number, height: number): this {
      this.drawCommands.push({ type: "rect", x, y, width, height })
      return this
    }

    public poly(points: number[]): this {
      this.drawCommands.push({ type: "poly", points })
      return this
    }

    public fill(fill: unknown): this {
      const command = this.drawCommands.at(-1)
      if (command !== undefined) {
        command.fill = fill
      }
      return this
    }

    public stroke(stroke: unknown): this {
      const command = this.drawCommands.at(-1)
      if (command !== undefined) {
        command.stroke = stroke
      }
      return this
    }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
  }
})

import { AYU_LIGHT_THEME } from "@/app/theme"


let createPipeFlowDecoration: typeof import("@/renderer/scene/decorations/PipeFlowDecoration")["createPipeFlowDecoration"]

beforeAll(async () => {
  createPipeFlowDecoration = (await import("@/renderer/scene/decorations/PipeFlowDecoration"))
    .createPipeFlowDecoration
})

import { createRenderTestScene } from "@/tests/helpers/render-test-scene"
import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers"
import { createSimulationHost } from "@/simulation/simulation-host"

const cleanups: Array<() => void> = []
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose() })

function createPipeFlowContext(options: { withSimulation?: boolean; recordSample?: (name: string, value: number) => void } = {}) {
  const scene = createRenderTestScene({ document: createWorldDocumentFromBlueprint(loadBlueprintFromFile(
    "src/tests/fixtures/blueprints/collections/req048/pipe-flow-runtime.schema7.json")) })
  cleanups.push(scene.dispose)
  scene.workspace.editor = scene.editor
  const simulation = options.withSimulation ? createSimulationHost(scene.workspace, { workerMode: "runtime" }) : null
  if (simulation !== null) cleanups.push(simulation.dispose)
  return {
    simulation,
    viewportState: { width: 400, height: 300, resolution: 1, centerX: 21, centerY: 20.5, gridCellPixelSize: 100 },
    viewportBounds: { left: 0, top: 0, width: 400, height: 300 },
    renderHost: { input: { ...scene.input, simulation } }, theme: AYU_LIGHT_THEME, nowMs: 0,
    profiler: options.recordSample === undefined ? undefined : {
      count: options.recordSample, measure: <T>(_stage: string, callback: () => T): T => callback(),
    },
  }
}

describe("PipeFlowDecoration", () => {
  it("draws double chevrons for all pipe transport components regardless of fluid", async () => {
    const ctx = createPipeFlowContext({ withSimulation: true })
    const decoration = createPipeFlowDecoration()
    cleanups.push(decoration.destroy)
    await ctx.simulation!.actions.start()
    expect(ctx.simulation!.state.runningState).toBe("start")
    expect(ctx.simulation!.queries.getPipeFluidItemId("pipe-a")).toBeNull()
    // 无流体时也显示 decoration
    decoration.sync(ctx as never)
    const arrowGraphics = decoration.container.children[0] as unknown as { context: { instructions: unknown[] }; visible: boolean }
    const arrowMask = decoration.container.children[1] as unknown as { context: { instructions: unknown[] }; visible: boolean }
    expect(decoration.container.visible).toBe(true)
    expect(arrowGraphics.visible).toBe(true)
    expect(arrowMask.visible).toBe(true)
    // 有流体时同样显示
    expect((await ctx.simulation!.internalActions.syncToTick(10)).status).toBe("ready")
    expect(ctx.simulation!.queries.getPipeFluidItemId("pipe-a")).toBe("item_liquid_water")
    decoration.sync(ctx as never)
    expect(decoration.container.visible).toBe(true)
    expect(arrowGraphics.visible).toBe(true)
    expect(arrowMask.visible).toBe(true)
    // 流体恢复为空后仍然显示
    ctx.simulation!.actions.stop()
    expect(ctx.simulation!.queries.getPipeFluidItemId("pipe-a")).toBeNull()
    decoration.sync(ctx as never)
    expect(decoration.container.visible).toBe(true)
    expect(arrowGraphics.visible).toBe(true)
    expect(arrowMask.visible).toBe(true)
  })

  it("records disjoint work stages and their input sizes", () => {
    const decoration = createPipeFlowDecoration()
    cleanups.push(decoration.destroy)
    const samples = new Map<string, number>()
    const ctx = createPipeFlowContext({ recordSample: (name, value) => samples.set(name, value) })
    decoration.sync(ctx as never)
    for (const name of ["pipeFlow.activeScan-ms", "pipeFlow.pathEntries-ms", "pipeFlow.buildChains-ms", "pipeFlow.generateMarks-ms", "pipeFlow.drawMask-ms", "pipeFlow.drawMarks-ms"]) {
      expect(samples.get(name)).toBeGreaterThanOrEqual(0)
    }
    expect(samples.get("pipeFlow.activeEntityCount")).toBe(2)
    expect(samples.get("pipeFlow.pathEntryCount")).toBe(2)
    expect(samples.get("pipeFlow.chainCount")).toBe(1)
    expect(samples.get("pipeFlow.markCount")).toBe(1)
    expect(samples.get("pipeFlow.maskRectCount")).toBe(2)
  })
})
