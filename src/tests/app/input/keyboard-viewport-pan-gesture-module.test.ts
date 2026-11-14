import { afterEach, describe, expect, it } from "vitest";
import { createGestureActionRouter, createHypergryphKeyboardViewportPanModule } from "@/app/input/gesture/actions";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { SHORTCUT_KEY } from "@/app/actions";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); });

function setup(gridSize = 1) {
  const test = createCanvasTestSession({ viewport: { center: { x: 0, y: 0 }, gridSize, displayRotation: 0 },
    adapterOptions: { onCancel: () => cancelRouter?.() } });
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
  const module = createHypergryphKeyboardViewportPanModule();
  const inputRouter = createGestureActionRouter({ gestureAdapter: test.adapter, workspace: test.workspace,
    getAppHost: () => test.app, getCanvas: () => test.canvas,
    getShortcutBinding: id => test.app.internalActions.getKeyboardShortcutFor(id),
    getShortcutInputLayer: () => "canvas", getActiveTool: () => test.canvas.state.activeTool, modules: [module] });
  const cancelRouter = () => inputRouter.cancel();
  cleanups.push(() => { inputRouter.dispose(); test.dispose(); });
  const key = (code: string, down = true, shift = false) => {
    const event = { code, key: code === "ShiftLeft" ? "Shift" : code.replace("Key", "").toLowerCase(),
      keyCode: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: shift };
    return down ? test.adapter.handleKeyDown(event) : test.adapter.handleKeyUp(event);
  };
  return { ...test, module, router: inputRouter, key,
    pixels: () => ({ x: test.view.state.center.x * test.view.state.gridCellPixelSize,
      y: test.view.state.center.y * test.view.state.gridCellPixelSize }) };
}

describe("caller-driven keyboard viewport pan", () => {
  it.each([
    ["KeyW", 0, -1280], ["KeyS", 0, 1280], ["KeyA", -1280, 0], ["KeyD", 1280, 0],
    ["ArrowUp", 0, -1280], ["ArrowDown", 0, 1280], ["ArrowLeft", -1280, 0], ["ArrowRight", 1280, 0],
  ] as const)("%s keeps each screen axis at 1280 px/s without implicit frames", (code, x, y) => {
    const test = setup();
    test.key(code);
    expect(test.module.needsFrame?.()).toBe(true);
    expect(test.pixels()).toEqual({ x: 0, y: 0 });
    test.router.advanceFrame(0);
    expect(test.pixels()).toEqual({ x: 0, y: 0 });
    test.router.advanceFrame(1000);
    expect(test.pixels()).toEqual({ x, y });
  });

  it.each([1, 4, 8])("preserves screen speed at zoom %s", zoom => {
    const test = setup(zoom);
    test.key("KeyW"); test.router.advanceFrame(0); test.router.advanceFrame(1000);
    expect(test.pixels()).toEqual({ x: 0, y: -1280 });
  });

  it.each(["KeyW", "ArrowUp"])("uses Shift held before %s, then changes speed without restarting", code => {
    const test = setup();
    test.key("ShiftLeft", true, true); test.key(code, true, true);
    test.router.advanceFrame(0); test.router.advanceFrame(1000);
    expect(test.pixels().y).toBe(-2560);
    test.key("ShiftLeft", false, false); test.router.advanceFrame(2000);
    expect(test.pixels().y).toBe(-3840);
    test.key("ShiftLeft", true, true); test.router.advanceFrame(3000);
    expect(test.pixels().y).toBe(-6400);
    test.key(code, false, true);
    expect(test.module.needsFrame?.()).toBe(false);
    test.router.advanceFrame(4000);
    expect(test.pixels().y).toBe(-6400);
  });

  it("combines axes, deduplicates equivalent direction keys, and stops after release", () => {
    const test = setup();
    test.key("KeyW"); test.key("ArrowUp"); test.key("KeyD");
    test.router.advanceFrame(0); test.router.advanceFrame(1000);
    expect(test.pixels()).toEqual({ x: 1280, y: -1280 });
    test.key("KeyW", false); test.key("ArrowUp", false); test.key("KeyD", false);
    expect(test.module.needsFrame?.()).toBe(false);
    test.router.advanceFrame(2000);
    expect(test.pixels()).toEqual({ x: 1280, y: -1280 });
  });

  it("cancels on blur and rebases the next gesture without accumulating hidden time", () => {
    const test = setup();
    test.key("KeyW"); test.router.advanceFrame(0); test.router.advanceFrame(1000);
    test.adapter.handleBlur(); test.router.advanceFrame(10000);
    expect(test.module.needsFrame?.()).toBe(false);
    expect(test.pixels().y).toBe(-1280);
    test.key("KeyW"); test.router.advanceFrame(20000); test.router.advanceFrame(20100);
    expect(test.pixels().y).toBe(-1408);
  });

  it("reads customized bindings and ignores unrelated keys and repeated or backwards frame samples", () => {
    const test = setup();
    test.app.internalActions.setShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_UP, "I");
    test.key("KeyW"); test.router.advanceFrame(0); test.router.advanceFrame(1000);
    expect(test.module.needsFrame?.()).toBe(false);
    test.key("KeyI"); test.router.advanceFrame(1000); test.router.advanceFrame(1100);
    test.router.advanceFrame(1100); test.router.advanceFrame(1050); test.router.advanceFrame(NaN);
    expect(test.pixels().y).toBe(-128);
    test.router.advanceFrame(1200);
    expect(test.pixels().y).toBe(-256);
  });
});
