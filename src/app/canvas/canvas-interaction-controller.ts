import { runInAction } from "mobx";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { CanvasOperationId } from "@/domain/shared/canvas-operation";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { resolveRegionGridBounds } from "@/shared/geometry/region-rects";
import type { mountCanvasSceneView } from "./scene-view-mount";
import { CanvasInteractionStateReadWriteImpl } from "../state";
import type { CanvasFloatingToolbarButtonId, CanvasTopLeftCornerToolbarButtonId } from "../state";
import { CanvasActionImpl } from "../actions";
import type { AppHost } from "../host";
import type { GestureAdapter } from "../input/gesture/adapter";
import { WorkbenchOverlapEntityMenuController } from "../shell";
import type { GestureActionRouter } from "../input/gesture/actions";
import { createDemandFrameDriver } from "@/shared/timing/demand-frame-driver";
import type { SinglePlacementRequest } from "@/domain/editor/types/editor-session-types";
import type { GridPoint } from "@/domain/shared/grid";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";

export interface PlacementPaletteEntry {
  readonly id: string;
  readonly definitionId: string;
  readonly availableCount: number | null;
  createRequest(centerGridPoint: GridPoint): SinglePlacementRequest | null;
}

const editingOwners = new WeakMap<EditorContract, CanvasInteractionController>();

/** 每个交互画布显式绑定相机和所属会话；主工作台通过 getter 等待 Editor 装配。 */
export class CanvasInteractionController {
  public readonly state = new CanvasInteractionStateReadWriteImpl();
  public readonly actions = new CanvasActionImpl(this.state, this);
  public readonly overlapEntityMenu = new WorkbenchOverlapEntityMenuController();
  public selectedPaletteEntryId: string | null = null;
  public pendingPlacementEnter: {
    deviceId: string; anchor: GridPoint; pointerMode: "mouse" | "touch"; initialMousePosition: ClientPixelPoint | null;
  } | null = null;
  private disposed = false;
  private placementPreparationEpoch = 0;
  private inputAdapter: GestureAdapter | null = null;
  private inputRouter: GestureActionRouter<AppHost> | null = null;
  private inputDriver: ReturnType<typeof createDemandFrameDriver> | null = null;
  private readonly suspensions = new Map<symbol, string | null>();
  private binding: Awaited<ReturnType<typeof mountCanvasSceneView>> | null = null;
  private releaseRenderSuspension: (() => void) | null = null;
  public readonly view: EditorViewContract;
  public get renderBinding(): Awaited<ReturnType<typeof mountCanvasSceneView>> | null { return this.binding; }
  public set renderBinding(value: Awaited<ReturnType<typeof mountCanvasSceneView>> | null) {
    if (this.disposed && value !== null) { value.dispose(); return; }
    if (value === this.binding) return;
    this.releaseRenderSuspension?.();
    this.binding = value;
    this.releaseRenderSuspension = this.isInputSuspended ? value?.suspend() ?? null : null;
  }
  public get isInputSuspended(): boolean { return this.disposed || this.suspensions.size > 0; }
  /** 底图手势和窗口命令是两个输入通道；窗口仍由装配层及路由声明资格。 */
  public get isCommandInputSuspended(): boolean {
    return this.disposed || [...this.suspensions.values()].some(owner =>
      owner === null || this.options.canHandleSuspendedCommands?.(owner) !== true);
  }

  /** 遮挡者各持有一个租约；最后一个遮挡消失才恢复最新场景。 */
  public suspend = (commandOwner: string | null = null): (() => void) => {
    if (this.disposed) return () => {};
    const token = Symbol("canvas-suspension");
    if (this.suspensions.size === 0) {
      this.inputAdapter?.handleBlur();
      this.cancelInput();
      this.cancelTransientInteraction();
      this.releaseRenderSuspension = this.binding?.suspend() ?? null;
    }
    this.suspensions.set(token, commandOwner);
    return () => {
      if (!this.suspensions.delete(token) || this.suspensions.size > 0) return;
      this.releaseRenderSuspension?.();
      this.releaseRenderSuspension = null;
    };
  };
  public constructor(private readonly options: {
    readonly view: EditorViewContract;
    readonly registry: RegistryContract;
    readonly readEditor: () => EditorContract | null;
    readonly readWorkbench: () => AppHost;
    readonly readPalette?: () => readonly PlacementPaletteEntry[];
    readonly preparePlacement?: () => Promise<void>;
    readonly workbenchActions?: boolean;
    readonly canHandleSuspendedCommands?: (owner: string) => boolean;
  }) { this.view = options.view; }

