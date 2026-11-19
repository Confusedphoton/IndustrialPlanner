import { runInAction } from "mobx";

import type { CanvasInteractionController } from "@/app/canvas";
import {
  openMarkingMenuState,
  resolveMarkingMenuDeviceId,
  trackMarkingMenuPointer,
  type MarkingMenuGroup,
} from "@/app/canvas/marking-menu";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { buildPlacementDeviceSections } from "@/app/shell/panels/placement-catalog";
import type { WorldEntity } from "@/domain/document/world-document";

import type { GestureMappingModule } from "../types";
import { holdDeviceForPlacement } from "./hypergryph-single-placement-gesture-module";
import { isPreviewBoundingBoxAtClientPoint, TOUCH_PREVIEW_HIT_SLOP_PX } from "./mobile-preview-bounds";

/**
 * 环形标记菜单的触发与跟踪：选择工具中在空白处长按、放置中在任意处长按（触控时避开预览本身）打开；
 * 不松开继续滑动选择，松开即把设备交到手上；原地松开则菜单留下，改为点按选择。
 * 选择工具开启「直接框选」时，触控长按空白处仍是框选，菜单只响应笔与鼠标。
 */
export function createHypergryphMarkingMenuGestureModule(): GestureMappingModule<AppHost> {
  let dragGestureId: string | null = null;

  return {
    id: "hypergryph-marking-menu-gesture",
    // 先于移动、框选与吸管判定长按。
    priority: 220,
    cancel() {
      dragGestureId = null;
    },
    acceptsLongPress(context, gridHasEntity) {
      const tool = context.canvas.state.activeTool;
      return context.canvas.canUseWorkbenchActions
        && (tool === "single-placement" || (tool === "select" && !gridHasEntity));
    },
    handle(event, context) {
      const canvas = context.canvas;
      const menu = canvas.state.runtime.markingMenu;

      switch (event.type) {
        case "mouse-long-press-ready":
          if (event.button !== 0 || !canOpenAt(canvas, "mouse", event.position, event.pointerEntity, event.isPen)) {
            return { status: "ignored" };
          }
          return openMarkingMenu(canvas, "mouse", event.position) ? { status: "handled" } : { status: "ignored" };

        case "tap-long-press-ready":
          if (!canOpenAt(canvas, "touch", event.position, event.pointerEntity)) {
            return { status: "ignored" };
          }
          return openMarkingMenu(canvas, "touch", event.position) ? { status: "handled" } : { status: "ignored" };

        case "mouse dragstart":
        case "touch dragstart":
          if (menu === null || menu.mode !== "drag") {
            return { status: "ignored" };
          }
          dragGestureId = event.gestureId;
          trackPointer(canvas, event.position);
          return { status: "claimed" };

        case "mouse dragmove":
        case "touch dragmove":
          if (dragGestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          trackPointer(canvas, event.position);
          return { status: "handled" };

        case "mouse dragend":
        case "touch dragend":
          if (dragGestureId !== event.gestureId) {
            return { status: "ignored" };
          }
          dragGestureId = null;
          if (event.reason === "release") {
            trackPointer(canvas, event.position);
            chooseHighlightedDevice(canvas, event.position);
          } else {
            closeMarkingMenu(canvas);
          }
          return { status: "handled" };

        case "mouse tap":
        case "touch tap":
          // 长按后原地松开：菜单留着，改为点按分类与设备。
          if (menu === null || menu.mode !== "drag" || !event.longPress) {
            return { status: "ignored" };
          }
          runInAction(() => {
            canvas.state.runtime.markingMenu = { ...menu, mode: "tap" };
          });
          return { status: "handled" };

        case "on-exit-active-tool":
          if (menu !== null) {
            closeMarkingMenu(canvas);
          }
          return { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

export function closeMarkingMenu(canvas: CanvasInteractionController): void {
  runInAction(() => {
    canvas.state.runtime.markingMenu = null;
  });
}

/** 点按方式下进入某个分类。 */
export function enterMarkingMenuGroup(canvas: CanvasInteractionController, groupIndex: number): void {
  const menu = canvas.state.runtime.markingMenu;
  if (menu === null) return;
  runInAction(() => {
    canvas.state.runtime.markingMenu = { ...menu, level: 2, groupIndex, itemIndex: null };
  });
}

/** 选定设备：关闭菜单，设备交到手上，预览出现在打开菜单的位置（笔与鼠标随后跟随指针）。 */
export function chooseMarkingMenuDevice(
  canvas: CanvasInteractionController,
  deviceId: string,
  position: GesturePosition | null = null,
): void {
  const menu = canvas.state.runtime.markingMenu;
  closeMarkingMenu(canvas);
  if (menu === null) return;
  holdDeviceForPlacement(canvas, { deviceId }, {
    source: menu.pointer,
    position: menu.pointer === "mouse" && position !== null ? position : menu.origin,
  });
}

function chooseHighlightedDevice(canvas: CanvasInteractionController, position: GesturePosition): void {
  const menu = canvas.state.runtime.markingMenu;
  const deviceId = menu === null ? null : resolveMarkingMenuDeviceId(menu);
  if (menu !== null && menu.level === 1 && menu.groupIndex !== null) {
    // 停在分类上抬笔：展开该分类，设备留着供点按。
    runInAction(() => {
      canvas.state.runtime.markingMenu = { ...menu, mode: "tap", level: 2, itemIndex: null };
    });
    return;
  }
  if (deviceId === null) {
    closeMarkingMenu(canvas);
    return;
  }
  chooseMarkingMenuDevice(canvas, deviceId, position);
}

function trackPointer(canvas: CanvasInteractionController, position: GesturePosition): void {
  const menu = canvas.state.runtime.markingMenu;
  if (menu === null) return;
  const next = trackMarkingMenuPointer(menu, position);
  if (
    next.level === menu.level
    && next.groupIndex === menu.groupIndex
    && next.itemIndex === menu.itemIndex
    && next.reachedRing === menu.reachedRing
  ) return;
  runInAction(() => {
    canvas.state.runtime.markingMenu = next;
  });
}

function canOpenAt(
  canvas: CanvasInteractionController,
  pointer: "mouse" | "touch",
  position: GesturePosition,
  pointerEntity: WorldEntity | null,
  isPen = false,
): boolean {
  const editor = canvas.editor;
  if (editor === null || !canvas.canUseWorkbenchActions || !canvas.isOperationEnabled("confirm-placement")) {
    return false;
  }
  switch (canvas.state.activeTool) {
    case "select":
      return pointerEntity === null
        && (pointer === "mouse" || !canvas.workbench.state.settings.hypergryphImmediateMarquee);
    case "single-placement":
      return (pointer === "mouse" && !isPen) || !isPreviewBoundingBoxAtClientPoint({
        editor,
        view: canvas.view,
        position,
        hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
      });
    default:
      return false;
  }
}

function openMarkingMenu(canvas: CanvasInteractionController, pointer: "mouse" | "touch", origin: GesturePosition): boolean {
  const groups: MarkingMenuGroup[] = buildPlacementDeviceSections(canvas.workbench).map((section) => ({
    titleKey: section.titleKey,
    deviceIds: section.buttons.map((button) => button.uiButtonId.replace("placement-", "")),
  }));
  if (groups.length === 0) {
    return false;
  }
  const menu = openMarkingMenuState({ pressPoint: origin, bounds: canvas.unobstructedClientRect, pointer, groups });
  runInAction(() => {
    canvas.state.runtime.markingMenu = menu;
  });
  return true;
}
