import { useReadonlyCanvas } from "@/app/canvas";
import { createEmbedWorldDocument } from "@/app/embed";
import { selectDocumentBaseId } from "@/shared/snapshot/world-document-selection";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { observer } from "mobx-react-lite";
import LucideChevronLeft from "~icons/lucide/chevron-left";
import LucideFolder from "~icons/lucide/folder";

import {
  downloadBlueprintDocumentForTransfer,
  serializeBlueprintDocumentForTransfer,
} from "@/app/blueprint/blueprint-transfer";
import type { AppHost } from "@/app/host/app-host";
import { canPlaceBlueprintDocumentInCurrentBase } from "@/app/placement-zone-availability";
import { useEditorDocumentSnapshot } from "../hooks";
import type { WorkbenchBlueprintPreviewController } from "@/app/shell/state/blueprint-preview-dialog-state";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";


import {
  createEmptyBlueprintLibraryDirectory,
  type BlueprintLibraryDirectoryListing,
  type BlueprintLibraryFolder,
  type BlueprintLibraryRecord,
} from "@/shared/blueprints/blueprint-library";
import {
  deleteBlueprintDocument,
  listBlueprintDirectory,
  readBlueprintFolder,
  saveBlueprintDocument,
} from "@/shared/storage/blueprint-storage";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";













function resolveBlueprintFootprint(
  record: BlueprintLibraryRecord,
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>,
) {
  const orderedEntities = record.entityOrder
    .map((entityId) => record.entities[entityId])
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined);
  const geometry = resolveEntityGridGeometry({
    entities: orderedEntities,
    entityDefinitionMap,
  });

  if (geometry === null) {
    return {
      width: 0,
      height: 0,
    };
  }

  return {
    width: geometry.boundingBox.width,
    height: geometry.boundingBox.height,
  };
}

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}











function formatBlueprintFolderPath(options: {
  readonly rootLabel: string;
  readonly folderStack: readonly BlueprintLibraryFolder[];
}): {
  readonly displayLabel: string;
  readonly fullLabel: string;
} {
  if (options.folderStack.length === 0) {
    return {
      displayLabel: options.rootLabel,
      fullLabel: options.rootLabel,
    };
  }

  const fullLabel = [options.rootLabel, ...options.folderStack.map((folder) => folder.name)].join(" / ");

  if (options.folderStack.length === 1) {
    return {
      displayLabel: fullLabel,
      fullLabel,
    };
  }

  const currentFolder = options.folderStack.at(-1);

  return {
    displayLabel: `${options.rootLabel} / … / ${currentFolder?.name ?? ""}`,
    fullLabel,
  };
}

async function resolveBlueprintFolderStack(
  parentFolderId: string | null,
): Promise<BlueprintLibraryFolder[]> {
  const folderStack: BlueprintLibraryFolder[] = [];
  const visitedFolderIds = new Set<string>();
  let currentFolderId = parentFolderId;

  while (currentFolderId !== null && !visitedFolderIds.has(currentFolderId)) {
    visitedFolderIds.add(currentFolderId);
    const folder = await readBlueprintFolder(currentFolderId);

    if (folder === null) {
      break;
    }

    folderStack.unshift(folder);
    currentFolderId = folder.parentFolderId;
  }

  return folderStack;
}

