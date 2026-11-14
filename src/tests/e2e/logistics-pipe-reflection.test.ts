import { readFileSync } from 'node:fs';
import { expect, test } from "./harness/fixture";
import { chooseSettingsGroup, waitForAppReady } from "./harness/workbench";
import type { Page } from "playwright";
import type { WorldDocument } from '@/domain/document/world-document';

// 复用已版本化的三节空管蓝图；本用例验证真正的 Canvas alpha，而不是截屏中的 CSS 底色。
const fixture = JSON.parse(readFileSync(new URL(
  '../fixtures/blueprints/collections-extra/renderer/logistics-material-topology/scene-01-variant-1.schema7.json',
  import.meta.url,
), 'utf8')) as Pick<WorldDocument, 'entities' | 'entityOrder' | 'baseId' | 'slotLinks' | 'regions'>;


for (const themeId of ['ayu-light', 'ayu-dark']) {
  test(`无草地时管壁可见且空白画布透明：${themeId}`, async ({ browserSession: browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
    try {
      const page = await context.newPage();
      await page.addInitScript((theme) => {
        localStorage.setItem('v3-app-settings', JSON.stringify({
          themeId: theme, showGrassBackground: false, gameAlwaysShowGridLines: false,
          gameUseBlueprintStyleDeviceImages: false, gamePipeWallReflection: false,
          gameShowDeviceNames: false, gameShowDeviceIcons: false,
        }));
        localStorage.setItem('v3-user-settings-dialog', JSON.stringify({ selectedGroupId: 'display', values: {} }));
      }, themeId);
      await page.goto('http://127.0.0.1:4174/');
      await waitForAppReady(page);
      await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.render);
      await page.evaluate(async (scene) => {
        const editor = window.__industrialPlannerAppHost!.workspace.editor!;
        await editor.actions.applySynchronizedDocument({ ...editor.document.getSnapshot(), ...scene });
        window.__industrialPlannerAppHost!.mainCanvas.focusOnEntity('p1', { duration: 0 });
      }, fixture);
      await waitForMainRender(page);
      await page.waitForFunction(() => window.__test__!.renderSurface().app.stage.getChildByLabel('logistics-material:p1', true)?.visible);

      await page.getByRole('button', { name: '设置', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '设置', exact: true });
      await chooseSettingsGroup(page, "显示与性能");
      const input = dialog.locator('input[name="game-pipe-wall-reflection"]');
      const label = dialog.locator('label[for="setting-game-pipe-wall-reflection"]');
      await expect(input).not.toBeChecked();
      await label.click();
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await waitForMainRender(page);
      await page.waitForFunction(() => window.__test__!.renderSurface().app.stage.getChildByLabel('logistics-pipe-reflection')?.filters?.length === 1);

      const pixels = await page.evaluate(() => {
        const owner = window.__industrialPlannerAppHost!.mainCanvas;
        const renderedCanvas = owner.renderBinding!.canvas!;
        // 同步绘制后立即读取同一 WebGL 后缓冲，保持真实 alpha 验证。
        window.__test__!.renderSurface().app.render();
        const viewport = owner.view.state;
        const resolution = renderedCanvas.width / viewport.clientRect.width;
        const canvas = document.createElement('canvas');
        canvas.width = renderedCanvas.width; canvas.height = renderedCanvas.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(renderedCanvas, 0, 0);
        const sample = (x: number, y: number) => [...ctx.getImageData(
          Math.round((viewport.clientRect.width / 2 + (x - viewport.center.x) * viewport.gridCellPixelSize) * resolution),
          Math.round((viewport.clientRect.height / 2 + (y - viewport.center.y) * viewport.gridCellPixelSize) * resolution),
          1, 1,
        ).data];
        return { pipe: [1.2, 1.5, 1.8].map(x => sample(x, .5)), empty: sample(1.5, 1.5) };
      });
      for (const pixel of pixels.pipe) expect(pixel[3]).toBeGreaterThan(250);
      expect(pixels.empty[3]).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`reflection-${themeId}.png`) });

      await page.getByRole('button', { name: '设置', exact: true }).click();
      await label.click();
      await expect(input).not.toBeChecked();
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await waitForMainRender(page);
      await page.waitForFunction(() => window.__test__!.renderSurface().app.stage.getChildByLabel('logistics-pipe-reflection') == null);
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function waitForMainRender(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const app = window.__industrialPlannerAppHost;
    const binding = app?.mainCanvas.renderBinding;
    const status = binding && app?.workspace.render?.queries.getViewStatus(binding.handle);
    return status?.phase === "ready" && !status.dirty && (binding?.canvas?.width ?? 0) > 0;
  });
}
