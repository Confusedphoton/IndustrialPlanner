import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridEdge, GridRect } from "@/domain/shared/grid";
import type {
  LogisticsDraftEndpoint,
  LogisticsKind,
  LogisticsPortDirection,
  LogisticsPortKind,
} from "@/domain/shared/logistics";
import {
  FluidDomain,
  ItemDomainFlag,
} from "@/domain/shared/item-domain-flags";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { GridRectIndex } from "./geometry/grid-rect-index";

import { getRotatedGridFootprint } from "./geometry/grid";
import {
  resolveGridEdgeDelta,
  rotateGridEdge,
  rotateLocalPortCell,
} from "./geometry/port";

type DevicePortEndpoint = Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>;

/** Select a belt or pipe run through the corresponding lane of each bridge. */
export function collectTransportSegmentEntityIds(options: {
  readonly startEntity: WorldEntity;
  readonly document: WorldDocument;
  readonly registry: RegistryContract;
  readonly directions?: readonly LogisticsPortDirection[];
  readonly alreadySelected?: ReadonlySet<string>;
}): ReadonlySet<string> {
  const { startEntity, document, registry } = options;
  const kind = registry.queries.resolveDedicatedLogisticsKind(startEntity.definitionId);
  if (kind === null) return new Set();

  const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
  const indexedEntities = Object.values(document.entities).flatMap((entity) => {
    const definition = definitions.get(entity.definitionId);
    return definition === undefined ? [] : [{ entity, rect: resolveEntityGridRect({ entity, definition }) }];
  });
  const index = new GridRectIndex(indexedEntities, ({ rect }) => rect);

  const endpoints = new Map<string, DevicePortEndpoint[]>();
  const ports = (entity: WorldEntity): readonly DevicePortEndpoint[] => {
    let cached = endpoints.get(entity.id);
    if (cached === undefined) {
      const definition = definitions.get(entity.definitionId);
      cached = definition === undefined ? [] : (["input", "output"] as const).flatMap((direction) =>
        resolveDevicePortEndpoints({ entity, definition, kind, direction }),
      );
      endpoints.set(entity.id, cached);
    }
    return cached;
  };

  function neighbors(endpoint: DevicePortEndpoint) {
    const point = endpoint.outsideGridPoint;
    return index.at(point).flatMap(({ entity }) =>
      ports(entity).filter((other) => other.portDirection !== endpoint.portDirection
        && other.insideGridPoint.x === point.x && other.insideGridPoint.y === point.y
        && other.outsideGridPoint.x === endpoint.insideGridPoint.x
        && other.outsideGridPoint.y === endpoint.insideGridPoint.y)
        .map((port) => ({ entity, port })),
    );
  }

  const directions = options.directions ?? ["input", "output"];
  const selected = new Set([startEntity.id]);
  const bridgeLanes = new Map<string, Set<ReturnType<typeof portAxis>>>();
  const queue: { entity: WorldEntity; axis?: ReturnType<typeof portAxis> }[] = [{ entity: startEntity }];

  for (const { entity, axis } of queue) {
    for (const port of ports(entity)) {
      if (!directions.includes(port.portDirection) || (axis !== undefined && portAxis(port.edge) !== axis)) continue;
      for (const neighbor of neighbors(port)) {
        const definitionId = neighbor.entity.definitionId;
        if (registry.queries.resolveDedicatedLogisticsKind(definitionId) === kind && !selected.has(neighbor.entity.id)) {
          selected.add(neighbor.entity.id);
          queue.push({ entity: neighbor.entity });
        } else if (registry.queries.resolveLogisticsRole(definitionId) === "connector") {
          const nextAxis = portAxis(neighbor.port.edge);
          const lanes = bridgeLanes.get(neighbor.entity.id) ?? new Set();
          if (lanes.has(nextAxis)) continue;
          lanes.add(nextAxis);
          bridgeLanes.set(neighbor.entity.id, lanes);
          queue.push({ entity: neighbor.entity, axis: nextAxis });
        }
      }
    }
  }

  for (const [bridgeId, lanes] of bridgeLanes) {
    const bridge = document.entities[bridgeId];
    if (bridge === undefined) continue;
    const carriesAnotherLine = ports(bridge).some((port) =>
      !lanes.has(portAxis(port.edge)) && neighbors(port).some(({ entity }) =>
        !selected.has(entity.id) && !options.alreadySelected?.has(entity.id),
      ),
    );
    if (!carriesAnotherLine) selected.add(bridgeId);
  }
  return selected;
}

function portAxis(edge: GridEdge): "horizontal" | "vertical" {
  return edge === "EAST" || edge === "WEST" ? "horizontal" : "vertical";
}

function resolveDevicePortEndpoints(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
  direction: LogisticsPortDirection;
}): DevicePortEndpoint[] {
  const portKind = resolvePortKindForLogisticsKind(options.kind);
  const isPipe = options.kind === LOGISTICS_KIND.pipe;
  const endpoints: DevicePortEndpoint[] = [];

  for (const portGroup of options.definition.portGroups) {
    if (
      portGroup.isPipe !== isPipe
      || (portGroup.kind & portKind) === 0
      || portGroup.direction !== options.direction
    ) {
      continue;
    }

    for (const port of portGroup.ports) {
      const localCell = rotateLocalPortCell({
        footprint: options.definition.footprint,
        port,
        rotation: options.entity.rotation,
      });
      const edge = rotateGridEdge(port.edge, options.entity.rotation);
      const insideGridPoint = {
        x: options.entity.position.x + localCell.x,
        y: options.entity.position.y + localCell.y,
      };
      const delta = resolveGridEdgeDelta(edge);
      const outsideGridPoint = {
        x: insideGridPoint.x + delta.x,
        y: insideGridPoint.y + delta.y,
      };

      endpoints.push({
        type: "device-port",
        entityId: options.entity.id,
        portGroupId: portGroup.id,
        portId: port.id,
        portKind: portGroup.kind,
        portDirection: options.direction,
        insideGridPoint,
        outsideGridPoint,
        edge,
      });
    }
  }

  return endpoints;
}

function resolvePortKindForLogisticsKind(kind: LogisticsKind): LogisticsPortKind {
  return kind === LOGISTICS_KIND.belt ? ItemDomainFlag.Solid : FluidDomain;
}

function resolveEntityGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
}): GridRect {
  const footprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.entity.rotation,
  );

  return {
    x: options.entity.position.x,
    y: options.entity.position.y,
    width: footprint.width,
    height: footprint.height,
  };
}
