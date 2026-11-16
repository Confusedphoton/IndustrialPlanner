import type { AppHost } from "@/app/host/app-host";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridRotation } from "@/domain/shared/grid";

import type { GestureMappingModule } from "../types";

/** 笔偏离竖直少于该角度时视为竖直，不改变朝向。 */
const MIN_LEAN_DEGREES = 20;

/**
 * 试验（设置「按笔的倾斜设定朝向」，默认关闭）：放置中笔悬停时，按笔身倾斜的方向（上、右、下、左）
 * 设定手上设备的朝向。只读取悬停移动，不处理落笔；不需要时删除本模块、其注册与该设置即可。
 */
export function createHypergryphPenTiltFacingModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-pen-tilt-facing",
    // 先于放置模块：转好朝向后放置模块再把预览对到笔尖下。
    priority: 120,
    handle(event, context) {
      const canvas = context.canvas;
      const editor = canvas.editor;
      if (
        event.type !== "mouse move"
        || editor === null
        || !canvas.workbench.internalState.settings.penTiltFacing
        || canvas.state.activeTool !== "single-placement"
        || editor.state.collections.preview.length !== 1
      ) {
        return { status: "ignored" };
      }
      const source = event.sourceEvent as { pointerType?: string; tiltX?: number; tiltY?: number } | null;
      const facing = source?.pointerType === "pen"
        ? resolveTiltFacing(source.tiltX ?? 0, source.tiltY ?? 0, canvas.view.state.displayRotation)
        : null;
      const preview = editor.queries.getEntityById(editor.state.collections.preview[0]!);
      if (facing === null || preview === null || preview.rotation === facing) {
        return { status: "ignored" };
      }
      const steps = ((facing - preview.rotation) / 90 + 4) % 4;
      for (let step = 0; step < steps; step += 1) {
        editor.actions.rotateCollectionAroundCenterPoint(EntityCollectionType.preview, 90);
      }
      return { status: "ignored" };
    },
  };
}

/**
 * 倾斜方向量化为四个朝向：在屏幕上向上倾为 0°，顺时针依次为 90°、180°、270°；接近竖直时为 null。
 * 视图旋转后换算回网格朝向，让设备在屏幕上朝笔倾斜的方向。
 */
export function resolveTiltFacing(tiltX: number, tiltY: number, displayRotation: GridRotation): GridRotation | null {
  if (Math.hypot(tiltX, tiltY) < MIN_LEAN_DEGREES) {
    return null;
  }
  const angle = Math.atan2(tiltX, -tiltY) * 180 / Math.PI - displayRotation;
  const quadrant = ((Math.round(angle / 90) % 4) + 4) % 4;
  return (quadrant * 90) as GridRotation;
}
