import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import LucideEllipsis from "~icons/lucide/ellipsis";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import type { ActivePanel } from "@/app/state/state-impl";
import { recipeTreeOverlayState } from "@/app/shell/recipe-tree/recipe-tree-state";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";


type LeftToolbarPanel = Exclude<ActivePanel, null>;

const PRIMARY_TOOLBAR_ITEMS = [
  {
    id: "primary-region",
    icon: "region" as const,
    labelKey: "workbench.leftRail.region",
    panel: "region" as LeftToolbarPanel,
  },
  {
    id: "primary-blueprint",
    icon: "blueprint" as const,
    labelKey: "workbench.leftRail.blueprint",
    panel: "blueprint" as LeftToolbarPanel,
  },
  {
    id: "primary-base",
    icon: "base" as const,
    labelKey: "workbench.leftRail.base",
    panel: "base" as LeftToolbarPanel,
  },
  {
    id: "primary-simulation",
    icon: "simulation" as const,
    labelKey: "workbench.leftRail.simulation",
    panel: "simulation" as LeftToolbarPanel,
    debugOnly: true,
  },
];

const UTILITY_TOOLBAR_ITEMS = [
  {
    id: "utility-debug-log",
    icon: "debug-log" as const,
    labelKey: "workbench.utility.debugLogs",
    dialogKey: "debug-log",
    debugOnly: true,
  },
  {
    id: "utility-toolbox",
    icon: "toolbox" as const,
    labelKey: "workbench.utility.toolbox",
    dialogKey: "toolbox",
  },
  {
    id: "utility-help",
    icon: "help" as const,
    labelKey: "workbench.utility.help",
    dialogKey: "help",
  },
  {
    id: "utility-feedback",
    icon: "feedback" as const,
    labelKey: "workbench.utility.feedback",
    dialogKey: "feedback",
  },
  {
    id: "utility-settings",
    icon: "settings" as const,
    labelKey: "workbench.utility.settings",
    dialogKey: "settings",
  },
];

/** 常驻在工具栏上的项；其余（历史、基地、帮助、反馈、设置等不常用的）收进「更多」。 */
const PINNED_PANELS: ReadonlySet<LeftToolbarPanel> = new Set(["region", "blueprint"]);
const PINNED_DIALOGS: ReadonlySet<string> = new Set(["toolbox"]);

