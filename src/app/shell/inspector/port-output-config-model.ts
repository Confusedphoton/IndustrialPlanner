import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridEdge, GridRotation } from "@/domain/shared/grid";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";
import {
  INSPECTOR_TYPE,
  type PortOutputConfigInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";
import {
  FluidDomain,
  ItemDomainFlag,
  type ItemDomainFlag as ItemDomainFlags,
} from "@/domain/shared/item-domain-flags";

export type PortGroupDefinition = EntityDefinition["portGroups"][number];

export interface OutputPortGroupNumbering {
  readonly portGroup: PortGroupDefinition;
  readonly groupIndex: number;
  readonly portLabel: string;
}

export interface OutputGroupRow {
  readonly portGroup: PortGroupDefinition;
  readonly groupIndex: number;
  readonly currentItemId: string | null;
  readonly label: string;
  readonly portLabel: string;
}

export function resolveSharedOutputGroupRows(
  definition: EntityDefinition,
  entity: WorldEntity,
): OutputGroupRow[] {
  return resolveOutputGroupRows(
    definition,
    resolveSharedOutputPortGroupIds(definition),
    entity,
  );
}

export function resolveSharedOutputPortGroupIds(
  definition: EntityDefinition,
): readonly string[] {
  const outputConfigDeclaration = definition.inspectors.find(
    (inspector): inspector is PortOutputConfigInspectorDeclaration =>
      inspector.type === INSPECTOR_TYPE.portOutputConfig,
  );

  if (outputConfigDeclaration !== undefined) {
    return outputConfigDeclaration.portGroupIds;
  }

  return definition.portGroups
    .filter((portGroup) => portGroup.direction === "output")
    .map((portGroup) => portGroup.id);
}

export function resolveOutputPortGroupNumbering(
  definition: EntityDefinition,
  portGroupIds: readonly string[],
): OutputPortGroupNumbering[] {
  const numberedPortGroups: OutputPortGroupNumbering[] = [];

  for (const portGroupId of portGroupIds) {
    const groupIndex = definition.portGroups.findIndex((g) => g.id === portGroupId);
    if (groupIndex < 0) continue;
    const portGroup = definition.portGroups[groupIndex];
    if (portGroup === undefined) continue;
    if (portGroup.direction !== "output") continue;

    numberedPortGroups.push({
      portGroup,
      groupIndex,
      portLabel: `P${numberedPortGroups.length + 1}`,
    });
  }

  return numberedPortGroups;
}

export function resolveOutputGroupRows(
  definition: EntityDefinition,
  portGroupIds: readonly string[],
  entity: WorldEntity,
): OutputGroupRow[] {
  const rows: OutputGroupRow[] = [];

  for (const numberedPortGroup of resolveOutputPortGroupNumbering(definition, portGroupIds)) {
    const { groupIndex, portGroup, portLabel } = numberedPortGroup;
    const firstPortIndex = 0;
    const configPath = `portGroups[${groupIndex}].ports[${firstPortIndex}].acceptRule`;
    const configOverride = entity.config[configPath];

    let currentItemId: string | null = null;
    if (
      configOverride !== undefined
      && configOverride !== null
      && typeof configOverride === "object"
    ) {
      const base = (configOverride as Record<string, unknown>).base;
      if (
        base !== undefined
        && base !== null
        && typeof base === "object"
        && (base as Record<string, unknown>).kind === "item"
        && typeof (base as Record<string, unknown>).itemId === "string"
      ) {
        currentItemId = (base as Record<string, unknown>).itemId as string;
      }
    }

    const kindLabel = resolveOutputKindLabel(portGroup);

    rows.push({
      portGroup,
      groupIndex,
      currentItemId,
      label: kindLabel,
      portLabel,
    });
  }

  return rows;
}

export function resolvePortTone(portGroup: PortGroupDefinition): ItemDomainFlags {
  return portGroup.kind;
}

function resolveOutputKindLabel(portGroup: PortGroupDefinition): string {
  if (!portGroup.isPipe) {
    return "inspectorText.solidOutput";
  }

  const firstPortRule = portGroup.ports[0]?.acceptRule.base;
  const flags = firstPortRule?.kind === "domain"
    ? firstPortRule.flags
    : portGroup.kind;
  if (flags === ItemDomainFlag.Gas) {
    return "inspectorText.gasOutput";
  }
  if (flags === FluidDomain) {
    return "inspectorText.fluidOutput";
  }
  return "inspectorText.liquidOutput";
}

const OUTPUT_SIDE_KEYS: Readonly<Record<GridEdge, string>> = {
  NORTH: "inspectorText.side.top",
  EAST: "inspectorText.side.right",
  SOUTH: "inspectorText.side.bottom",
  WEST: "inspectorText.side.left",
};

/**
 * 按端口在屏幕上的实际方位命名输出端口（如“右 1”“下”），取代与位置无关的 P# 序号。
 * rotation 为设备朝向叠加视口旋转后的屏幕朝向；同侧多个端口按从左到右/从上到下编号，单个时不编号。
 */
export function resolveOutputPortSideLabels(options: {
  readonly definition: EntityDefinition;
  readonly rows: readonly OutputGroupRow[];
  readonly rotation: GridRotation;
  readonly translate: (key: string) => string;
}): ReadonlyMap<string, string> {
  const placed = options.rows.flatMap((row) => {
    const port = row.portGroup.ports[0];
    if (port === undefined) {
      return [];
    }
    const geometry = resolveRotatedPortGeometry({
      footprint: options.definition.footprint,
      port,
      rotation: options.rotation,
    });
    return [{ groupId: row.portGroup.id, edge: geometry.edge, x: geometry.cell.x, y: geometry.cell.y }];
  });

  const labels = new Map<string, string>();
  for (const edge of Object.keys(OUTPUT_SIDE_KEYS) as GridEdge[]) {
    const sameSide = placed
      .filter((entry) => entry.edge === edge)
      .sort((left, right) => (edge === "NORTH" || edge === "SOUTH" ? left.x - right.x : left.y - right.y));
    sameSide.forEach((entry, index) => {
      const side = options.translate(OUTPUT_SIDE_KEYS[edge]);
      labels.set(entry.groupId, sameSide.length > 1 ? `${side} ${index + 1}` : side);
    });
  }
  return labels;
}
