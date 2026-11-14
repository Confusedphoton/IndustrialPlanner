import { observer } from "mobx-react-lite";
import { translateKnownText } from "@/app/shell/shared/known-text-translation";
import type { AppHost } from "@/app/host/app-host";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { EditorHistoryRecord } from "@/domain/editor/editor-history";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const HistoryPanel = observer(function HistoryPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  const history = editor?.state.history;
  const records = history?.records.slice().reverse() ?? [];
  const cursorSequence = history?.cursorSequence ?? 0;
  const undoDepth = history?.undoDepth ?? 0;
  const redoDepth = history?.redoDepth ?? 0;
  const canUndo = editor !== null && undoDepth > 0;
  const canRedo = editor !== null && redoDepth > 0;
  const isReady = history?.isReady ?? true;

  return (
    <div className={cm(styles, "history-panel stack")}>
      <section className={cm(styles, "placeholder-section history-actions-section")}>
        <div className={cm(styles, "placeholder-section-header")}>
          <h3>{t("workbench.section.historyActions")}</h3>
        </div>
        <div className={cm(styles, "history-action-grid")}>
          <button
            className={cm(styles, "history-action-button")}
            data-ui-button-id="history-action-undo"
            disabled={!canUndo}
            onClick={() => {
              editor?.actions.undoDocumentHistory();
            }}
            title={t("workbench.button.undo")}
            type="button"
          >
            <span aria-hidden="true" className={cm(styles, "button-icon")}>
              <WorkbenchIcon className={cm(styles, "button-icon-image")} kind="undo" />
            </span>
            <span className={cm(styles, "history-action-label")}>{t("workbench.button.undo")}</span>
          </button>
          <button
            className={cm(styles, "history-action-button")}
            data-ui-button-id="history-action-redo"
            disabled={!canRedo}
            onClick={() => {
              editor?.actions.redoDocumentHistory();
            }}
            title={t("workbench.button.redo")}
            type="button"
          >
            <span aria-hidden="true" className={cm(styles, "button-icon")}>
              <WorkbenchIcon className={cm(styles, "button-icon-image")} kind="redo" />
            </span>
            <span className={cm(styles, "history-action-label")}>{t("workbench.button.redo")}</span>
          </button>
        </div>
      </section>

      <section className={cm(styles, "placeholder-section history-lane-section")}>
        <div className={cm(styles, "placeholder-section-header")}>
          <h3>{t("workbench.section.historyLane")}</h3>
        </div>
        {isReady && records.length === 0 ? (
          <div className={cm(styles, "history-empty-state")}>
            <h3>{t("workbench.history.emptyTitle")}</h3>
          </div>
        ) : (
          <div className={cm(styles, "history-record-list")}>
            {records.map((record) => (
              <HistoryRecordButton
                currentSequence={cursorSequence}
                key={record.id}
                onRestore={() => {
                  editor?.actions.restoreDocumentHistoryTo(record.sequence);
                }}
                record={record}
                translate={t}
              />
            ))}
            {records.length > 0 ? (
              <button
                className={cm(styles, cursorSequence === 0
                  ? "history-record-button is-current"
                  : "history-record-button")}
                data-history-record-sequence="0"
                disabled={editor === null || cursorSequence === 0}
                onClick={() => {
                  editor?.actions.restoreDocumentHistoryTo(0);
                }}
                type="button"
              >
                <span className={cm(styles, "history-record-main")}>
                  <span className={cm(styles, "history-record-sequence")}>#0</span>
                  <span className={cm(styles, "history-record-title")}>{t("workbench.history.initialState")}</span>
                </span>
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
});

function HistoryRecordButton({
  currentSequence,
  onRestore,
  record,
  translate: _translate,
}: {
  currentSequence: number;
  onRestore: () => void;
  record: EditorHistoryRecord;
  translate: (key: string) => string;
}) {
  const isCurrent = record.sequence === currentSequence;
  const _isRedoable = record.sequence > currentSequence;
  const _detail = resolveRecordDetail(record);

  return (
    <button
      className={cm(styles, isCurrent
        ? "history-record-button is-current"
        : "history-record-button")}
      data-history-record-sequence={record.sequence}
      disabled={isCurrent}
      onClick={onRestore}
      type="button"
    >
      <span className={cm(styles, "history-record-main")}>
        <span className={cm(styles, "history-record-sequence")}>{`#${record.sequence}`}</span>
        <span className={cm(styles, "history-record-title")}>{translateKnownText(record.action.label, _translate)}</span>
      </span>
    </button>
  );
}

function resolveRecordDetail(record: EditorHistoryRecord): string {
  const detailParts = [
    record.action.detail,
    record.action.count === undefined ? null : `${record.action.count}`,
  ].filter((part): part is string => typeof part === "string" && part !== "");

  return detailParts.join(" · ");
}

function _formatHistoryTime(createdAt: string): string {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

