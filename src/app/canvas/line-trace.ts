import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import type { GridEdge, GridPoint } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { resolveGridEdgeDelta, rotateGridEdge } from "@/shared/geometry/port";

/** 沿线追溯的最大格数，防止环线。 */
const MAX_TRACE_CELLS = 4096;

export interface LineTraceEnd {
  readonly entity: WorldEntity;
  readonly portGroupId: string;
}

/**
 * 一条传送带/管道：从上游到下游的各格，以及两端接着的设备端口（遇到分流器等物流设备、开放端时为 null）。
 * 只沿真正首尾相接的线格走，旁边平行经过的线不算。
 */
export interface LineTrace {
  readonly kind: LogisticsKind;
  readonly cells: readonly { readonly cell: GridPoint; readonly entityId: string }[];
  readonly source: LineTraceEnd | null;
  readonly sink: LineTraceEnd | null;
}

export function traceLine(editor: EditorContract, registry: RegistryQuery, kind: LogisticsKind, cell: GridPoint): LineTrace | null {
  const start = editor.queries.findTransportLineAtGridPoint(cell, kind);
  if (start === null) {
    return null;
  }
  const visited = new Set<string>([start.id]);
  const upstream = walkLine(editor, registry, kind, cell, start, "input", visited);
  const downstream = walkLine(editor, registry, kind, cell, start, "output", visited);
  return {
    kind,
    cells: [...upstream.cells.reverse(), { cell, entityId: start.id }, ...downstream.cells],
    source: upstream.end,
    sink: downstream.end,
  };
}

/**
 * 从一格沿线逆流（input）或顺流（output）走到头。桥接器让物品从一边直穿到对边，照样跨过去；
 * 走到设备端口时记下它，遇到分流器等其他物流设备或开放端时停下。
 */
function walkLine(
  editor: EditorContract,
  registry: RegistryQuery,
  kind: LogisticsKind,
  cell: GridPoint,
  line: WorldEntity,
  direction: "input" | "output",
  visited: Set<string>,
): { cells: { cell: GridPoint; entityId: string }[]; end: LineTraceEnd | null } {
  const cells: { cell: GridPoint; entityId: string }[] = [];
  const back = direction === "input" ? "output" : "input";
  let current = { cell, line };
  for (let step = 0; step < MAX_TRACE_CELLS; step += 1) {
    const edge = resolveLineEdge(registry, current.line, direction);
    if (edge === null) break;
    let from = current.cell;
    let next = offset(from, edge);
    for (let connector = findConnectorAt(editor, registry, kind, next); connector !== null; connector = findConnectorAt(editor, registry, kind, next)) {
      if (visited.has(connector.id)) return { cells, end: null };
      visited.add(connector.id);
      cells.push({ cell: next, entityId: connector.id });
      from = next;
      next = offset(next, edge);
    }
    const nextLine = editor.queries.findTransportLineAtGridPoint(next, kind);
    if (nextLine === null) {
      return { cells, end: resolvePortEnd(editor, kind, next, from, direction === "input" ? "output" : "input") };
    }
    const backEdge = resolveLineEdge(registry, nextLine, back);
    if (visited.has(nextLine.id) || backEdge === null || !samePoint(offset(next, backEdge), from)) break;
    visited.add(nextLine.id);
    cells.push({ cell: next, entityId: nextLine.id });
    current = { cell: next, line: nextLine };
  }
  return { cells, end: null };
}

/** 该格上同族的桥接器。 */
function findConnectorAt(editor: EditorContract, registry: RegistryQuery, kind: LogisticsKind, cell: GridPoint): WorldEntity | null {
  const port = editor.queries.findDevicePortAtGridPoint(cell);
  const entity = port === null || port.kind !== kind ? null : editor.queries.getEntityById(port.endpoint.entityId);
  return entity !== null && registry.resolveLogisticsRole(entity.definitionId) === "connector" ? entity : null;
}

/** 线的输入边或输出边（已按线格朝向旋转）。 */
export function resolveLineEdge(registry: RegistryQuery, line: WorldEntity, direction: "input" | "output"): GridEdge | null {
  const port = registry.findEntityDefinition(line.definitionId)?.portGroups.find((group) => group.direction === direction)?.ports[0];
  return port === undefined ? null : rotateGridEdge(port.edge, line.rotation);
}

/** 设备上设定的配方（各频道）。 */
export function configuredRecipeIds(entity: WorldEntity): string[] {
  const channelRecipes = entity.config.channelRecipes;
  return typeof channelRecipes === "object" && channelRecipes !== null
    ? Object.values(channelRecipes as Record<string, unknown>).filter((recipeId): recipeId is string => typeof recipeId === "string")
    : [];
}

/**
 * 这些配方每分钟产出（output）或消耗（input）这些物品的总数；没有一个配方产出或消耗它们时为 null。
 */
export function resolveRecipeItemRatePerMinute(
  registry: RegistryContract,
  recipeIds: readonly string[],
  itemIds: readonly string[],
  direction: "input" | "output",
): number | null {
  let rate: number | null = null;
  for (const recipeId of recipeIds) {
    const recipe = registry.queries.findRecipeDefinition(recipeId);
    if (recipe === null || recipe.durationSeconds <= 0) continue;
    const flows = (direction === "output" ? recipe.outputs : recipe.inputs).filter((flow) => itemIds.includes(flow.itemId));
    if (flows.length === 0) continue;
    rate = (rate ?? 0) + flows.reduce((sum, flow) => sum + flow.amount, 0) * 60 / recipe.durationSeconds;
  }
  return rate;
}

function resolvePortEnd(
  editor: EditorContract,
  kind: LogisticsKind,
  portCell: GridPoint,
  lineCell: GridPoint,
  direction: "input" | "output",
): LineTraceEnd | null {
  const port = editor.queries.findDevicePortAtGridPoint(portCell);
  if (
    port === null
    || port.kind !== kind
    || port.endpoint.portDirection !== direction
    || !samePoint(port.endpoint.outsideGridPoint, lineCell)
  ) {
    return null;
  }
  const entity = editor.queries.getEntityById(port.endpoint.entityId);
  return entity === null ? null : { entity, portGroupId: port.endpoint.portGroupId };
}

function offset(point: GridPoint, edge: GridEdge): GridPoint {
  const delta = resolveGridEdgeDelta(edge);
  return { x: point.x + delta.x, y: point.y + delta.y };
}

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}
