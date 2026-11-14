import LucideLink2 from "~icons/lucide/link-2";
import LucideUnlink2 from "~icons/lucide/unlink-2";
import { runInAction } from "mobx";
import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { useEditorDocumentSnapshot } from "../hooks";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  DARK_PIPE_LINK_TOOL,
  findDarkPipeSlotLinkForEntity,
  findRegionalDarkPipeLinkForEndpoint,
  listDarkPipeLinkCandidateEntityIds,
  resolveDarkPipeLinkedEntityId,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";


export const DarkPipeLinkInspector = observer(function DarkPipeLinkInspector({
  appHost,
  entity,
  definition,
}: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}) {
  const editor = appHost.workspace.editor;
  // 界面文案改走 i18n，翻译函数取自 appHost（props.translate 仍按原契约不读取）。
  const translate = appHost.actions.translate;
  const documentSnapshot = useEditorDocumentSnapshot(editor, snapshot => snapshot);
  const darkPipeToolState = appHost.mainCanvas.state.toolInfo;
  const role = resolveDarkPipeRole(definition.id);
  const currentLink = documentSnapshot === null ? null : findDarkPipeSlotLinkForEntity(documentSnapshot, entity.id);
  const currentEndpoint = documentSnapshot === null
    ? null
    : { baseId: documentSnapshot.baseId, entityId: entity.id };
  const currentRegionalLink = currentEndpoint === null
    ? null
    : findRegionalDarkPipeLinkForEndpoint(editor?.queries.getRegionalDarkPipeLinks() ?? [], currentEndpoint);
  const currentRegionalEndpointRole = currentRegionalLink === null || currentEndpoint === null
    ? null
    : currentRegionalLink.inlet.baseId === currentEndpoint.baseId
        && currentRegionalLink.inlet.entityId === currentEndpoint.entityId
      ? "inlet"
      : "outlet";
  const regionalCounterpart = currentRegionalLink === null || currentRegionalEndpointRole === null
    ? null
    : currentRegionalEndpointRole === "inlet"
      ? currentRegionalLink.outlet
      : currentRegionalLink.inlet;
  const linkedEntityId = documentSnapshot === null ? null : resolveDarkPipeLinkedEntityId(documentSnapshot, entity.id);
  const candidates = documentSnapshot === null
    ? []
    : listDarkPipeLinkCandidateEntityIds({
      document: documentSnapshot,
      sourceEntity: entity,
    });
  const selectingState = appHost.mainCanvas.state.toolInfo.darkPipeLink;
  const isSelectingThisEntity = appHost.mainCanvas.state.activeTool === DARK_PIPE_LINK_TOOL
    && selectingState?.sourceBaseId === documentSnapshot?.baseId
    && selectingState?.sourceEntityId === entity.id;
  const canCreateRegionalLink = false;
  const activeRegionalLink = canCreateRegionalLink ? currentRegionalLink : null;

  const currentBase = documentSnapshot === null
    ? undefined
    : appHost.workspace.registry.baseDefinitions.find(
        (base) => base.id === documentSnapshot.baseId,
      );
  const siblingBaseIds = currentBase === undefined
    ? []
    : appHost.workspace.registry.baseDefinitions
        .filter((base) => base.tag === currentBase.tag && base.id !== currentBase.id)
        .map((base) => base.id);
  const immediateRegionalLinkProblem = currentRegionalLink === null
    ? null
    : role !== currentRegionalEndpointRole
      ? translate("inspectorText.endpointRoleNoLongerMatchesThe")
      : regionalCounterpart !== null
          && !appHost.workspace.registry.baseDefinitions.some(
            (base) => base.id === regionalCounterpart.baseId,
          )
        ? translate("inspectorText.remoteBaseNoLongerExists")
        : null;
  const regionalValidationRequestKey = activeRegionalLink !== null
    && currentRegionalEndpointRole !== null
    && regionalCounterpart !== null
    && editor !== null
    && role !== null
    && immediateRegionalLinkProblem === null
    ? JSON.stringify([
        activeRegionalLink.id,
        currentRegionalEndpointRole,
        regionalCounterpart.baseId,
        regionalCounterpart.entityId,
      ])
    : null;
  const [regionalValidationResult, setRegionalValidationResult] = useState<{
    readonly requestKey: string;
    readonly status: "valid" | "invalid";
    readonly message: string | null;
  } | null>(null);
  const regionalLinkValidation = activeRegionalLink === null
    ? null
    : immediateRegionalLinkProblem !== null
      ? { status: "invalid" as const, message: immediateRegionalLinkProblem }
      : regionalValidationResult?.requestKey === regionalValidationRequestKey
        ? regionalValidationResult
        : { status: "checking" as const, message: null };

  useEffect(() => {
    if (
      regionalValidationRequestKey === null
      || activeRegionalLink === null
      || currentRegionalEndpointRole === null
      || regionalCounterpart === null
      || editor === null
      || role === null
    ) {
      return;
    }

    let cancelled = false;
    void editor.queries.readLatestBaseDocuments([regionalCounterpart.baseId])
      .then(([document]) => {
        if (cancelled) return;
        const counterpartEntity = document?.entities[regionalCounterpart.entityId];
        const expectedRole = currentRegionalEndpointRole === "inlet" ? "outlet" : "inlet";
        if (counterpartEntity === undefined) {
          setRegionalValidationResult({
            requestKey: regionalValidationRequestKey,
            status: "invalid",
            message: translate("inspectorText.remoteConduitNoLongerExists"),
          });
          return;
        }
        if (resolveDarkPipeRole(counterpartEntity.definitionId) !== expectedRole) {
          setRegionalValidationResult({
            requestKey: regionalValidationRequestKey,
            status: "invalid",
            message: translate("inspectorText.remoteDeviceIsNoLongerA"),
          });
          return;
        }
        setRegionalValidationResult({
          requestKey: regionalValidationRequestKey,
          status: "valid",
          message: null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRegionalValidationResult({
            requestKey: regionalValidationRequestKey,
            status: "invalid",
            message: translate("inspectorText.cannotReadTheRemoteBase"),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    translate,
    currentRegionalEndpointRole,
    activeRegionalLink,
    editor,
    regionalCounterpart,
    regionalValidationRequestKey,
    role,
  ]);

  const canCreate = editor !== null
    && documentSnapshot !== null
    && role !== null
    && currentLink === null
    && activeRegionalLink === null
    && (candidates.length > 0 || (canCreateRegionalLink && siblingBaseIds.length > 0));

  const startSelection = () => {
    if (!canCreate || role === null || documentSnapshot === null) {
      return;
    }

    const returnTool = appHost.mainCanvas.state.activeTool === DARK_PIPE_LINK_TOOL
      ? "select"
      : appHost.mainCanvas.state.activeTool;
    runInAction(() => {
      darkPipeToolState.darkPipeLink = {
        sourceBaseId: documentSnapshot.baseId,
        sourceEntityId: entity.id,
        sourceRole: role,
        candidateEntityIds: candidates,
        returnTool,
      };
    });
    appHost.internalActions.setActiveTool(DARK_PIPE_LINK_TOOL);
    appHost.internalActions.closeDialog("inspector");
  };

  const cancelSelection = () => {
    const returnTool = selectingState?.returnTool ?? "select";
    runInAction(() => {
      darkPipeToolState.darkPipeLink = null;
    });
    appHost.internalActions.setActiveTool(returnTool === DARK_PIPE_LINK_TOOL ? "select" : returnTool);
  };

  const removeLink = async () => {
    if (editor === null || (currentLink === null && activeRegionalLink === null)
      || appHost.regionalSettings.darkPipeLinkSaving) {
      return;
    }

    runInAction(() => {
      appHost.regionalSettings.darkPipeLinkSaving = true;
      appHost.regionalSettings.darkPipeLinkSaveFailed = false;
    });
    try {
      const removed = await editor.actions.removeDarkPipeLink(entity.id);
      runInAction(() => {
        appHost.regionalSettings.darkPipeLinkSaveFailed = !removed;
        if (removed && isSelectingThisEntity) cancelSelection();
      });
    } finally {
      runInAction(() => { appHost.regionalSettings.darkPipeLinkSaving = false; });
    }
  };

  const regionalCounterpartBase = regionalCounterpart === null
    ? null
    : appHost.workspace.registry.baseDefinitions.find(
        (base) => base.id === regionalCounterpart.baseId,
      );
  const hasActiveLink = currentLink !== null || activeRegionalLink !== null;
  const buttonLabel = hasActiveLink
    ? translate("inspectorText.unlink")
    : isSelectingThisEntity
      ? translate("inspectorText.cancelSelection")
      : translate("inspectorText.createLink");
  const linkedLabel = currentLink !== null
    ? `${translate("inspectorText.linkedTo")} ${linkedEntityId ?? ""}`
    : activeRegionalLink === null
      ? translate("inspectorText.notLinked")
      : regionalLinkValidation?.status === "invalid"
        ? `${translate("inspectorText.endpointInvalid")}${regionalLinkValidation.message ?? translate("inspectorText.unknownReason")}`
        : regionalLinkValidation?.status === "checking"
          ? translate("inspectorText.checkingRemoteEndpoint")
          : `${regionalCounterpartBase?.name ?? regionalCounterpart?.baseId} · ${regionalCounterpart?.entityId}`;
  return (
    <InspectorCollapsiblePanel
      className="dark-pipe-link-inspector"
      dataInspectorKey="dark-pipe-link"
      title={translate("inspectorText.conduitLink")}
    >
      <div
        className={cm(styles, "dark-pipe-link-row")}
        data-dark-pipe-link-state={hasActiveLink ? "linked" : "unlinked"}
      >
        <span className={cm(styles, "dark-pipe-link-status")}>{linkedLabel}</span>
        <button
          className={cm(styles, hasActiveLink ? "dark-pipe-link-button is-danger" : "dark-pipe-link-button")}
          data-dark-pipe-link-action={hasActiveLink ? "remove" : "create"}
          disabled={appHost.regionalSettings.darkPipeLinkSaving || (!hasActiveLink && !isSelectingThisEntity && !canCreate)}
          onClick={() => {
            if (currentLink !== null || activeRegionalLink !== null) {
              void removeLink();
              return;
            }
            if (isSelectingThisEntity) {
              cancelSelection();
              return;
            }
            startSelection();
          }}
          title={buttonLabel}
          type="button"
        >
          {hasActiveLink ? <LucideUnlink2 aria-hidden="true" /> : <LucideLink2 aria-hidden="true" />}
          <span>{buttonLabel}</span>
        </button>
      </div>
    </InspectorCollapsiblePanel>
  );
});








