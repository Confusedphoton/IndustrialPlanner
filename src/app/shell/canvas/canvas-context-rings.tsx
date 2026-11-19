import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState, type ReactNode } from "react";
import LucideArrowUp from "~icons/lucide/arrow-up";
import LucideBookmarkPlus from "~icons/lucide/bookmark-plus";
import LucideCopy from "~icons/lucide/copy";
import LucideEllipsis from "~icons/lucide/ellipsis";
import LucideMove from "~icons/lucide/move";
import LucideRotateCw from "~icons/lucide/rotate-cw";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideX from "~icons/lucide/x";

import { resolveIncomingFlowItems } from "@/app/canvas/flow-items";
import { canSaveSelectionAsBlueprint } from "@/app/blueprint/save-blueprint";
import { RAIL_SELECTION_COPY_BUTTON_ID } from "@/app/input/gesture/actions/rail-buttons";
import type { AppHost } from "@/app/host/app-host";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { EntityDefinition, PortDefinition, PortGroupDefinition } from "@/domain/registry/types/entity-definition";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { ClientPixelPoint, ClientPixelRect } from "@/domain/shared/client-pixel";
import { resolveRotatedPortGeometry, rotateGridEdge } from "@/shared/geometry/port";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import { readAdmissionRule } from "@/shared/registry/admission-rule";
import { matchesItemAcceptRule } from "@/shared/registry/item-accept-rule";
import { configuredDeviceItemIds, outputPortItemIds } from "@/shared/device-item-labels";
import styles from "@/app/shell/app-shell.module.scss";
import { useEditorDocumentSnapshot } from "../hooks";
import { cm } from "../shared/css-module-class";

const identity = (document: WorldDocument) => document;
const PORT_ANGLES = { NORTH: -90, EAST: 0, SOUTH: 90, WEST: 180 } as const;
const PORT_LABELS = {
  NORTH: "canvasGesture.north", EAST: "canvasGesture.east", SOUTH: "canvasGesture.south", WEST: "canvasGesture.west",
} as const;

interface RingButton {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly angle?: number;
  choose(): void;
}

export const CanvasContextRings = observer(function CanvasContextRings({ appHost }: { appHost: AppHost }) {
  const canvas = appHost.mainCanvas;
  const editor = canvas.editor;
  const selection = editor?.state.collections.selection;
  const document = useEditorDocumentSnapshot(editor, identity);
  const lasso = canvas.lassoPath.get();
  const lassoAt = canvas.lassoActionsAt.get();
  const orbitAt = canvas.placementOrbitAt.get();
  const bounds = canvas.unobstructedClientRect;
  const t = appHost.actions.translate;
  const entity = selection?.length === 1 && document !== null ? document.entities[selection[0]!] ?? null : null;
  const definition = entity === null ? null : canvas.registry.queries.findEntityDefinition(entity.definitionId);
  const actions = [
    canvas.isOperationEnabled("move") && { key: "move", label: t("historyLabel.moveDevice"), icon: <LucideMove />, id: "canvas-floating-toolbar-button-move" },
    canvas.isOperationEnabled("rotate-placement") && { key: "rotate", label: t("action.rotateSelection"), icon: <LucideRotateCw />, id: "canvas-floating-toolbar-button-rotate" },
    canvas.isOperationEnabled("save-blueprint") && canSaveSelectionAsBlueprint(appHost.workspace)
      && { key: "save", label: t("action.saveBlueprint"), icon: <LucideBookmarkPlus />, id: "canvas-floating-toolbar-button-save-blueprint" },
    canvas.isOperationEnabled("blueprint-placement") && canvas.canUseWorkbenchActions
      && { key: "copy", label: t("action.copySelection"), icon: <LucideCopy />, id: RAIL_SELECTION_COPY_BUTTON_ID },
    canvas.isOperationEnabled("delete") && { key: "delete", label: t("action.deleteSelection"), icon: <LucideTrash2 />, id: "canvas-floating-toolbar-button-delete" },
  ];
  const select = canvas.state.activeTool === "select";
  const showLassoRing = select && lassoAt !== null && (selection?.length ?? 0) > 0;
  const buttons = showLassoRing ? actions.flatMap((entry) => entry === false ? [] : [{
    ...entry,
    choose() {
      canvas.setLassoActionsAt(null);
      appHost.gestureAdapter.handleUiButtonTouchTap({ uiButtonId: entry.id, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false });
    },
  }]) : [];

  return (
    <>
      {lasso === null ? null : (
        <svg aria-hidden="true" className={cm(styles, "canvas-lasso-ink")}>
          <polygon points={lasso.map((point) => `${point.x},${point.y}`).join(" ")} />
        </svg>
      )}
      {orbitAt === null ? null : (
        <div aria-hidden="true" className={cm(styles, "canvas-placement-orbit")} style={{ left: orbitAt.x, top: orbitAt.y }}>
          <span /><span /><span /><span />
        </div>
      )}
      {lassoAt !== null && buttons.length > 0 ? <ContextRing at={lassoAt} bounds={bounds} buttons={buttons} label={t("canvasGesture.selection")} /> : null}
      {select && lasso === null && !showLassoRing && entity !== null && editor !== null && definition !== null
        && canvas.isOperationEnabled("configure-device") && canvas.state.runtime.markingMenu === null
        ? <DeviceItemRing key={`${document?.documentKey}:${entity.id}:${definition.id}`} appHost={appHost} editor={editor}
          entity={entity} definition={definition} bounds={bounds} /> : null}
    </>
  );
});

