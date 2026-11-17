import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import type { AppHost } from "@/app/host/app-host";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { recentPlacementKey, recentPlacements } from "@/app/recent-placement-devices";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import { useEditorDocumentSnapshot } from "../hooks";
import { HoldableDeviceTile } from "@/app/shell/shared/holdable-device-tile";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { canvasToolRailState } from "./canvas-tool-rail-state";
import { holdingTrayState, type HoldingTrayItem } from "./holding-tray-state";
import { pullFromHoldingTray } from "@/app/input/gesture/actions";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { resolvePlacementPointerSource } from "@/app/shell/shared/placement-pointer-source";

/** 画布快捷栏最多显示的设备数。 */
const CANVAS_HOTBAR_LIMIT = 12;

/**
 * 画布上常驻的设备快捷栏：最近放置过的设备（连同当时的配方），贴在画布工具条一侧的底角，后接暂存托盘。
 * 点按把设备交到手上；放置中点按原地换设备，不退出放置。拖到画布上直接放下一台。
 * 带配方的条目角上显示产物；手上的设备高亮并在栏尾显示名称；按住图标可查看名称。
 */
export const CanvasHotbar = observer(function CanvasHotbar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const canvas = appHost.mainCanvas;
  const baseId = useEditorDocumentSnapshot(appHost.workspace.editor, selectDocumentBaseId, Object.is);

  const registry = appHost.workspace.registry;
  const entries = recentPlacements.entries.filter((entry) => {
    const definition = registry.queries.findEntityDefinition(entry.deviceId);
    return definition !== null && canPlaceEntityDefinitionInCurrentBase(canvas, definition);
  }).slice(0, CANVAS_HOTBAR_LIMIT);
  const trayItems = holdingTrayState.items.filter((item) => item.blueprint.baseId === baseId);
  if (entries.length === 0 && trayItems.length === 0) {
    return null;
  }

  const heldId = canvas.state.activeTool === "single-placement" ? canvas.state.runtime.singlePlacementDeviceId : null;
  const heldKey = heldId === null ? null : recentPlacementKey({ deviceId: heldId, config: canvas.state.runtime.singlePlacementConfig });
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
      {entries.map((entry) => {
        const key = recentPlacementKey(entry);
        const output = resolveRecipeOutput(registry, entry.config);
        const machineName = t(registry.queries.findEntityDefinition(entry.deviceId)?.nameKey ?? entry.deviceId);
        return (
          <HoldableDeviceTile
            appHost={appHost}
            badge={output === null ? undefined : (
              <img alt="" className={cm(styles, "canvas-hotbar-recipe")} src={createItemIconAssetUrl(output.iconId)} />
            )}
            className={cm(styles, "canvas-hotbar-button")}
            device={{ deviceId: entry.deviceId, config: entry.config }}
            held={heldKey === key}
            key={key}
            label={output === null
              ? machineName
              : t("lineEndChip.consumer").replace("{item}", t(output.nameKey)).replace("{machine}", machineName)}
            peekClassName={cm(styles, "canvas-hotbar-peek")}
          />
        );
      })}
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

/** 条目配置里配方的主产物（显示在角上）；没有配方时为 null。 */
function resolveRecipeOutput(
  registry: AppHost["workspace"]["registry"],
  config: Readonly<Record<string, unknown>> | null,
): ItemDefinition | null {
  const channelRecipes = config?.channelRecipes;
  if (typeof channelRecipes !== "object" || channelRecipes === null) return null;
  for (const recipeId of Object.values(channelRecipes as Record<string, unknown>)) {
    const recipe = typeof recipeId === "string" ? registry.queries.findRecipeDefinition(recipeId) : null;
    const itemId = recipe?.primaryOutputs?.[0] ?? recipe?.outputs[0]?.itemId;
    const item = itemId === undefined ? null : registry.queries.findItemDefinition(itemId);
    if (item !== null) return item;
  }
  return null;
}

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
