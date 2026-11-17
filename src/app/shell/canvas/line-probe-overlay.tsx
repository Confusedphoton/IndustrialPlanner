import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";

import type { LineProbeState } from "@/app/canvas/line-probe";
import { configuredRecipeIds, resolveRecipeItemRatePerMinute, traceLine, type LineTraceEnd } from "@/app/canvas/line-trace";
import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import {
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
} from "@/app/shell/production-planning/production-planning-model";
import { useRecipeTreePlanningIndex } from "@/app/shell/recipe-tree/recipe-tree-plan";
import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { resolveLogisticsThroughputPerMinute } from "@/domain/registry";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { outputPortItemIds, runningDeviceItemIds } from "@/shared/device-item-labels";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { useEditorDocumentSnapshot } from "../hooks";

const CARD_WIDTH_PX = 236;
const CARD_OFFSET_PX = 18;
const CARD_MARGIN_PX = 8;
/** 实测流量的统计窗口（仿真秒）。 */
const FLOW_WINDOW_SECONDS = 10;
/** 至少采到这么多仿真秒再显示实测流量，免得刚开始的几个 tick 让读数乱跳。 */
const FLOW_MIN_SECONDS = 1;
const FLOW_REFRESH_MS = 250;

const selectEntities = (document: WorldDocument) => document.entities;

/**
 * 线上读数：悬停（或手指点选的单段）传送带/管道旁的小卡片与整条线的高亮。
 * 上游产量与下游用量按两端设备设定的配方算，平分到该设备同组接了线的端口上；运力按线的种类；
 * 仿真运行时另按进入这一格的物品数实测流量（管道没有逐格交接记录，不显示实测）。
 */
