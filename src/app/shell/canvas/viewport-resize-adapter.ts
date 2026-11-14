
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import { useEffect, type RefObject } from "react";

export function useViewportResizeAdapter(options: {
  view: EditorViewContract;
  viewportSurfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { view, viewportSurfaceRef } = options;
  useEffect(() => {
    const surface = viewportSurfaceRef.current;
    if (surface === null) return;
    let frame: number | null = null;
    const measure = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const rect = surface.getBoundingClientRect();
      view.actions.setViewportClientRect({ left: rect.left, top: rect.top,
        width: Math.max(0, Math.floor(surface.clientWidth)), height: Math.max(0, Math.floor(surface.clientHeight)) });
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    for (let element: HTMLElement | null = surface; element !== null; element = element.parentElement) observer?.observe(element);
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    mutations?.observe(document.body, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    // 原生指针开始前同步最新位置，避免等下一帧测量才更新命中坐标。
    surface.addEventListener("pointerdown", measure, true);
    measure();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect(); mutations?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      surface.removeEventListener("pointerdown", measure, true);
    };
  }, [view, viewportSurfaceRef]);
}