  public get editor(): EditorContract | null { return this.options.readEditor(); }
  public acquireInput(): void {
    const editor = this.editor;
    if (editor === null || this.isInputSuspended || editingOwners.get(editor) === this) return;
    const previous = editingOwners.get(editor);
    previous?.inputAdapter?.handleBlur();
    previous?.cancelTransientInteraction();
    previous?.actions.setActiveTool("select");
    editingOwners.set(editor, this);
  }
  public get registry(): RegistryContract { return this.options.registry; }
  public get workbench(): AppHost { return this.options.readWorkbench(); }
  public get canUseWorkbenchActions(): boolean { return this.options.workbenchActions === true; }
  public get gestureActionRouter(): GestureActionRouter<AppHost> {
    if (this.inputRouter === null) throw new Error("Canvas router has not been attached.");
    return this.inputRouter;
  }
  public isOperationEnabled(operation: CanvasOperationId): boolean {
    const availability = this.getOperationAvailability(operation);
    return availability.supported && availability.enabled;
  }
  public getFloatingButtonAvailability(button: CanvasFloatingToolbarButtonId) {
    const operations: Record<CanvasFloatingToolbarButtonId, CanvasOperationId> = {
      "canvas-floating-toolbar-button-ok": this.state.activeTool === "move" ? "move" : "confirm-placement",
      "canvas-floating-toolbar-button-cancel": "cancel-placement",
      "canvas-floating-toolbar-button-rotate": "rotate-placement",
      "canvas-floating-toolbar-button-switch-mode": "switch-device-variant",
      "canvas-floating-toolbar-button-move": "move",
      "canvas-floating-toolbar-button-copy": "copy",
      "canvas-floating-toolbar-button-save-blueprint": "save-blueprint",
      "canvas-floating-toolbar-button-delete": "delete",
      "canvas-floating-toolbar-button-delete-many": "delete",
      "canvas-floating-toolbar-button-delete-upstream-segment": "delete",
      "canvas-floating-toolbar-button-delete-downstream-segment": "delete",
    };
    return this.getOperationAvailability(operations[button]);
  }
  public getTopLeftButtonAvailability(button: CanvasTopLeftCornerToolbarButtonId) {
    const operations: Record<CanvasTopLeftCornerToolbarButtonId, CanvasOperationId> = {
      "canvas-top-left-corner-toolbar-button-toggle-pipe": "select",
      "canvas-top-left-corner-toolbar-button-toggle-belt": "select",
      "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee": "toggle-marquee-selection",
      "canvas-top-left-corner-toolbar-button-toggle-continuous-placement": "continuous-placement",
    };
    return this.getOperationAvailability(operations[button]);
  }
  public isPaletteDefinitionAvailable(definitionId: string): boolean | null {
    if (this.options.readPalette === undefined) return null;
    return this.options.readPalette().some(entry => entry.definitionId === definitionId && entry.availableCount !== 0);
  }
  public createPlacementDraft(request: SinglePlacementRequest): boolean {
    if (!this.isOperationEnabled("confirm-placement")) return false;
    // 放置同一设备期间附带运行时初始配置（例如配方树指定的配方）。
    const pendingConfig = this.state.runtime.singlePlacementConfig;
    if (request.config === undefined && pendingConfig !== null && this.state.runtime.singlePlacementDeviceId === request.definitionId) {
      request = { ...request, config: pendingConfig };
    }
    const pendingRotation = this.state.runtime.singlePlacementRotation;
    if (request.rotation === undefined && pendingRotation !== null && this.state.runtime.singlePlacementDeviceId === request.definitionId) {
      request = { ...request, rotation: pendingRotation };
    }
    const entry = this.options.readPalette?.().find(candidate => candidate.id === this.selectedPaletteEntryId
      && candidate.definitionId === request.definitionId && candidate.availableCount !== 0);
    const ownedRequest = this.options.readPalette === undefined ? request : entry?.createRequest(request.centerGridPoint);
    if (ownedRequest === null || ownedRequest === undefined || this.editor === null) return false;
    this.editor.actions.createSinglePlacementDraft(ownedRequest);
    return this.editor.state.collections.preview.length > 0;
  }
  public cancelPendingPlacementPreparation(): void { this.placementPreparationEpoch++; }
  /** 动态供应清单可在提交后更新；等待期间保留取消入口，迟到结果不能恢复已经退出的操作。 */
  public deferPlacementContinuation(resume: () => boolean, cancel: () => void): boolean {
    const prepare = this.options.preparePlacement;
    if (prepare === undefined) return false;
    const epoch = ++this.placementPreparationEpoch;
    const isCurrent = (): boolean => !this.disposed && epoch === this.placementPreparationEpoch && this.state.activeTool === "single-placement";
    const finish = (ready: boolean): void => {
      if (!isCurrent()) return;
      runInAction(() => {
        try { if (ready && resume()) return; }
        catch { /* 准备或续建失败只结束当前放置，不撤销已经提交的设备。 */ }
        cancel();
      });
    };
    void Promise.resolve().then(() => isCurrent() ? prepare() : undefined).then(() => finish(true), () => finish(false));
    return true;
  }
  public get debugMode(): boolean { return this.workbench.internalState.settings.debugMode; }
  public get gestureAdapter(): GestureAdapter {
    if (this.inputAdapter === null) throw new Error("Canvas input has not been attached.");
    return this.inputAdapter;
  }
  public attachGestureAdapter(adapter: GestureAdapter): void {
    if (this.inputAdapter !== null) throw new Error("Canvas input is already attached.");
    this.inputAdapter = adapter;
  }
  public attachGestureRouter(router: GestureActionRouter<AppHost>): void {
    if (this.inputRouter !== null) throw new Error("Canvas router is already attached.");
    this.inputRouter = router;
    this.inputDriver = createDemandFrameDriver({
      request: (frame) => requestAnimationFrame(frame),
      cancel: (handle) => cancelAnimationFrame(handle),
      needsFrame: () => !this.isInputSuspended && (this.inputAdapter?.needsFrame() === true || router.needsFrame()),
      onFrame: (timeMs) => {
        this.inputAdapter?.advanceFrame(timeMs);
        router.advanceFrame(timeMs);
      },
    });
  }
  public wakeInput(): void { this.inputDriver?.wake(); }
  public cancelInput(): void {
    this.inputRouter?.cancel();
    this.view.actions.cancelMotion();
  }

