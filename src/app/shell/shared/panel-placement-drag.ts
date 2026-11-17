import { runInAction } from "mobx";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { AppHost } from "@/app/host/app-host";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { dragPlacementFromPanel, dropPlacementFromPanel } from "@/app/input/gesture/actions";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";

export interface PanelPlacementTarget {
  readonly deviceId: string;
  /** 放下的设备附带的初始配置（例如配方）；null 为设备默认配置。 */
  readonly config: Readonly<Record<string, unknown>> | null;
  readonly iconSrc: string | null;
  /** 放下即链接的仓库物品（原料卡片拖出的仓库取货口）。 */
  readonly warehouseItemId?: string;
}

/** 设备的拖出放置目标；config 为放下时附带的初始配置。 */
export function resolveDevicePlacementTarget(
  appHost: AppHost,
  deviceId: string,
  config: Readonly<Record<string, unknown>> | null = null,
): PanelPlacementTarget | null {
  const definition = appHost.workspace.registry.queries.findEntityDefinition(deviceId);
  return definition === null
    ? null
    : { deviceId: definition.id, config, iconSrc: createEntityIconAssetUrl(definition.iconPath) };
}

/** 按下后移动超过该距离才算拖出，避免笔尖抖动把点按变成拖动。 */
export const PANEL_PLACEMENT_DRAG_START_PX = 10;
const GHOST_SIZE_PX = 44;

let dragJustEnded = false;

/** 刚结束一次拖出放置时为 true：同一次按压随后的 pointerup/click 不应再当作点按。 */
export function didPanelPlacementDragJustEnd(): boolean {
  return dragJustEnded;
}

function markDragEnded(): void {
  dragJustEnded = true;
  window.setTimeout(() => { dragJustEnded = false; }, 0);
}

/** 指针下是否是主画布本身（被浮动面板盖住的部分不算）。 */
function isOverMainCanvas(appHost: AppHost, x: number, y: number): boolean {
  const element = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  const scene = element?.closest<HTMLElement>("[data-scene-id]");
  return scene?.dataset.sceneId === appHost.mainCanvas.view.id;
}

/**
 * 一次从面板拖出设备的过程：画布外显示跟随指针的设备图标，进入画布后改为真实的放置预览，
 * 在画布上松手放下一台，在画布外松手取消。
 */
export class PanelPlacementDrag {
  private ghost: HTMLElement | null = null;
  private placing = false;

  public constructor(private readonly appHost: AppHost, private readonly target: PanelPlacementTarget) {}

  public move(x: number, y: number): void {
    const canvas = this.appHost.mainCanvas;
    const overCanvas = isOverMainCanvas(this.appHost, x, y);
    if (overCanvas) {
      if (!this.placing) {
        runInAction(() => {
          canvas.state.runtime.singlePlacementConfig = this.target.config;
          canvas.state.runtime.singlePlacementWarehouseItemId = this.target.warehouseItemId ?? null;
          canvas.state.runtime.singlePlacementRotation = null;
        });
      }
      this.placing = dragPlacementFromPanel(canvas, this.target.deviceId, { x, y });
    } else {
      canvas.edgePan.stop();
    }
    this.showGhost(overCanvas && this.placing ? null : { x, y });
  }

  /** 用笔拖放时放下后设备仍在手上，与笔在画布上点按放置一致。 */
  public drop(x: number, y: number, pointerType: string): void {
    this.removeGhost();
    markDragEnded();
    const overCanvas = isOverMainCanvas(this.appHost, x, y);
    // 带配方的卡片落在同型号的设备上：改那台设备的配方，不再叠放一台新的。
    if (overCanvas && this.applyRecipeToMachineAt(x, y)) {
      if (this.placing) dropPlacementFromPanel(this.appHost.mainCanvas, null);
      this.placing = false;
      return;
    }
    if (this.placing) {
      dropPlacementFromPanel(
        this.appHost.mainCanvas,
        overCanvas ? { x, y } : null,
        pointerType === "pen",
      );
    }
    this.placing = false;
  }

