import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";

/**
 * 物流线末端的「+ 设备」提示：从端口拖出的传送带/管道松开时末端仍开放，在末端外侧给出一个小提示，
 * 点开列出消费该线上物品的设备，选中后设备直接接在末端。下一次操作时提示消失。
 */
export interface LineEndChipState {
  readonly kind: LogisticsKind;
  /** 线的最后一格。 */
  readonly endCell: GridPoint;
  /** 末端输出方向外侧的空格：设备的输入端口要落在这一格。 */
  readonly targetCell: GridPoint;
  /** 物品流出末端的方向。 */
  readonly flowEdge: GridEdge;
  /** 线上运送的物品（来自上游设备的配方产物或出口设定）。 */
  readonly itemIds: readonly string[];
  readonly expanded: boolean;
}

export interface LineEndSnapPlacement {
  readonly position: GridPoint;
  readonly rotation: GridRotation;
}

const ROTATIONS: readonly GridRotation[] = [0, 90, 180, 270];
const OPPOSITE_EDGE: Readonly<Record<GridEdge, GridEdge>> = { NORTH: "SOUTH", SOUTH: "NORTH", EAST: "WEST", WEST: "EAST" };

/**
 * 设备接到线末端的全部摆法：某个同族输入端口落在末端外侧格并朝向线末端。
 * 端口越靠近设备在该边上的中线越优先，使设备正对着线展开。
 */
export function resolveLineEndSnapPlacements(options: {
  readonly definition: Pick<EntityDefinition, "footprint" | "portGroups">;
  readonly kind: LogisticsKind;
  readonly targetCell: GridPoint;
  readonly flowEdge: GridEdge;
}): LineEndSnapPlacement[] {
  const facing = OPPOSITE_EDGE[options.flowEdge];
  const alongX = options.flowEdge === "NORTH" || options.flowEdge === "SOUTH";
  const candidates: Array<LineEndSnapPlacement & { readonly offCenter: number }> = [];
  for (const rotation of ROTATIONS) {
    const rotated = getRotatedGridFootprint(options.definition.footprint, rotation);
    for (const group of options.definition.portGroups) {
      if (group.direction === "output" || group.isPipe !== (options.kind === "pipe")) continue;
      for (const port of group.ports) {
        const geometry = resolveRotatedPortGeometry({ footprint: options.definition.footprint, port, rotation });
        if (geometry.edge !== facing) continue;
        const offCenter = alongX
          ? Math.abs(geometry.cell.x + 0.5 - rotated.width / 2)
          : Math.abs(geometry.cell.y + 0.5 - rotated.height / 2);
        candidates.push({
          position: { x: options.targetCell.x - geometry.cell.x, y: options.targetCell.y - geometry.cell.y },
          rotation,
          offCenter,
        });
      }
    }
  }
  return candidates
    .sort((left, right) => left.offCenter - right.offCenter)
    .map(({ position, rotation }) => ({ position, rotation }));
}
