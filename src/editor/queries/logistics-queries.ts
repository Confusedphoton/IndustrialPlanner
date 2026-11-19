import type { EditorQuery } from "@/domain/editor/editor-query";
import type { EditorQueriesContext } from "./types";
import {
  createEntityDefinitionMap,
  resolveDevicePortAtGridPoint,
  resolveTransportLineAtGridPoint,
  resolveLogisticsEndpointAtGridPoint,
} from "../logistics/logistics-utils";

type EditorLogisticsQueries = Pick<
  EditorQuery,
  | "canCreateLogisticsDraftStartHere"
  | "findLogisticsDraftEndpointAtGridPoint"
  | "findDevicePortAtGridPoint"
  | "findTransportLineAtGridPoint"
  | "resolveLogisticsDraftState"
>;

export function createEditorLogisticsQueries(
  context: EditorQueriesContext,
): EditorLogisticsQueries {
  const entityDefinitionMap = createEntityDefinitionMap(
    context.workspace.registry.entityDefinitions,
  );

  return {
    resolveLogisticsDraftState: () => {
      return context.state.internalTransientState.logisticsDraft;
    },
    findLogisticsDraftEndpointAtGridPoint: (gridPoint, kind) => {
      return resolveLogisticsEndpointAtGridPoint({
        gridPoint,
        kind,
        document: context.document.getSnapshot(),
        drafts: [],
        entityDefinitionMap,
        registryQueries: context.workspace.registry.queries,
        baseDefinitions: context.workspace.registry.baseDefinitions,
      });
    },
    findDevicePortAtGridPoint: (gridPoint, connection) => resolveDevicePortAtGridPoint({
      gridPoint, connection,
      document: context.document.getSnapshot(),
      entityDefinitionMap,
      registryQueries: context.workspace.registry.queries,
    }),
    findTransportLineAtGridPoint: (gridPoint, kind) => resolveTransportLineAtGridPoint({
      gridPoint,
      kind,
      document: context.document.getSnapshot(),
      entityDefinitionMap,
      registryQueries: context.workspace.registry.queries,
    }),
    canCreateLogisticsDraftStartHere: (gridPoint, kind) => {
      return resolveLogisticsEndpointAtGridPoint({
        gridPoint,
        kind,
        document: context.document.getSnapshot(),
        drafts: [],
        entityDefinitionMap,
        registryQueries: context.workspace.registry.queries,
        baseDefinitions: context.workspace.registry.baseDefinitions,
      }) !== null;
    },
  };
}