export const LeftToolbar = observer(function LeftToolbar({
  appHost,
  compact = false,
}: {
  appHost: AppHost;
  compact?: boolean;
}) {
  const t = appHost.actions.translate;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || moreRef.current?.contains(event.target) !== true) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const activePanel = appHost.internalState.runtime.activePanel ?? "placement";
  const dialogState = appHost.internalState.workbench.dialogState;
  const primaryToolbarItems = PRIMARY_TOOLBAR_ITEMS.filter((item) => {
    if (item.panel === "region" && !appHost.state.settings.showRegionAnnotations) {
      return false;
    }
    return item.debugOnly !== true || appHost.state.settings.debugMode;
  });
  const utilityToolbarItems = UTILITY_TOOLBAR_ITEMS.filter((item) => {
    return item.debugOnly !== true || appHost.state.settings.debugMode;
  });
  const isPanelActive = (panel: LeftToolbarPanel) => leftDockOpen && activePanel === panel;
  const isDialogActive = (dialogKey: string) =>
    (dialogState as Record<string, { visible: boolean } | undefined>)[dialogKey]?.visible ?? false;
  const togglePanel = (panel: LeftToolbarPanel) => {
    if (isPanelActive(panel)) {
      appHost.internalActions.toggleLeftDock();
      return;
    }
    appHost.internalActions.setActivePanel(panel);
  };

  const panelButton = (item: typeof PRIMARY_TOOLBAR_ITEMS[number], inMenu: boolean) => {
    const label = t(item.labelKey);
    const isActive = isPanelActive(item.panel);
    return (
      <button
        aria-label={label}
        aria-pressed={isActive}
        className={cm(styles, isActive ? "rail-button is-active" : "rail-button")}
        key={item.id}
        onClick={() => {
          togglePanel(item.panel);
          if (inMenu) setMoreOpen(false);
        }}
        role={inMenu ? "menuitem" : undefined}
        title={label}
        type="button"
      >
        <span className={cm(styles, "rail-button-short")}>
          <WorkbenchIcon kind={item.icon} />
        </span>
        <span className={cm(styles, "rail-button-label")}>{label}</span>
      </button>
    );
  };

  const dialogButton = (item: typeof UTILITY_TOOLBAR_ITEMS[number], inMenu: boolean) => {
    const label = t(item.labelKey);
    const isActive = isDialogActive(item.dialogKey);
    return (
      <button
        aria-label={label}
        aria-pressed={isActive}
        className={cm(styles, isActive ? "rail-button rail-button-utility is-active" : "rail-button rail-button-utility")}
        key={item.id}
        onClick={() => {
          appHost.internalActions.openDialog(item.dialogKey);
          if (inMenu) setMoreOpen(false);
        }}
        role={inMenu ? "menuitem" : undefined}
        title={label}
        type="button"
      >
        <span className={cm(styles, "rail-button-short")}>
          <WorkbenchIcon kind={item.icon} />
        </span>
        <span className={cm(styles, "rail-button-label")}>{label}</span>
      </button>
    );
  };

  const overflowPanels = primaryToolbarItems.filter((item) => !PINNED_PANELS.has(item.panel));
  const overflowDialogs = utilityToolbarItems.filter((item) => !PINNED_DIALOGS.has(item.dialogKey));
  const overflowActive = overflowPanels.some((item) => isPanelActive(item.panel))
    || overflowDialogs.some((item) => isDialogActive(item.dialogKey));
  const moreLabel = t("workbench.leftRail.more");

  return (
    <aside className={cm(styles, compact ? "left-toolbar panel-surface is-compact" : "left-toolbar panel-surface")}>
      <div className={cm(styles, "toolbar-rail-group")}>
        {primaryToolbarItems.filter((item) => PINNED_PANELS.has(item.panel)).map((item) => panelButton(item, false))}
      </div>
      <div className={cm(styles, "toolbar-rail-group toolbar-rail-utility")}>
        {/* 配方树浮层开关；浮层常驻画布上方，不占用左侧面板。 */}
        <button
          type="button"
          aria-label={t("workbench.utility.recipeTree")}
          aria-pressed={recipeTreeOverlayState.visible}
          className={cm(styles, recipeTreeOverlayState.visible
            ? "rail-button rail-button-utility is-active"
            : "rail-button rail-button-utility")}
          onClick={recipeTreeOverlayState.toggleVisible}
          title={t("recipeTree.title")}
        >
          <span className={cm(styles, "rail-button-short")}><WorkbenchIcon kind="recipe-tree" /></span>
          <span className={cm(styles, "rail-button-label")}>{t("workbench.utility.recipeTree")}</span>
        </button>
        {utilityToolbarItems.filter((item) => PINNED_DIALOGS.has(item.dialogKey)).map((item) => dialogButton(item, false))}
        <div className={cm(styles, "left-toolbar-more")} ref={moreRef}>
          <button
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            aria-label={moreLabel}
            className={cm(styles, moreOpen || overflowActive
              ? "rail-button rail-button-utility is-active"
              : "rail-button rail-button-utility")}
            onClick={() => setMoreOpen((open) => !open)}
            title={moreLabel}
            type="button"
          >
            <span className={cm(styles, "rail-button-short")}><LucideEllipsis aria-hidden /></span>
            <span className={cm(styles, "rail-button-label")}>{moreLabel}</span>
          </button>
          <div aria-label={moreLabel} className={cm(styles, "left-toolbar-more-menu")} hidden={!moreOpen} role="menu">
            {overflowPanels.map((item) => panelButton(item, true))}
            {overflowDialogs.map((item) => dialogButton(item, true))}
          </div>
        </div>
      </div>
    </aside>
  );
});
