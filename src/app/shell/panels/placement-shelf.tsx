import { observer } from "mobx-react-lite";
import LucidePanelLeftOpen from "~icons/lucide/panel-left-open";

import type { AppHost } from "@/app/host/app-host";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import { HoldableDeviceTile } from "@/app/shell/shared/holdable-device-tile";
import { useEditorDocumentSnapshot } from "../hooks";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { buildPlacementDeviceSections } from "./placement-catalog";
import { placementShelfState } from "./placement-shelf-state";
import { PlacementTodoList } from "./placement-todo-list";

/**
 * 窄设备架：一列图标。上方是待放清单，其下每个分类一个图标，点按展开该分类的设备（同时只展开一个）。
 * 设备名在笔悬停时提示，触控按住图标显示；顶部按钮切回完整面板。
 */
export const PlacementShelf = observer(function PlacementShelf({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  useEditorDocumentSnapshot(appHost.workspace.editor, selectDocumentBaseId, Object.is);
  const sections = buildPlacementDeviceSections(appHost);
  const canvas = appHost.mainCanvas;
  const heldId = canvas.state.activeTool === "single-placement" ? canvas.state.runtime.singlePlacementDeviceId : null;
  const registry = appHost.workspace.registry;
  const expandLabel = t("placement.showFullPalette");

  return (
    <div className={cm(styles, "placement-shelf")}>
      <button
        aria-label={expandLabel}
        className={cm(styles, "placement-shelf-button")}
        onClick={() => placementShelfState.setEnabled(false)}
        title={expandLabel}
        type="button"
      >
        <LucidePanelLeftOpen aria-hidden />
      </button>
      <PlacementTodoList appHost={appHost} variant="shelf" />
      {sections.map((section) => {
        const open = placementShelfState.openGroupKey === section.titleKey;
        const label = t(section.titleKey);
        const firstDeviceId = section.buttons[0]!.uiButtonId.replace("placement-", "");
        return (
          <div className={cm(styles, "placement-shelf-group")} key={section.titleKey} role="group" aria-label={label}>
            <button
              aria-expanded={open}
              aria-label={label}
              className={cm(styles, open ? "placement-shelf-button is-category is-open" : "placement-shelf-button is-category")}
              onClick={() => placementShelfState.toggleGroup(section.titleKey)}
              title={label}
              type="button"
            >
              <img alt="" src={createEntityIconAssetUrl(registry.queries.findEntityDefinition(firstDeviceId)?.iconPath)} />
            </button>
            {open ? section.buttons.map((button) => {
              const deviceId = button.uiButtonId.replace("placement-", "");
              return (
                <HoldableDeviceTile
                  appHost={appHost}
                  className={cm(styles, "placement-shelf-button")}
                  device={{ deviceId }}
                  held={heldId === deviceId}
                  key={deviceId}
                  label={t(button.labelKey)}
                  peekClassName={cm(styles, "placement-shelf-peek")}
                />
              );
            }) : null}
          </div>
        );
      })}
    </div>
  );
});
