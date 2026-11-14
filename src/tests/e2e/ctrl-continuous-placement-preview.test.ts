import { SCREEN_PROFILES } from "./harness/profiles";
import { expect, test } from "./harness/fixture";


for (const profile of SCREEN_PROFILES) {
  test(`Ctrl 连续放置后，新预览与刚放下的设备位置和方向一致 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.profile(profile);

    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:4174/");
      await expect(page.locator("canvas").first()).toBeVisible();
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost?.mainCanvas.view.state.clientRect.width ?? 0,
      )).toBeGreaterThan(0);

      await page.getByRole("button", { name: "装备原件机", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost?.mainCanvas.state.activeTool))
        .toBe("single-placement");

      const viewport = await page.evaluate(() =>
        window.__industrialPlannerAppHost!.mainCanvas.view.state.clientRect,
      );
      const firstPoint = {
        x: viewport.left + viewport.width * 0.54,
        y: viewport.top + viewport.height * 0.48,
      };
      const placementPoint = {
        x: viewport.left + viewport.width * 0.72,
        y: viewport.top + viewport.height * 0.63,
      };
      await page.mouse.move(firstPoint.x, firstPoint.y);
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost!.workspace.editor!.state.collections.preview.length,
      )).toBe(1);
      const firstPosition = await page.evaluate(() => {
        const editor = window.__industrialPlannerAppHost!.workspace.editor!;
        return editor.queries.getEntityById(editor.state.collections.preview[0]!)!.position;
      });
      await page.mouse.move(placementPoint.x, placementPoint.y);
      await expect.poll(() => page.evaluate(() => {
        const editor = window.__industrialPlannerAppHost!.workspace.editor!;
        return editor.queries.getEntityById(editor.state.collections.preview[0]!)?.position;
      })).not.toEqual(firstPosition);

      await page.keyboard.press("r");
      const before = await page.evaluate(() => {
        const host = window.__industrialPlannerAppHost!;
        const editor = host.workspace.editor!;
        const previewId = editor.state.collections.preview[0]!;
        return {
          preview: editor.queries.getEntityById(previewId)!,
          entityOrder: [...editor.document.getSnapshot().entityOrder],
          anchor: host.mainCanvas.state.runtime.placementAnchor,
        };
      });
      expect(before.preview.rotation).toBe(90);
      expect(before.anchor).toEqual(await page.evaluate((point) =>
        window.__industrialPlannerAppHost!.mainCanvas.view.queries.findGridCellForClientPixelPoint(point),
      placementPoint));
      await testInfo.attach("before.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });


      await page.keyboard.down("Control");
      try {
        await page.mouse.click(placementPoint.x, placementPoint.y);
      } finally {
        await page.keyboard.up("Control");
      }

      const after = await page.evaluate(() => {
        const host = window.__industrialPlannerAppHost!;
        const editor = host.workspace.editor!;
        const snapshot = editor.document.getSnapshot();
        const previewId = editor.state.collections.preview[0];
        return {
          activeTool: host.mainCanvas.state.activeTool,
          preview: previewId === undefined ? null : editor.queries.getEntityById(previewId),
          entityOrder: [...snapshot.entityOrder],
          entities: snapshot.entities,
        };
      });
      await testInfo.attach("after.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
      await page.screenshot({ path: testInfo.outputPath(`ctrl-placement-${profile.name}.png`) });

      const placedIds = after.entityOrder.filter((id) => !before.entityOrder.includes(id));
      expect(placedIds).toHaveLength(1);
      const placed = after.entities[placedIds[0]!]!;
      expect(after.activeTool).toBe("single-placement");
      expect(after.preview?.definitionId).toBe("winder_1");
      expect(placed.definitionId).toBe("winder_1");
      expect(placed.position).toEqual(before.preview.position);
      expect(placed.rotation).toBe(90);
      expect(after.preview?.rotation).toBe(90);
      expect(after.preview?.position).toEqual(placed.position);
    } finally {
      await browser.closeContext(context);
    }
  });
}
