import type { EditorQuery } from "@/domain/editor/editor-query";

import { createEditorDocumentQueries } from "./document-queries";
import { createEditorEntityQueries } from "./entity-queries";
import { createEditorLogisticsQueries } from "./logistics-queries";
import { createEditorRegionQueries } from "./region-queries";
import type { EditorQueriesContext } from "./types";

export function createEditorQueries(
  context: EditorQueriesContext,
): EditorQuery {
  return {
    getOperationAvailability: context.getOperationAvailability,
    subscribeCommittedEdits: (listener) => context.history.subscribeCommittedEdits(listener),
    ...createEditorDocumentQueries(context),
    ...createEditorEntityQueries(context),
    ...createEditorLogisticsQueries(context),
    ...createEditorRegionQueries(context),
  };
}

export type { EditorQueriesContext } from "./types";

export { resolveGridCellAtClientPixelPoint, resolveClientRectForGridCell } from "./viewport-geometry";
