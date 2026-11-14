import type { WorldDocument } from "../document/world-document";
import { EditorAction } from "./editor-action";
import { EditorQuery } from "./editor-query";
import { EditorState } from "./editor-state";
import type { SceneSnapshotSource } from "../shared/scene-snapshot";


export interface EditorContract {
  document: SceneSnapshotSource<WorldDocument>;
  readonly state: EditorState;
  queries: EditorQuery;
  actions: EditorAction;
}
