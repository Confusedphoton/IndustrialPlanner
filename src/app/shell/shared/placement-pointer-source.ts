import type { AppHost } from "@/app/host/app-host";

/**
 * 从面板或快捷栏拿起设备时按哪种指针进入放置：鼠标与精确输入的手写笔让预览跟随指针、点按画布即放下；
 * 手指（及关闭精确输入的笔）把预览放在画布中央，配合拖动与浮动确认按钮。
 */
export function resolvePlacementPointerSource(appHost: AppHost, pointerType: string): "mouse" | "touch" {
  return pointerType === "mouse" || (pointerType === "pen" && appHost.internalState.settings.penPreciseInput)
    ? "mouse"
    : "touch";
}