  /** 指针下是同型号设备且卡片带配方时，把配方（及其相关设定）写进那台设备，返回是否已处理。 */
  private applyRecipeToMachineAt(x: number, y: number): boolean {
    const config = this.target.config;
    const channelRecipes = config?.channelRecipes;
    const canvas = this.appHost.mainCanvas;
    const editor = canvas.editor;
    if (config === null || typeof channelRecipes !== "object" || channelRecipes === null || editor === null) {
      return false;
    }
    // 拖动时手上的预览盖在设备上，所以按格子在正式文档里找同型号设备。
    const cell = canvas.view.queries.findGridCellForClientPixelPoint({ x, y });
    const definition = this.appHost.workspace.registry.queries.findEntityDefinition(this.target.deviceId);
    const entity = cell === null || definition === null ? undefined : Object.values(editor.document.getSnapshot().entities).find((candidate) => {
      if (candidate.definitionId !== this.target.deviceId) return false;
      const footprint = getRotatedGridFootprint(definition.footprint, candidate.rotation);
      return cell.x >= candidate.position.x && cell.x < candidate.position.x + footprint.width
        && cell.y >= candidate.position.y && cell.y < candidate.position.y + footprint.height;
    });
    if (entity === undefined) {
      return false;
    }
    const existing = entity.config.channelRecipes;
    editor.actions.patchEntityConfig(entity.id, {
      ...config,
      channelRecipes: {
        ...(typeof existing === "object" && existing !== null ? existing as Record<string, unknown> : {}),
        ...(channelRecipes as Record<string, unknown>),
      },
    });
    return true;
  }

  public cancel(): void {
    this.removeGhost();
    if (this.placing) {
      dropPlacementFromPanel(this.appHost.mainCanvas, null);
    }
    this.placing = false;
  }

  private showGhost(position: { readonly x: number; readonly y: number } | null): void {
    if (position === null || this.target.iconSrc === null) {
      if (this.ghost !== null) this.ghost.style.display = "none";
      return;
    }
    if (this.ghost === null) {
      const ghost = document.createElement("div");
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: `${GHOST_SIZE_PX}px`,
        height: `${GHOST_SIZE_PX}px`,
        padding: "4px",
        boxSizing: "border-box",
        borderRadius: "8px",
        border: "1px solid var(--accent)",
        background: "var(--surface-2)",
        boxShadow: "var(--shadow-floating-control)",
        pointerEvents: "none",
        zIndex: "10000",
        opacity: "0.92",
      } satisfies Partial<CSSStyleDeclaration>);
      const image = document.createElement("img");
      image.alt = "";
      image.src = this.target.iconSrc;
      Object.assign(image.style, { width: "100%", height: "100%", objectFit: "contain" });
      ghost.append(image);
      document.body.append(ghost);
      this.ghost = ghost;
    }
    this.ghost.style.display = "block";
    // 图标停在笔尖左上方，不挡住落点。
    this.ghost.style.transform = `translate(${position.x - GHOST_SIZE_PX - 6}px, ${position.y - GHOST_SIZE_PX - 6}px)`;
  }

  private removeGhost(): void {
    this.ghost?.remove();
    this.ghost = null;
  }
}

/**
 * 面板条目（设备磁贴、配方树行、设备合计芯片）的按下处理：移动超过阈值即开始拖出放置。
 * 点按不受影响；拖动结束后条目自己的 pointerup/click 处理应先检查 didPanelPlacementDragJustEnd()。
 */
export function startPanelPlacementPress(
  appHost: AppHost,
  event: ReactPointerEvent<HTMLElement>,
  resolveTarget: () => PanelPlacementTarget | null,
): void {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let drag: PanelPlacementDrag | null = null;

  const finish = () => {
    window.removeEventListener("pointermove", handleMove, true);
    window.removeEventListener("pointerup", handleUp, true);
    window.removeEventListener("pointercancel", handleCancel, true);
  };
  const handleMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (drag === null) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < PANEL_PLACEMENT_DRAG_START_PX) return;
      const target = resolveTarget();
      if (target === null) {
        finish();
        return;
      }
      drag = new PanelPlacementDrag(appHost, target);
    }
    moveEvent.preventDefault();
    drag.move(moveEvent.clientX, moveEvent.clientY);
  };
  const handleUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    finish();
    drag?.drop(upEvent.clientX, upEvent.clientY, upEvent.pointerType);
  };
  const handleCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerId) return;
    finish();
    drag?.cancel();
  };
  window.addEventListener("pointermove", handleMove, true);
  window.addEventListener("pointerup", handleUp, true);
  window.addEventListener("pointercancel", handleCancel, true);
}
