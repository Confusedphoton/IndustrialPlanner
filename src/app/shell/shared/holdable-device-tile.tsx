import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { AppHost } from "@/app/host/app-host";
import { holdDeviceForPlacement, type HeldDevice } from "@/app/input/gesture/actions";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import {
  didPanelPlacementDragJustEnd,
  resolveDevicePlacementTarget,
  startPanelPlacementPress,
} from "@/app/shell/shared/panel-placement-drag";
import { resolvePlacementPointerSource } from "@/app/shell/shared/placement-pointer-source";

/** 按住图标这么久显示设备名（触控没有悬停提示），松开时不拿起设备。 */
const NAME_PEEK_MS = 450;

/**
 * 只显示图标的设备磁贴（画布快捷栏、窄设备架、待放清单共用）：点按把设备交到手上，拖到画布上放下一台，
 * 笔悬停显示名称，按住不动也显示名称（给触控用）且不拿起。
 */
export function HoldableDeviceTile({
  appHost,
  device,
  label,
  held,
  className,
  peekClassName,
  badge,
}: {
  readonly appHost: AppHost;
  /** 拿起的设备，可带配方等配置。 */
  readonly device: HeldDevice;
  readonly label: string;
  readonly held: boolean;
  /** 磁贴样式；手上的设备附加 is-active。 */
  readonly className: string;
  readonly peekClassName: string;
  readonly badge?: ReactNode;
}) {
  // 名称气泡挂到 body 上并按磁贴位置定位，不会被停靠栏的滚动区裁掉。
  const [peek, setPeek] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const peekTimerRef = useRef<number | null>(null);
  const peekShownRef = useRef(false);
  useEffect(() => () => {
    if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
  }, []);
  const clearPeek = () => {
    if (peekTimerRef.current !== null) {
      window.clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
    setPeek(null);
  };
  const hold = (source: "mouse" | "touch") => holdDeviceForPlacement(appHost.mainCanvas, device, { source });

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    peekShownRef.current = false;
    clearPeek();
    peekTimerRef.current = window.setTimeout(() => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      peekShownRef.current = true;
      setPeek({ x: rect.left + rect.width / 2, y: rect.top });
    }, NAME_PEEK_MS);
    startPanelPlacementPress(appHost, event, () => {
      clearPeek();
      return resolveDevicePlacementTarget(appHost, device.deviceId, device.config ?? null);
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    clearPeek();
    if (peekShownRef.current || didPanelPlacementDragJustEnd()) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    hold(resolvePlacementPointerSource(appHost, event.pointerType));
  };

  const definition = appHost.workspace.registry.queries.findEntityDefinition(device.deviceId);
  return (
    <button
      aria-label={label}
      aria-pressed={held}
      className={held ? `${className} is-active` : className}
      data-ui-button-id={`device-tile-${device.deviceId}`}
      onClick={(event) => {
        // 键盘触发（detail 为 0）；指针点按由 pointerup 处理。
        if (event.detail === 0) hold("mouse");
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerCancel={clearPeek}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      ref={buttonRef}
      title={label}
      type="button"
    >
      <img alt="" draggable={false} src={createEntityIconAssetUrl(definition?.iconPath)} />
      {badge}
      {peek === null ? null : createPortal(
        <span
          className={peekClassName}
          role="tooltip"
          style={{ position: "fixed", left: Math.max(8, peek.x), top: Math.max(8, peek.y - 8) }}
        >
          {label}
        </span>,
        document.body,
      )}
    </button>
  );
}
