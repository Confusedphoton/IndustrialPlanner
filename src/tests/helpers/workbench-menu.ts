import { act } from "react";

export function openWorkbenchMenu(container: HTMLElement, more = false): void {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="菜单"], button[aria-label="Menu"]');
  if (!trigger) throw new Error("Workbench menu is unavailable");
  if (trigger.getAttribute("aria-expanded") !== "true") act(() => trigger.click());
  if (more) {
    const summary = container.querySelector<HTMLElement>("details > summary");
    if (!summary) throw new Error("More menu is unavailable");
    if (!(summary.parentElement as HTMLDetailsElement).open) act(() => summary.click());
  }
}

export function clickWorkbenchMenuItem(container: HTMLElement, title: string, more = false): void {
  openWorkbenchMenu(container, more);
  const item = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!item) throw new Error(`Workbench menu item is unavailable: ${title}`);
  act(() => item.click());
}
