import { SCREEN_PROFILES } from "./harness/profiles";
import { readFileSync } from "node:fs";
import type { BlueprintDocument } from "../../domain/document/blueprint-document";
import { expect, test, type Page } from "./harness/fixture";
import { waitForAppReady, clickEntity } from "./harness/workbench";

const TOOLTIP_TEXT = "自然资源现在由基地面板的地区资源卡片控制";
const APP_URL = "http://127.0.0.1:4174/";


for (const profile of SCREEN_PROFILES) {
  test(`natural-resource warehouse links keep a locked infinity control with hover and click tooltip [${profile.name}]`, async ({ browserSession: browser }) => {
  test.setTimeout(90_000);

    const context = await browser.profile(profile);
    const page = await context.newPage();

    try {
      await page.goto(APP_URL);
      await waitForAppReady(page);
      await installNaturalResourceWarehouseLink(page);

      const actualProfile = await page.evaluate(() =>
        window.__industrialPlannerAppHost?.state.screenProfile,
      );
      expect(actualProfile, profile.name).toMatchObject({
        viewportWidth: profile.width,
        viewportHeight: profile.height,
        devicePixelRatio: profile.dpr,
        deviceClass: profile.name,
        screenShape: profile.shape,
        hasTouch: true,
      });

      const lockButton = page.locator("[data-warehouse-link-natural-resource-lock]");
      await expect(lockButton, profile.name).toBeVisible();
      await expect(lockButton, profile.name).toHaveAttribute("aria-disabled", "true");
      await expect(lockButton, profile.name).not.toHaveAttribute("aria-pressed", /.+/);

      if (profile.name === "desktop") {
        await lockButton.hover();
        await expect(page.getByRole("tooltip"), profile.name).toHaveText(TOOLTIP_TEXT);
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip"), profile.name).toBeHidden();
      }

      const configBefore = await readNaturalResourceIgnoreStock(page);
      if (profile.isMobile) {
        await lockButton.tap({ force: true });
      } else {
        await lockButton.click({ force: true });
      }
      await page.mouse.move(0, 0);

      const tooltip = page.getByRole("tooltip");
      await expect(tooltip, profile.name).toHaveText(TOOLTIP_TEXT);
      const geometry = await tooltip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          parentTag: element.parentElement?.tagName ?? null,
          position: getComputedStyle(element).position,
          right: rect.right,
          top: rect.top,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        };
      });
      expect(geometry.parentTag, profile.name).toBe("BODY");
      expect(geometry.position, profile.name).toBe("fixed");
      expect(geometry.left, profile.name).toBeGreaterThanOrEqual(8);
      expect(geometry.right, profile.name).toBeLessThanOrEqual(geometry.viewportWidth - 8);
      expect(geometry.top, profile.name).toBeGreaterThanOrEqual(8);
      expect(geometry.bottom, profile.name).toBeLessThanOrEqual(geometry.viewportHeight - 8);
      expect(await readNaturalResourceIgnoreStock(page), profile.name).toBe(configBefore);

      await page.keyboard.press("Escape");
      await expect(tooltip, profile.name).toBeHidden();
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function installNaturalResourceWarehouseLink(page: Page): Promise<void> {
  const payload = JSON.parse(readFileSync("src/tests/fixtures/blueprints/e2e/natural-resource-warehouse-link.schema7.json", "utf8")) as BlueprintDocument;
  const loaded = await page.evaluate(input => window.__test__!.loadBlueprint(input), payload);
  await clickEntity(page, loaded.entityIds[0]!);
}

async function readNaturalResourceIgnoreStock(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const entity = window.__test__!.entity("e2e-natural-resource-unloader");
    return entity?.config["storageSlotGroups[0].slots[0].ignoreStock"];
  });
}
