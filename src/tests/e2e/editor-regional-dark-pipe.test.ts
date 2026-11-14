import { SCREEN_PROFILES as profiles } from "./harness/profiles";
import { expect, test, type Page } from "./harness/fixture";
import { clickEntity as clickCanvasEntity, waitForAppReady } from "./harness/workbench";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import fixtureJson from "../fixtures/blueprints/editor-regional-dark-pipe/scene.schema7.json" with { type: "json" };

const fixture = normalizeBlueprintDocument(fixtureJson)!;

for (const profile of profiles) {
  test(`暗管跨基地原生选点、取消和显示切换 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
    // 桌面还验证插槽覆盖、仓库覆盖和删除端点；取证下公共链路约 90–120 秒，180 秒会截断附加分支。
    // 总预算按实际步骤规模设置；每次建链仍受 waitForDarkPipeSave 的独立事务预算约束。
    test.setTimeout(120_000);
    const context = await browser.profile(profile);
    try {
      await context.addInitScript(() => {
        localStorage.setItem("v3-user-settings-dialog", JSON.stringify({ values: {
          "other-experimental-features": true,
          "debug-legacy-simulation-engine": false,
        } }));
        localStorage.setItem("v3-experimental-regional-multi-base", "true");
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => {
        if (message.text().includes("[MobX]") && message.text().includes("strict-mode")) {
          errors.push(message.text());
        }
      });
      await page.goto("/");
      await waitForAppReady(page, profile);
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.state.screenProfile)).toMatchObject({
        deviceClass: profile.name, screenShape: profile.shape, devicePixelRatio: profile.dpr,
        viewportWidth: profile.width, viewportHeight: profile.height, hasTouch: true,
      });
      await page.getByRole("button", { name: "基地", exact: true }).click();
      await toggleMultiBase(page);
      const bases = await page.evaluate(async blueprint => {
        const app = window.__industrialPlannerAppHost!;
        const editor = app.workspace.editor!;
        await editor.queries.listBaseDocumentSummaries();
        const inlet = editor.document.getSnapshot().baseId;
        const region = app.workspace.registry.baseDefinitions.find(base => base.id === inlet)!.tag;
        const outlet = app.workspace.registry.baseDefinitions.find(base => base.tag === region && base.id !== inlet)!.id;
        for (const before of await editor.queries.readLatestBaseDocuments([inlet, outlet])) {
          await editor.actions.applySynchronizedDocument({
            ...before, entities: { ...before.entities, ...blueprint.entities },
            entityOrder: [...before.entityOrder, ...blueprint.entityOrder], slotLinks: blueprint.slotLinks,
          });
        }
        return { inlet, outlet };
      }, fixture);
      const panel = page.locator('[data-inspector-key="dark-pipe-link"]');
      await clickEntity(page, "inlet");
      await panel.getByRole("button", { name: "创建链接", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.mainCanvas.state.toolInfo.darkPipeLink)).toBeNull();
      await clickEntity(page, "inlet");
      await panel.getByRole("button", { name: "创建链接", exact: true }).click();
      await selectBase(page, bases.outlet);
      await clickEntity(page, "outlet");
      await expect.poll(() => visibleRelationCount(page)).toBe(1);
      await page.screenshot({ path: testInfo.outputPath("cross-base-visible.png") });
      await testInfo.attach("connected.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      await toggleMultiBase(page);
      await expect.poll(() => visibleRelationCount(page)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("cross-base-hidden.png") });
      await dismissInspector(page);
      await page.screenshot({ path: testInfo.outputPath("after.png") });
      await testInfo.attach("after.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });
      expect(errors).toEqual([]);
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function dismissInspector(page: Page): Promise<void> {
  const backdrop = page.locator(".inspector-dialog-backdrop");
  if (await backdrop.isVisible()) await backdrop.click({ position: { x: 4, y: 4 } });
}

async function toggleMultiBase(page: Page): Promise<void> {
  await dismissInspector(page);
  await page.locator("label").filter({ hasText: "同时运行所有基地" }).click();
  const guide = page.locator('[data-dialog-key="regional-multi-base-guide"]');
  if (await guide.isVisible()) await guide.click({ position: { x: 4, y: 4 } });
}

async function selectBase(page: Page, baseId: string): Promise<void> {
  await dismissInspector(page);
  await page.locator('[data-ui-button-id="base-current-select"]').click();
  await page.locator(`[data-base-id="${baseId}"]`).click();
  await page.getByRole("dialog", { name: "选择基地" }).getByRole("button", { name: "确定", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.document.getSnapshot().baseId)).toBe(baseId);
}

async function clickEntity(page: Page, entityId: string): Promise<void> {
  await dismissInspector(page);
  await clickCanvasEntity(page, entityId);
  await waitForDarkPipeSave(page);
}

async function waitForDarkPipeSave(page: Page): Promise<void> {
  await page.waitForFunction(() => !window.__industrialPlannerAppHost!.regionalSettings.darkPipeLinkSaving,
    null, { timeout: 30_000 });
}

async function visibleRelationCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.queries.getRegionalDarkPipeLinks().length);
}