export const LineProbeOverlay = observer(function LineProbeOverlay({ appHost }: { appHost: AppHost }) {
  const canvas = appHost.mainCanvas;
  const editor = appHost.workspace.editor;
  const index = useRecipeTreePlanningIndex(appHost);
  useEditorDocumentSnapshot(editor, selectEntities);
  const probe = resolveShownProbe(canvas, editor);
  const trace = probe === null || editor === null ? null : traceLine(editor, canvas.registry.queries, probe.kind, probe.cell);
  const probedEntityId = trace?.cells.find((entry) => entry.cell.x === probe!.cell.x && entry.cell.y === probe!.cell.y)?.entityId ?? null;
  const measured = useMeasuredFlow(appHost, probe?.kind === "belt" ? probedEntityId : null);
  const simulation = appHost.workspace.simulation;
  const running = simulation !== null && simulation.state.runningState === "start";
  if (probe === null || trace === null || editor === null) {
    return null;
  }

  const t = appHost.actions.translate;
  const registry = canvas.registry;
  // 设备没设配方（游戏里按投入的原料自动生产）时，仿真运行中改用它正在跑的配方与产物；再不行就用实测到的物品。
  const runtimeStatus = (end: LineTraceEnd | null) => end === null || !running ? null : simulation.queries.getDeviceRuntimeStatus(end.entity.id);
  const recipeIdsAt = (end: LineTraceEnd) => {
    const configured = configuredRecipeIds(end.entity);
    const status = configured.length > 0 ? null : runtimeStatus(end);
    return status === null ? configured : Object.values(status.channelRecipes).flatMap((channel) => channel?.recipeId ? [channel.recipeId] : []);
  };
  const sourceDefinition = trace.source === null ? null : registry.queries.findEntityDefinition(trace.source.entity.definitionId);
  const configuredItemIds = trace.source === null || sourceDefinition === null
    ? []
    : outputPortItemIds(sourceDefinition, trace.source.entity, trace.source.portGroupId, registry);
  const sourceStatus = configuredItemIds.length > 0 ? null : runtimeStatus(trace.source);
  const runningItemIds = sourceStatus === null || sourceDefinition === null ? [] : runningDeviceItemIds(sourceDefinition, sourceStatus, registry);
  const itemIds = configuredItemIds.length > 0 ? configuredItemIds
    : runningItemIds.length > 0 ? runningItemIds
      : measured?.itemIds ?? [];
  const supply = trace.source === null ? null : splitRate(editor, registry, trace.source, recipeIdsAt(trace.source), probe.kind, itemIds, "output");
  const demand = trace.sink === null ? null : splitRate(editor, registry, trace.sink, recipeIdsAt(trace.sink), probe.kind, itemIds, "input");
  const capacity = resolveLogisticsThroughputPerMinute(probe.kind);
  const fill = supply === null ? null : supply / capacity;
  const rate = (key: "lineProbe.supply" | "lineProbe.capacity" | "lineProbe.demand" | "lineProbe.flow", value: number) =>
    t(key).replace("{rate}", formatRate(value));

  const centers = trace.cells.flatMap(({ cell }) => {
    const rect = canvas.view.queries.findClientRectForGridCell(cell);
    return rect === null ? [] : [`${rect.left + rect.width / 2},${rect.top + rect.height / 2}`];
  });
  const cellPx = canvas.view.state.gridCellPixelSize;
  const anchorRect = canvas.view.queries.findClientRectForGridCell(probe.cell);
  const anchor = probe.pointer ?? (anchorRect === null ? null : { x: anchorRect.left + anchorRect.width, y: anchorRect.top });
  if (anchor === null) {
    return null;
  }
  const visible = canvas.unobstructedClientRect;
  const left = Math.min(Math.max(anchor.x + CARD_OFFSET_PX, visible.left + CARD_MARGIN_PX), visible.left + visible.width - CARD_WIDTH_PX - CARD_MARGIN_PX);
  const top = Math.max(anchor.y + CARD_OFFSET_PX, visible.top + CARD_MARGIN_PX);
  const itemId = itemIds[0];

  return (
    <>
      <svg aria-hidden="true" className={cm(styles, "line-probe-path")}>
        <polyline points={centers.join(" ")} strokeWidth={Math.max(6, cellPx * 0.7)} />
      </svg>
      <div aria-label={t("lineProbe.title")} className={cm(styles, "line-probe-card")} role="status" style={{ left, top, width: CARD_WIDTH_PX }}>
        <div className={cm(styles, "line-probe-title")}>
          {itemId === undefined ? null : <img alt="" src={resolveProductionPlanningItemIconSrc(itemId, index)} />}
          <strong>{itemId === undefined ? t("lineProbe.unknownItem") : resolveProductionPlanningItemName(itemId, index, t)}</strong>
        </div>
        {supply === null ? null : <span>{rate("lineProbe.supply", supply)}</span>}
        <span>{rate("lineProbe.capacity", capacity)}</span>
        {fill === null ? null : (
          <span className={cm(styles, fill > 1 ? "line-probe-bar is-over" : "line-probe-bar")}>
            <span style={{ width: `${Math.min(1, fill) * 100}%` }} />
          </span>
        )}
        {demand === null ? null : <span>{rate("lineProbe.demand", demand)}</span>}
        {measured === null ? null : <span>{rate("lineProbe.flow", measured.rate)}</span>}
        {fill !== null && fill > 1 ? <span className={cm(styles, "line-probe-warning")}>{t("lineProbe.overCapacity")}</span> : null}
        {supply !== null && demand !== null && Math.min(supply, capacity) < demand - 1e-6
          ? <span className={cm(styles, "line-probe-warning")}>{t("lineProbe.short")}</span>
          : null}
      </div>
    </>
  );
});

/** 悬停的线；手指没有悬停，改为选中恰好一段线时显示。线末端提示出现时让位。 */
function resolveShownProbe(canvas: CanvasInteractionController, editor: EditorContract | null): LineProbeState | null {
  if (editor === null || canvas.state.activeTool !== "select" || canvas.state.runtime.lineEndChip !== null) {
    return null;
  }
  if (canvas.state.runtime.lineProbe !== null) {
    return canvas.state.runtime.lineProbe;
  }
  const selection = editor.state.collections.selection;
  const entity = selection.length === 1 ? editor.queries.getEntityById(selection[0]!) : null;
  if (entity === null) {
    return null;
  }
  const kind: LogisticsKind | null = canvas.registry.queries.isBelt(entity.definitionId)
    ? "belt"
    : canvas.registry.queries.isPipe(entity.definitionId) ? "pipe" : null;
  return kind === null ? null : { kind, cell: entity.position, pointer: null };
}

