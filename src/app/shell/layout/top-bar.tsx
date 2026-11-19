import LucideEllipsis from "~icons/lucide/ellipsis";
import LucideMenu from "~icons/lucide/menu";
import { FullscreenToggleButton } from "@/app/shell/layout/fullscreen-toggle-button";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { RAIL_TOGGLE_CONTINUOUS_PLACEMENT_BUTTON_ID } from "@/app/input/gesture/actions";
import type { AppHost } from "@/app/host/app-host";
import type { ActivePanel } from "@/app/state/state-impl";
import { recipeTreeOverlayState } from "@/app/shell/recipe-tree/recipe-tree-state";
import { observer } from "mobx-react-lite";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  isTouchLandscapeScreenProfile,
} from "@/shared/browser/screen-profile";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  ACTIVITY_DEFINITIONS,
  resolveOngoingActivityDefinitions,
} from "@/shared/registry/activity-availability";

const ACTIVITY_STATUS_REFRESH_INTERVAL_MS = 60_000;
const SIMULATION_CONTROL_BUTTON_ID = "top-bar-simulation-control";
const SIMULATION_SPEED_OPTIONS = [0.25, 1, 2, 4, 16] as const;

function formatSimulationSpeedLabel(speed: number) {
  return `x${speed}`;
}

export const SimulationControlButton = observer(function SimulationControlButton({
  appHost,
  className,
}: {
  appHost: AppHost;
  className: string;
}) {
  const simulationState = appHost.workspace.simulation?.state.runningState ?? "stop";
  const isStarting = simulationState === "starting";
  const isRunning = simulationState === "start";
  const iconKind = simulationState === "start"
    ? "pause"
    : simulationState === "pause"
      ? "resume"
      : "play";
  const label = appHost.actions.translate(
    isRunning
      ? "action.pause"
      : simulationState === "pause"
        ? "action.resume"
        : "action.start",
  );

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: SIMULATION_CONTROL_BUTTON_ID,
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: SIMULATION_CONTROL_BUTTON_ID,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) {
      return;
    }

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: SIMULATION_CONTROL_BUTTON_ID,
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  };

  return (
    <button
      aria-label={label}
      aria-pressed={isRunning}
      className={cm(styles, className)}
      data-ui-button-id={SIMULATION_CONTROL_BUTTON_ID}
      disabled={isStarting}
      onClick={handleClick}
      onPointerDown={preventTouchPointerCompatibilityMouseEvents}
      onPointerUp={handlePointerUp}
      title={label}
      type="button"
    >
      <span className={cm(styles, "top-bar-toggle-icon")}>
        <WorkbenchIcon kind={iconKind} />
      </span>
      <span className={cm(styles, "sr-only")}>{label}</span>
    </button>
  );
});


export const SimulationSpeedButtons = observer(function SimulationSpeedButtons({
  appHost,
}: {
  appHost: AppHost;
}) {
  const simulation = appHost.workspace.simulation;
  const currentSpeed = simulation?.state.simulationSpeed ?? 1;
  const isStarting = simulation?.state.runningState === "starting";
  const t = appHost.actions.translate;

  const handleSpeedClick = (speed: number) => {
    if (simulation === null) return;
    simulation.actions.setSimulationSpeed(speed);
  };

  const handleStopClick = () => {
    if (simulation === null) return;
    simulation.actions.stop();
  };

  return (
    <>
      {SIMULATION_SPEED_OPTIONS.map((speed) => (
        <button
          key={speed}
          aria-label={`${t("statusBar.speed")} ${formatSimulationSpeedLabel(speed)}`}
          aria-pressed={currentSpeed === speed}
          disabled={isStarting}
          className={cm(styles, currentSpeed === speed
            ? "top-bar-speed-button top-bar-speed-active"
            : "top-bar-speed-button")}
          data-ui-button-id={`top-bar-speed-${speed}`}
          onClick={() => handleSpeedClick(speed)}
          title={`${t("statusBar.speed")} ${formatSimulationSpeedLabel(speed)}`}
          type="button"
        >
          <span className={cm(styles, "top-bar-speed-label")}>{formatSimulationSpeedLabel(speed)}</span>
        </button>
      ))}
      <button
        aria-label={t("action.stop")}
        className={cm(styles, "top-bar-icon-button")}
        data-ui-button-id="top-bar-simulation-stop"
        disabled={isStarting}
        onClick={handleStopClick}
        title={t("action.stop")}
        type="button"
      >
        <span className={cm(styles, "top-bar-toggle-icon")}>
          <WorkbenchIcon kind="stop" />
        </span>
        <span className={cm(styles, "sr-only")}>{t("action.stop")}</span>
      </button>
    </>
  );
});

export const TimelineButton = observer(function TimelineButton({
  appHost,
  className,
  onOpen,
}: {
  appHost: AppHost;
  className: string;
  onOpen?: () => void;
}) {
  const label = appHost.actions.translate("timelineDialog.title");
  const active = appHost.internalState.workbench.dialogState.timeline.visible;

  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cm(styles, className)}
      data-ui-button-id="top-bar-timeline"
      onClick={() => {
        onOpen?.();
        appHost.internalActions.openDialog("timeline");
      }}
      title={label}
      type="button"
    >
      <span className={cm(styles, "top-bar-toggle-icon")}>
        <WorkbenchIcon kind="timeline" />
      </span>
      <span className={cm(styles, "sr-only")}>{label}</span>
    </button>
  );
});

