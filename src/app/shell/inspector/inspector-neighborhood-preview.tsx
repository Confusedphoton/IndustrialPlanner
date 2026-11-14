import { useReadonlyCanvas } from "@/app/canvas";
import { selectDocumentContent, sameDocumentContent } from "@/shared/snapshot/world-document-selection";
import { useEditorDocumentSnapshot } from "../hooks";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import {
  resolveInspectorNeighborhoodPreviewModel,
} from "@/app/shell/inspector/inspector-neighborhood-preview-model";
import {
  resolveOutputPortSideLabels,
  resolveSharedOutputGroupRows,
  resolvePortTone,
  type OutputGroupRow,
} from "@/app/shell/inspector/port-output-config-model";
import {
  resolvePortPriorityCalloutRows,
  type PortPriorityGroupPortRow,
} from "@/app/shell/inspector/port-priority-group-model";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { DefaultPortPriority } from "@/domain/registry/types/default-port-priority";
import type { GridEdge } from "@/domain/shared/grid";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";

import { resolveRotatedPortGeometry } from "@/shared/geometry/port";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";


interface InspectorNeighborhoodPreviewHostSize {
  width: number;
  height: number;
}

interface InspectorPortOutputCallout {
  readonly id: string;
  readonly label: string;
  readonly portKind: EntityDefinition["portGroups"][number]["kind"];
  readonly isPipe: boolean;
  readonly targetX: number;
  readonly targetY: number;
  readonly labelX: number;
  readonly labelY: number;
  readonly labelWidth: number;
  readonly markerPoints: readonly {
    readonly x: number;
    readonly y: number;
    readonly portId: string;
  }[];
}

