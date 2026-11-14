import { action } from "mobx";
import type { CanvasInteractionController } from "../canvas";
import type { AppInternalAction } from "./action-impl";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import { CANVAS_OPERATION_IDS, type CanvasOperationId } from "@/domain/shared/canvas-operation";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";
import { CANVAS_FLOATING_TOOLBAR_BUTTON_IDS, CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS, type CanvasInteractionStateReadWriteImpl, type CanvasFloatingToolbarButtonId, type CanvasFloatingToolbarSize, type CanvasRightDockToolbarItemRequest, type CanvasRightDockToolbarPresentation, type CanvasTopLeftCornerToolbarButtonId, type CanvasTopLeftCornerToolbarShowButtonId } from "../state";

type CanvasInternalAction = Pick<AppInternalAction, "showCanvasToast" | "setCanvasAlert" | "setActiveTool" | "showCanvasFloatingToolbar" | "showCanvasFloatingToolbarForCollection" | "moveCanvasFloatingToolbar" | "alignCanvasFloatingToolbar" | "setCanvasFloatingToolbarSize" | "hideCanvasFloatingToolbar" | "showCanvasRightDockToolbar" | "hideCanvasRightDockToolbar" | "showCanvasTopLeftCornerToolbar" | "hideCanvasTopLeftCornerToolbar">;
const DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT = 44;
const FLOATING_TOOLBAR_DEVICE_GAP_PX = 6;
/** 悬停指针与浮动工具条的距离不超过此值时冻结工具条位置。 */
const FLOATING_TOOLBAR_HOVER_HOLD_DISTANCE_PX = 80;

interface FloatingToolbarHold {
  readonly centerX: number;
  readonly centerY: number;
  readonly gridSize: number;
  readonly displayRotation: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  pendingAlign: boolean;
}

