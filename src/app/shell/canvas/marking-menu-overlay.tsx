import { observer } from "mobx-react-lite";
import type { CSSProperties } from "react";

import {
  resolveMarkingMenuDeviceId,
  resolveMarkingMenuGroupPosition,
  resolveMarkingMenuItemPosition,
} from "@/app/canvas/marking-menu";
import type { AppHost } from "@/app/host/app-host";
import { chooseMarkingMenuDevice, closeMarkingMenu, enterMarkingMenuGroup } from "@/app/input/gesture/actions";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

/**
 * 环形标记菜单的显示层：分类一圈围绕按住的位置，进入分类后以该分类图标为中心展开设备一圈。
 * 滑动选择时整层不接收指针（手势由画布跟踪）；原地松开后变为可点按，点在菜单外关闭。
 */
export const MarkingMenuOverlay = observer(function MarkingMenuOverlay({ appHost }: { appHost: AppHost }) {
  const canvas = appHost.mainCanvas;
  const menu = canvas.state.runtime.markingMenu;
  if (menu === null) {
    return null;
  }
  const t = appHost.actions.translate;
  const registry = appHost.workspace.registry;
  const iconOf = (deviceId: string | undefined) =>
    createEntityIconAssetUrl(deviceId === undefined ? undefined : registry.queries.findEntityDefinition(deviceId)?.iconPath);
  const nameOf = (deviceId: string) => t(registry.queries.findEntityDefinition(deviceId)?.nameKey ?? deviceId);
  const tapMode = menu.mode === "tap";
  const highlightedDeviceId = resolveMarkingMenuDeviceId(menu);
  const caption = highlightedDeviceId !== null
    ? nameOf(highlightedDeviceId)
    : menu.groupIndex === null ? null : t(menu.groups[menu.groupIndex]!.titleKey);
  const at = (point: { readonly x: number; readonly y: number }) => ({ left: point.x, top: point.y }) as CSSProperties;

  return (
    <div
      aria-hidden={!tapMode}
      className={cm(styles, tapMode ? "marking-menu is-tap" : "marking-menu")}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) closeMarkingMenu(canvas);
      }}
      role={tapMode ? "menu" : undefined}
    >
      <span className={cm(styles, "marking-menu-origin")} style={at(menu.origin)} />
      {menu.groups.map((group, groupIndex) => {
        const active = menu.groupIndex === groupIndex;
        // 展开分类后只留该分类图标作为设备圈的中心，其余分类让出位置。
        if (menu.level === 2 && !active) return null;
        return (
          <button
            aria-label={t(group.titleKey)}
            className={cm(styles, active ? "marking-menu-group is-active" : "marking-menu-group")}
            key={group.titleKey}
            onClick={() => enterMarkingMenuGroup(canvas, groupIndex)}
            role="menuitem"
            style={at(resolveMarkingMenuGroupPosition(menu.origin, groupIndex, menu.groups.length))}
            tabIndex={tapMode ? 0 : -1}
            title={t(group.titleKey)}
            type="button"
          >
            <img alt="" draggable={false} src={iconOf(group.deviceIds[0])} />
          </button>
        );
      })}
      {menu.level === 2 && menu.groupIndex !== null ? menu.groups[menu.groupIndex]!.deviceIds.map((deviceId, itemIndex) => (
        <button
          aria-label={nameOf(deviceId)}
          className={cm(styles, menu.itemIndex === itemIndex ? "marking-menu-item is-active" : "marking-menu-item")}
          key={deviceId}
          onClick={() => chooseMarkingMenuDevice(canvas, deviceId)}
          role="menuitem"
          style={at(resolveMarkingMenuItemPosition(menu, menu.groupIndex!, itemIndex))}
          tabIndex={tapMode ? 0 : -1}
          title={nameOf(deviceId)}
          type="button"
        >
          <img alt="" draggable={false} src={iconOf(deviceId)} />
        </button>
      )) : null}
      {caption === null ? null : (
        <span
          className={cm(styles, "marking-menu-caption")}
          style={at(menu.level === 2 && menu.groupIndex !== null
            ? resolveMarkingMenuGroupPosition(menu.origin, menu.groupIndex, menu.groups.length)
            : menu.origin)}
        >
          {caption}
        </span>
      )}
    </div>
  );
});
