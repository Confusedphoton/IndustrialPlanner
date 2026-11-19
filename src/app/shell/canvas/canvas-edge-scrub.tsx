import LucideZoomIn from "~icons/lucide/zoom-in";
import LucideHistory from "~icons/lucide/history";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "../shared/css-module-class";

export const CanvasEdgeScrub = observer(function CanvasEdgeScrub({ appHost }: { appHost: AppHost }) {
  const canvas = appHost.mainCanvas;
  const editor = canvas.editor;
  if (editor === null) return null;
  const t = appHost.actions.translate;
  const zoom = canvas.view.state.gridSize;
  const { min, max } = canvas.view.queries.getZoomRange();
  const zoomStart = Math.log2(min);
  const zoomSpan = Math.log2(max) - zoomStart;
  const history = editor.state.history;
  const undo = canvas.isOperationEnabled("undo");
  const redo = canvas.isOperationEnabled("redo");
  const oldest = (history.records[0]?.sequence ?? history.cursorSequence + 1) - 1;
  const first = undo ? oldest : history.cursorSequence;
  const last = redo ? history.headSequence : history.cursorSequence;
  const historyEnabled = history.isReady && first < last;
  const percent = `${Math.round(zoom * 100)}%`;

  return (
    <div className={cm(styles, "canvas-edge-scrub")}>
      <label title={`${t("canvasGesture.zoom")} ${percent}`}>
        <LucideZoomIn aria-hidden="true" />
        <input
          aria-label={t("canvasGesture.zoom")}
          aria-valuetext={percent}
          disabled={!canvas.isOperationEnabled("zoom-viewport")}
          max={100}
          min={0}
          step={0.1}
          type="range"
          value={(Math.log2(zoom) - zoomStart) / zoomSpan * 100}
          onChange={(event) => {
            const target = zoomStart + event.currentTarget.valueAsNumber / 100 * zoomSpan;
            canvas.view.actions.zoom((target - Math.log2(canvas.view.state.gridSize)) * 6);
            canvas.actions.alignCanvasFloatingToolbar();
          }}
        />
      </label>
      <label title={t("canvasGesture.history")}>
        <LucideHistory aria-hidden="true" />
        <input
          aria-label={t("canvasGesture.history")}
          aria-valuetext={`${history.cursorSequence - oldest} / ${history.headSequence - oldest}`}
          disabled={!historyEnabled}
          max={last}
          min={first}
          step={1}
          type="range"
          value={history.cursorSequence}
          onChange={(event) => {
            if (editor.actions.restoreDocumentHistoryTo(event.currentTarget.valueAsNumber)) {
              canvas.dismissRepeatLaneUndo();
            }
          }}
        />
      </label>
    </div>
  );
});