export class CanvasActionImpl implements CanvasInternalAction {
constructor(private readonly state: CanvasInteractionStateReadWriteImpl, private readonly canvas: CanvasInteractionController) {}
private canvasToastTimer: ReturnType<typeof setTimeout> | null = null;

private canvasToastRevision = 0;

private disposed = false;

private floatingToolbarHold: FloatingToolbarHold | null = null;

public readonly showCanvasToast: CanvasInternalAction["showCanvasToast"] = action((messageKey) => {
    if (this.disposed) return;
    if (this.canvasToastTimer !== null) clearTimeout(this.canvasToastTimer);
    const revision = ++this.canvasToastRevision;
    this.state.runtime.canvasToastKey = messageKey;
    this.canvasToastTimer = setTimeout(action(() => {
      if (this.disposed || revision !== this.canvasToastRevision) return;
      this.state.runtime.canvasToastKey = null;
      this.canvasToastTimer = null;
    }), 3000);
  });

public readonly setCanvasAlert: CanvasInternalAction["setCanvasAlert"] = action((messageKey) => {
    if (!this.disposed) this.state.runtime.canvasAlertKey = messageKey;
  });

public readonly dispose = action(() => {
    this.disposed = true;
    ++this.canvasToastRevision;
    if (this.canvasToastTimer !== null) clearTimeout(this.canvasToastTimer);
    this.canvasToastTimer = null;
    this.state.runtime.canvasToastKey = null;
    this.state.runtime.canvasAlertKey = null;
  });

public readonly setActiveTool: CanvasInternalAction["setActiveTool"] = action((activeTool) => {
    if (activeTool === "select") this.canvas.setPlacementPanelSuppressed(false);
    const previousActiveTool = this.state.activeTool;
    if (previousActiveTool === activeTool) {
      return;
    }
    this.canvas.cancelPendingPlacementPreparation();

    if (!(previousActiveTool === "select" && activeTool === "single-placement")) {
      this.state.runtime.selectingPlacementGroup = null;
    }

    if (activeTool !== "dark-pipe-link") {
      this.state.toolInfo.darkPipeLink = null;
    }

    this.state.activeTool = activeTool;
  });

public readonly showCanvasFloatingToolbar: CanvasInternalAction["showCanvasFloatingToolbar"] = action((
    buttonIds,
    clientPixelPoint,
  ) => {
    const nextButtonIds = normalizeCanvasFloatingToolbarButtonIds(buttonIds).filter(id => this.canvas.getFloatingButtonAvailability(id).supported);
    const nextAnchor = normalizeClientPixelPoint(clientPixelPoint);

    if (nextButtonIds.length === 0 || nextAnchor === null) {
      this.hideCanvasFloatingToolbar();
      return;
    }

    this.floatingToolbarHold = null;
    this.state.runtime.canvasFloatingToolbar.visible = true;
    this.state.runtime.canvasFloatingToolbar.buttonIds = nextButtonIds;
    this.state.runtime.canvasFloatingToolbar.anchor = nextAnchor;
    this.state.runtime.canvasFloatingToolbar.attachedCollection = null;
  });

public readonly showCanvasFloatingToolbarForCollection: CanvasInternalAction["showCanvasFloatingToolbarForCollection"] = action((
    buttonIds,
    collectionType,
  ) => {
    const nextButtonIds = normalizeCanvasFloatingToolbarButtonIds(buttonIds).filter(id => this.canvas.getFloatingButtonAvailability(id).supported);

    if (nextButtonIds.length === 0) {
      this.hideCanvasFloatingToolbar();
      return false;
    }

    if (!this.state.runtime.canvasFloatingToolbar.visible
      || this.state.runtime.canvasFloatingToolbar.attachedCollection !== collectionType) {
      this.floatingToolbarHold = null;
    }
    this.state.runtime.canvasFloatingToolbar.visible = true;
    this.state.runtime.canvasFloatingToolbar.buttonIds = nextButtonIds;
    this.state.runtime.canvasFloatingToolbar.attachedCollection = collectionType;

    if (!this.alignCanvasFloatingToolbar()) {
      this.hideCanvasFloatingToolbar();
      return false;
    }

    return true;
  });

public readonly moveCanvasFloatingToolbar: CanvasInternalAction["moveCanvasFloatingToolbar"] = action((
    clientPixelPoint,
  ) => {
    if (!this.state.runtime.canvasFloatingToolbar.visible) {
      return;
    }

    const nextAnchor = normalizeClientPixelPoint(clientPixelPoint);
    if (nextAnchor === null) {
      return;
    }

    this.state.runtime.canvasFloatingToolbar.anchor = nextAnchor;
  });

/**
 * 悬停中的笔或鼠标靠近浮动工具条时冻结其位置：预览继续跟随指针，工具条不再随之跳开，笔可以直接滑到按钮上。
 * 指针离开该范围或在画布上落笔（传入 null）时恢复跟随，并补做冻结期间被跳过的对齐；视口移动或缩放后总是重新对齐。
 */
public readonly trackCanvasFloatingToolbarHover = action((pointer: ClientPixelPoint | null) => {
    const toolbar = this.state.runtime.canvasFloatingToolbar;
    const anchor = toolbar.anchor;
    if (pointer !== null && toolbar.visible && anchor !== null
      && Math.abs(pointer.x - anchor.x) <= (toolbar.measuredSize?.width ?? 0) / 2 + FLOATING_TOOLBAR_HOVER_HOLD_DISTANCE_PX
      && Math.abs(pointer.y - anchor.y)
        <= (toolbar.measuredSize?.height ?? DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT) / 2 + FLOATING_TOOLBAR_HOVER_HOLD_DISTANCE_PX) {
      if (this.floatingToolbarHold === null) {
        const view = this.canvas.view.state;
        this.floatingToolbarHold = {
          centerX: view.center.x,
          centerY: view.center.y,
          gridSize: view.gridSize,
          displayRotation: view.displayRotation,
          left: view.clientRect.left,
          top: view.clientRect.top,
          width: view.clientRect.width,
          height: view.clientRect.height,
          pendingAlign: false,
        };
      }
      return;
    }

    const hold = this.floatingToolbarHold;
    if (hold === null) {
      return;
    }
    this.floatingToolbarHold = null;
    if (hold.pendingAlign) {
      this.alignCanvasFloatingToolbar();
    }
  });

public readonly alignCanvasFloatingToolbar: CanvasInternalAction["alignCanvasFloatingToolbar"] = action(() => {
    const toolbar = this.state.runtime.canvasFloatingToolbar;
    if (!toolbar.visible || toolbar.attachedCollection === null) {
      return false;
    }

    const hold = this.floatingToolbarHold;
    if (hold !== null && toolbar.anchor !== null) {
      const view = this.canvas.view.state;
      if (hold.centerX === view.center.x && hold.centerY === view.center.y && hold.gridSize === view.gridSize
        && hold.displayRotation === view.displayRotation && hold.left === view.clientRect.left
        && hold.top === view.clientRect.top && hold.width === view.clientRect.width
        && hold.height === view.clientRect.height) {
        hold.pendingAlign = true;
        return true;
      }
      this.floatingToolbarHold = null;
    }

    const editor = this.canvas.editor;
    if (editor === null) {
      return false;
    }

    const collectionRect = editor.queries.findEntityCollectionGridRect(
      toolbar.attachedCollection,
    );
    if (collectionRect === null) {
      return false;
    }

    const viewportState = this.canvas.view.state;
    const collectionClientRect = resolveViewportRectFromWorldGridRect({
      gridRect: collectionRect,
      viewportBounds: viewportState.clientRect,
      viewportCenter: viewportState.center,
      gridCellPixelSize: viewportState.gridCellPixelSize,
      displayRotation: viewportState.displayRotation,
    });
    if (collectionClientRect === null) {
      return false;
    }

    const toolbarHeight = toolbar.measuredSize?.height ?? DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT;
    const toolbarWidth = toolbar.measuredSize?.width ?? 0;
    const viewport = viewportState.clientRect;


    const halfToolbarHeight = toolbarHeight / 2;

    const aboveAnchor: ClientPixelPoint = {
      x:
        collectionClientRect.left
        + collectionClientRect.width / 2,
      y:
        collectionClientRect.top
        - halfToolbarHeight
        - FLOATING_TOOLBAR_DEVICE_GAP_PX,
    };

    let anchor = aboveAnchor;

    const viewportTopSixth = viewport.top + viewport.height / 6;
    if (aboveAnchor.y < viewportTopSixth) {
      const viewportBottomFiveSixths = viewport.top + (viewport.height * 5) / 6;
      const belowY =
        collectionClientRect.top
        + collectionClientRect.height
        + halfToolbarHeight
        + FLOATING_TOOLBAR_DEVICE_GAP_PX;

      if (belowY <= viewportBottomFiveSixths) {
        anchor = {
          x: aboveAnchor.x,
          y: belowY,
        };
      } else {
        anchor = {
          x: aboveAnchor.x,
          y: viewport.top + toolbarHeight * 1.5,
        };
      }
    }

    if (toolbarWidth > 0) {
      const halfWidth = toolbarWidth / 2;
      const viewportLeft = viewport.left;
      const viewportRight = viewport.left + viewport.width;

      if (anchor.x - halfWidth < viewportLeft) {
        anchor = {
          x: viewportLeft + halfWidth,
          y: anchor.y,
        };
      } else if (anchor.x + halfWidth > viewportRight) {
        anchor = {
          x: viewportRight - halfWidth,
          y: anchor.y,
        };
      }
    }

    toolbar.anchor = anchor;
    return true;
  });

public readonly setCanvasFloatingToolbarSize: CanvasInternalAction["setCanvasFloatingToolbarSize"] = action((size) => {
    const nextSize = normalizeCanvasFloatingToolbarSize(size);
    const currentSize = this.state.runtime.canvasFloatingToolbar.measuredSize;

    if (
      currentSize?.width === nextSize?.width
      && currentSize?.height === nextSize?.height
    ) {
      return;
    }

    this.state.runtime.canvasFloatingToolbar.measuredSize = nextSize;
    this.alignCanvasFloatingToolbar();
  });

public readonly hideCanvasFloatingToolbar: CanvasInternalAction["hideCanvasFloatingToolbar"] = action(() => {
    if (
      !this.state.runtime.canvasFloatingToolbar.visible
      && this.state.runtime.canvasFloatingToolbar.buttonIds.length === 0
      && this.state.runtime.canvasFloatingToolbar.anchor === null
      && this.state.runtime.canvasFloatingToolbar.attachedCollection === null
    ) {
      return;
    }

    this.floatingToolbarHold = null;
    this.state.runtime.canvasFloatingToolbar.visible = false;
    this.state.runtime.canvasFloatingToolbar.buttonIds = [];
    this.state.runtime.canvasFloatingToolbar.anchor = null;
    this.state.runtime.canvasFloatingToolbar.attachedCollection = null;
  });

public readonly showCanvasRightDockToolbar: CanvasInternalAction["showCanvasRightDockToolbar"] = action((
    items,
  ) => {
    const nextItems = normalizeCanvasRightDockToolbarItems(items).filter(item => this.canvas.getOperationAvailability(item.operationId).supported);

    if (nextItems.length === 0) {
      this.hideCanvasRightDockToolbar();
      return;
    }

    this.state.runtime.canvasRightDockToolbar.visible = true;
    this.state.runtime.canvasRightDockToolbar.items = nextItems;
  });

public readonly hideCanvasRightDockToolbar: CanvasInternalAction["hideCanvasRightDockToolbar"] = action(() => {
    if (
      !this.state.runtime.canvasRightDockToolbar.visible
      && this.state.runtime.canvasRightDockToolbar.items.length === 0
    ) {
      return;
    }

    this.state.runtime.canvasRightDockToolbar.visible = false;
    this.state.runtime.canvasRightDockToolbar.items = [];
  });

public readonly showCanvasTopLeftCornerToolbar: CanvasInternalAction["showCanvasTopLeftCornerToolbar"] = action((
    buttonIds,
  ) => {
    const nextToolbarState = normalizeCanvasTopLeftCornerToolbarButtons(buttonIds);

    if (nextToolbarState.buttonIds.length === 0) {
      this.hideCanvasTopLeftCornerToolbar();
      return;
    }

    this.state.runtime.canvasTopLeftCornerToolbar.visible = true;
    this.state.runtime.canvasTopLeftCornerToolbar.buttonIds = nextToolbarState.buttonIds;
    this.state.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds =
      nextToolbarState.initialOffButtonIds;
  });

public readonly hideCanvasTopLeftCornerToolbar: CanvasInternalAction["hideCanvasTopLeftCornerToolbar"] = action(() => {
    if (
      !this.state.runtime.canvasTopLeftCornerToolbar.visible
      && this.state.runtime.canvasTopLeftCornerToolbar.buttonIds.length === 0
      && this.state.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds.length === 0
    ) {
      return;
    }

    this.state.runtime.canvasTopLeftCornerToolbar.visible = false;
    this.state.runtime.canvasTopLeftCornerToolbar.buttonIds = [];
    this.state.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds = [];
  });
}

