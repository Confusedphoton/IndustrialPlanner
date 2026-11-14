
import type { WorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EditorServices } from "../editor-services";
import type { EditorStateReadWrite } from "../state-impl";
import { resolveListedEntities } from "../entity-resolvers";
import { resolvePoweredEntityIds } from "../entity-power";

export function syncPoweredEntityCollection(options: {
  document: WorldDocument;
  state: EditorStateReadWrite;
  workspace: EditorServices;
}): void {
  const entities = resolveListedEntities({ document: options.document, drafts: [],
    baseDefinitions: options.workspace.includeBaseBuiltins === false ? [] : options.workspace.registry.baseDefinitions });
  options.state.collections[EntityCollectionType.powered].replace([...resolvePoweredEntityIds(entities, options.workspace.registry)]);
}
