import { observer } from "mobx-react-lite";
import type { CSSProperties } from "react";

import type { AppHost } from "@/app/host/app-host";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { normalizeQuickPlaceFavorites, resolveCanvasHotbarDeviceIds } from "@/app/quick-place";
import { recentPlacementDevices } from "@/app/recent-placement-devices";
import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import { useEditorDocumentSnapshot } from "../hooks";
import { HoldableDeviceTile } from "@/app/shell/shared/holdable-device-tile";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { canvasToolRailState } from "./canvas-tool-rail-state";

/**
 * 画布上常驻的设备快捷栏：快速放置的收藏在前，其后是最近放置过的设备，贴在画布工具条一侧的底角。
 * 点按把设备交到手上；放置中点按原地换设备，不退出放置。拖到画布上直接放下一台。
 * 手上的设备高亮并在栏尾显示名称；按住图标可查看名称。
 */
export const CanvasHotbar = observer(function CanvasHotbar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const canvas = appHost.mainCanvas;
  useEditorDocumentSnapshot(appHost.workspace.editor, selectDocumentBaseId, Object.is);

  const registry = appHost.workspace.registry;
  const deviceIds = resolveCanvasHotbarDeviceIds({
    favorites: normalizeQuickPlaceFavorites(appHost.internalState.workbench.quickPlaceFavoriteEntityIds),
    recents: recentPlacementDevices.deviceIds,
    isAvailable: (deviceId) => {
      const definition = registry.queries.findEntityDefinition(deviceId);
      return definition !== null && canPlaceEntityDefinitionInCurrentBase(canvas, definition);
    },
  });
  if (deviceIds.length === 0) {
    return null;
  }

  const heldId = canvas.state.activeTool === "single-placement" ? canvas.state.runtime.singlePlacementDeviceId : null;
  const heldDefinition = heldId === null ? null : registry.queries.findEntityDefinition(heldId);

  return (
    <div
      aria-label={t("canvasHotbar.label")}
      className={cm(styles, canvasToolRailState.side === "right" ? "canvas-hotbar is-right" : "canvas-hotbar")}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      role="toolbar"
      style={{ "--canvas-hotbar-edge-offset": `${canvasToolRailState.baseWidth + 6}px` } as CSSProperties}
    >
      {deviceIds.map((deviceId) => (
        <HoldableDeviceTile
          appHost={appHost}
          className={cm(styles, "canvas-hotbar-button")}
          device={{ deviceId }}
          held={heldId === deviceId}
          key={deviceId}
          label={t(registry.queries.findEntityDefinition(deviceId)?.nameKey ?? deviceId)}
          peekClassName={cm(styles, "canvas-hotbar-peek")}
        />
      ))}
      {heldDefinition === null ? null : (
        <span className={cm(styles, "canvas-hotbar-held")}>{t(heldDefinition.nameKey)}</span>
      )}
    </div>
  );
});