  public dispose(): void {
    if (this.disposed) return;
    // 先送达取消，再撤销输入归属；销毁后所有新输入与迟到 binding 都拒绝。
    this.inputAdapter?.handleBlur();
    this.disposed = true;
    const editor = this.editor;
    if (editor !== null && editingOwners.get(editor) === this) editingOwners.delete(editor);
    this.cancelTransientInteraction();
    this.actions.setActiveTool("select");
    this.inputDriver?.dispose();
    this.inputDriver = null;
    this.inputRouter?.dispose();
    this.inputRouter = null;
    this.actions.dispose();
    this.inputAdapter?.dispose();
    this.inputAdapter = null;
    this.pendingPlacementEnter = null;
    this.selectedPaletteEntryId = null;
    this.overlapEntityMenu.dispose();
    this.view.actions.cancelMotion();
    this.renderBinding?.dispose();
    this.renderBinding = null;
    this.suspensions.clear();
  }

  private cancelTransientInteraction(): void {
    // 仅取消拥有临时草稿的工具；跨窗口的业务选点不是在途指针手势。
    const tool = this.state.activeTool;
    const ownsTransientDraft = tool === "single-placement" || tool === "blueprint-placement"
      || tool === "move" || tool === "marquee" || tool === "logistics-placement" || tool === "region-edit";
    if (this.state.activeTool === "single-placement" || this.state.activeTool === "blueprint-placement") this.editor?.actions.cancelPlacementDraft();
    if (this.state.activeTool === "move") this.editor?.actions.cancelMoveOperationDraft();
    if (this.state.activeTool === "marquee") this.editor?.actions.cancelMarquee();
    if (this.state.activeTool === "logistics-placement") this.editor?.actions.cancelLogisticsDraft();
    if (this.state.activeTool === "region-edit") this.editor?.actions.cancelRegionDraft();
    this.pendingPlacementEnter = null;
    this.overlapEntityMenu.cancel();
    if (ownsTransientDraft) this.actions.setActiveTool("select");
  }

