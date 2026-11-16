import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import type { AppHost } from "@/app/host/app-host";
import { holdDeviceForPlacement } from "@/app/input/gesture/actions";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { normalizeQuickPlaceFavorites, resolveCanvasHotbarDeviceIds } from "@/app/quick-place";
import { recentPlacementDevices } from "@/app/recent-placement-devices";
import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import { useEditorDocumentSnapshot } from "../hooks";
import {
  didPanelPlacementDragJustEnd,
  resolveDevicePlacementTarget,
  startPanelPlacementPress,
} from "@/app/shell/shared/panel-placement-drag";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { resolvePlacementPointerSource } from "@/app/shell/shared/placement-pointer-source";
import { canvasToolRailState } from "./canvas-tool-rail-state";

/** 按住快捷栏图标这么久显示设备名（触控没有悬停提示），松开时不换设备。 */
const NAME_PEEK_MS = 450;

/**
 * 画布上常驻的设备快捷栏：快速放置的收藏在前，其后是最近放置过的设备，贴在画布工具条一侧的底角。
 * 点按把设备交到手上；放置中点按原地换设备，不退出放置。拖到画布上直接放下一台。
 * 手上的设备高亮并在栏尾显示名称；按住图标可查看名称。
 */
export const CanvasHotbar = observer(function CanvasHotbar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const canvas = appHost.mainCanvas;
  useEditorDocumentSnapshot(appHost.workspace.editor, selectDocumentBaseId, Object.is);
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekTimerRef = useRef<number | null>(null);
  const peekShownRef = useRef(false);
  useEffect(() => () => {
    if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
  }, []);

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
  const nameOf = (deviceId: string) => t(registry.queries.findEntityDefinition(deviceId)?.nameKey ?? deviceId);

  const clearPeekTimer = () => {
    if (peekTimerRef.current !== null) {
      window.clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, deviceId: string) => {
    event.stopPropagation();
    peekShownRef.current = false;
    clearPeekTimer();
    peekTimerRef.current = window.setTimeout(() => {
      peekShownRef.current = true;
      setPeekId(deviceId);
    }, NAME_PEEK_MS);
    startPanelPlacementPress(appHost, event, () => {
      clearPeekTimer();
      setPeekId(null);
      return resolveDevicePlacementTarget(appHost, deviceId);
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>, deviceId: string) => {
    event.stopPropagation();
    clearPeekTimer();
    setPeekId(null);
    if (peekShownRef.current || didPanelPlacementDragJustEnd()) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    holdDeviceForPlacement(canvas, { deviceId }, { source: resolvePlacementPointerSource(appHost, event.pointerType) });
  };

  return (
    <div
      aria-label={t("canvasHotbar.label")}
      className={cm(styles, canvasToolRailState.side === "right" ? "canvas-hotbar is-right" : "canvas-hotbar")}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      role="toolbar"
      style={{ "--canvas-hotbar-edge-offset": `${canvasToolRailState.baseWidth + 6}px` } as CSSProperties}
    >
      {deviceIds.map((deviceId) => {
        const definition = registry.queries.findEntityDefinition(deviceId);
        const name = nameOf(deviceId);
        return (
          <button
            aria-label={name}
            aria-pressed={heldId === deviceId}
            className={cm(styles, heldId === deviceId ? "canvas-hotbar-button is-active" : "canvas-hotbar-button")}
            data-ui-button-id={`canvas-hotbar-${deviceId}`}
            key={deviceId}
            onClick={(event) => {
              // 键盘触发（detail 为 0）；指针点按由 pointerup 处理。
              if (event.detail === 0) holdDeviceForPlacement(canvas, { deviceId }, { source: "mouse" });
            }}
            onPointerCancel={() => {
              clearPeekTimer();
              setPeekId(null);
            }}
            onPointerDown={(event) => handlePointerDown(event, deviceId)}
            onPointerUp={(event) => handlePointerUp(event, deviceId)}
            title={name}
            type="button"
          >
            <img alt="" draggable={false} src={createEntityIconAssetUrl(definition?.iconPath)} />
            {peekId === deviceId ? <span className={cm(styles, "canvas-hotbar-peek")} role="tooltip">{name}</span> : null}
          </button>
        );
      })}
      {heldDefinition === null ? null : (
        <span className={cm(styles, "canvas-hotbar-held")}>{t(heldDefinition.nameKey)}</span>
      )}
    </div>
  );
});
