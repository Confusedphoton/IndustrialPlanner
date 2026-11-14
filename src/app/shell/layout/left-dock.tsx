import { useEffect, useRef, type ComponentType } from "react";
import { observer } from "mobx-react-lite";
import { BasePanel } from "@/app/shell/panels/base-panel";
import { BlueprintPanel } from "@/app/shell/panels/blueprint-panel";
import { HistoryPanel } from "@/app/shell/panels/history-panel";
import { PlacementPanel } from "@/app/shell/panels/placement-panel";
import { RegionPanel } from "@/app/shell/panels/region-panel";
import { SimulationPanel } from "@/app/shell/panels/simulation-panel";
import type { AppHost } from "@/app/host/app-host";
import {
  clampLeftDockWidth,
  type ActivePanel,
} from "@/app/state/state-impl";
import { isMobileOrTabletScreenProfile } from "@/shared/browser/screen-profile";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";


type LeftDockPanelId = Exclude<ActivePanel, null>;

const DEFAULT_ACTIVE_PANEL: LeftDockPanelId = "placement";

const PANEL_TITLE_KEYS: Record<LeftDockPanelId, string> = {
  placement: "workbench.panel.placement.title",
  region: "workbench.panel.region.title",
  blueprint: "workbench.panel.blueprint.title",
  history: "workbench.panel.history.title",
  base: "workbench.panel.base.title",
  simulation: "workbench.panel.simulation.title",
};

const PANEL_COMPONENTS: Record<LeftDockPanelId, ComponentType<{ appHost: AppHost; active?: boolean }>> = {
  placement: PlacementPanel,
  region: RegionPanel,
  blueprint: BlueprintPanel,
  history: HistoryPanel,
  base: BasePanel,
  simulation: SimulationPanel,
};

const PANEL_ORDER: LeftDockPanelId[] = ["placement", "region", "blueprint", "history", "base", "simulation"];

const LeftDockView = observer(function LeftDockView({
  appHost,
  hidden,
}: {
  appHost: AppHost;
  hidden: boolean;
}) {
  const t = appHost.actions.translate;
  const activePanel = appHost.internalState.runtime.activePanel ?? DEFAULT_ACTIVE_PANEL;
  const currentPanelLabel = t(PANEL_TITLE_KEYS[activePanel]);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const screenProfile = appHost.state.screenProfile;
  const isTouchLayout = isMobileOrTabletScreenProfile(screenProfile);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isTouchLayout) {
      return;
    }

    event.preventDefault();

    const startX = event.clientX;
    const startWidth = appHost.state.workbench.leftDockWidth;

    resizeCleanupRef.current?.();

    const handlePointerMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;

      appHost.internalActions.setLeftDockWidth(clampLeftDockWidth(startWidth + deltaX));
    };

    const stopResize = () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-resizing-left-dock");
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = stopResize;
    document.body.classList.add("is-resizing-left-dock");
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResize);
  };

  return (
    <div className={cm(styles, "dock-shell-left")} hidden={hidden}>
      <aside className={cm(styles, "dock dock-left panel-surface")}>
        <section className={cm(styles, "dock-section")}>
          {isTouchLayout ? null : (
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
      {isTouchLayout ? null : <div className={cm(styles, "dock-resize-handle")} onMouseDown={handleResizeStart} />}
    </div>
  );
});

export function LeftDock({
  appHost,
  hidden = false,
}: {
  appHost: AppHost;
  hidden?: boolean;
}) {
  return <LeftDockView appHost={appHost} hidden={hidden} />;
}

export default LeftDock;