  public getOperationAvailability(operation: CanvasOperationId) {
    const availability = this.editor?.queries.getOperationAvailability(operation)
      ?? { supported: false, enabled: false, reason: null };
    return this.isCommandInputSuspended ? { ...availability, enabled: false } : availability;
  }

  public focusOnEntity(entityId: string, options?: { duration?: number }): void {
    const entity = this.editor?.queries.getEntityById(entityId);
    if (entity == null) return;
    const definition = this.options.registry.queries.findEntityDefinition(entity.definitionId);
    if (definition == null) return;
    this.view.actions.focusOnBounds(resolveEntityGridRect({ entity, definition }), { durationMs: options?.duration });
  }

  /**
   * 视口变窄（例如打开右侧面板）后，若设备落到可见区域之外，按最小距离平移让它重新完整可见；
   * 本来就可见时不动视图。obstruction 是画布两侧被常驻浮层（工具条）占用的宽度，设备也要避开。
   */
  public keepEntityInView(entityId: string, obstruction: { readonly left: number; readonly right: number }): void {
    const entity = this.editor?.queries.getEntityById(entityId);
    if (entity == null) return;
    const definition = this.options.registry.queries.findEntityDefinition(entity.definitionId);
    if (definition == null) return;
    const bounds = resolveEntityGridRect({ entity, definition });
    const topLeft = this.view.queries.findClientRectForGridCell({ x: bounds.x, y: bounds.y });
    const bottomRight = this.view.queries.findClientRectForGridCell({ x: bounds.x + bounds.width - 1, y: bounds.y + bounds.height - 1 });
    if (topLeft === null || bottomRight === null) return;
    const viewport = this.view.state.clientRect;
    const margin = 24;
    const left = Math.min(topLeft.left, bottomRight.left);
    const right = Math.max(topLeft.left + topLeft.width, bottomRight.left + bottomRight.width);
    const top = Math.min(topLeft.top, bottomRight.top);
    const bottom = Math.max(topLeft.top + topLeft.height, bottomRight.top + bottomRight.height);
    const shift = (start: number, end: number, min: number, max: number) => (
      start < min ? min - start : end > max ? Math.max(min - start, max - end) : 0
    );
    const dx = shift(
      left,
      right,
      viewport.left + obstruction.left + margin,
      viewport.left + viewport.width - obstruction.right - margin,
    );
    const dy = shift(top, bottom, viewport.top + margin, viewport.top + viewport.height - margin);
    if (dx === 0 && dy === 0) return;
    const start = { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
    this.view.actions.moveViewportByClientPixelVector({ startClientPixel: start, endClientPixel: { x: start.x + dx, y: start.y + dy } });
  }

  public focusOnRegion(regionId: string): void {
    const region = this.editor?.document.getSnapshot().regions.find((region) => region.id === regionId);
    const bounds = region === undefined ? null : resolveRegionGridBounds(region.rects);
    if (bounds === null) return;
    // 保留既有区域聚焦的 82% 留白；像素比例由当前 View 提供，不依赖主 Editor。
    const pixelsPerCell = this.view.state.gridCellPixelSize / this.view.state.gridSize;
    const gridSize = Math.min(this.view.state.clientRect.width * 0.82 / Math.max(1, bounds.width * pixelsPerCell),
      this.view.state.clientRect.height * 0.82 / Math.max(1, bounds.height * pixelsPerCell));
    this.view.actions.focusOnBounds(bounds, { durationMs: 0, gridSize });
  }
}
