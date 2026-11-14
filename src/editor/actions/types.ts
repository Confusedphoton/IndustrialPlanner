import type { EditorServices } from "../editor-services";
import type { EditorQuery } from "@/domain/editor/editor-query";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type {
  EditorDocumentWriter,
  EditorHistoryRuntime,
} from "../history";
import type { EditorStateReadWrite } from "../state-impl";
import type { EditorDocumentRepository } from "../document-repository";

export interface EditorActionsContext {
  document: SnapshotStoreReadWrite<WorldDocument>;
  documentWriter: EditorDocumentWriter;
  documents: EditorDocumentRepository;
  history: EditorHistoryRuntime;
  state: EditorStateReadWrite;
  queries: EditorQuery;
  workspace: EditorServices;
  beforeDocumentChange(): void;
  captureOperationGuard(): () => boolean;
}
