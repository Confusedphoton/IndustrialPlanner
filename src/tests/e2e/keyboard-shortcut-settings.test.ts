import { SCREEN_PROFILES } from "./harness/profiles";
import { expect, test, type Page } from "./harness/fixture";


const EXPECTED_GROUPS = [
  { id: "quick-access", title: "快速访问与面板", actionCount: 6 },
  { id: "placement", title: "放置入口", actionCount: 7 },
  { id: "operation", title: "当前操作与选区", actionCount: 9 },
  { id: "viewport", title: "视口", actionCount: 5 },
  { id: "history", title: "历史", actionCount: 2 },
] as const;

for (const profile of SCREEN_PROFILES.filter(profile => profile.name === "desktop")) {
  test(`shortcut settings groups actions and resolves conflicts from real route scopes [${profile.name}]`, async ({ browserSession: browser }) => {
  test.setTimeout(120_000);

    const context = await browser.profile(profile);
    const page = await context.newPage();

    try {
      await page.goto("/");
      await openShortcutSettings(page);

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

      const shortcutDialog = page.locator(".keyboard-shortcut-settings-dialog");
      await expect(shortcutDialog.locator('[data-shortcut-id][data-slot-index="0"]')).toHaveCount(29);
      await expect(primarySlot(page, "shortcut-cut-selection")).toHaveAttribute("aria-label", /剪切选区.*Ctrl\+X/);
      await expect(shortcutDialog.locator("[data-shortcut-group]")).toHaveCount(5);
      for (const groupSpec of EXPECTED_GROUPS) {
        const group = shortcutDialog.locator(`[data-shortcut-group="${groupSpec.id}"]`);
        await expect(group.getByRole("heading", { level: 2, name: groupSpec.title })).toBeVisible();
        await expect(group.locator(":scope > article")).toHaveCount(groupSpec.actionCount);
      }

      const rotate = primarySlot(page, "shortcut-rotate");
      const resourcesPower = primarySlot(page, "shortcut-resources-power");
      await captureBinding(page, "shortcut-rotate", "g");
      await expect(page.locator(".keyboard-shortcut-conflict-dialog")).toHaveCount(0);
      await expect(rotate).toHaveAttribute("aria-label", /· G$/);
      await expect(resourcesPower).toHaveAttribute("aria-label", /· G$/);

      await captureBinding(page, "shortcut-rotate", "v");
      const chordConflict = page.locator(".keyboard-shortcut-conflict-dialog");
      await expect(chordConflict).toBeVisible();
      await expect(chordConflict).toContainText("粘贴选区（Ctrl+V）");
      await chordConflict.getByRole("button", { name: "取消" }).click();
      await expect(rotate).toHaveAttribute("aria-label", /· G$/);

      const quickPlace = primarySlot(page, "shortcut-quick-place");
      await captureBinding(page, "shortcut-quick-place", "1");
      const fixedConflict = page.locator(".keyboard-shortcut-conflict-dialog");
      await expect(fixedConflict).toContainText("选择放置设备快捷位（1）");
      await expect(fixedConflict).toContainText("无法替换");
      await expect(fixedConflict.getByRole("button", { name: "更换" })).toHaveCount(0);
      await fixedConflict.getByRole("button", { name: "取消" }).click();
      await expect(quickPlace).toHaveAttribute("aria-label", /· Z$/);

      await resetAllShortcuts(page);
      await expect(rotate).toHaveAttribute("aria-label", /· R$/);
      const rotateViewport = primarySlot(page, "shortcut-rotate-viewport");
      await expect(rotateViewport).toHaveAttribute("aria-label", /· Ctrl\+R$/);

      await captureBinding(page, "shortcut-rotate-viewport", "r");
      await expect(page.locator(".keyboard-shortcut-conflict-dialog")).toHaveCount(0);
      await expect(rotate).toHaveAttribute("aria-label", /· R$/);
      await expect(rotateViewport).toHaveAttribute("aria-label", /· R$/);

      await page.reload();

      const restoredSettingsDialog = page.getByRole("dialog", { name: "设置", exact: true });
      await expect(restoredSettingsDialog).toBeVisible();
      await restoredSettingsDialog.getByRole("button", { name: "打开快捷键设置", exact: true }).click();
      await expect(page.locator(".keyboard-shortcut-settings-dialog")).toBeVisible();
      await expect(primarySlot(page, "shortcut-rotate")).toHaveAttribute("aria-label", /· R$/);
      await expect(primarySlot(page, "shortcut-rotate-viewport")).toHaveAttribute("aria-label", /· R$/);

      await captureModifierOnlyBinding(page, "shortcut-rotate", "Control");
      await expect(primarySlot(page, "shortcut-rotate")).toHaveAttribute("aria-label", /· Ctrl$/);
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function openShortcutSettings(page: Page): Promise<void> {
  const shortcutDialog = page.locator(".keyboard-shortcut-settings-dialog");
  if (await shortcutDialog.isVisible()) {
    return;
  }
  const settingsDialog = page.getByRole("dialog", { name: "设置", exact: true });
  if (!await settingsDialog.isVisible()) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
  }
  await page.getByRole("button", { name: "打开快捷键设置", exact: true }).click();
  await expect(shortcutDialog).toBeVisible();
}

function primarySlot(page: Page, shortcutId: string) {
  return page.locator(`[data-shortcut-id="${shortcutId}"][data-slot-index="0"]`);
}

async function captureBinding(page: Page, shortcutId: string, binding: string): Promise<void> {
  await primarySlot(page, shortcutId).click();
  await page.keyboard.press(binding);
}

async function captureModifierOnlyBinding(
  page: Page,
  shortcutId: string,
  modifier: string,
): Promise<void> {
  await primarySlot(page, shortcutId).click();
  await page.keyboard.down(modifier);
  await page.keyboard.up(modifier);
}

async function resetAllShortcuts(page: Page): Promise<void> {
  const shortcutDialog = page.locator(".keyboard-shortcut-settings-dialog");
  await shortcutDialog.getByRole("button", { name: "重置全部快捷键" }).click();
  const resetDialog = page.locator(".keyboard-shortcut-reset-dialog");
  await expect(resetDialog).toBeVisible();
  await resetDialog.getByRole("button", { name: "重置全部快捷键" }).click();
  await expect(resetDialog).toBeHidden();
}

