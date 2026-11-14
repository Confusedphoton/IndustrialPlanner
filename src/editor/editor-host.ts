import { AVAILABLE_OPERATION, guardEditorActions } from "./editor-operation-policy";
import type { SceneSpace } from "@/domain/shared/scene-space";
import { validateSceneSpace } from "@/shared/geometry/scene-space";
import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import { resolveEditorPlacementGeometry } from "./placement-space";
import type { WorldDocument } from "@/domain/document/world-document";
import { EditorContract } from "@/domain/editor/editor-contract";
import { WorkspaceContract } from "@/domain/document/workspace-contract";
import { runInAction } from "mobx";
import { createWorldDocument } from "@/domain/document/world-document";
import {
  SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { createEditorActions } from "./actions";
import { createSnapshotSelector, shallowSnapshotEqual } from "@/shared/snapshot/snapshot-selector";
import { selectDocumentEntities } from "@/shared/snapshot/world-document-selection";
import { createEditorDocumentRepository, hookDocumentStorage } from "./document-storage";
import type { EditorDocumentRepository } from "./document-repository";
import {
  createEditorDocumentWriter,
  EditorDocumentWriter,
  EditorHistoryRuntime,
} from "./history";
import { createEditorQueries } from "./queries";
import { syncPlacementValidationState } from "./placement-validation";
import { syncPoweredEntityCollection } from "./actions/powered-collection";
import { hookLocalstorage } from "./storage-hook";

import { hookDarkPipeLinkLifecycle, normalizeEditedDarkPipeLinks } from "./dark-pipe-link-lifecycle";
import { createEditorStateReadWrite, EditorStateReadWrite } from "./state-impl";
import type { EditorSessionWriter } from "./history/document-writer";
import type { EditorServices } from "./editor-services";
import type { EditorSessionPolicy, EditorDocumentTransition } from "@/domain/editor/types/editor-session-types";
import { createSessionDocument } from "./session-document";

// state 和 document 都是外部使用的，editor组件内部使用internal来获取可写的state和document
export interface EditorRuntimeHost extends EditorContract {
  internalDocument: SnapshotStoreReadWrite<WorldDocument>;
  internalDocumentWriter: EditorDocumentWriter;
  internalHistory: EditorHistoryRuntime;
  internalDocuments: EditorDocumentRepository;
  services: EditorServices;
  internalState: EditorStateReadWrite;
  dispose: () => void;
}

export interface EditorHost extends EditorRuntimeHost {
  workspace: WorkspaceContract;
}

export interface EditorRuntimeOptions<TIntent = undefined> {
  persistence?: "browser" | "memory";
  initialDocument?: WorldDocument;
  space?: SceneSpace;
  beforeDocumentChange?: () => void;
  /** 由交互 owner 捕获异步提交资格；Editor 不读取 App 工具状态。 */
  captureOperationGuard?: () => () => boolean;
  initialIntent?: TIntent;
  policy?: EditorSessionPolicy<TIntent>;
  reduceIntent?: (intent: TIntent, transition: EditorDocumentTransition) => TIntent;
}

export function createEditorHost(workspace: WorkspaceContract, options: EditorRuntimeOptions = {}): EditorHost {
  const host = createEditorRuntime(workspace, options);
  return Object.assign(host, { workspace });
}

export function createEditorRuntime<TIntent = undefined>(services: EditorServices, options: EditorRuntimeOptions<TIntent> = {}) {
  const space = options.space === undefined ? undefined : freezeSnapshot(structuredClone(options.space));
  if (space !== undefined) validateSceneSpace(space);
  const workspace: EditorServices = space === undefined ? services : {
    registry: services.registry,
    includeBaseBuiltins: services.includeBaseBuiltins,
    get app() { return services.app; },
    get simulation() { return services.simulation; },
    placement: {
      space,
      resolvePlacementAreaIds: (entity, candidateSpace) => options.policy?.resolvePlacementAreaIds(entity, candidateSpace)
        ?? resolveEditorPlacementGeometry(services, sessionDocument.document.getSnapshot(), entity).allowedAreaIds,
    },
  };
  const persistence = options.persistence ?? "browser";
  const disposers: Array<() => void> = [];
  let disposed = false;
  const sessionDocument = createSessionDocument(options.initialDocument ?? createWorldDocument(), options.initialIntent as TIntent, (): void => { options.beforeDocumentChange?.(); });
  const internalDocument = sessionDocument.document;
  const editorState = createEditorStateReadWrite();
  const internalDocuments = createEditorDocumentRepository({
    document: internalDocument, state: editorState, workspace,
    persistence,
  });
  const getOperationAvailability = (operation: Parameters<EditorContract["queries"]["getOperationAvailability"]>[0]) => disposed ? { supported: false, enabled: false, reason: null }
    : options.policy?.getOperationAvailability(operation) ?? AVAILABLE_OPERATION;
  const internalHistory = new EditorHistoryRuntime(editorState.history, { persistence });
  const internalDocumentWriter: EditorSessionWriter<TIntent> = createEditorDocumentWriter({
    document: internalDocument,
    history: internalHistory,
    getOperationAvailability,
    isDisposed: () => disposed,
    session: {
      getIntent: () => sessionDocument.snapshot.getSnapshot().intent,
      reduceIntent: options.reduceIntent ?? ((intent) => intent),
      validateTransition: (transition, intent) => options.policy?.validateTransition(transition, intent) ?? [],
      publish: sessionDocument.publish,
    },
    normalizeEdit: (before, after) => normalizeEditedDarkPipeLinks(before, after,
      workspace.app?.state.settings.regionalMultiBaseEnabled === true),
  });
  const queries: EditorContract["queries"] = createEditorQueries({
    getOperationAvailability,
    history: internalHistory,
    document: internalDocument,
    documents: internalDocuments,
    state: editorState,
    workspace,
  });
  const actions: EditorContract["actions"] = guardEditorActions(createEditorActions({
    document: internalDocument,
    documentWriter: internalDocumentWriter,
    documents: internalDocuments,
    history: internalHistory,
    state: editorState,
    workspace,
    queries,
    beforeDocumentChange: (): void => { options.beforeDocumentChange?.(); },
    captureOperationGuard: () => options.captureOperationGuard?.() ?? (() => true),
  }), { getOperationAvailability, isDisposed: () => disposed, allowDocumentMaintenance: persistence === "browser" });


  const publicState: EditorContract["state"] = {
    get marqueeGridRect() {
      return editorState.marqueeGridRect;
    },
    history: editorState.history,
    regionAnnotations: editorState.regionAnnotations,
    collections: editorState.collections,
    get hoverTarget() {
      return editorState.hoverTarget;
    },
    get suppressBelts() {
      return editorState.suppressBelts;
    },
    get suppressPipes() {
      return editorState.suppressPipes;
    },
  };

  const host: EditorRuntimeHost = {
    document: {
      getSnapshot: internalDocument.getSnapshot,
      subscribe: internalDocument.subscribe,
    },
    state: publicState,
    internalDocument,
    internalDocuments,
    internalDocumentWriter,
    internalHistory,
    services: workspace,
    dispose: () => {
      if (disposed) return;
      options.beforeDocumentChange?.();
      disposed = true;
      internalHistory.dispose();
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
    queries,
    actions,
    internalState: editorState,
  };

  disposers.push(hookDocumentHistory(host));
  disposers.push(hookPlacementValidation(host));
  disposers.push(hookPoweredCollection(host));
  if (persistence === "browser") disposers.push(hookLocalstorage(host));
  disposers.push(hookDocumentStorage(host, { persistence, initialDocument: options.initialDocument }));

  if (persistence === "browser") disposers.push(hookDarkPipeLinkLifecycle(host));

  return Object.assign(host, { internalDocumentWriter, internalSessionSnapshot: sessionDocument.snapshot });
}

function hookPlacementValidation(editorHost: EditorRuntimeHost): () => void {
  return createSnapshotSelector(editorHost.internalDocument, selectDocumentEntities, shallowSnapshotEqual).subscribe(() => {
    const document = editorHost.internalDocument.getSnapshot();
    runInAction(() => {
      syncPlacementValidationState({
        document,
        state: editorHost.internalState,
        workspace: editorHost.services,
      });
    });
  });
}

function hookPoweredCollection(editorHost: EditorRuntimeHost): () => void {
  return createSnapshotSelector(editorHost.internalDocument, selectDocumentEntities, shallowSnapshotEqual).subscribe(() => {
    const document = editorHost.internalDocument.getSnapshot();
    runInAction(() => {
      syncPoweredEntityCollection({
        document,
        state: editorHost.internalState,
        workspace: editorHost.services,
      });
    });
  });
}

function hookDocumentHistory(editorHost: EditorRuntimeHost): () => void {
  let documentKey: string | null = null;

  return editorHost.internalDocument.subscribe((document) => {
    if (documentKey === document.documentKey) {
      return;
    }

    documentKey = document.documentKey;
    editorHost.internalHistory.loadDocumentHistory(document.documentKey);
  });
}

