import { SCREEN_PROFILES } from "./harness/profiles";
import type { Locator } from "playwright/test";

import { expect, test } from "./harness/fixture";

const APP_URL = "http://127.0.0.1:4174/";


for (const profile of SCREEN_PROFILES) {
  test(`stage action clears content before exposing the red delete action [${profile.name}]`, async ({ browserSession: browser }) => {
    test.setTimeout(90_000);

    const context = await browser.profile(profile);
    const page = await context.newPage();

    try {

      await page.goto(APP_URL);
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost !== undefined)).toBe(true);

      const initialStage = await page.evaluate(() => {
        const stage = window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages[0];
        return stage === undefined ? null : {
          entryCount: stage.entries.length,
          id: stage.id,
          name: stage.name,
        };
      });
      expect(initialStage, profile.name).not.toBeNull();
      expect(initialStage?.entryCount, profile.name).toBe(0);
      if (initialStage === null) {
        throw new Error(`${profile.name}: initial stage unavailable`);
      }
      await page.evaluate(() => {
        const appHost = window.__industrialPlannerAppHost;
        if (appHost === undefined) {
          throw new Error("AppHost unavailable");
        }

        appHost.internalActions.setToolboxDockPreference("floating");
        appHost.internalActions.setDialogTab("toolbox", "module-balancing");
        if (!appHost.internalState.workbench.dialogState.toolbox.maximized) {
          appHost.internalActions.toggleDialogMaximized("toolbox");
        }
        appHost.internalActions.openDialog("toolbox");
      });

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

      const wizard = page.getByRole("navigation", { name: "模块配平" });
      await expect(wizard, profile.name).toBeVisible();
      await press(
        wizard.getByRole("button", { name: initialStage.name, exact: true }),
        profile.isMobile,
      );

      const clearButton = page.getByRole("button", { name: "清空阶段", exact: true });
      const deleteButton = page.getByRole("button", { name: "删除阶段", exact: true });
      await expect(deleteButton, profile.name).toBeVisible();
      await expect(clearButton, profile.name).toBeHidden();

      const libraryHeading = page.getByRole("heading", { name: "模块库", exact: true });
      if (!await libraryHeading.isVisible()) {
        await press(
          wizard.getByRole("button", { name: "模块库", exact: true }),
          profile.isMobile,
        );
      }
      await expect(libraryHeading, profile.name).toBeVisible();
      const libraryPanel = libraryHeading.locator("..").locator("..");
      const firstModuleCard = libraryPanel.locator('[role="button"][draggable]').first();
      await expect(firstModuleCard, profile.name).toBeVisible();
      await press(firstModuleCard, profile.isMobile);
      await expect(page.getByRole("heading", { name: "添加到阶段", exact: true }), profile.name)
        .toBeVisible();
      await press(
        page.getByRole("button", { name: "确认添加", exact: true }),
        profile.isMobile,
      );

      const drawerCloseButton = libraryHeading.locator("..")
        .getByRole("button", { name: "关闭", exact: true });
      if (await drawerCloseButton.isVisible()) {
        await press(drawerCloseButton, profile.isMobile);
      }
      await expect(clearButton, profile.name).toBeVisible();
      await expect(deleteButton, profile.name).toBeHidden();

      await press(
        wizard.getByRole("button", { name: "新建阶段", exact: true }),
        profile.isMobile,
      );
      const stagesBeforeClear = await page.evaluate(() =>
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages.map((stage) => ({ id: stage.id, name: stage.name })),
      );
      expect(stagesBeforeClear, profile.name).toHaveLength(2);
      const adjacentStage = stagesBeforeClear?.find((stage) => stage.id !== initialStage.id);
      expect(adjacentStage, profile.name).toBeDefined();
      if (adjacentStage === undefined) {
        throw new Error(`${profile.name}: adjacent stage unavailable`);
      }
      await press(
        wizard.getByRole("button", { name: initialStage.name, exact: true }),
        profile.isMobile,
      );
      await test.info().attach(`${profile.name}-before-clear.yaml`, {
        body: await wizard.ariaSnapshot(),
        contentType: "text/yaml",
      });

      await press(clearButton, profile.isMobile);
      await expect(clearButton, profile.name).toBeHidden();
      await expect(deleteButton, profile.name).toBeVisible();
      await expect.poll(() => page.evaluate((stageId) =>
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages.find((stage) => stage.id === stageId)?.entries.length,
        initialStage.id,
      ), { message: profile.name }).toBe(0);

      // 删除按钮颜色有 CSS transition；轮询相同终值，不更改颜色期望。
      await expect.poll(async () => {
        const deleteColor = await deleteButton.evaluate((button) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--danger)";
        document.body.append(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        return {
          actual: getComputedStyle(button).color,
          danger,
        };
      });
        return deleteColor.actual === deleteColor.danger;
      }, { message: profile.name }).toBe(true);

      await press(deleteButton, profile.isMobile);
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages.map((stage) => stage.id),
      ), { message: profile.name }).toEqual([adjacentStage.id]);
      await expect(wizard.getByRole("button", { name: adjacentStage.name, exact: true }), profile.name)
        .toHaveClass(/is-active/);

      await press(page.getByRole("button", { name: "删除阶段", exact: true }), profile.isMobile);
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages.length,
      ), { message: profile.name }).toBe(0);
      await expect(wizard.getByRole("button", { name: "画布", exact: true }), profile.name)
        .toHaveClass(/is-active/);
      await test.info().attach(`${profile.name}-after-delete.yaml`, {
        body: await wizard.ariaSnapshot(),
        contentType: "text/yaml",
      });
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function press(button: Locator, coarsePointer: boolean): Promise<void> {
  if (coarsePointer) {
    await button.tap();
    return;
  }

  await button.click();
}