/** 设备在这一端的速率，平分到同一端口组里接了这种线的端口上。 */
function splitRate(
  editor: EditorContract,
  registry: RegistryContract,
  end: LineTraceEnd,
  recipeIds: readonly string[],
  kind: LogisticsKind,
  itemIds: readonly string[],
  direction: "input" | "output",
): number | null {
  const total = resolveRecipeItemRatePerMinute(registry, recipeIds, itemIds, direction);
  const definition = registry.queries.findEntityDefinition(end.entity.definitionId);
  const group = definition?.portGroups.find((entry) => entry.id === end.portGroupId);
  if (total === null || definition === null || group === undefined) {
    return total;
  }
  const connected = group.ports.filter((port) => {
    const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: end.entity.rotation });
    return editor.queries.findTransportLineAtGridPoint({
      x: end.entity.position.x + geometry.cell.x + geometry.delta.x,
      y: end.entity.position.y + geometry.cell.y + geometry.delta.y,
    }, kind) !== null;
  }).length;
  return total / Math.max(1, connected);
}

/** 仿真运行时每帧读当前 tick 的交接，统计进入这一格的物品数（换算成每分钟）与物品种类。 */
function useMeasuredFlow(appHost: AppHost, entityId: string | null): { readonly rate: number; readonly itemIds: string[] } | null {
  // 读数带着它所属的格，换了格时旧读数自然作废，不必在副作用里清空。
  const [measured, setMeasured] = useState<{ readonly entityId: string; readonly rate: number; readonly itemIds: string[] } | null>(null);
  useEffect(() => {
    const simulation = appHost.workspace.simulation;
    if (entityId === null || simulation === null) {
      return;
    }
    const setFlow = (flow: { readonly rate: number; readonly itemIds: string[] } | null) => {
      setMeasured(flow === null ? null : { entityId, ...flow });
    };
    const samples: { readonly tick: number; readonly amount: number; readonly itemIds: readonly string[] }[] = [];
    let lastTick: number | null = null;
    let lastPublish = 0;
    let frame = 0;
    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      const status = simulation.queries.getDocumentRuntimeStatus();
      if (simulation.state.runningState !== "start" || status === null || status.tickNumber === null || status.standardTickRate <= 0) {
        samples.length = 0;
        lastTick = null;
        setFlow(null);
        return;
      }
      if (status.tickNumber !== lastTick) {
        lastTick = status.tickNumber;
        const transfers = simulation.queries.getCurrentTickItemTransfers().filter((transfer) => transfer.targetDeviceId === entityId);
        samples.push({
          tick: status.tickNumber,
          amount: transfers.reduce((sum, transfer) => sum + transfer.amount, 0),
          itemIds: transfers.map((transfer) => transfer.itemId),
        });
        const oldest = status.tickNumber - FLOW_WINDOW_SECONDS * status.standardTickRate;
        while (samples.length > 0 && samples[0]!.tick < oldest) samples.shift();
      }
      if (now - lastPublish < FLOW_REFRESH_MS) return;
      lastPublish = now;
      const span = (samples.at(-1)!.tick - samples[0]!.tick + 1) / status.standardTickRate;
      // 高倍速时并非每个 tick 都能读到：按读到的 tick 平均，再乘每秒 tick 数。
      setFlow(span < FLOW_MIN_SECONDS ? null : {
        rate: samples.reduce((sum, sample) => sum + sample.amount, 0) / samples.length * status.standardTickRate * 60,
        itemIds: [...new Set(samples.flatMap((sample) => sample.itemIds))],
      });
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [appHost, entityId]);
  return measured !== null && measured.entityId === entityId ? measured : null;
}

function formatRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
