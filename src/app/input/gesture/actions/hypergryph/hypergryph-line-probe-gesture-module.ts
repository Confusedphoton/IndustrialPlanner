import { runInAction } from "mobx";

import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";

import type { GestureMappingModule } from "../types";

/**
 * 只观察不消费：选择工具下笔或鼠标悬停在传送带/管道上时记下读数位置，离开线、开始拖动、点按、切换工具时收起。
 */
export function createHypergryphLineProbeGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-line-probe",
    priority: 1050,
    handle(event, context) {
      const canvas = context.canvas;
      switch (event.type) {
        case "mouse move":
          if (event.buttons === 0) {
            probeLineAt(canvas, event.position);
          }
          return { status: "ignored" };
        case "mouse dragstart":
        case "touch dragstart":
        case "mouse tap":
        case "touch tap":
        case "mouse-long-press-ready":
        case "tap-long-press-ready":
        case "on-exit-active-tool":
          closeLineProbe(canvas);
          return { status: "ignored" };
        default:
          return { status: "ignored" };
      }
    },
  };
}

export function closeLineProbe(canvas: CanvasInteractionController): void {
  if (canvas.state.runtime.lineProbe === null) return;
  runInAction(() => {
    canvas.state.runtime.lineProbe = null;
  });
}

function probeLineAt(canvas: CanvasInteractionController, position: GesturePosition): void {
  const editor = canvas.editor;
  const cell = canvas.view.queries.findGridCellForClientPixelPoint(position);
  const kind = editor === null || cell === null || canvas.state.activeTool !== "select" || canvas.isInputSuspended
    ? null
    : [LOGISTICS_KIND.belt, LOGISTICS_KIND.pipe].find((candidate) => editor.queries.findTransportLineAtGridPoint(cell, candidate) !== null)
      ?? null;
  if (kind === null || cell === null) {
    closeLineProbe(canvas);
    return;
  }
  runInAction(() => {
    canvas.state.runtime.lineProbe = { kind, cell: { ...cell }, pointer: { x: position.x, y: position.y } };
  });
}