function MobileOngoingActivityStatus({ label }: { readonly label: string }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!tooltipVisible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node)
        || buttonRef.current?.contains(target)
        || tooltipRef.current?.contains(target)
      ) {
        return;
      }

      setTooltipVisible(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTooltipVisible(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [tooltipVisible]);

  return (
    <span className={cm(styles, "top-bar-ongoing-activity-mobile")}>
      <button
        aria-controls={tooltipVisible ? tooltipId : undefined}
        aria-expanded={tooltipVisible}
        aria-label={label}
        className={cm(styles, "top-bar-ongoing-activity-button top-bar-icon-button")}
        onClick={() => setTooltipVisible((visible) => !visible)}
        ref={buttonRef}
        title={label}
        type="button"
      >
        <span className={cm(styles, "top-bar-toggle-icon")}>
          <WorkbenchIcon kind="simulation" />
        </span>
        <span className={cm(styles, "sr-only")}>{label}</span>
      </button>
      {tooltipVisible ? (
        <span
          className={cm(styles, "top-bar-ongoing-activity-tooltip")}
          id={tooltipId}
          ref={tooltipRef}
          role="tooltip"
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

function TopBarMenu({ label, icon, children }: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  return (
    <div className={cm(styles, "top-bar-menu")} ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={label}
        className={cm(styles, "top-bar-menu-trigger")}
        onClick={() => setOpen(!open)}
        ref={buttonRef}
        title={label}
        type="button"
      >
        <span className={cm(styles, "top-bar-toggle-icon")}>{icon}</span>
        {label}
      </button>
      <div className={cm(styles, "top-bar-menu-panel")} hidden={!open} id={panelId}>
        {open ? children(() => setOpen(false)) : null}
      </div>
    </div>
  );
}

export const SimulationMenu = observer(function SimulationMenu({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const running = appHost.workspace.simulation?.state.runningState === "start";
  return (
    <TopBarMenu
      label={t("workbench.leftRail.simulation")}
      icon={<WorkbenchIcon kind={running ? "play" : "simulation"} />}
    >
      {(close) => (
        <>
          <SimulationControlButton appHost={appHost} className="top-bar-icon-button" />
          <SimulationSpeedButtons appHost={appHost} />
          <TimelineButton appHost={appHost} className="top-bar-icon-button" onOpen={close} />
        </>
      )}
    </TopBarMenu>
  );
});

export const WorkbenchMenu = observer(function WorkbenchMenu({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const canvas = appHost.mainCanvas;
  const placing = canvas.state.activeTool === "single-placement" || canvas.state.activeTool === "blueprint-placement";
  const continuous = canvas.state.activeTool === "blueprint-placement"
    ? canvas.state.runtime.blueprintPlacementContinuous
    : canvas.state.runtime.singlePlacementContinuous;
  const activePanel = appHost.internalState.runtime.activePanel ?? "placement";
  const dockOpen = appHost.state.workbench.leftDockOpen;
  const { dialogState } = appHost.internalState.workbench;
  const { debugMode, showRegionAnnotations } = appHost.state.settings;
  const recipesVisible = recipeTreeOverlayState.visible;
  const toolboxVisible = dialogState.toolbox.visible;

  return (
    <TopBarMenu label={t("topBar.menu")} icon={<LucideMenu aria-hidden />}>
      {(close) => {
        const item = (
          labelKey: string,
          icon: Parameters<typeof WorkbenchIcon>[0]["kind"],
          onClick: () => void,
          pressed?: boolean,
        ) => (
          <button
            aria-pressed={pressed}
            className={cm(styles, "top-bar-menu-trigger")}
            onClick={() => { onClick(); close(); }}
            title={t(labelKey)}
            type="button"
          >
            <span className={cm(styles, "top-bar-toggle-icon")}><WorkbenchIcon kind={icon} /></span>
            {t(labelKey)}
          </button>
        );
        const panel = (id: NonNullable<ActivePanel>, labelKey: string, icon: Parameters<typeof WorkbenchIcon>[0]["kind"]) => {
          const selected = dockOpen && activePanel === id;
          return item(labelKey, icon, () => {
            if (selected) appHost.internalActions.toggleLeftDock();
            else appHost.internalActions.setActivePanel(id);
          }, selected);
        };

        return (
          <div className={cm(styles, "top-bar-workbench-menu")}>
            {panel("placement", "workbench.panel.placement.title", "placement")}
            {panel("blueprint", "workbench.leftRail.blueprint", "blueprint")}
            {showRegionAnnotations ? panel("region", "workbench.leftRail.region", "region") : null}
            {item("workbench.utility.recipeTree", "recipe-tree", recipeTreeOverlayState.toggleVisible, recipesVisible)}
            {item("workbench.utility.toolbox", "toolbox", () => appHost.internalActions.openDialog("toolbox"), toolboxVisible)}
            {placing ? (
              <button
                aria-pressed={continuous}
                className={cm(styles, "top-bar-menu-trigger")}
                disabled={!continuous && !canvas.isOperationEnabled("continuous-placement")}
                onClick={() => appHost.gestureAdapter.handleUiButtonMouseTap({
                  uiButtonId: RAIL_TOGGLE_CONTINUOUS_PLACEMENT_BUTTON_ID,
                  button: 0,
                  altKey: false,
                  ctrlKey: false,
                  metaKey: false,
                  shiftKey: false,
                })}
                type="button"
              >
                {t("action.continuousPlacement")}
              </button>
            ) : null}
            <details className={cm(styles, "top-bar-menu-more")}>
              <summary className={cm(styles, "top-bar-menu-trigger")}>
                <span className={cm(styles, "top-bar-toggle-icon")}><LucideEllipsis aria-hidden /></span>
                {t("workbench.leftRail.more")}
              </summary>
              <div className={cm(styles, "top-bar-menu-more-items")}>
                {panel("base", "workbench.leftRail.base", "base")}
                {debugMode ? panel("simulation", "workbench.leftRail.simulation", "simulation") : null}
                {debugMode ? item("workbench.utility.debugLogs", "debug-log", () => appHost.internalActions.openDialog("debug-log")) : null}
                {item("workbench.utility.help", "help", () => appHost.internalActions.openDialog("help"))}
                {item("workbench.utility.feedback", "feedback", () => appHost.internalActions.openDialog("feedback"))}
                {item("workbench.utility.settings", "settings", () => appHost.internalActions.openDialog("settings"))}
              </div>
            </details>
          </div>
        );
      }}
    </TopBarMenu>
  );
});

export const TopBar = observer(function TopBar({
  appHost,
  isStandalone = false,
  onFullscreenActionFailure,
}: {
  appHost: AppHost;
  isStandalone?: boolean;
  onFullscreenActionFailure?: (reason: "rejected" | "unsupported") => void;
}) {
  const t = appHost.actions.translate;
  const {
    screenProfile,
    workbench: { topBarCollapsed },
  } = appHost.state;
  const [activityNow, setActivityNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActivityNow(Date.now());
    }, ACTIVITY_STATUS_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  const ongoingActivities = resolveOngoingActivityDefinitions(
    ACTIVITY_DEFINITIONS,
    activityNow,
  );
  const ongoingActivityLabel = ongoingActivities.length > 0
    ? `${t("topBar.ongoingActivity")}${ongoingActivities.map((activity) => activity.name).join("、")}`
    : null;
  const isMobile = screenProfile.deviceClass === "mobile";

  const toggleTopBarCollapsed = () => {
    appHost.internalActions.toggleTopBarCollapsed();
  };
  const isTouchLandscape = isTouchLandscapeScreenProfile(screenProfile);
  const collapseActionKey = isTouchLandscape && topBarCollapsed ? "action.expand" : "action.collapse";
  const collapseButtonLabel = `${t(collapseActionKey)} ${t("topBar.controls")}`;

  if (isTouchLandscape && topBarCollapsed) {
    return null;
  }

  return (
    <header className={cm(styles, "top-bar")}>
      <div className={cm(styles, "top-bar-title-block")}>
        <div className={cm(styles, "top-bar-title-stack")}>
          <div className={cm(styles, "top-bar-title")}>
            {t("app.title")}
            {window.__APP_VERSION__ ? (
              <span className={cm(styles, "top-bar-version")}>{window.__APP_VERSION__}</span>
            ) : (
              <span className={cm(styles, "top-bar-version")}>(Dev)</span>
            )}
          </div>
          {ongoingActivityLabel !== null && !isMobile ? (
            <div aria-live="polite" className={cm(styles, "top-bar-ongoing-activity-text")}>
              {ongoingActivityLabel}
            </div>
          ) : null}
        </div>
        {ongoingActivityLabel !== null && isMobile ? (
          <MobileOngoingActivityStatus label={ongoingActivityLabel} />
        ) : null}
      </div>
      <div className={cm(styles, "toolbar-group top-bar-controls")}>
        <WorkbenchMenu appHost={appHost} />
        <SimulationMenu appHost={appHost} />
        <FullscreenToggleButton
          appHost={appHost}
          className={cm(styles, "top-bar-icon-button top-bar-fullscreen-button")}
          isStandalone={isStandalone}
          onFullscreenActionFailure={onFullscreenActionFailure}
        />
        {isTouchLandscape ? (
          <button
            aria-label={collapseButtonLabel}
            className={cm(styles, "top-bar-collapse-button top-bar-icon-button")}
            onClick={toggleTopBarCollapsed}
            title={collapseButtonLabel}
            type="button"
          >
            <span className={cm(styles, "top-bar-toggle-icon")}>
              <WorkbenchIcon kind="panel-top-close" />
            </span>
            <span className={cm(styles, "sr-only")}>{t("action.collapse")}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
});
