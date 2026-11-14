import blueprint from "../fixtures/blueprints/e2e/clipboard-selection.schema7.json" with { type: "json" };
import { waitForAppReady, clickEntity } from "./harness/workbench";
import { SCREEN_PROFILES } from "./harness/profiles";
import { expect, test } from "./harness/fixture";



for (const profile of SCREEN_PROFILES) {
  test(`框选剪切并从其他画布工具粘贴 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.profile(profile);

    try {
      await context.addInitScript(() => {
        localStorage.setItem("v3-app-settings", JSON.stringify({ gameUseInspectorPanel: true }));
      });
      const page = await context.newPage();
      await page.goto("/");
      await waitForAppReady(page, profile);
      const scene = await page.evaluate(input => window.__test__!.loadBlueprint(input), blueprint);
      const entityId = scene.entityIds[0]!;
      await clickEntity(page, entityId);

      await testInfo.attach("before.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+x");
      expect(await page.evaluate((id) => ({
        tool: window.__industrialPlannerAppHost!.mainCanvas.state.activeTool,
        exists: window.__industrialPlannerAppHost!.workspace.editor!.document.getSnapshot().entities[id] !== undefined,
      }), entityId)).toEqual({ tool: "select", exists: true });

      await page.getByRole("button", { name: "批量选择", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.mainCanvas.state.activeTool)).toBe("marquee");
      await page.keyboard.press("Control+x");
      const cut = await page.evaluate((id) => {
        const host = window.__industrialPlannerAppHost!;
        const editor = host.workspace.editor!;
        return {
          tool: host.mainCanvas.state.activeTool,
          exists: editor.document.getSnapshot().entities[id] !== undefined,
          previewCount: editor.state.collections.preview.length,
          blueprintId: host.mainCanvas.state.runtime.blueprintPlacementRecord?.blueprintId ?? null,
          sourceIds: host.mainCanvas.state.runtime.blueprintPlacementRecord?.entityOrder ?? [],
        };
      }, entityId);
      expect(cut.tool).toBe("blueprint-placement");
      expect(cut.exists).toBe(false);
      expect(cut.previewCount).toBe(1);
      expect(cut.sourceIds).toEqual([entityId]);

      await page.keyboard.press("Control+v");
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.mainCanvas.state.runtime.blueprintPlacementRecord?.blueprintId))
        .toBe(cut.blueprintId);
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.mainCanvas.state.activeTool)).toBe("select");
      await page.keyboard.press("Control+v");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.mainCanvas.state.activeTool))
        .toBe("blueprint-placement");
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.state.collections.preview.length))
        .toBe(1);
      await page.screenshot({ path: testInfo.outputPath("cut-paste.png") });
      await testInfo.attach("after.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
    } finally {
      await browser.closeContext(context);
    }
  });
}
