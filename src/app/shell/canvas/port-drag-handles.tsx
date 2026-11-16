import { observer } from "mobx-react-lite";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import LucideArrowUp from "~icons/lucide/arrow-up";

import type { AppHost } from "@/app/host/app-host";
import { resolvePortDragHandles, startPortHandleDrag, type PortDragHandle } from "@/app/input/gesture/actions";
import type { WorldDocument } from "@/domain/document/world-document";
import type { GridEdge } from "@/domain/shared/grid";
import { useLastPointerType } from "@/app/shell/shared/use-last-input-kind";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { useEditorDocumentSnapshot } from "../hooks";

/** 把手直径随格子缩放，但不小于手指可靠按中的尺寸，也不大到盖住相邻端口太多。 */
const HANDLE_MIN_PX = 30;
const HANDLE_MAX_PX = 42;
/** 按下后移动超过该距离才开始拉线，避免点按时抖出一格线。 */
const DRAG_START_PX = 8;
const EDGE_ANGLE: Readonly<Record<GridEdge, number>> = { NORTH: 0, EAST: 90, SOUTH: 180, WEST: 270 };

const selectEntities = (document: WorldDocument) => document.entities;

/**
 * 格子小于把手时，同一端口组在同一侧的相邻把手会叠在一起难以分辨：每侧每组只留中间那个，放大后再逐个显示。
 */
export function thinPortDragHandles(handles: readonly PortDragHandle[], cellPx: number, handlePx: number): PortDragHandle[] {
  if (cellPx >= handlePx) {
    return [...handles];
  }
  const groups = new Map<string, PortDragHandle[]>();
  for (const handle of handles) {
    const group = handle.source.type === "device-port" ? handle.source.endpoint.portGroupId : "line";
    const key = `${group}:${handle.flowEdge}`;
    groups.set(key, [...(groups.get(key) ?? []), handle]);
  }
  return [...groups.values()].map((side) => side[Math.floor((side.length - 1) / 2)]!);
}

interface HandleDrag {
  readonly pointerId: number;
  readonly start: { readonly x: number; readonly y: number };
  readonly handle: PortDragHandle;
  controller: ReturnType<typeof startPortHandleDrag>;
}

/**
 * 手指的端口拉线：用手指（或关闭精确输入的笔）选中一台设备或一段传送带/管道后，在仍空着的端口、线端外侧
 * 显示箭头把手，从把手拖出即铺线（输出向外、输入向内），松开提交，与笔从端口格直接拖动是同一套逻辑。
 * 把手在设备外侧，因此拖动设备平移视图、长按移动都不受影响。
 */
export const PortDragHandles = observer(function PortDragHandles({ appHost }: { appHost: AppHost }) {
  const canvas = appHost.mainCanvas;
  const editor = appHost.workspace.editor;
  const pointerType = useLastPointerType();
  // 端口接上线或腾空时更新把手。
  useEditorDocumentSnapshot(editor, selectEntities);
  const drag = useRef<HandleDrag | null>(null);
  const [dragging, setDragging] = useState<PortDragHandle | null>(null);
  const [drawing, setDrawing] = useState(false);

  const fingerLike = pointerType === "touch" || (pointerType === "pen" && !appHost.internalState.settings.penPreciseInput);
  const selection = editor?.state.collections.selection ?? [];
  const handles = dragging !== null
    ? [dragging]
    : editor === null
      || !fingerLike
      || canvas.state.activeTool !== "select"
      || selection.length !== 1
      || editor.queries.resolveLogisticsDraftState() !== null
      || !canvas.canUseWorkbenchActions
      || !canvas.isOperationEnabled("logistics-placement")
      ? []
      : resolvePortDragHandles(canvas, selection[0]!);
  const cellPx = canvas.view.state.gridCellPixelSize;
  const size = Math.min(HANDLE_MAX_PX, Math.max(HANDLE_MIN_PX, cellPx));
  const shown = thinPortDragHandles(handles, cellPx, size);
  if (shown.length === 0) {
    return null;
  }

  const t = appHost.actions.translate;
  const displayRotation = canvas.view.state.displayRotation;

  const finish = (event: ReactPointerEvent, commit: boolean) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    drag.current = null;
    current.controller?.end(commit);
    setDragging(null);
    setDrawing(false);
  };

  return (
    <>
      {shown.map((handle) => {
        const rect = canvas.view.queries.findClientRectForGridCell(handle.cell);
        if (rect === null) return null;
        const label = handle.source.type === "line-end"
          ? t("portHandle.lineEnd")
          : handle.source.endpoint.portDirection === "output" ? t("portHandle.output") : t("portHandle.input");
        const output = handle.source.type === "device-port" && handle.source.endpoint.portDirection === "output";
        return (
          <button
            aria-label={label}
            className={cm(styles, output || handle.source.type === "line-end" ? "port-drag-handle" : "port-drag-handle is-input")}
            data-port-drag-handle={handle.key}
            key={handle.key}
            onLostPointerCapture={(event) => finish(event, false)}
            onPointerCancel={(event) => finish(event, false)}
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current !== null) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, handle, controller: null };
              setDragging(handle);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (current === null || current.pointerId !== event.pointerId) return;
              const position = { x: event.clientX, y: event.clientY };
              if (current.controller === null) {
                if (Math.hypot(position.x - current.start.x, position.y - current.start.y) < DRAG_START_PX) return;
                current.controller = startPortHandleDrag(canvas, current.handle.source);
                setDrawing(current.controller !== null);
              }
              current.controller?.move(position);
            }}
            onPointerUp={(event) => finish(event, true)}
            style={{
              left: rect.left + rect.width / 2,
              top: rect.top + rect.height / 2,
              width: size,
              height: size,
              // 拉线时把手让出线头，只保留指针捕获。
              opacity: drawing ? 0 : undefined,
            }}
            title={label}
            type="button"
          >
            <LucideArrowUp aria-hidden="true" style={{ transform: `rotate(${EDGE_ANGLE[handle.flowEdge] + displayRotation}deg)` }} />
          </button>
        );
      })}
    </>
  );
});