export const BlueprintPreviewDialog = observer(function BlueprintPreviewDialog({
  appHost,
  controller,
}: {
  appHost: AppHost;
  controller: WorkbenchBlueprintPreviewController;
}) {
  const t = appHost.actions.translate;
  const record = controller.record;
  const dialogState = controller.dialogState;
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isTabletLayout = appHost.state.screenProfile.deviceClass === "tablet";
  const editor = appHost.workspace.editor;
  // 订阅 document 变化使蓝图放置按钮在切换基地后正确更新
  useEditorDocumentSnapshot(editor, selectDocumentBaseId, Object.is);
  const previewCanvasHostRef = useRef<HTMLDivElement | null>(null);


  const moveFolderInitializationRequestIdRef = useRef(0);
  const moveDirectoryRequestIdRef = useRef(0);


  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [isMoveLoading, setIsMoveLoading] = useState(false);
  const [isMovePickerReady, setIsMovePickerReady] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [moveErrorMessage, setMoveErrorMessage] = useState<string | null>(null);
  const [transferErrorMessage, setTransferErrorMessage] = useState<string | null>(null);
  const [moveFolderStack, setMoveFolderStack] = useState<BlueprintLibraryFolder[]>([]);
  const [moveDirectoryListing, setMoveDirectoryListing] = useState<BlueprintLibraryDirectoryListing>(
    createEmptyBlueprintLibraryDirectory(null),
  );
  const useImmersiveShell = isPhoneLayout
    || (dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile));
  const currentMoveFolder = moveFolderStack.length > 0 ? moveFolderStack[moveFolderStack.length - 1] ?? null : null;
  const currentMoveFolderId = currentMoveFolder?.folderId ?? null;
  const copy = appHost.state.settings.locale === "zh-CN"
    ? {
      title: "蓝图预览",
      close: "关闭",
      maximize: "最大化",
      restore: "还原",
      previewTitle: "蓝图预览",
      previewHint: "布局总览",
      place: "放置",
      placeOriginal: "放置到原位 (调试模式)",
      placeOriginalHint: "将当前蓝图放置到保存时的原始位置",
      placeBlockedByBase: "包含不可放置设备",
      placeHint: "将当前蓝图放置到场景",
      version: "版本",
      schemaVersion: "架构版本",
      base: "地图",
      entities: "实体数",
      links: "连线数",
      footprint: "预估范围",
      boundingBox: "包围盒范围",
      area: "面积",
      anchor: "初始坐标",
      updatedAt: "更新时间",
      noDescription: "暂无描述",
      rendererNote: "蓝图信息",
      delete: "删除",
      deleteConfirm: "确认删除",
      deleteCancel: "取消",
      deleteFailed: "删除蓝图失败，请检查浏览器存储是否可用。",
      deleteHint: "将当前蓝图移入已删除列表",
      deleting: "删除中...",
      edit: "编辑详细信息",
      editHint: "修改蓝图名称、描述或保存位置",
      move: "移动",
      moveHint: "将当前蓝图移动到其他文件夹",
      moveCancel: "取消移动",
      moveConfirm: "移动",
      moveFailed: "移动蓝图失败，请检查浏览器存储是否可用。",
      moveLoading: "正在读取目录...",
      moving: "移动中...",
      moveTargetFolder: "目标文件夹",
      moveBack: "返回上一级",
      moveEmpty: "当前目录下没有子文件夹，可以直接移动到这里。",
      moveCurrentFolderNote: "当前蓝图已经位于这个目录。",
    }
    : {
      title: "Blueprint Preview",
      previewTitle: "Blueprint Preview",
      previewHint: "Layout Overview",
      place: "Place",
      placeOriginal: "Place at Origin (Debug)",
      placeOriginalHint: "Place this blueprint at its original saved position",
      placeBlockedByBase: "Contains unplaceable devices",
      placeHint: "Place this blueprint into the scene",
      version: "Version",
      schemaVersion: "Schema Version",
      base: "Base",
      entities: "Entities",
      links: "Links",
      footprint: "Footprint",
      boundingBox: "Bounding Box",
      area: "Area",
      anchor: "Anchor",
      updatedAt: "Updated",
      noDescription: "No description",
      rendererNote: "Blueprint Information",
      delete: "Delete",
      deleteConfirm: "Confirm Delete",
      deleteCancel: "Cancel",
      deleteFailed: "Failed to delete the blueprint. Check browser storage availability.",
      deleteHint: "Move this blueprint into deleted items",
      deleting: "Deleting...",
      edit: "Edit Details",
      editHint: "Edit the blueprint name, description, or saved folder",
      move: "Move",
      moveHint: "Move this blueprint to another folder",
      moveCancel: "Cancel Move",
      moveConfirm: "Move Here",
      moveFailed: "Failed to move the blueprint. Check browser storage availability.",
      moveLoading: "Loading folders...",
      moving: "Moving...",
      moveTargetFolder: "Target Folder",
      moveBack: "Up One Level",
      moveEmpty: "This folder has no subfolders. You can move the blueprint here.",
      moveCurrentFolderNote: "This blueprint is already in the current folder.",
    };
  const rootFolderLabel = t("workbench.blueprint.rootFolder");

  useEffect(() => {
    setIsDeleteConfirming(false);
    setIsDeleting(false);
    setDeleteErrorMessage(null);
    setIsMoveMode(false);
    setIsMoveLoading(false);
    setIsMovePickerReady(false);
    setIsMoving(false);
    setIsCopying(false);
    setMoveErrorMessage(null);
    setTransferErrorMessage(null);
    setMoveFolderStack([]);
    setMoveDirectoryListing(createEmptyBlueprintLibraryDirectory(null));
  }, [controller.canDelete, dialogState.visible, record?.blueprintId]);

  useEffect(() => {
    if (!dialogState.visible || record === null || !controller.canDelete || !isMoveMode) {
      return;
    }

    let cancelled = false;
    const requestId = moveFolderInitializationRequestIdRef.current + 1;
    moveFolderInitializationRequestIdRef.current = requestId;

    setIsMoveLoading(true);
    setIsMovePickerReady(false);
    setMoveErrorMessage(null);

    void resolveBlueprintFolderStack(record.parentFolderId)
      .then((folderStack) => {
        if (cancelled || moveFolderInitializationRequestIdRef.current !== requestId) {
          return;
        }

        setMoveFolderStack(folderStack);
        setMoveDirectoryListing(
          createEmptyBlueprintLibraryDirectory(folderStack.at(-1)?.folderId ?? null),
        );
        setIsMovePickerReady(true);
      })
      .finally(() => {
        if (cancelled || moveFolderInitializationRequestIdRef.current !== requestId) {
          return;
        }

        setIsMoveLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [controller.canDelete, dialogState.visible, isMoveMode, record]);

  useEffect(() => {
    if (!dialogState.visible || record === null || !controller.canDelete || !isMoveMode || !isMovePickerReady) {
      return;
    }

    let cancelled = false;
    const requestId = moveDirectoryRequestIdRef.current + 1;
    moveDirectoryRequestIdRef.current = requestId;

    setIsMoveLoading(true);
    setMoveErrorMessage(null);
    setMoveDirectoryListing(createEmptyBlueprintLibraryDirectory(currentMoveFolderId));

    void listBlueprintDirectory(currentMoveFolderId)
      .then((listing) => {
        if (cancelled || moveDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setMoveDirectoryListing(listing);
      })
      .catch(() => {
        if (cancelled || moveDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setMoveErrorMessage(copy.moveFailed);
      })
      .finally(() => {
        if (cancelled || moveDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setIsMoveLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [controller.canDelete, copy.moveFailed, currentMoveFolderId, dialogState.visible, isMoveMode, isMovePickerReady, record]);

















  const previewDocument = useMemo(() => record === null ? null : createEmbedWorldDocument(record, appHost.workspace.registry), [appHost, record]);
  const preview = useReadonlyCanvas({ appHost, container: previewCanvasHostRef, document: previewDocument, enabled: dialogState.visible,
    onReady: (canvas) => { canvas.dataset.blueprintPreviewCanvas = "true"; } });

  if (!dialogState.visible || record === null) {
    return null;
  }
  const footprint = resolveBlueprintFootprint(
    record,
    new Map(
      appHost.workspace.registry.entityDefinitions.map((definition) => [definition.id, definition]),
    ),
  );
  const moveFolderPath = formatBlueprintFolderPath({
    rootLabel: rootFolderLabel,
    folderStack: moveFolderStack,
  });
  const isMoveTargetCurrent = currentMoveFolderId === record.parentFolderId;
  const activeErrorMessage = transferErrorMessage ?? moveErrorMessage ?? deleteErrorMessage ?? preview.error;
  const canPlaceBlueprint = canPlaceBlueprintDocumentInCurrentBase(appHost.mainCanvas, record);
  const handlePlaceButtonPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canPlaceBlueprint) {
      return;
    }

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: "blueprint-preview-place-button",
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: "blueprint-preview-place-button",
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };
  const handlePlaceButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!canPlaceBlueprint) {
      return;
    }

    if (event.detail !== 0) {
      return;
    }

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "blueprint-preview-place-button",
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  };
  const handlePlaceOriginalButtonClick = () => {
    if (!canPlaceBlueprint) {
      return;
    }

    const editor = appHost.workspace.editor;
    if (editor === null || editor.actions.createBlueprintPlacementDraft === undefined) {
      return;
    }

    try {
      editor.actions.createBlueprintPlacementDraft(record, record.initialGridPoint);
      const applied = editor.actions.applyPlacementDraft();
      if (!applied) {
        editor.actions.cancelPlacementDraft();
        return;
      }
      controller.close();
    } catch {
      // 放置失败，静默忽略
    }
  };
  const handleDeleteButtonClick = async () => {
    if (!controller.canDelete) {
      return;
    }

    setTransferErrorMessage(null);

    if (!isDeleteConfirming) {
      setIsDeleteConfirming(true);
      setDeleteErrorMessage(null);
      return;
    }

    setIsDeleting(true);
    setDeleteErrorMessage(null);

    try {
      const deletedRecord = await deleteBlueprintDocument(record.blueprintId);

      if (deletedRecord === null) {
        setDeleteErrorMessage(copy.deleteFailed);
        return;
      }

      controller.markDeleted();
      controller.close();
    } finally {
      setIsDeleting(false);
    }
  };
  const handleOpenMoveMode = () => {
    if (!controller.canDelete) {
      return;
    }

    setIsDeleteConfirming(false);
    setDeleteErrorMessage(null);
    setMoveErrorMessage(null);
    setTransferErrorMessage(null);
    const editableRecord = record;

    controller.close();

    if (typeof window === "undefined") {
      appHost.saveBlueprintDialog.openEdit(editableRecord);
      return;
    }

    window.setTimeout(() => {
      appHost.saveBlueprintDialog.openEdit(editableRecord);
    }, 0);
  };
  const handleExportButtonClick = () => {
    setTransferErrorMessage(null);

    try {
      downloadBlueprintDocumentForTransfer(record);
    } catch {
      setTransferErrorMessage(t("workbench.blueprint.exportFileFailed"));
    }
  };
  const handleCopyButtonClick = async () => {
    if (isCopying) {
      return;
    }

    if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
      setTransferErrorMessage(t("workbench.blueprint.copyClipboardUnavailable"));
      return;
    }

    setIsCopying(true);
    setTransferErrorMessage(null);

    try {
      await navigator.clipboard.writeText(serializeBlueprintDocumentForTransfer(record));
    } catch {
      setTransferErrorMessage(t("workbench.blueprint.copyClipboardFailed"));
    } finally {
      setIsCopying(false);
    }
  };
  const handleMoveSubmit = async () => {
    if (!controller.canDelete || isMoveLoading || isMoving || isMoveTargetCurrent) {
      return;
    }

    setIsMoving(true);
    setMoveErrorMessage(null);

    try {
      const movedRecord = await saveBlueprintDocument(record, {
        parentFolderId: currentMoveFolderId,
      });

      if (movedRecord === null) {
        setMoveErrorMessage(copy.moveFailed);
        return;
      }

      controller.markMoved();
      controller.close();
    } finally {
      setIsMoving(false);
    }
  };
  const showDeleteAction = controller.canDelete;
  const showMoveAction = controller.canDelete;
  const defaultActionCount = 4 + (showMoveAction ? 1 : 0) + (showDeleteAction ? 1 : 0);
  const actionsClassName = isDeleteConfirming
    ? "blueprint-preview-actions is-dual-action"
    : defaultActionCount >= 3
      ? "blueprint-preview-actions is-triple-action"
      : defaultActionCount === 2
        ? "blueprint-preview-actions is-dual-action"
      : "blueprint-preview-actions";





  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      // TapTap 手机端按 Chrome 89 兼容；Chrome 89 不支持 inline style 中的 dvh/dvw，手机对话框使用 vh/vw。
      width: isPhoneLayout ? "100vw" : isTabletLayout ? "720px" : "760px",
      height: isPhoneLayout ? "100vh" : isTabletLayout ? "720px" : "680px",
      minHeight: isPhoneLayout ? "100vh" : "520px",
    }
    : undefined;

  return (
    <DialogShell
      bodyClassName="blueprint-preview-dialog-body"
      className="blueprint-preview-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isPhoneLayout}
      dialogKey="blueprint-preview"
      dialogState={dialogState}
      immersiveMaximized={useImmersiveShell}
      maximizeTitle={t("dialog.maximize")}
      onClose={controller.close}
      onOffsetChange={controller.setOffset}
      onResize={isPhoneLayout ? undefined : controller.setSize}
      onToggleMaximized={controller.toggleMaximized}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={copy.title}
      titleId="blueprint-preview-dialog-title"
    >
      <div className={cm(styles, "blueprint-preview-dialog-content")}>
        <section className={cm(styles, "blueprint-preview-layout")} aria-label={copy.previewTitle}>
          <div className={cm(styles, "blueprint-preview-stage")}>
            <div className={cm(styles, "blueprint-preview-canvas-shell")}>
              <div
                className={cm(styles, "blueprint-preview-canvas")}






                ref={previewCanvasHostRef}
              />
              {}
            </div>
            {}
          </div>
          <div className={cm(styles, isMoveMode
            ? "blueprint-preview-summary-card is-folder-picker-mode"
            : "blueprint-preview-summary-card")}
          >
            {isMoveMode ? (
              <section
                aria-label={copy.moveTargetFolder}
                className={cm(styles, "blueprint-preview-folder-picker-card")}
              >
                {activeErrorMessage === null ? null : (
                  <p className={cm(styles, "save-blueprint-error")} role="alert">{activeErrorMessage}</p>
                )}
                <div className={cm(styles, "blueprint-preview-folder-picker-toolbar")}>
                  {currentMoveFolder === null ? null : (
                    <button
                      aria-label={copy.moveBack}
                      className={cm(styles, "blueprint-utility-button blueprint-preview-folder-picker-back-button")}
                      data-ui-button-id="blueprint-preview-move-back-button"
                      disabled={isMoveLoading || isMoving}
                      onClick={() => {
                        setMoveErrorMessage(null);
                        setMoveFolderStack((currentValue) => currentValue.slice(0, -1));
                      }}
                      type="button"
                    >
                      <LucideChevronLeft className={cm(styles, "button-icon-image")} />
                    </button>
                  )}
                  <span
                    className={cm(styles, "blueprint-preview-folder-picker-path")}
                    data-blueprint-preview-move-breadcrumb
                    title={moveFolderPath.fullLabel}
                  >
                    {moveFolderPath.displayLabel}
                  </span>
                </div>
                {isMoveLoading ? (
                  <p className={cm(styles, "blueprint-preview-footnote")}>{copy.moveLoading}</p>
                ) : moveDirectoryListing.folders.length === 0 ? (
                  <p className={cm(styles, "blueprint-preview-footnote")}>{copy.moveEmpty}</p>
                ) : (
                  <div className={cm(styles, "blueprint-preview-folder-picker-list")}>
                    {moveDirectoryListing.folders.map((folder) => (
                      <button
                        className={cm(styles, "save-blueprint-secondary-button blueprint-preview-folder-picker-entry")}
                        data-blueprint-preview-folder-id={folder.folderId}
                        key={folder.folderId}
                        onClick={() => {
                          setMoveErrorMessage(null);
                          setMoveFolderStack((currentValue) => [...currentValue, folder]);
                        }}
                        title={folder.name}
                        type="button"
                      >
                        <span aria-hidden="true" className={cm(styles, "button-icon blueprint-preview-folder-picker-entry-icon")}>
                          <LucideFolder className={cm(styles, "button-icon-image")} />
                        </span>
                        <span className={cm(styles, "blueprint-preview-folder-picker-entry-label")}>{folder.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {isMoveTargetCurrent ? (
                  <p className={cm(styles, "blueprint-preview-footnote")}>{copy.moveCurrentFolderNote}</p>
                ) : null}
                <div className={cm(styles, "blueprint-preview-actions is-dual-action blueprint-preview-folder-picker-actions")}>
                  <button
                    className={cm(styles, "save-blueprint-secondary-button")}
                    data-ui-button-id="blueprint-preview-move-cancel-button"
                    disabled={isMoveLoading || isMoving}
                    onClick={() => {
                      setIsMoveMode(false);
                      setMoveErrorMessage(null);
                    }}
                    type="button"
                  >
                    {copy.moveCancel}
                  </button>
                  <button
                    className={cm(styles, "save-blueprint-primary-button")}
                    data-ui-button-id="blueprint-preview-move-confirm-button"
                    disabled={isMoveLoading || isMoving || isMoveTargetCurrent}
                    onClick={() => {
                      void handleMoveSubmit();
                    }}
                    type="button"
                  >
                    {isMoving ? copy.moving : copy.moveConfirm}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <div className={cm(styles, "blueprint-preview-header")}>
                  <div className={cm(styles, "blueprint-preview-header-copy")}>
                    <h3>{record.name}</h3>
                    <p className={cm(styles, "blueprint-preview-description")}>
                      {record.description.length > 0 ? record.description : copy.noDescription}
                    </p>
                  </div>
                </div>
                {activeErrorMessage === null ? null : (
                  <p className={cm(styles, "save-blueprint-error")} role="alert">{activeErrorMessage}</p>
                )}
                <div className={cm(styles, actionsClassName)}>
                  {isDeleteConfirming ? (
                    <>
                      <button
                        className={cm(styles, "save-blueprint-secondary-button")}
                        data-ui-button-id="blueprint-preview-delete-cancel-button"
                        disabled={isDeleting}
                        onClick={() => {
                          setIsDeleteConfirming(false);
                          setDeleteErrorMessage(null);
                        }}
                        type="button"
                      >
                        {copy.deleteCancel}
                      </button>
                      <button
                        className={cm(styles, "save-blueprint-primary-button blueprint-preview-danger-button is-confirm")}
                        data-ui-button-id="blueprint-preview-delete-confirm-button"
                        disabled={isDeleting}
                        onClick={() => {
                          void handleDeleteButtonClick();
                        }}
                        type="button"
                      >
                        {isDeleting ? copy.deleting : copy.deleteConfirm}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={cm(styles, "save-blueprint-primary-button")}
                        data-ui-button-id="blueprint-preview-place-button"
                        disabled={!canPlaceBlueprint}
                        onClick={handlePlaceButtonClick}
                        onPointerDown={preventTouchPointerCompatibilityMouseEvents}
                        onPointerUp={handlePlaceButtonPointerUp}
                        title={copy.placeHint}
                        type="button"
                      >
                        {canPlaceBlueprint ? copy.place : copy.placeBlockedByBase}
                      </button>
                      {appHost.state.settings.debugMode ? (
                        <button
                          className={cm(styles, "save-blueprint-primary-button")}
                          data-ui-button-id="blueprint-preview-place-original-button"
                          disabled={!canPlaceBlueprint}
                          onClick={handlePlaceOriginalButtonClick}
                          title={copy.placeOriginalHint}
                          type="button"
                        >
                          {canPlaceBlueprint ? copy.placeOriginal : copy.placeBlockedByBase}
                        </button>
                      ) : null}
                      <button
                        className={cm(styles, "save-blueprint-secondary-button")}
                        data-ui-button-id="blueprint-preview-export-file-button"
                        onClick={handleExportButtonClick}
                        title={t("workbench.button.exportBlueprintToFile")}
                        type="button"
                      >
                        {t("workbench.button.exportBlueprintToFile")}
                      </button>
                      <button
                        className={cm(styles, "save-blueprint-secondary-button")}
                        data-ui-button-id="blueprint-preview-copy-clipboard-button"
                        disabled={isCopying}
                        onClick={() => {
                          void handleCopyButtonClick();
                        }}
                        title={t("workbench.button.copyBlueprintToClipboard")}
                        type="button"
                      >
                        {t("workbench.button.copyBlueprintToClipboard")}
                      </button>
                      {showMoveAction ? (
                        <button
                          className={cm(styles, "save-blueprint-secondary-button")}
                          data-ui-button-id="blueprint-preview-move-button"
                          onClick={handleOpenMoveMode}
                          title={copy.editHint}
                          type="button"
                        >
                          {copy.edit}
                        </button>
                      ) : null}
                      {showDeleteAction ? (
                        <button
                          className={cm(styles, "save-blueprint-secondary-button blueprint-preview-danger-button")}
                          data-ui-button-id="blueprint-preview-delete-button"
                          onClick={() => {
                            void handleDeleteButtonClick();
                          }}
                          title={copy.deleteHint}
                          type="button"
                        >
                          {copy.delete}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
                <dl className={cm(styles, "blueprint-preview-metadata")}>
                  <dt>{copy.entities}</dt>
                  <dd>{record.entityOrder.length}</dd>
                  <dt>{copy.version}</dt>
                  <dd className={cm(styles, "blueprint-preview-metadata-inline")}>
                    <span>{record.version}</span>
                    <span className={cm(styles, "blueprint-preview-metadata-inline-label")}>{copy.schemaVersion}</span>
                    <span>{record.schemaVersion}</span>
                  </dd>
                  <dt>{copy.boundingBox}</dt>
                  <dd className={cm(styles, "blueprint-preview-metadata-inline")}>
                    <span>{footprint.width} x {footprint.height}</span>
                    <span className={cm(styles, "blueprint-preview-metadata-inline-label")}>{copy.area}</span>
                    <span>{footprint.width * footprint.height}</span>
                  </dd>
                </dl>
              </>
            )}
            {}
            {}
          </div>
        </section>
      </div>
    </DialogShell>
  );
});

