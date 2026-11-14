import { portIsOpen } from "../../../scripts/browser-test/runtime.mjs";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

// 笔优先：主要界面上每个可点按控件的有效命中区域（含 ::before 扩展）都不小于 36px。
// 逐个面板打开后用 elementFromPoint 探测控件中心上下左右 ±17px 是否仍命中该控件。
test.use({ appServer: false });

const desktop = SCREEN_PROFILES.find((profile) => profile.name === "desktop")!;

test("interactive controls keep a pen-sized hit area on the main surfaces", async ({ browserSession, round }) => {
  test.setTimeout(180_000);
  if (await portIsOpen(4188)) throw new Error("4188 已被占用，不能接管其他服务");
  const server = await round.start(process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4188", "--strictPort"],
    "pen-target-vite.log", { NODE_ENV: "development" });
  await round.waitForServer(server, "http://127.0.0.1:4188", 60_000);
  const cli = await browserSession.openCli(desktop);
  const violations = await cli.runJson(`async page => {
    await page.addInitScript(() => localStorage.setItem("v3-app-settings", JSON.stringify({ locale: "en-US" })));
    await page.goto('http://127.0.0.1:4188');
    await page.locator('footer').waitFor();
    const sweep = (surface) => page.evaluate((surface) => {
      const reach = 17;
      const found = [];
      const selector = 'button, [role="button"], select, [role="tab"], [role="option"]';
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || element.closest('[inert], footer')) continue;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        if (document.elementFromPoint(cx, cy)?.closest(selector) !== element) continue;
        const probes = [[cx - reach, cy], [cx + reach, cy], [cx, cy - reach], [cx, cy + reach]];
        const missed = probes.some(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit === null || (hit !== element && !element.contains(hit));
        });
        if (missed) {
          found.push(surface + ': ' + (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 40)
            + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height));
        }
      }
      return found;
    }, surface);
    const open = (name) => page.getByRole('button', { name, exact: true }).first().click();
    const found = [];
    found.push(...await sweep('placement'));
    for (const panel of ['Blueprint', 'History', 'Base']) {
      await open(panel);
      found.push(...await sweep(panel));
    }
    await open('Placement');
    for (const dialog of ['Toolbox', 'Help', 'Settings']) {
      await open(dialog);
      await page.waitForTimeout(300);
      found.push(...await sweep(dialog));
      await page.keyboard.press('Escape');
    }
    return found;
  }`) as string[];

  expect(violations).toEqual([]);
});
