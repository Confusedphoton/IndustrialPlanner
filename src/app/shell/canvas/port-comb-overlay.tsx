import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

/** 梳线时其余各条平行线的虚线预览，随主线草稿更新；落笔时按这些路径逐条铺设。 */
export const PortCombOverlay = observer(function PortCombOverlay({ appHost }: { appHost: AppHost }) {
  const canvas = appHost.mainCanvas;
  const comb = canvas.state.runtime.portComb;
  if (comb === null || comb.lanes.length === 0) {
    return null;
  }
  const cellPx = canvas.view.state.gridCellPixelSize;
  return (
    <svg aria-hidden="true" className={cm(styles, "port-comb-lanes")}>
      {comb.lanes.map((lane, index) => (
        <polyline
          key={index}
          points={lane.flatMap((cell) => {
            const rect = canvas.view.queries.findClientRectForGridCell(cell);
            return rect === null ? [] : [`${rect.left + rect.width / 2},${rect.top + rect.height / 2}`];
          }).join(" ")}
          strokeDasharray={`${Math.max(4, cellPx * 0.4)} ${Math.max(3, cellPx * 0.3)}`}
          strokeWidth={Math.max(3, cellPx * 0.35)}
        />
      ))}
    </svg>
  );
});
