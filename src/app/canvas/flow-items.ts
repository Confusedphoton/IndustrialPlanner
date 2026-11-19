import type { EditorContract } from "@/domain/editor/editor-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { configuredDeviceItemIds, outputPortItemIds } from "@/shared/device-item-labels";
import { oppositeGridEdge, resolveRotatedPortGeometry } from "@/shared/geometry/port";
import { resolveLineEdge, traceLine, type LineTraceEnd } from "./line-trace";

export function resolveIncomingFlowItems(editor: EditorContract, registry: RegistryContract, junction: WorldEntity): string[] {
  const items = new Set<string>();
  const visited = new Set<string>();
  const queue = [junction];
  const document = editor.document.getSnapshot();

  const addSource = (source: LineTraceEnd) => {
    const definition = registry.queries.findEntityDefinition(source.entity.definitionId);
    if (definition === null) return;
    const configured = outputPortItemIds(definition, source.entity, source.portGroupId, registry, source.portId);
    const warehouse = configuredDeviceItemIds(definition, source.entity.id, document, registry);
    for (const item of [...configured, ...warehouse]) items.add(item);
    if (configured.length === 0 && registry.queries.resolveLogisticsRole(source.entity.definitionId) !== null) queue.push(source.entity);
  };

  for (let index = 0; index < queue.length; index += 1) {
    const entity = queue[index]!;
    if (visited.has(entity.id)) continue;
    visited.add(entity.id);
    const definition = registry.queries.findEntityDefinition(entity.definitionId);
    if (definition === null) continue;
    for (const group of definition.portGroups.filter((group) => group.direction === "input")) {
      const kind: LogisticsKind = group.isPipe ? "pipe" : "belt";
      for (const port of group.ports) {
        const { cell, edge, delta } = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
        const inside = { x: entity.position.x + cell.x, y: entity.position.y + cell.y };
        const outside = { x: inside.x + delta.x, y: inside.y + delta.y };
        const line = editor.queries.findTransportLineAtGridPoint(outside, kind);
        if (line !== null) {
          if (resolveLineEdge(registry.queries, line, "output") !== oppositeGridEdge(edge)) continue;
          const source = traceLine(editor, registry.queries, kind, outside)?.source;
          if (source != null) addSource(source);
          continue;
        }
        const upstream = editor.queries.findDevicePortAtGridPoint(outside, {
          kind, direction: "output", outsideGridPoint: inside,
        });
        if (upstream === null) continue;
        const { entityId, portGroupId, portId } = upstream.endpoint;
        const source = editor.queries.getEntityById(entityId);
        if (source !== null) addSource({ entity: source, portGroupId, portId });
      }
    }
  }
  return [...items];
}
