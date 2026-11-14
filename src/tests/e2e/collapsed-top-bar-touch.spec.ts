import { expect, test } from "./harness/fixture";

test.use({
  viewport: {
    width: 764,
    height: 345,
  },
  deviceScaleFactor: 3.125,
  hasTouch: true,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
});

test("collapsed top-bar controls remain outside canvas input and accept touch taps", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");

  const collapseButton = page.getByTitle("折叠 运行控制");
  await expect(collapseButton).toBeVisible({ timeout: 20_000 });
  await collapseButton.tap();

  const expandButton = page.getByTitle("展开 运行控制");
  await expect(expandButton).toBeVisible();
  await expect.poll(() => expandButton.evaluate((button) => button.closest("main") === null)).toBe(true);

  const touchEventProbes = [
    {
      button: page.locator('[data-ui-button-id="top-bar-simulation-control"]'),
      eventType: "pointerup",
    },
    {
      button: page.locator('[data-ui-button-id="top-bar-timeline"]'),
      eventType: "click",
    },
    {
      button: page.getByLabel("进入全屏"),
      eventType: "click",
    },
    {
      button: expandButton,
      eventType: "click",
    },
  ] as const;

  for (const { button, eventType } of touchEventProbes) {
    await button.evaluate((element, expectedEventType) => {
      element.addEventListener(expectedEventType, (event) => {
        element.setAttribute("data-touch-event-received", expectedEventType);
        event.stopPropagation();
      }, { once: true });
    }, eventType);

    await button.tap();
    await expect(button).toHaveAttribute("data-touch-event-received", eventType);
  }
});
