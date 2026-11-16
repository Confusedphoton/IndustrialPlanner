import type { EntityDefinition, ItemDomain, PortGroupDefinition } from "@/domain/registry/types/entity-definition";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { oppositeGridEdge, resolveRotatedPortGeometry } from "@/shared/geometry/port";
import { matchesItemAcceptRule } from "@/shared/registry/item-accept-rule";

/**
 * 物流线末端的「+ 设备」提示：从端口拖出、或用传送带/管道工具铺完的线末端仍开放时，在末端外侧给出一个小提示，
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
  /** 线上运送的物品（来自上游设备该端口的设定或已选配方的产物）。 */
  readonly itemIds: readonly string[];
  readonly expanded: boolean;
}

export interface LineEndSnapPlacement {
  readonly position: GridPoint;
  readonly rotation: GridRotation;
}

type SnapDefinition = Pick<EntityDefinition, "footprint" | "portGroups" | "portStorageBindings" | "recipeChannels">;

const ROTATIONS: readonly GridRotation[] = [0, 90, 180, 270];

/**
 * 设备接到线末端的全部摆法：某个能收下线上物品、且通向配方原料存储组的同族输入端口落在末端外侧格并朝向线末端。
 * 端口越靠近设备在该边上的中线越优先，使设备正对着线展开。
 */
export function resolveLineEndSnapPlacements(options: {
  readonly definition: SnapDefinition;
  readonly kind: LogisticsKind;
  readonly targetCell: GridPoint;
  readonly flowEdge: GridEdge;
  readonly itemIds: readonly string[];
  readonly resolveItemDomain: (itemId: string) => ItemDomain | null;
}): LineEndSnapPlacement[] {
  const { definition } = options;
  const facing = oppositeGridEdge(options.flowEdge);
  const alongX = options.flowEdge === "NORTH" || options.flowEdge === "SOUTH";
  const groups = definition.portGroups.filter((group) => isFeedingInputGroup(definition, group, options.kind));
  const candidates: Array<LineEndSnapPlacement & { readonly offCenter: number }> = [];
  for (const rotation of ROTATIONS) {
    const rotated = getRotatedGridFootprint(definition.footprint, rotation);
    for (const group of groups) {
      for (const port of group.ports) {
        if (!options.itemIds.some((itemId) => matchesItemAcceptRule(itemId, port.acceptRule, options.resolveItemDomain))) continue;
        const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation });
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

/** 同族的输入端口组，且（有存储绑定时）通向某个配方频道的原料存储组。 */
function isFeedingInputGroup(definition: SnapDefinition, group: PortGroupDefinition, kind: LogisticsKind): boolean {
  if (group.direction === "output" || group.isPipe !== (kind === "pipe")) {
    return false;
  }
  const storageGroupIds = definition.portStorageBindings
    .filter((binding) => binding.portGroupId === group.id)
    .map((binding) => binding.storageSlotGroupId);
  return storageGroupIds.length === 0 || definition.recipeChannels.some((channel) => (
    channel.ingredientStorageGroupIds.some((id) => storageGroupIds.includes(id))
  ));
}