interface FilterPort {
  readonly port: PortDefinition;
  readonly group: PortGroupDefinition;
  readonly groupIndex: number;
  readonly portIndex: number;
  readonly admission: boolean;
  readonly wholeGroup: boolean;
}

const DeviceItemRing = observer(function DeviceItemRing({ appHost, editor, entity, definition, bounds }: {
  appHost: AppHost; editor: EditorContract; entity: WorldEntity; definition: EntityDefinition; bounds: ClientPixelRect;
}) {
  const [selected, selectPort] = useState<string | null>(null);
  const [seen, setSeen] = useState<readonly string[]>([]);
  const canvas = appHost.mainCanvas;
  const view = canvas.view.state;
  const registry = canvas.registry;
  const role = registry.queries.resolveLogisticsRole(entity.definitionId);
  const t = appHost.actions.translate;
  const simulation = appHost.workspace.simulation;

  const running = simulation?.state.runningState === "start";
  useEffect(() => {
    if (simulation === null || selected === null || !running) return;
    const timer = window.setInterval(() => {
      const transfers = simulation.queries.getCurrentTickItemTransfers();
      const items = transfers.filter((transfer) => transfer.targetDeviceId === entity.id).map((transfer) => transfer.itemId);
      if (items.length > 0) setSeen((previous) => {
        const next = [...new Set([...previous, ...items])];
        return next.length === previous.length ? previous : next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [entity.id, running, selected, simulation]);

  const ports = definition.portGroups.flatMap((group, groupIndex): FilterPort[] => {
    const admission = role === "admission" && group.direction === "input";
    const wholeGroup = definition.inspectors.some((entry) => entry.type === "port-output-config" && entry.portGroupIds.includes(group.id));
    if (!admission && !wholeGroup && (role !== "splitter" || group.direction !== "output")) return [];
    return (wholeGroup ? group.ports.slice(0, 1) : group.ports).map((port, portIndex) => ({ port, group, groupIndex, portIndex, admission, wholeGroup }));
  });
  const current = ports.find(({ group, port }) => selected === `${group.id}:${port.id}`);
  if (ports.length === 0) return null;
  const position = resolveViewportPointFromWorldPoint({
    worldPoint: { x: entity.position.x + 0.5, y: entity.position.y + 0.5 },
    viewportBounds: view.clientRect, viewportCenter: view.center, gridCellPixelSize: view.gridCellPixelSize, displayRotation: view.displayRotation,
  });
  if (position.x < bounds.left || position.y < bounds.top
    || position.x > bounds.left + bounds.width || position.y > bounds.top + bounds.height) return null;

  if (current === undefined) {
    const buttons = ports.map(({ group, port }, index): RingButton => {
      const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
      const edge = rotateGridEdge(geometry.edge, view.displayRotation);
      const key = `${group.id}:${port.id}`;
      const angle = PORT_ANGLES[edge];
      return {
        key, label: `${t(PORT_LABELS[edge])} · ${t("canvasGesture.itemFilter")}`,
        icon: <LucideArrowUp style={{ transform: `rotate(${angle + 90}deg)` }} />,
        angle: role === "splitter" ? angle : ports.length === 1 ? angle : -90 + 360 * index / ports.length,
        choose: () => selectPort(key),
      };
    });
    return <ContextRing at={position} bounds={bounds} buttons={buttons} label={t("canvasGesture.itemFilter")} />;
  }

  const { group, groupIndex, port, portIndex, wholeGroup, admission } = current;
  const acceptPaths = (wholeGroup ? group.ports.map((_, index) => index) : [portIndex])
    .map((index) => `portGroups[${groupIndex}].ports[${index}].acceptRule`);
  const admissionPath = `portGroups[${groupIndex}].ports[${portIndex}].admissionRule`;
  const rule = readAdmissionRule(entity.config[admissionPath]);
  const configured = (entity.config[acceptPaths[0]!] as { base?: { itemId?: string } } | undefined)?.base?.itemId;
  const accepts = (id: string) => wholeGroup
    ? group.ports.every((entry) => matchesItemAcceptRule(id, entry.acceptRule, registry.queries.resolveItemDomain))
    : matchesItemAcceptRule(id, port.acceptRule, registry.queries.resolveItemDomain);
  const setItem = (itemId: string) => {
    const latest = editor.document.getSnapshot();
    if (latest.entities[entity.id]?.definitionId !== definition.id) return;
    const patch: Record<string, unknown> = Object.fromEntries(acceptPaths.map((path) => [path, { base: { kind: "item", itemId }, exclude: [] }]));
    if (admission) patch[admissionPath] = { itemId, limit: rule?.limit ?? null, perMinuteLimit: rule?.perMinuteLimit ?? null };
    editor.actions.patchEntityConfig(entity.id, patch);
    selectPort(null);
  };
  const incoming = wholeGroup ? [
    ...outputPortItemIds(definition, entity, group.id, registry),
    ...configuredDeviceItemIds(definition, entity.id, editor.document.getSnapshot(), registry),
  ] : resolveIncomingFlowItems(editor, registry, entity);
  const items = [...new Set([...(configured === undefined ? [] : [configured]), ...seen, ...incoming])]
    .filter(accepts).flatMap((id) => registry.queries.findItemDefinition(id) ?? []);
  const buttons: RingButton[] = items.slice(0, 6).map((item) => ({
    key: item.id,
    label: t(item.nameKey),
    icon: <img alt="" src={createItemIconAssetUrl(item.iconId)} />,
    active: item.id === configured,
    choose: () => setItem(item.id),
  }));
  if (configured !== undefined || rule?.itemId != null) buttons.push({
    key: "clear", label: t("canvasGesture.clearFilter"), icon: <LucideTrash2 />,
    choose: () => {
      editor.actions.deleteEntityConfigKeys(entity.id, admission ? [...acceptPaths, admissionPath] : acceptPaths);
      selectPort(null);
    },
  });
  buttons.push({
    key: "browse", label: t("encyclopediaPicker.title.item"), icon: <LucideEllipsis />,
    async choose() {
      const before = editor.document.getSnapshot();
      const itemId = await appHost.encyclopediaPicker.pickItem({ title: t("encyclopediaPicker.title.item"), filterItem: (item) => accepts(item.id) });
      if (itemId !== null && editor.document.getSnapshot().documentKey === before.documentKey
        && editor.document.getSnapshot().entities[entity.id] === before.entities[entity.id]) setItem(itemId);
    },
  });
  return <ContextRing at={position} bounds={bounds} buttons={buttons} label={t("canvasGesture.itemFilter")} close={() => selectPort(null)} closeLabel={t("action.cancel")} />;
});

function ContextRing({ at, bounds, buttons, label, close, closeLabel }: {
  at: ClientPixelPoint; bounds: ClientPixelRect; buttons: readonly RingButton[]; label: string;
  close?: () => void; closeLabel?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (close === undefined) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [close]);
  const radius = buttons.length > 6 ? 64 : 50;
  const padding = radius + 21;
  const x = Math.max(bounds.left + padding, Math.min(at.x, bounds.left + bounds.width - padding));
  const y = Math.max(bounds.top + padding, Math.min(at.y, bounds.top + bounds.height - padding));
  return (
    <div ref={root} aria-label={label} className={cm(styles, "canvas-context-ring")} role="group"
      onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === "Escape" && close !== undefined) {
          event.stopPropagation();
          close();
        }
      }}>
      {close === undefined ? <span aria-hidden="true" className={cm(styles, "canvas-context-origin")} style={{ left: x, top: y }} />
        : <button aria-label={closeLabel} className={cm(styles, "canvas-context-center")} style={{ left: x, top: y }} onClick={close} type="button"><LucideX /></button>}
      {buttons.map((button, index) => {
        const angle = (button.angle ?? (-90 + index * 360 / buttons.length)) * Math.PI / 180;
        return <button key={button.key} aria-label={button.label} aria-pressed={button.active} title={button.label}
          style={{ left: x + Math.cos(angle) * radius, top: y + Math.sin(angle) * radius }}
          onClick={button.choose} type="button">{button.icon}</button>;
      })}
    </div>
  );
}