function normalizeCanvasFloatingToolbarButtonIds(
  buttonIds: readonly CanvasFloatingToolbarButtonId[],
): CanvasFloatingToolbarButtonId[] {
  const knownButtonIds = new Set<CanvasFloatingToolbarButtonId>(CANVAS_FLOATING_TOOLBAR_BUTTON_IDS);
  const deduped: CanvasFloatingToolbarButtonId[] = [];

  for (const buttonId of buttonIds) {
    if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
      continue;
    }

    deduped.push(buttonId);
  }

  return deduped;
}

function normalizeCanvasRightDockToolbarItems(
  items: readonly CanvasRightDockToolbarItemRequest[],
): CanvasRightDockToolbarItemRequest[] {
  const knownOperationIds = new Set<CanvasOperationId>(
    CANVAS_OPERATION_IDS,
  );
  const knownPresentations = new Set<CanvasRightDockToolbarPresentation>([
    "button",
    "shortcut",
    "both",
  ]);
  const seenOperationIds = new Set<CanvasOperationId>();
  const deduped: CanvasRightDockToolbarItemRequest[] = [];

  for (const item of items) {
    if (
      !knownOperationIds.has(item.operationId)
      || !knownPresentations.has(item.presentation)
      || seenOperationIds.has(item.operationId)
    ) {
      continue;
    }

    seenOperationIds.add(item.operationId);
    deduped.push({
      operationId: item.operationId,
      presentation: item.presentation,
    });
  }

  return deduped;
}

