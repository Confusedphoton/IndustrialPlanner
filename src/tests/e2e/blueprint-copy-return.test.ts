import blueprint from "../fixtures/blueprints/e2e/copy-selection.schema7.json" with { type: "json" };
import { waitForAppReady, expectCanvasHit } from "./harness/workbench";
import { SCREEN_PROFILES as profiles } from "./harness/profiles";
import { expect, test, type Page } from "./harness/fixture";



for (const profile of profiles) {
  test(`复制连续放置后返回原选区，剪切粘贴不继承返回状态 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
    const context = await browser.profile(profile);
    try {
      await context.addInitScript(() => {
        localStorage.setItem("v3-app-settings", JSON.stringify({ gameUseInspectorPanel: true }));
      });
      const page = await context.newPage();
      await page.goto("/");
      await waitForAppReady(page, profile);
      const scene = await page.evaluate(input => window.__test__!.loadBlueprint(input), blueprint);
      const ids = scene.entityIds;
      await page.evaluate(id => window.__test__!.focusEntity(id), ids[0]!);
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost!.mainCanvas.view.state.center.x,
      )).toBe(15.5);
      await page.evaluate(() => window.__industrialPlannerAppHost!.mainCanvas.view.actions.zoom(-12));
      await page.getByRole("button", { name: "批量选择", exact: true }).click();
      for (const id of ids) {
        const point = await page.evaluate(value => window.__test__!.entityPoint(value), id);
        await page.mouse.click(point.x, point.y);
      }
      await expect.poll(() => readSelection(page)).toMatchObject({ tool: "marquee", ids });
      const closeDock = page.getByRole("button", { name: "关闭 右侧", exact: true });
      if (await closeDock.isVisible()) await closeDock.click();
      await testInfo.attach("before.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      await page.keyboard.press("Control+c");
      expect(await readSelection(page)).toMatchObject({ tool: "blueprint-placement", ids, continuous: true });
      await page.keyboard.press("Escape");
      expect(await readSelection(page)).toMatchObject({ tool: "marquee", ids, preview: 0 });

      await page.keyboard.press("Control+c");
      const beforeCount = (await readSelection(page)).count;
      for (const x of [22, 27]) {
        await placeAt(page, x, 15);
      }
      expect(await readSelection(page)).toMatchObject({
        tool: "blueprint-placement", ids, count: beforeCount + 4, preview: 2,
      });
      const canvas = await page.locator("canvas").first().boundingBox();
      if (canvas === null) throw new Error("画布不可见");
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { button: "right" });
      expect(await readSelection(page)).toMatchObject({ tool: "marquee", ids, preview: 0 });
      await page.screenshot({ path: testInfo.outputPath("copy-selection-return.png") });
      await testInfo.attach("after.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");
      await page.keyboard.press("Escape");
      expect(await readSelection(page)).toMatchObject({ tool: "select", ids: [], preview: 0 });
      await page.keyboard.press("x");
      await page.keyboard.down("Control");
      try {
        for (const id of ids) {
          const point = await page.evaluate(value => window.__test__!.entityPoint(value), id);
          await page.mouse.click(point.x, point.y);
        }
      } finally { await page.keyboard.up("Control"); }
      await page.keyboard.press("Control+x");
      expect(await readSelection(page)).toMatchObject({ tool: "blueprint-placement", ids: [], count: beforeCount + 2 });
      await page.keyboard.press("Escape");
      expect(await readSelection(page)).toMatchObject({ tool: "select", ids: [], preview: 0 });
      await page.keyboard.press("x");
      expect((await readSelection(page)).tool).toBe("marquee");
      await page.keyboard.press("x");
      expect((await readSelection(page)).tool).toBe("select");
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function readSelection(page: Page) {
  return page.evaluate(() => {
    const state = window.__test__!.getAppState();
    return { tool: state.tool, ids: state.selection, preview: state.previewCount,
      count: state.entityCount, continuous: state.continuousPlacement };
  });
}

async function placeAt(page: Page, x: number, y: number) {
  const point = await page.evaluate(grid => window.__test__!.gridPoint(grid), { x, y });
  await expectCanvasHit(page, point);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
}
