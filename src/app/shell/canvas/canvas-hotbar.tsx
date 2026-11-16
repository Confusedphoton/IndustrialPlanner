import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

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
import { holdingTrayState, type HoldingTrayItem } from "./holding-tray-state";
import { pullFromHoldingTray } from "@/app/input/gesture/actions";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import { resolvePlacementPointerSource } from "@/app/shell/shared/placement-pointer-source";

/**
 * 画布上常驻的设备快捷栏：快速放置的收藏在前，其后是最近放置过的设备，贴在画布工具条一侧的底角。
 * 点按把设备交到手上；放置中点按原地换设备，不退出放置。拖到画布上直接放下一台。
 * 手上的设备高亮并在栏尾显示名称；按住图标可查看名称。
 */
export const CanvasHotbar = observer(function CanvasHotbar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const canvas = appHost.mainCanvas;
  const baseId = useEditorDocumentSnapshot(appHost.workspace.editor, selectDocumentBaseId, Object.is);

  const registry = appHost.workspace.registry;
  const deviceIds = resolveCanvasHotbarDeviceIds({
    favorites: normalizeQuickPlaceFavorites(appHost.internalState.workbench.quickPlaceFavoriteEntityIds),
    recents: recentPlacementDevices.deviceIds,
    isAvailable: (deviceId) => {
      const definition = registry.queries.findEntityDefinition(deviceId);
      return definition !== null && canPlaceEntityDefinitionInCurrentBase(canvas, definition);
    },
  });
  const trayItems = holdingTrayState.items.filter((item) => item.blueprint.baseId === baseId);
  if (deviceIds.length === 0 && trayItems.length === 0) {
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
      {trayItems.length === 0 ? null : (
        <div aria-label={t("canvasHotbar.tray")} className={cm(styles, "canvas-hotbar-tray")} role="group">
          {trayItems.map((item) => <HoldingTrayTile appHost={appHost} item={item} key={item.id} />)}
        </div>
      )}
      {heldDefinition === null ? null : (
        <span className={cm(styles, "canvas-hotbar-held")}>{t(heldDefinition.nameKey)}</span>
      )}
    </div>
  );
});

/** 暂存托盘里的一组：点按拿起放回画布；按住显示名称与丢弃按钮。 */
const HoldingTrayTile = observer(function HoldingTrayTile({ appHost, item }: { appHost: AppHost; item: HoldingTrayItem }) {
  const t = appHost.actions.translate;
  // 菜单挂到 body 上：快捷栏可横向滚动，会裁掉向上弹出的内容。
  const [menuAt, setMenuAt] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  useEffect(() => () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
  }, []);
  const name = t(appHost.workspace.registry.queries.findEntityDefinition(item.iconDeviceId)?.nameKey ?? item.iconDeviceId);
  const label = `${t("canvasHotbar.tray")}: ${name} ×${item.deviceCount}`;
  const pulled = appHost.mainCanvas.state.activeTool === "blueprint-placement"
    && appHost.mainCanvas.state.runtime.blueprintPlacementRecord?.blueprintId === item.blueprint.blueprintId;

  return (
    <span className={cm(styles, "canvas-hotbar-tray-slot")}>
      <button
        aria-label={label}
        aria-pressed={pulled}
        className={cm(styles, pulled ? "canvas-hotbar-button is-tray is-active" : "canvas-hotbar-button is-tray")}
        onPointerDown={(event) => {
          event.stopPropagation();
          heldRef.current = false;
          holdTimerRef.current = window.setTimeout(() => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (rect === undefined) return;
            heldRef.current = true;
            setMenuAt({ x: rect.left + rect.width / 2, y: rect.top });
          }, 450);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
          if (heldRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
          setMenuAt(null);
          pullFromHoldingTray(appHost.mainCanvas, item, resolvePlacementPointerSource(appHost, event.pointerType));
        }}
        onPointerCancel={() => {
          if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
        }}
        ref={buttonRef}
        title={label}
        type="button"
      >
        <img alt="" draggable={false} src={createEntityIconAssetUrl(appHost.workspace.registry.queries.findEntityDefinition(item.iconDeviceId)?.iconPath)} />
        <span className={cm(styles, "canvas-hotbar-tray-count")}>{item.deviceCount}</span>
      </button>
      {menuAt === null ? null : createPortal(
        <span
          className={cm(styles, "canvas-hotbar-tray-menu")}
          role="menu"
          style={{ left: menuAt.x, top: Math.max(8, menuAt.y - 8) }}
        >
          <span>{label}</span>
          <button
            className={cm(styles, "canvas-hotbar-tray-discard")}
            onClick={() => {
              setMenuAt(null);
              holdingTrayState.discard(item.id);
            }}
            role="menuitem"
            type="button"
          >
            {t("canvasHotbar.discard")}
          </button>
          <button
            aria-label={t("action.close")}
            className={cm(styles, "canvas-hotbar-tray-discard")}
            onClick={() => setMenuAt(null)}
            role="menuitem"
            type="button"
          >
            ×
          </button>
        </span>,
        document.body,
      )}
    </span>
  );
});
