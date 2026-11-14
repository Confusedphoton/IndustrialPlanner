import { type CSSProperties, type PointerEvent } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type { CanvasInteractionController } from "@/app/canvas";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import { cm } from "@/app/shell/shared/css-module-class";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import styles from "@/app/shell/canvas/canvas.module.scss";


export const OverlapEntityMenu = observer(function OverlapEntityMenu({
  appHost,
  canvas = appHost.mainCanvas,
}: {
  readonly appHost: AppHost;
  readonly canvas?: CanvasInteractionController;
}) {
  const controller = canvas.overlapEntityMenu;
  const visible = controller.visible
    && controller.position !== null
    && controller.candidates.length > 1;
  const position = controller.position;
  const t = appHost.actions.translate;
  const definitionMap = new Map(
    canvas.registry.entityDefinitions.map((definition) => [definition.id, definition]),
  );


  if (!visible || position === null) {
    return null;
  }

  const menuStyle = resolveMenuStyle(position);

  return (
    <OverlayStackLayer kind="system" layerId={`overlap-entity-menu:${canvas.view.id}`} visible={visible}>
      {({ zIndex }) => (
        <div className={cm(styles, "overlap-entity-menu-layer")} style={{ zIndex }}>
          <div
            aria-hidden="true"
            className={cm(styles, "overlap-entity-menu-backdrop")}
            onPointerDown={controller.cancel}
          />
          <div
            aria-label={t("tool.select")}
            className={cm(styles, "overlap-entity-menu")}
            onPointerDown={stopMenuPointerPropagation}
            role="menu"
            style={menuStyle}
          >
            {controller.candidates.map((candidate) => {
              const definition = definitionMap.get(candidate.definitionId);
              const label = definition === undefined
                ? candidate.definitionId
                : t(definition.nameKey);
              const iconSrc = createEntityIconAssetUrl(definition?.iconPath);

              return (
                <button
                  className={cm(styles, "overlap-entity-menu-item")}
                  key={candidate.entityId}
                  onClick={() => controller.select(candidate.entityId)}
                  role="menuitem"
                  type="button"
                >
                  <span className={cm(styles, "overlap-entity-menu-icon")} aria-hidden="true">
                    <img alt="" src={iconSrc} />
                  </span>
                  <span className={cm(styles, "overlap-entity-menu-label")}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </OverlayStackLayer>
  );
});

function stopMenuPointerPropagation(event: PointerEvent<HTMLElement>): void {
  event.stopPropagation();
}

function resolveMenuStyle(position: { readonly x: number; readonly y: number }): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const alignRight = viewportWidth > 0 && position.x > viewportWidth - 216;
  const alignBottom = viewportHeight > 0 && position.y > viewportHeight - 180;

  return {
    left: position.x,
    top: position.y,
    transform: `translate(${alignRight ? "calc(-100% - 6px)" : "6px"}, ${alignBottom ? "calc(-100% - 6px)" : "6px"})`,
  };
}
