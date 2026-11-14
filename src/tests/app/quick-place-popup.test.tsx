// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AppHost } from "@/app/host/app-host";
import { createAppTestHost } from "@/tests/helpers/app-test-workspace";
import { canPlaceEntityDefinitionInBase } from "@/app/placement-zone-availability";
import { buildQuickPlaceDeviceEntries } from "@/app/quick-place";
import { recentPlacementDevices } from "@/app/recent-placement-devices";
import { QuickPlacePopup } from "@/app/shell/quick-place/quick-place-popup";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { type EditorHost } from "@/editor/editor-host";
import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createWorldDocument } from "@/domain/document/world-document";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
    audio: null,
  };
}

function dispatchPointerDown(target: Element): void {
  target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
}

function dispatchInput(target: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

  descriptor?.set?.call(target, value);
  target.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
}

function dispatchKeyDown(
  target: Element,
  options: {
    readonly key: string;
    readonly code: string;
    readonly isComposing?: boolean;
  },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: options.code,
    key: options.key,
  });

  if (options.isComposing === true) {
    Object.defineProperty(event, "isComposing", { value: true });
  }
  target.dispatchEvent(event);
  return event;
}

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();

  return {
    clearData(format?: string) {
      if (format === undefined) {
        data.clear();
      } else {
        data.delete(format);
      }
    },
    dropEffect: "none",
    effectAllowed: "uninitialized",
    files: [] as unknown as FileList,
    getData(format: string) {
      return data.get(format) ?? "";
    },
    items: [] as unknown as DataTransferItemList,
    setData(format: string, value: string) {
      data.set(format, value);
    },
    setDragImage() {},
    get types() {
      return Array.from(data.keys());
    },
  } as DataTransfer;
}

function dispatchDragEvent(
  target: Element,
  type: string,
  dataTransfer: DataTransfer,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    clientX: { value: 0 },
    clientY: { value: 0 },
    dataTransfer: { value: dataTransfer },
    relatedTarget: { value: null },
  });
  target.dispatchEvent(event);
}

/** 只占最后一个收藏位，让收藏格显示出来并留出前面的空位。 */
function seedLastFavoriteSlot(appHost: AppHost): void {
  runInAction(() => {
    appHost.internalState.workbench.quickPlaceFavoriteEntityIds = [...Array<null>(9).fill(null), "furnance_1"];
  });
}

