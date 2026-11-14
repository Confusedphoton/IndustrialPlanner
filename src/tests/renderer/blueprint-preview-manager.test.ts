import { afterEach, describe, expect, it } from "vitest";
import { createReadonlyCanvasScene } from "@/app/canvas";
import { createAppTestWorkspace } from "@/tests/helpers/app-test-workspace";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { resolveEffectiveCanvasTheme, BLUEPRINT_CANVAS_THEME_COLOR_PATCH } from "@/shared/theme/canvas-theme";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); });
function setup() {
  const { app, workspace } = createAppTestWorkspace(); cleanups.push(() => app.dispose());
  const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-device.schema7.json"));
  return { app, workspace, document };
}

describe("通用只读预览场景", () => {
  it("只读投影不创建 Editor 或 Simulation，尺寸自适应而用户缩放和平移无效", () => {
    const { app, workspace, document } = setup();
    const scene = createReadonlyCanvasScene({ appHost: app, id: "preview", document, bounds: { x: 10, y: 20, width: 4, height: 6 } }); cleanups.push(scene.dispose);
    scene.resize({ left: 30, top: 40, width: 320, height: 240 });
    expect(scene.view.state.center).toEqual({ x: 12, y: 23 });
    expect(scene.view.state.gridSize).toBe(2.5);
    scene.view.actions.zoom(6); scene.view.actions.setViewportDisplayRotation(90);
    scene.view.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 160, y: 160 } });
    expect(scene.view.state.center).toEqual({ x: 12, y: 23 });
    expect(scene.view.state.gridSize).toBe(2.5); expect(scene.view.state.displayRotation).toBe(0);
    expect(workspace.editor).toBeNull(); expect(workspace.simulation).toBeNull(); expect(scene.input.simulation).toBeNull();
    expect(scene.input.source.snapshot.getSnapshot().interaction).toBeNull();
    expect(scene.input.presentation.getSnapshot().settings).toMatchObject({ gameShowDeviceNames: false, gameShowDeviceIcons: true, gamePlayDeviceAnimations: false });
  });

  it("Inspector 固定邻域不截断源文档且关闭名称与图标", () => {
    const { app, document } = setup();
    const scene = createReadonlyCanvasScene({ appHost: app, id: "inspector", document,
      bounds: { x: -1, y: -1, width: 3, height: 3 }, settings: { gameShowDeviceIcons: false } }); cleanups.push(scene.dispose);
    scene.resize({ left: 0, top: 0, width: 240, height: 240 });
    expect(scene.input.source.queries.listEntities().map(entity => entity.id)).toEqual(document.entityOrder);
    expect(scene.view.state.center).toEqual({ x: .5, y: .5 });
    expect(scene.input.presentation.getSnapshot().settings).toMatchObject({ gameShowDeviceNames: false, gameShowDeviceIcons: false });
    expect(scene.input.source.queries.getEntityById("other-entity")?.position.x).toBe(100);
  });

  it("显示覆盖保留浅色画布和网格，且不会回写用户偏好", () => {
    const { app, document } = setup();
    app.internalState.settings.themeId = "ayu-dark";
    app.internalState.settings.gameShowDeviceNames = true;
    app.internalState.settings.gamePlayDeviceAnimations = true;
    const scene = createReadonlyCanvasScene({ appHost: app, id: "theme", document }); cleanups.push(scene.dispose);
    const projection = scene.input.presentation.getSnapshot();
    const theme = resolveEffectiveCanvasTheme(projection.theme, projection.settings.gameUseBlueprintStyleDeviceImages, projection.settings.showGrassBackground);
    expect(theme.colors["in-canvas-bg"]).toBe(BLUEPRINT_CANVAS_THEME_COLOR_PATCH["in-canvas-bg"]);
    expect(theme.colors["renderer-grid-line"]).toBe(BLUEPRINT_CANVAS_THEME_COLOR_PATCH["renderer-grid-line"]);
    expect(app.state.settings.themeId).toBe("ayu-dark");
    expect(app.state.settings.gameShowDeviceNames).toBe(true); expect(app.state.settings.gamePlayDeviceAnimations).toBe(true);
  });

  it("多个预览独立替换、缩放适配与释放；高亮通过只读 overlay 输入", () => {
    const { app, document } = setup();
    const overlay = { selectedEntityIds: ["entity-1"], invalidEntityIds: [], deviceItemIds: {}, links: [] };
    const first = createReadonlyCanvasScene({ appHost: app, id: "first", document, overlay }); cleanups.push(first.dispose);
    const second = createReadonlyCanvasScene({ appHost: app, id: "second", document }); cleanups.push(second.dispose);
    first.resize({ left: 0, top: 0, width: 120, height: 80 });
    second.resize({ left: 0, top: 0, width: 640, height: 480 });
    const secondDocument = second.input.source.snapshot.getSnapshot().document;
    const secondViewport = { center: { ...second.view.state.center }, zoom: second.view.state.gridSize };
    expect(first.input.overlay.getSnapshot()).toEqual(overlay); expect(second.input.overlay.getSnapshot()).toBeNull();
    const next = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/pointer-hits.schema7.json"));
    first.replace(next); first.dispose(); first.dispose();
    expect(first.input.source.snapshot.getSnapshot().disposed).toBe(true);
    expect(second.input.source.snapshot.getSnapshot().disposed).toBe(false);
    expect(second.input.source.snapshot.getSnapshot().document).toBe(secondDocument);
    expect({ center: { ...second.view.state.center }, zoom: second.view.state.gridSize }).toEqual(secondViewport);
    expect(document.entityOrder).toContain("selected-entity");
  });
});

