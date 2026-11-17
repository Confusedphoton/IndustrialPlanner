import { useEffect, useRef, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { observer } from "mobx-react-lite";
import { BasePanel } from "@/app/shell/panels/base-panel";
import { BlueprintPanel } from "@/app/shell/panels/blueprint-panel";
import { PlacementPanel } from "@/app/shell/panels/placement-panel";
import { RegionPanel } from "@/app/shell/panels/region-panel";
import { SimulationPanel } from "@/app/shell/panels/simulation-panel";
import type { AppHost } from "@/app/host/app-host";
import {
  resolveMinLeftDockWidthForScreenProfile,
  type ActivePanel,
} from "@/app/state/state-impl";
import { MIN_SQUEEZED_LEFT_DOCK_WIDTH_PX } from "@/app/shell/layout/dock-layout-budget";
import { isMobileOrTabletScreenProfile } from "@/shared/browser/screen-profile";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { placementShelfState } from "@/app/shell/panels/placement-shelf-state";


type LeftDockPanelId = Exclude<ActivePanel, null>;

const DEFAULT_ACTIVE_PANEL: LeftDockPanelId = "placement";

const PANEL_TITLE_KEYS: Record<LeftDockPanelId, string> = {
  placement: "workbench.panel.placement.title",
  region: "workbench.panel.region.title",
  blueprint: "workbench.panel.blueprint.title",
  base: "workbench.panel.base.title",
  simulation: "workbench.panel.simulation.title",
};

const PANEL_COMPONENTS: Record<LeftDockPanelId, ComponentType<{ appHost: AppHost; active?: boolean }>> = {
  placement: PlacementPanel,
  region: RegionPanel,
  blueprint: BlueprintPanel,
  base: BasePanel,
  simulation: SimulationPanel,
};

/** 拖动抓手超过该距离才开始改变宽度。 */
const RESIZE_DRAG_SLOP_PX = 6;

const PANEL_ORDER: LeftDockPanelId[] = ["placement", "region", "blueprint", "base", "simulation"];

const LeftDockView = observer(function LeftDockView({
  appHost,
  hidden,
  side,
  width,
  maxWidth,
}: {
  appHost: AppHost;
  hidden: boolean;
  side: "left" | "right";
  width: number;
  maxWidth: number;
}) {
  const t = appHost.actions.translate;
  const activePanel = appHost.internalState.runtime.activePanel ?? DEFAULT_ACTIVE_PANEL;
  const currentPanelLabel = t(PANEL_TITLE_KEYS[activePanel]);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const screenProfile = appHost.state.screenProfile;
  const isTouchLayout = isMobileOrTabletScreenProfile(screenProfile);
  const regularMinWidth = resolveMinLeftDockWidthForScreenProfile(screenProfile);
  // 画布把面板挤到常规最窄宽度以下时，仍可在挤压下限与布局允许的最宽值之间拖动。
  const minWidth = maxWidth < regularMinWidth ? MIN_SQUEEZED_LEFT_DOCK_WIDTH_PX : regularMinWidth;
  const shelf = placementShelfState.narrow && activePanel === "placement";
  const resizable = !hidden && !shelf && maxWidth > minWidth;

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    // 从实际显示的宽度起算：保存的宽度可能被布局挤窄，否则要先拖过这段差值才有反应。
    const startWidth = width;
    const lowerBound = Math.min(minWidth, startWidth);

    resizeCleanupRef.current?.();

    let dragging = false;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      // 笔尖按住时的细微抖动不算拖动；否则被布局挤窄时的宽度会被当成偏好保存下来。
      if (!dragging && Math.abs(moveEvent.clientX - startX) < RESIZE_DRAG_SLOP_PX) {
        return;
      }
      dragging = true;

      appHost.internalActions.setLeftDockWidth(
        Math.min(maxWidth, Math.max(lowerBound, startWidth + (moveEvent.clientX - startX) * (side === "right" ? -1 : 1))),
      );
    };

    const stopResize = () => {
      target.removeEventListener("pointermove", handlePointerMove);
      target.removeEventListener("pointerup", handlePointerEnd);
      target.removeEventListener("pointercancel", handlePointerEnd);
      document.body.classList.remove("is-resizing-left-dock");
      resizeCleanupRef.current = null;
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId === pointerId) {
        stopResize();
      }
    };

    resizeCleanupRef.current = stopResize;
    target.setPointerCapture(pointerId);
    document.body.classList.add("is-resizing-left-dock");
    target.addEventListener("pointermove", handlePointerMove);
    target.addEventListener("pointerup", handlePointerEnd);
    target.addEventListener("pointercancel", handlePointerEnd);
  };

  return (
    <div className={cm(styles, "dock-shell-left")} hidden={hidden}>
      <aside className={cm(styles, "dock dock-left panel-surface")}>
        <section className={cm(styles, "dock-section")}>
          {isTouchLayout || shelf ? null : (
            <div className={cm(styles, "section-header")}>
              <div className={cm(styles, "section-header-copy")}>
                <h2>{currentPanelLabel}</h2>
              </div>
            </div>
          )}
          <div className={cm(styles, "section-body")}>
              {PANEL_ORDER.map((panelId) => {
                const PanelComponent = PANEL_COMPONENTS[panelId];
                const isActive = panelId === activePanel;

                return (
                  <div
                    aria-hidden={!isActive}
                    className={cm(styles, isActive ? "left-dock-panel is-active" : "left-dock-panel")}
                    data-panel-id={panelId}
                    hidden={!isActive}
                    key={panelId}
                  >
                    <PanelComponent appHost={appHost} active={!hidden && isActive} />
                  </div>
                );
              })}
          </div>
        </section>
      </aside>
      {resizable ? <div aria-hidden className={cm(styles, "dock-resize-handle")} onPointerDown={handleResizeStart} /> : null}
    </div>
  );
});

export function LeftDock({
  appHost,
  hidden = false,
  side = "left",
  width,
  maxWidth,
}: {
  appHost: AppHost;
  hidden?: boolean;
  /** 面板停靠在画布的哪一侧（跟随画布工具条）；右侧时抓手在面板左缘，向左拖变宽。 */
  side?: "left" | "right";
  /** 布局实际给面板的宽度（可能被画布挤窄到保存的宽度以下）。 */
  width: number;
  /** 当前布局下面板最宽可拖到的宽度。 */
  maxWidth: number;
}) {
  return <LeftDockView appHost={appHost} hidden={hidden} maxWidth={maxWidth} side={side} width={width} />;
}

export default LeftDock;