describe("QuickPlacePopup", () => {
  let container: HTMLDivElement;
  let root: Root;
  let appHost: AppHost;
  let editor: EditorHost;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    appHost = createAppTestHost(createWorkspace());
    editor = createEditorTestHost(appHost.workspace);
    await editor.internalDocuments.ready();
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "wuling_protocol_core" }));

    runInAction(() => {
      appHost.mainCanvas.state.runtime.quickPlace.visible = true;
      appHost.mainCanvas.state.runtime.quickPlace.anchor = { x: 120, y: 80 };
      appHost.mainCanvas.state.runtime.quickPlace.openSource = "pointer";
    });
  });

  afterEach(async () => {
    act(() => {
      root.unmount();
    });
    await editor.internalHistory.flush();
    await editor.internalDocuments.flush();
    await editor.internalDocuments.settleMaintenance();
    editor.dispose();
    appHost.dispose();
    container.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps pointer-opened search unfocused and blurs it before interacting outside the input", () => {
    seedLastFavoriteSlot(appHost);
    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input") as HTMLInputElement | null;
    const deviceButton = container.querySelector('[role="option"]');
    const emptyFavoriteSlot = container.querySelector(".quick-place-favorite-slot.is-empty");

    expect(searchInput).not.toBeNull();
    expect(deviceButton).not.toBeNull();
    expect(emptyFavoriteSlot).not.toBeNull();
    expect(document.activeElement).not.toBe(searchInput);

    act(() => {
      searchInput?.focus();
      dispatchInput(searchInput!, deviceButton?.getAttribute("title") ?? "");
    });
    expect(document.activeElement).toBe(searchInput);

    const filteredDeviceButton = container.querySelector('[role="option"]');
    expect(filteredDeviceButton).not.toBeNull();

    act(() => {
      dispatchPointerDown(filteredDeviceButton!);
    });
    expect(document.activeElement).not.toBe(searchInput);

    act(() => {
      searchInput?.focus();
      dispatchPointerDown(emptyFavoriteSlot!);
    });
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("focuses search when opened by the keyboard shortcut", () => {
    runInAction(() => {
      appHost.mainCanvas.state.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input");
    expect(document.activeElement).toBe(searchInput);
  });

  it("distinguishes same-named variants in results and favorite slots", () => {
    runInAction(() => {
      appHost.internalState.workbench.quickPlaceFavoriteEntityIds = [
        "furnance_1",
        "furnance_1_liquid",
      ];
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const results = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const normalResult = results.find((button) => button.id.endsWith("-furnance_1"));
    const liquidResult = results.find((button) => button.id.endsWith("-furnance_1_liquid"));
    const favorites = Array.from(container.querySelectorAll<HTMLButtonElement>(".quick-place-favorite-slot"));
    const normalBadge = normalResult?.querySelector<HTMLElement>(".quick-place-variant-badge");
    const liquidBadge = liquidResult?.querySelector<HTMLElement>(".quick-place-variant-badge");

    expect(normalResult?.querySelector(".quick-place-device-name")?.textContent).toBe(
      liquidResult?.querySelector(".quick-place-device-name")?.textContent,
    );
    expect(normalResult?.getAttribute("aria-label")).toContain("基础模式");
    expect(liquidResult?.getAttribute("aria-label")).toContain("液体模式");
    expect(normalBadge?.dataset.entityVariantName).toBe("normal");
    expect(liquidBadge?.dataset.entityVariantName).toBe("liquid");
    expect(normalBadge?.style.maskImage).toContain("icon_port_normal.webp");
    expect(liquidBadge?.style.maskImage).toContain("icon_port_liquid.webp");
    expect(favorites[0]?.getAttribute("aria-label")).toContain("基础模式");
    expect(favorites[1]?.getAttribute("aria-label")).toContain("液体模式");
    expect(favorites[0]?.querySelector(".quick-place-variant-badge")).not.toBeNull();
    expect(favorites[1]?.querySelector(".quick-place-variant-badge")).not.toBeNull();
  });

  it("navigates filtered results without moving input focus and selects the active result with Enter", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    runInAction(() => {
      appHost.mainCanvas.state.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input") as HTMLInputElement | null;
    const resultButtons = Array.from(
      container.querySelectorAll('[role="option"]'),
    ) as HTMLButtonElement[];
    expect(searchInput).not.toBeNull();
    expect(resultButtons.length).toBeGreaterThan(1);

    act(() => {
      dispatchKeyDown(searchInput!, { code: "ArrowDown", key: "ArrowDown" });
    });
    expect(resultButtons[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      dispatchKeyDown(searchInput!, { code: "ArrowDown", key: "ArrowDown" });
    });
    expect(resultButtons[1]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(searchInput);

    act(() => {
      dispatchKeyDown(searchInput!, { code: "Enter", key: "Enter" });
    });
    expect(handleMouseTap).toHaveBeenCalledOnce();
    expect(container.querySelector(".quick-place-popup")).toBeNull();
  });

  it("clamps result navigation, resets the active result after search changes, and ignores empty-result Enter", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    runInAction(() => {
      appHost.mainCanvas.state.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input") as HTMLInputElement | null;
    let resultButtons = Array.from(
      container.querySelectorAll('[role="option"]'),
    ) as HTMLButtonElement[];
    const lastResult = resultButtons.at(-1);
    expect(searchInput).not.toBeNull();
    expect(lastResult).toBeDefined();

    act(() => {
      dispatchKeyDown(searchInput!, { code: "ArrowUp", key: "ArrowUp" });
      dispatchKeyDown(searchInput!, { code: "ArrowDown", key: "ArrowDown" });
    });
    expect(lastResult?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      dispatchInput(searchInput!, "pipe");
    });
    expect(container.querySelector('[aria-selected="true"]')).toBeNull();

    act(() => {
      dispatchKeyDown(searchInput!, { code: "ArrowDown", key: "ArrowDown" });
      dispatchKeyDown(searchInput!, { code: "ArrowUp", key: "ArrowUp" });
    });
    resultButtons = Array.from(
      container.querySelectorAll('[role="option"]'),
    ) as HTMLButtonElement[];
    expect(resultButtons[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      dispatchInput(searchInput!, "__no_quick_place_result__");
    });
    act(() => {
      dispatchKeyDown(searchInput!, { code: "Enter", key: "Enter" });
    });
    expect(container.querySelector(".quick-place-empty-results")).not.toBeNull();
    expect(container.querySelector(".quick-place-popup")).not.toBeNull();
    expect(handleMouseTap).not.toHaveBeenCalled();
  });

  it("selects the first filtered result with Enter when no result was explicitly activated", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    const firstEntry = buildQuickPlaceDeviceEntries({
      definitions: appHost.workspace.registry.entityDefinitions,
      translate: appHost.actions.translate,
      canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(appHost, definition, appHost.workspace.editor!.document.getSnapshot().baseId),
    })[0];
    runInAction(() => {
      appHost.mainCanvas.state.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input");
    expect(firstEntry).toBeDefined();
    act(() => {
      dispatchKeyDown(searchInput!, { code: "Enter", key: "Enter" });
    });

    expect(handleMouseTap).toHaveBeenCalledWith(expect.objectContaining({
      uiButtonId: `ui-left-dock-placement-mode-${firstEntry?.id}-mouse-tap`,
    }));
  });

  it("prioritizes occupied numeric favorites and leaves empty numeric slots unconsumed", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    const firstEntry = buildQuickPlaceDeviceEntries({
      definitions: appHost.workspace.registry.entityDefinitions,
      translate: appHost.actions.translate,
      canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(appHost, definition, appHost.workspace.editor!.document.getSnapshot().baseId),
    })[0];
    expect(firstEntry).toBeDefined();
    runInAction(() => {
      appHost.mainCanvas.state.runtime.quickPlace.openSource = "keyboard-shortcut";
      appHost.internalState.workbench.quickPlaceFavoriteEntityIds = [firstEntry!.id];
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input");
    let occupiedEvent!: KeyboardEvent;
    act(() => {
      occupiedEvent = dispatchKeyDown(searchInput!, { code: "Digit1", key: "1" });
    });
    expect(occupiedEvent.defaultPrevented).toBe(true);
    expect(handleMouseTap).toHaveBeenCalledOnce();

    act(() => {
      runInAction(() => {
        appHost.mainCanvas.state.runtime.quickPlace.visible = true;
        appHost.mainCanvas.state.runtime.quickPlace.anchor = { x: 120, y: 80 };
        appHost.mainCanvas.state.runtime.quickPlace.openSource = "keyboard-shortcut";
        appHost.internalState.workbench.quickPlaceFavoriteEntityIds = [];
      });
    });
    const reopenedSearchInput = container.querySelector(".quick-place-search-input");
    let emptyEvent!: KeyboardEvent;
    act(() => {
      emptyEvent = dispatchKeyDown(reopenedSearchInput!, { code: "Digit1", key: "1" });
    });
    expect(emptyEvent.defaultPrevented).toBe(false);
  });

  it("does not navigate or select results while an input method is composing", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    runInAction(() => {
      appHost.mainCanvas.state.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input");
    let enterEvent!: KeyboardEvent;
    act(() => {
      dispatchKeyDown(searchInput!, {
        code: "ArrowDown",
        isComposing: true,
        key: "ArrowDown",
      });
      enterEvent = dispatchKeyDown(searchInput!, {
        code: "Enter",
        isComposing: true,
        key: "Enter",
      });
    });

    expect(container.querySelector('[aria-selected="true"]')).toBeNull();
    expect(enterEvent.defaultPrevented).toBe(false);
    expect(handleMouseTap).not.toHaveBeenCalled();
  });

  it("commits the highlighted favorite slot when a mobile drag ends without drop", () => {
    seedLastFavoriteSlot(appHost);
    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const deviceButton = container.querySelector('[role="option"]') as HTMLButtonElement | null;
    const emptyFavoriteSlot = container.querySelector(".quick-place-favorite-slot.is-empty") as HTMLButtonElement | null;
    const dataTransfer = createDataTransfer();

    expect(deviceButton).not.toBeNull();
    expect(emptyFavoriteSlot).not.toBeNull();

    act(() => {
      dispatchDragEvent(deviceButton!, "dragstart", dataTransfer);
      dispatchDragEvent(emptyFavoriteSlot!, "dragenter", dataTransfer);
      dispatchDragEvent(deviceButton!, "dragend", dataTransfer);
    });

    expect(emptyFavoriteSlot?.getAttribute("aria-label")).toBe(`1 ${deviceButton?.title}`);
  });

  it("uses the active in-memory payload when mobile drop data is empty", () => {
    seedLastFavoriteSlot(appHost);
    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const deviceButton = container.querySelector('[role="option"]') as HTMLButtonElement | null;
    const emptyFavoriteSlot = container.querySelector(".quick-place-favorite-slot.is-empty") as HTMLButtonElement | null;
    const sourceDataTransfer = createDataTransfer();
    const emptyDropDataTransfer = createDataTransfer();

    expect(deviceButton).not.toBeNull();
    expect(emptyFavoriteSlot).not.toBeNull();

    act(() => {
      dispatchDragEvent(deviceButton!, "dragstart", sourceDataTransfer);
      dispatchDragEvent(emptyFavoriteSlot!, "dragenter", sourceDataTransfer);
      dispatchDragEvent(emptyFavoriteSlot!, "drop", emptyDropDataTransfer);
      dispatchDragEvent(deviceButton!, "dragend", sourceDataTransfer);
    });

    expect(emptyFavoriteSlot?.getAttribute("aria-label")).toBe(`1 ${deviceButton?.title}`);
  });

  it("hides the favorite slots until a device is starred", () => {
    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    expect(container.querySelector(".quick-place-favorite-slot")).toBeNull();

    const deviceButton = container.querySelector<HTMLButtonElement>('[role="option"]');
    const starToggle = deviceButton?.parentElement?.querySelector<HTMLButtonElement>("[aria-pressed]");
    act(() => {
      starToggle?.click();
    });

    const firstSlot = container.querySelector(".quick-place-favorite-slot");
    expect(firstSlot?.getAttribute("aria-label")).toBe(`1 ${deviceButton?.title}`);
  });

  it("lists recently placed devices above the results while the search is empty", () => {
    const [first, second] = Array.from(
      buildQuickPlaceDeviceEntries({
        definitions: appHost.workspace.registry.entityDefinitions,
        translate: appHost.actions.translate,
        canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(appHost, definition, "wuling_protocol_core"),
      }),
    );
    act(() => {
      recentPlacementDevices.record(first!.id);
      recentPlacementDevices.record(second!.id);
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const recent = container.querySelector(".quick-place-recent");
    const recentTitles = Array.from(recent?.querySelectorAll<HTMLButtonElement>(".quick-place-device-button") ?? [])
      .map((button) => button.title);
    expect(recentTitles.slice(0, 2)).toEqual([second!.name, first!.name]);
    expect(recent?.querySelector('[role="option"]')).toBeNull();

    const handleTouchTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonTouchTap");
    act(() => {
      const button = recent!.querySelector<HTMLButtonElement>(".quick-place-device-button")!;
      const event = new Event("pointerup", { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerType: { value: "pen" }, button: { value: 0 } });
      button.dispatchEvent(event);
    });
    expect(handleTouchTap).toHaveBeenCalledWith(expect.objectContaining({
      uiButtonId: `ui-left-dock-placement-mode-${second!.id}-touch-tap`,
    }));

    act(() => {
      runInAction(() => {
        appHost.mainCanvas.state.runtime.quickPlace.visible = true;
        appHost.mainCanvas.state.runtime.quickPlace.anchor = { x: 120, y: 80 };
        appHost.mainCanvas.state.runtime.quickPlace.searchQuery = first!.name;
      });
    });
    expect(container.querySelector(".quick-place-recent")).toBeNull();
  });
});