function normalizeCanvasTopLeftCornerToolbarButtons(
  buttonIds: readonly CanvasTopLeftCornerToolbarShowButtonId[],
): {
  buttonIds: CanvasTopLeftCornerToolbarButtonId[];
  initialOffButtonIds: CanvasTopLeftCornerToolbarButtonId[];
} {
  const knownButtonIds = new Set<CanvasTopLeftCornerToolbarButtonId>(
    CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS,
  );
  const deduped: CanvasTopLeftCornerToolbarButtonId[] = [];
  const initialOffButtonIds: CanvasTopLeftCornerToolbarButtonId[] = [];

  for (const requestedButtonId of buttonIds) {
    const isInitialOffButton = requestedButtonId.endsWith("-off");
    const buttonId = (isInitialOffButton
      ? requestedButtonId.slice(0, -4)
      : requestedButtonId) as CanvasTopLeftCornerToolbarButtonId;

    if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
      continue;
    }

    deduped.push(buttonId);

    if (isInitialOffButton) {
      initialOffButtonIds.push(buttonId);
    }
  }

  return {
    buttonIds: deduped,
    initialOffButtonIds,
  };
}

function normalizeClientPixelPoint(
  clientPixelPoint: ClientPixelPoint,
): ClientPixelPoint | null {
  if (!Number.isFinite(clientPixelPoint.x) || !Number.isFinite(clientPixelPoint.y)) {
    return null;
  }

  return {
    x: clientPixelPoint.x,
    y: clientPixelPoint.y,
  };
}

function normalizeCanvasFloatingToolbarSize(
  size: CanvasFloatingToolbarSize | null,
): CanvasFloatingToolbarSize | null {
  if (
    size === null
    || !Number.isFinite(size.width)
    || !Number.isFinite(size.height)
    || size.width <= 0
    || size.height <= 0
  ) {
    return null;
  }

  return {
    width: size.width,
    height: size.height,
  };
}