export const InspectorNeighborhoodPreview = observer(function InspectorNeighborhoodPreview({
  appHost,
}: {
  appHost: AppHost;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);


  const [hostSize, setHostSize] = useState<InspectorNeighborhoodPreviewHostSize | null>(null);
  const editor = appHost.workspace.editor;


  const selectedEntityId = editor?.state.collections.selection.length === 1
    ? editor.state.collections.selection[0] ?? null
    : null;
  const documentSnapshot = useEditorDocumentSnapshot(editor, selectDocumentContent, sameDocumentContent);
  const entityDefinitionMap = useMemo(
    () => new Map(appHost.workspace.registry.entityDefinitions.map((definition) => [definition.id, definition])),
    [appHost.workspace.registry.entityDefinitions],
  );
  const previewModel = useMemo(
    () => resolveInspectorNeighborhoodPreviewModel({
      document: documentSnapshot,
      entityDefinitionMap,
      selectedEntityId,
    }),
    [documentSnapshot, entityDefinitionMap, selectedEntityId],
  );

  const defaultPortPriorities = selectedEntityId === null ? null : appHost.portPriorityDefaults.get(selectedEntityId);
  const portOutputCallouts = useMemo(
    () => previewModel === null || hostSize === null
      ? []
      : resolveInspectorPortOutputCallouts({
        bounds: previewModel.bounds,
        document: documentSnapshot,
        entityDefinitionMap,
        height: hostSize.height,
        selectedEntityId,
        defaultPortPriorities,
        width: hostSize.width,
        translate: appHost.actions.translate,
      }),
    [documentSnapshot, entityDefinitionMap, hostSize, previewModel, selectedEntityId, defaultPortPriorities, appHost],
  );

  useLayoutEffect(() => {
    const frame = frameRef.current;

    if (frame === null || previewModel === null) {
      setHostSize(null);
      return;
    }

    const syncHostSize = () => {
      const nextHostSize = resolveInspectorNeighborhoodPreviewHostSize({
        frame,
        bounds: previewModel.bounds,
      });

      setHostSize((currentValue) => {
        if (
          currentValue !== null
          && currentValue.width === nextHostSize.width
          && currentValue.height === nextHostSize.height
        ) {
          return currentValue;
        }

        return nextHostSize;
      });
    };

    syncHostSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      syncHostSize();
    });

    resizeObserver.observe(frame);

    return () => {
      resizeObserver.disconnect();
    };
  }, [previewModel, previewModel?.bounds.height, previewModel?.bounds.width]);





  const fullPreviewDocument = useMemo(() => {
    const document = editor?.document.getSnapshot();
    if (document === undefined || documentSnapshot === null) return null;
    // 包括内置供电设备；可写虚影不进入 Inspector 的只读源。
    const entities = editor!.queries.listEntities().filter((entity) => !("originalEntityId" in entity));
    return { ...document, entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])), entityOrder: entities.map((entity) => entity.id) };
  }, [editor, documentSnapshot]);
  const previewBounds = useMemo(() => previewModel === null ? undefined : ({ x: previewModel.bounds.left,
    y: previewModel.bounds.top, width: previewModel.bounds.width, height: previewModel.bounds.height }), [previewModel]);
  const previewOverlay = useMemo(() => ({ selectedEntityIds: previewModel === null ? [] : [previewModel.highlightedEntityId],
    invalidEntityIds: [], deviceItemIds: {}, links: [] }), [previewModel]);
  const preview = useReadonlyCanvas({ appHost, container: canvasHostRef, document: fullPreviewDocument,
    bounds: previewBounds, overlay: previewOverlay, enabled: previewModel !== null,
    settings: { gameShowDeviceIcons: false } });

  const hostStyle: CSSProperties = hostSize === null
    ? { aspectRatio: previewModel === null ? "1 / 1" : `${previewModel.bounds.width} / ${previewModel.bounds.height}` }
    : { width: `${hostSize.width}px`, height: `${hostSize.height}px` };

  if (previewModel === null) {
    return null;
  }

  return (
    <aside
      aria-label={appHost.actions.translate("rightDock.selection")}
      className={cm(styles, "inspector-neighborhood-preview")}
    >
      {preview.error ? <p role="alert">{preview.error}</p> : null}
      <div className={cm(styles, "inspector-neighborhood-preview-frame")} ref={frameRef}>
        <div
          className={cm(styles, "inspector-neighborhood-preview-canvas")}
          style={hostStyle}
        >
          <div
            className={cm(styles, "inspector-neighborhood-preview-canvas-stage")}
            ref={canvasHostRef}
          />
          {hostSize === null || portOutputCallouts.length === 0 ? null : (
            <svg
              aria-hidden="true"
              className={cm(styles, "inspector-port-callout-overlay")}
              focusable="false"
              viewBox={`0 0 ${hostSize.width} ${hostSize.height}`}
            >
              {portOutputCallouts.map((callout) => (
                <g
                  className={cm(styles, "inspector-port-callout")}
                  data-is-pipe={callout.isPipe ? "true" : "false"}
                  data-port-callout-id={callout.id}
                  key={callout.id}
                >
                  <line
                    className={cm(styles, "inspector-port-callout-leader")}
                    x1={callout.targetX}
                    x2={callout.labelX}
                    y1={callout.targetY}
                    y2={callout.labelY}
                  />
                  {callout.markerPoints.map((marker) => (
                    <circle
                      className={cm(styles, "inspector-port-callout-marker")}
                      cx={marker.x}
                      cy={marker.y}
                      data-port-id={marker.portId}
                      key={marker.portId}
                      r="4"
                    />
                  ))}
                  <g
                    className={cm(styles, "inspector-port-callout-label")}
                    transform={`translate(${callout.labelX - callout.labelWidth / 2} ${callout.labelY - 11})`}
                  >
                    <rect height="22" rx="6" width={callout.labelWidth} x="0" y="0" />
                    <text dominantBaseline="central" textAnchor="middle" x={callout.labelWidth / 2} y="11">
                      {callout.label}
                    </text>
                  </g>
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>
    </aside>
  );
});


export function resolveInspectorPortOutputCallouts(options: {
  readonly defaultPortPriorities?: readonly DefaultPortPriority[] | null;
  readonly bounds: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly document: WorldDocument | null;
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  readonly height: number;
  readonly selectedEntityId: string | null;
  readonly width: number;
  /** 提供时输出端口标注改用方位名（与属性面板一致），否则保留 P# 序号。 */
  readonly translate?: (key: string) => string;
}): InspectorPortOutputCallout[] {
  if (options.document === null || options.selectedEntityId === null) {
    return [];
  }

  const entity = options.document.entities[options.selectedEntityId];
  if (entity === undefined) {
    return [];
  }

  const definition = options.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return [];
  }

  const cellWidth = options.width / options.bounds.width;
  const cellHeight = options.height / options.bounds.height;
  const priorityRows = resolvePortPriorityCalloutRows(definition, entity, options.defaultPortPriorities);

  if (priorityRows.length > 0) {
    const callouts = priorityRows.flatMap((row) => {
      const rowModel = resolveCalloutPortModel({
        definition,
        entity,
        row,
      });

      const target = resolvePreviewPixelPoint({
        bounds: options.bounds,
        cellHeight,
        cellWidth,
        worldX: rowModel.target.x,
        worldY: rowModel.target.y,
      });
      const labelWidth = resolveCalloutLabelWidth(row.portLabel);
      const label = clampCalloutLabelPoint(
        resolvePreviewPixelPoint({
          bounds: options.bounds,
          cellHeight,
          cellWidth,
          worldX: rowModel.label.x,
          worldY: rowModel.label.y,
        }),
        options.width,
        options.height,
        labelWidth,
      );

      return [{
        id: row.portKey,
        edge: rowModel.edge,
        label: row.portLabel,
        portKind: row.portKind,
        isPipe: row.isPipe,
        targetX: target.x,
        targetY: target.y,
        labelX: label.x,
        labelY: label.y,
        labelWidth,
        markerPoints: [{
          portId: row.port.id,
          ...resolvePreviewPixelPoint({
            bounds: options.bounds,
            cellHeight,
            cellWidth,
            worldX: rowModel.markerPoint.x,
            worldY: rowModel.markerPoint.y,
          }),
        }],
      }];
    });
    return spreadPriorityCalloutLabels(callouts, options.width, options.height);
  }

  if (!shouldRenderOutputPortCallouts(definition)) {
    return [];
  }

  const rows = resolveSharedOutputGroupRows(definition, entity);
  const sideLabels = options.translate === undefined
    ? null
    : resolveOutputPortSideLabels({ definition, rows, rotation: entity.rotation, translate: options.translate });

  return rows.flatMap((row) => {
    const portLabel = sideLabels?.get(row.portGroup.id) ?? row.portLabel;
    const rowModel = resolveCalloutRowModel({
      definition,
      entity,
      row,
    });

    if (rowModel === null) {
      return [];
    }

    const target = resolvePreviewPixelPoint({
      bounds: options.bounds,
      cellHeight,
      cellWidth,
      worldX: rowModel.target.x,
      worldY: rowModel.target.y,
    });
    const labelWidth = resolveCalloutLabelWidth(portLabel);
    const label = clampCalloutLabelPoint(
      resolvePreviewPixelPoint({
        bounds: options.bounds,
        cellHeight,
        cellWidth,
        worldX: rowModel.label.x,
        worldY: rowModel.label.y,
      }),
      options.width,
      options.height,
      labelWidth,
    );

    return [{
      id: row.portGroup.id,
      label: portLabel,
      portKind: resolvePortTone(row.portGroup),
      isPipe: row.portGroup.isPipe,
      targetX: target.x,
      targetY: target.y,
      labelX: label.x,
      labelY: label.y,
      labelWidth,
      markerPoints: rowModel.markerPoints.map((marker) => ({
        portId: marker.portId,
        ...resolvePreviewPixelPoint({
          bounds: options.bounds,
          cellHeight,
          cellWidth,
          worldX: marker.x,
          worldY: marker.y,
        }),
      })),
    }];
  });
}

function resolveCalloutPortModel(options: {
  readonly definition: EntityDefinition;
  readonly entity: WorldEntity;
  readonly row: PortPriorityGroupPortRow;
}): {
  readonly edge: GridEdge;
  readonly target: { readonly x: number; readonly y: number };
  readonly label: { readonly x: number; readonly y: number };
  readonly markerPoint: { readonly x: number; readonly y: number };
} {
  const geometry = resolveRotatedPortGeometry({
    footprint: options.definition.footprint,
    port: options.row.port,
    rotation: options.entity.rotation,
  });
  const markerPoint = {
    x: options.entity.position.x + geometry.anchor.x,
    y: options.entity.position.y + geometry.anchor.y,
  };

  return {
    edge: geometry.edge,
    target: markerPoint,
    label: {
      x: markerPoint.x + geometry.delta.x * 1.35,
      y: markerPoint.y + geometry.delta.y * 1.35,
    },
    markerPoint,
  };
}

/** 同一边缘的逐端口标签沿边排开，连线仍指向各自的真实端口。 */
function spreadPriorityCalloutLabels(
  callouts: readonly (InspectorPortOutputCallout & { readonly edge: GridEdge })[],
  width: number,
  height: number,
): InspectorPortOutputCallout[] {
  const positions = new Map<string, { readonly labelX: number; readonly labelY: number }>();
  for (const edge of ["NORTH", "SOUTH", "EAST", "WEST"] as const) {
    const horizontal = edge === "NORTH" || edge === "SOUTH";
    const entries = callouts.filter((callout) => callout.edge === edge)
      .sort((left, right) => horizontal ? left.targetX - right.targetX : left.targetY - right.targetY);
    if (entries.length < 2) continue;
    const extent = (entry: InspectorPortOutputCallout) => horizontal ? entry.labelWidth : 22;
    const available = horizontal ? width : height;
    const labelSpan = entries.reduce((sum, entry) => sum + extent(entry), 0);
    const gap = Math.min(4, Math.max(0, (available - 4 - labelSpan) / (entries.length - 1)));
    const span = labelSpan + (entries.length - 1) * gap;
    if (span > available - 4) continue;
    const center = average(entries.map((entry) => horizontal ? entry.labelX : entry.labelY));
    let offset = clamp(center - span / 2, 2, available - span - 2);
    for (const entry of entries) {
      const position = offset + extent(entry) / 2;
      positions.set(entry.id, {
        labelX: horizontal ? position : entry.labelX,
        labelY: horizontal ? entry.labelY : position,
      });
      offset += extent(entry) + gap;
    }
  }
  return callouts.map((callout) => ({ ...callout, ...positions.get(callout.id) }));
}

function shouldRenderOutputPortCallouts(definition: EntityDefinition): boolean {
  return definition.inspectors.some(
    (inspector) =>
      inspector.type === INSPECTOR_TYPE.portOutputConfig
      || inspector.type === INSPECTOR_TYPE.warehouseItemLink,
  );
}

function resolveCalloutRowModel(options: {
  readonly definition: EntityDefinition;
  readonly entity: WorldEntity;
  readonly row: OutputGroupRow;
}): {
  readonly target: { readonly x: number; readonly y: number };
  readonly label: { readonly x: number; readonly y: number };
  readonly markerPoints: readonly { readonly portId: string; readonly x: number; readonly y: number }[];
} | null {
  const geometries = options.row.portGroup.ports.map((port) => {
    const geometry = resolveRotatedPortGeometry({
      footprint: options.definition.footprint,
      port,
      rotation: options.entity.rotation,
    });

    return {
      portId: port.id,
      delta: geometry.delta,
      x: options.entity.position.x + geometry.anchor.x,
      y: options.entity.position.y + geometry.anchor.y,
    };
  });

  if (geometries.length === 0) {
    return null;
  }

  const target = {
    x: average(geometries.map((geometry) => geometry.x)),
    y: average(geometries.map((geometry) => geometry.y)),
  };
  const firstDelta = geometries[0]?.delta ?? { x: 0, y: -1 };

  return {
    target,
    label: {
      x: target.x + firstDelta.x * 1.35,
      y: target.y + firstDelta.y * 1.35,
    },
    markerPoints: geometries.map((geometry) => ({
      portId: geometry.portId,
      x: geometry.x,
      y: geometry.y,
    })),
  };
}

function resolvePreviewPixelPoint(options: {
  readonly bounds: {
    readonly left: number;
    readonly top: number;
  };
  readonly cellHeight: number;
  readonly cellWidth: number;
  readonly worldX: number;
  readonly worldY: number;
}): { readonly x: number; readonly y: number } {
  return {
    x: (options.worldX - options.bounds.left) * options.cellWidth,
    y: (options.worldY - options.bounds.top) * options.cellHeight,
  };
}

function clampCalloutLabelPoint(
  point: { readonly x: number; readonly y: number },
  width: number,
  height: number,
  labelWidth: number,
): { readonly x: number; readonly y: number } {
  const halfLabelWidth = labelWidth / 2;

  return {
    x: clamp(point.x, halfLabelWidth + 4, width - halfLabelWidth - 4),
    y: clamp(point.y, 15, height - 15),
  };
}

function resolveCalloutLabelWidth(label: string): number {
  return Math.max(36, label.length * 7 + 14);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveInspectorNeighborhoodPreviewHostSize(options: {
  frame: HTMLDivElement;
  bounds: {
    width: number;
    height: number;
  };
}): InspectorNeighborhoodPreviewHostSize {
  const frameStyle = window.getComputedStyle(options.frame);
  const availableWidth = Math.max(
    1,
    Math.floor(
      options.frame.clientWidth
      - parseFloat(frameStyle.paddingLeft)
      - parseFloat(frameStyle.paddingRight),
    ),
  );
  const availableHeight = Math.max(
    1,
    Math.floor(
      options.frame.clientHeight
      - parseFloat(frameStyle.paddingTop)
      - parseFloat(frameStyle.paddingBottom),
    ),
  );

  return resolveAspectFitHostSize({
    availableWidth,
    availableHeight,
    aspectRatio: options.bounds.width / Math.max(1, options.bounds.height),
  });
}

function resolveAspectFitHostSize(options: {
  availableWidth: number;
  availableHeight: number;
  aspectRatio: number;
}): InspectorNeighborhoodPreviewHostSize {
  const normalizedAspectRatio = Number.isFinite(options.aspectRatio) && options.aspectRatio > 0
    ? options.aspectRatio
    : 1;
  const heightFromWidth = options.availableWidth / normalizedAspectRatio;

  if (heightFromWidth <= options.availableHeight) {
    return {
      width: options.availableWidth,
      height: Math.max(1, Math.floor(heightFromWidth)),
    };
  }

  return {
    width: Math.max(1, Math.floor(options.availableHeight * normalizedAspectRatio)),
    height: options.availableHeight,
  };
}
