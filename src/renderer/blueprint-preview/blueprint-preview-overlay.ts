import { Container, Graphics } from "pixi.js";
import type { SceneOverlay } from "@/domain/document/scene-view-input";
import type { GridRotation } from "@/domain/shared/grid";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";

/** 静态生产图标与逻辑连接，仅表达准备状态，不接入仿真。 */
export class SceneOverlayDecoration {
  readonly container = new Container();
  private readonly graphics = this.container.addChild(new Graphics());
  private signature = "";

  sync(overlay: SceneOverlay | null, entities: readonly WorldEntity[], registry: RegistryContract,
    viewport: { centerX: number; centerY: number; gridCellPixelSize: number; displayRotation: GridRotation }, width: number, height: number,
    version: string): void {
    if (this.signature === version) return;
    this.signature = version;
    this.graphics.clear();
    const centers = new Map(entities.flatMap(entity => {
      const definition = registry.queries.findEntityDefinition(entity.definitionId);
      if (!definition) return [];
      const rect = resolveEntityGridRect({ entity, definition });
      const point = resolveViewportPointFromWorldPoint({
        worldPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        viewportBounds: { left: 0, top: 0, width, height },
        viewportCenter: { x: viewport.centerX, y: viewport.centerY },
        gridCellPixelSize: viewport.gridCellPixelSize, displayRotation: viewport.displayRotation,
      });
      return point === null ? [] : [[entity.id, point]] as const;
    }));
    for (const link of overlay?.links ?? []) {
      const a = centers.get(link.sourceEntityId), b = centers.get(link.targetEntityId);
      if (!a || !b) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      for (let at = 0; at < length; at += link.binding ? length : 12) {
        const end = Math.min(length, at + (link.binding ? length : 7));
        this.graphics.moveTo(a.x + (b.x - a.x) * at / length, a.y + (b.y - a.y) * at / length)
          .lineTo(a.x + (b.x - a.x) * end / length, a.y + (b.y - a.y) * end / length);
      }
      const selected = overlay?.selectedEntityIds.some(id => id === link.sourceEntityId || id === link.targetEntityId);
      const stroke = { color: link.binding ? 0x2084b5 : 0x657a8c, width: selected ? 3 : 2, alpha: selected ? 1 : .65 };
      this.graphics.stroke(stroke);
      const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
      const tip = { x: a.x + (b.x - a.x) * .65, y: a.y + (b.y - a.y) * .65 };
      this.graphics.moveTo(tip.x - dx * 8 + dy * 4, tip.y - dy * 8 - dx * 4)
        .lineTo(tip.x, tip.y).lineTo(tip.x - dx * 8 - dy * 4, tip.y - dy * 8 + dx * 4).stroke(stroke);
    }
  }

  destroy(): void { this.container.destroy({ children: true }); }
}

