import { SCREEN_PROFILES as profiles } from "./harness/profiles";
import { expect, test, type Page } from "./harness/fixture";



for (const profile of profiles) {
  test(`物流提示：画布鼠标、触控与双语提示显示 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.profile(profile);
    try {
      await context.addInitScript(() => {
        localStorage.setItem("v3-app-settings", JSON.stringify({
          locale: "zh-CN",
          hypergryphAllowEmptyLogisticsEndpoints: false,
          gamePlayDeviceAudio: false,
        }));
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto("/");
      await page.waitForFunction(() => window.__test__?.readiness().viewportValid && window.__test__?.readiness().canvasAttached);
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.state.screenProfile)).toMatchObject({
        deviceClass: profile.name,
        viewportWidth: profile.width,
        viewportHeight: profile.height,
        devicePixelRatio: profile.dpr,
        hasTouch: true,
      });
      // 按所属 View 准备明确空地，避免比例选点在大屏命中协议核心。
      await page.evaluate(() => window.__industrialPlannerAppHost!.mainCanvas.view.actions.focusOnBounds(
        { x: 15, y: 15, width: 1, height: 1 }, { durationMs: 0, gridSize: 1 }));
      const canvas = page.getByRole("main");
      await canvas.click({ position: { x: 250, y: 150 } });
      await page.keyboard.press("e");
      await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.beltStart", toast: null });
      const point = await page.evaluate(() => window.__test__!.gridPoint({ x: 15, y: 15 }));
      expect(await page.evaluate(point => {
        const app = window.__industrialPlannerAppHost!;
        return app.workspace.editor!.queries.findEntityAtClientPixelPoint(point, app.mainCanvas.view.state);
      }, point)).toBeNull();
      await page.mouse.move(point.x, point.y);
      expect((await readNotices(page)).toast).toBeNull();
      await page.mouse.click(point.x, point.y);
      await expect(page.locator(".canvas-toast")).toContainText("请从设备出口");
      await expect(page.locator(".canvas-mode-alert")).toContainText("传送带需从");
      await page.screenshot({ path: testInfo.outputPath(`${profile.name}-notices.png`) });

      await page.touchscreen.tap(point.x, point.y);
      await expect.poll(() => readNotices(page)).toMatchObject({ toast: "canvas.toast.beltStart" });
      await page.keyboard.press("q");
      await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.pipeStart" });
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => readNotices(page)).toMatchObject({ toast: "canvas.toast.pipeStart" });
      await page.keyboard.press("Escape");
      expect(await readNotices(page)).toMatchObject({ alert: null, toast: "canvas.toast.pipeStart" });

      await page.keyboard.press("e");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      await dialog.locator('label[for="setting-game-arknights-allow-empty-logistics-endpoints"]').click();
      await expect.poll(() => readNotices(page)).toMatchObject({ alert: null, phase: "idle" });
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await page.keyboard.press("e");
      await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.beltStartWithEmpty" });
      await expect(page.locator(".canvas-mode-alert strong")).toContainText(["设备与物流出口", "空地", "其他传送带"]);
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => readNotices(page)).toMatchObject({ phase: "drawing", alert: null, toast: null });
      await page.mouse.click(point.x, point.y, { button: "right" });
      await expect.poll(() => readNotices(page)).toMatchObject({ phase: "idle", alert: "canvas.alert.beltStartWithEmpty" });
      await page.evaluate(() => window.__industrialPlannerAppHost!.internalActions.setLocale("en-US"));
      await expect(page.locator(".canvas-mode-alert")).toContainText("empty ground");
      await page.screenshot({ path: testInfo.outputPath(`${profile.name}-english.png`) });

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function readNotices(page: Page) {
  return page.evaluate(() => {
    const runtime = window.__industrialPlannerAppHost!.mainCanvas.state.runtime;
    return { toast: runtime.canvasToastKey, alert: runtime.canvasAlertKey, phase: runtime.logisticsPlacement.phase };
  });
}

