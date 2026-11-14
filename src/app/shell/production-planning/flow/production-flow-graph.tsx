import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LucideArrowDownUp from "~icons/lucide/arrow-down-up";
import LucideArrowRightLeft from "~icons/lucide/arrow-right-left";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideScan from "~icons/lucide/scan";
import LucideZoomIn from "~icons/lucide/zoom-in";
import LucideZoomOut from "~icons/lucide/zoom-out";
import { resolveWheelZoomDirection } from "@/shared/browser/wheel-zoom";

import type { ProductionPlanningDisplayMode, ProductionPlanningIndex, ProductionPlanningResult } from "../production-planning-model";
import { CompositeItemIcon } from "@/app/shell/shared";
import { buildProductionFlowGraph, type ProductionFlowGraphInput, type ProductionFlowLink, type ProductionFlowNode } from "./flow-graph-builder";
import { createSankeyLayout, updateSankeyLinkBreadths, type SankeyGraph, type SankeyLink, type SankeyNode } from "./sankey-layout";
import styles from "../production-planning-panel.module.scss";

export type ProductionFlowOrientation = "horizontal" | "vertical";
type OrientationPreference = "auto" | ProductionFlowOrientation;

interface ProductionFlowGraphProps {
  readonly displayMode: ProductionPlanningDisplayMode;
  readonly initialViewport?: ViewportState;
  readonly invertWheelZoom?: boolean;
  readonly plan?: ProductionPlanningResult;
  readonly index?: ProductionPlanningIndex;
  readonly input?: ProductionFlowGraphInput;
  readonly fitToView?: boolean;
  /**
   * "move"：拖动卡片可重新摆放（超过阈值才开始移动）；
   * "pan"：拖动任意位置都平移视图，卡片只响应点按，适合浏览参考图。
   */
  readonly nodeDrag?: "move" | "pan";
  readonly onViewportChange?: (viewport: ViewportState) => void;
  /** 节点被点按（未拖动）时回调，用于弹出节点快捷操作；锚点为节点卡片的屏幕矩形。 */
  readonly onNodeActivate?: (node: ProductionFlowNode, anchor: DOMRect) => void;
  readonly t: (key: string) => string;
}

interface ViewportState {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

type ViewportUpdate = ViewportState | ((current: ViewportState) => ViewportState);

interface NodePressState {
  readonly pointerId: number;
  readonly nodeId: string;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startX0: number;
  readonly startX1: number;
  readonly startY0: number;
  readonly startY1: number;
  moving: boolean;
}

interface PanDragState {
  readonly pointerId: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly startClientX: number;
  readonly startClientY: number;
  clientX: number;
  clientY: number;
  /** 从卡片上开始的平移；抬笔时若未移动则视为点按该卡片。 */
  readonly pressedNodeId: string | null;
}

interface PinchState {
  readonly startDistance: number;
  readonly startScale: number;
  readonly startViewportX: number;
  readonly startViewportY: number;
  readonly startMidX: number;
  readonly startMidY: number;
  secondPointerId: number;
  secondClientX: number;
  secondClientY: number;
}

/** 卡片尺寸：layer 为沿流向的厚度，cross 为垂直于流向的宽度。 */
interface CardMetrics {
  readonly layer: number;
  readonly cross: number;
  readonly layerGap: number;
  readonly crossGap: number;
}

interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const CARD_METRICS: Record<ProductionFlowOrientation, CardMetrics> = {
  horizontal: { layer: 200, cross: 72, layerGap: 96, crossGap: 20 },
  vertical: { layer: 72, cross: 176, layerGap: 76, crossGap: 16 },
};
const SURFACE_PADDING = 24;
const MIN_SCALE = 0.15;
const MAX_SCALE = 3.0;
/** 低于该缩放时文字难以辨认；适配视图改为只适配交叉轴，沿流向平移查看。 */
const MIN_READABLE_FIT_SCALE = 0.75;
const TAP_SLOP_PX = 6;
const ORIENTATION_HYSTERESIS = 1.15;
const TOOLBAR_CLEARANCE = 52;

export function ProductionFlowGraph({
  displayMode,
  initialViewport,
  invertWheelZoom = false,
  plan,
  index,
  input,
  fitToView = false,
  nodeDrag = "move",
  onViewportChange,
  onNodeActivate,
  t,
}: ProductionFlowGraphProps) {
  const graphInput = useMemo(() => input ?? (plan && index ? buildProductionFlowGraph(plan, index, t, displayMode)
    : { nodes: [], links: [] }), [displayMode, index, input, plan, t]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [orientationPreference, setOrientationPreference] = useState<OrientationPreference>("auto");
  const [autoOrientation, setAutoOrientation] = useState<ProductionFlowOrientation>("horizontal");
  const orientation = orientationPreference === "auto" ? autoOrientation : orientationPreference;
  const metrics = CARD_METRICS[orientation];

  const initialLayout = useMemo(() => createOrientedLayout(graphInput, metrics), [graphInput, metrics]);
  const [graph, setGraph] = useState(() => cloneSankeyGraph(initialLayout));
  const [viewport, setRawViewport] = useState<ViewportState>(() => normalizeViewportState(initialViewport));
  const viewportRef = useRef(viewport);

  const setViewport = useCallback((update: ViewportUpdate) => {
    setRawViewport((current) => {
      const nextViewport = normalizeViewportState(
        typeof update === "function" ? update(current) : update,
      );
      onViewportChange?.(nextViewport);
      return nextViewport;
    });
  }, [onViewportChange]);

  const fit = useCallback(() => {
    const element = canvasRef.current;
    if (element === null || initialLayout.nodes.length === 0) return;
    const rects = initialLayout.nodes.map((node) => resolveCardRect(node, orientation, metrics));
    const sinkRects = initialLayout.nodes
      .filter((node) => !node.sourceLinks.some((link) => link.direction === "forward"))
      .map((node) => resolveCardRect(node, orientation, metrics));
    const bounds = unionRects(rects);
    const sinkBounds = unionRects(sinkRects.length > 0 ? sinkRects : rects);
    const margin = 16;
    const availableWidth = Math.max(1, element.clientWidth - margin * 2);
    const availableHeight = Math.max(1, element.clientHeight - TOOLBAR_CLEARANCE - margin);
    const fullScale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    const crossScale = orientation === "vertical" ? availableWidth / bounds.width : availableHeight / bounds.height;
    const scale = clamp(
      Math.min(1, fullScale >= MIN_READABLE_FIT_SCALE ? fullScale : Math.max(MIN_READABLE_FIT_SCALE, crossScale)),
      MIN_SCALE,
      MAX_SCALE,
    );
    const centerX = (availableWidth - bounds.width * scale) / 2 + margin - bounds.left * scale;
    const centerY = (availableHeight - bounds.height * scale) / 2 + TOOLBAR_CLEARANCE - bounds.top * scale;
    const overflowsX = bounds.width * scale > availableWidth;
    const overflowsY = bounds.height * scale > availableHeight;
    // 溢出时让最终产物保持可见：沿流向贴住产物一端，交叉轴以产物为中心。
    const sinkCenterX = margin + availableWidth / 2 - (sinkBounds.left + sinkBounds.width / 2) * scale;
    const sinkCenterY = TOOLBAR_CLEARANCE + availableHeight / 2 - (sinkBounds.top + sinkBounds.height / 2) * scale;
    const anchoredX = orientation === "horizontal"
      ? margin + availableWidth - (sinkBounds.left + sinkBounds.width) * scale
      : sinkCenterX;
    const anchoredY = orientation === "vertical"
      ? TOOLBAR_CLEARANCE + availableHeight - (sinkBounds.top + sinkBounds.height) * scale
      : sinkCenterY;
    setViewport({
      x: overflowsX ? clampPan(anchoredX, availableWidth, bounds.left, bounds.width, scale, margin) : centerX,
      y: overflowsY ? clampPan(anchoredY, availableHeight, bounds.top, bounds.height, scale, TOOLBAR_CLEARANCE) : centerY,
      scale,
    });
  }, [initialLayout, metrics, orientation, setViewport]);

  useEffect(() => {
    const element = canvasRef.current;
    if (element === null) return;
    const resolveAutoOrientation = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width === 0 || height === 0) return;
      setAutoOrientation((current) => {
        if (height > width * ORIENTATION_HYSTERESIS) return "vertical";
        if (width > height * ORIENTATION_HYSTERESIS) return "horizontal";
        return current;
      });
    };
    const observer = new ResizeObserver(() => {
      resolveAutoOrientation();
      if (fitToView) fit();
    });
    observer.observe(element);
    resolveAutoOrientation();
    return () => observer.disconnect();
  }, [fit, fitToView]);

  useEffect(() => {
    if (fitToView) fit();
  }, [fit, fitToView]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const interactionRef = useRef<{
    node: NodePressState | null;
    pan: PanDragState | null;
    pinch: PinchState | null;
  }>({
    node: null,
    pan: null,
    pinch: null,
  });

  useEffect(() => {
    setGraph(cloneSankeyGraph(initialLayout));
  }, [initialLayout]);

  const resetNodeLayout = useCallback(() => {
    setGraph(cloneSankeyGraph(initialLayout));
    fit();
  }, [fit, initialLayout]);

  const zoomAroundCenter = useCallback((factor: number) => {
    const element = canvasRef.current;
    const centerX = (element?.clientWidth ?? 0) / 2;
    const centerY = (element?.clientHeight ?? 0) / 2;
    setViewport((current) => {
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = nextScale / current.scale;
      return {
        x: centerX - ratio * (centerX - current.x),
        y: centerY - ratio * (centerY - current.y),
        scale: nextScale,
      };
    });
  }, [setViewport]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;

    setViewport((current) => {
      const direction = resolveWheelZoomDirection(event.deltaY, invertWheelZoom);
      if (direction === 0) return current;
      const magnitude = Math.min(Math.abs(event.deltaMode === 0 ? event.deltaY : event.deltaY * 40), 120);
      const nextScale = clamp(current.scale * Math.exp(direction * magnitude * 0.0015), MIN_SCALE, MAX_SCALE);
      const ratio = nextScale / current.scale;
      return {
        x: cursorX - ratio * (cursorX - current.x),
        y: cursorY - ratio * (cursorY - current.y),
        scale: nextScale,
      };
    });
  }, [invertWheelZoom, setViewport]);

  const startPanOrPinch = useCallback((event: React.PointerEvent<HTMLDivElement>, pressedNodeId: string | null) => {
    const interaction = interactionRef.current;

    if (interaction.pan !== null && interaction.pan.pointerId !== event.pointerId) {
      const p0 = interaction.pan;
      const rect = canvasRef.current?.getBoundingClientRect();
      const dx = event.clientX - p0.clientX;
      const dy = event.clientY - p0.clientY;
      interaction.pinch = {
        startDistance: Math.hypot(dx, dy),
        startScale: viewportRef.current.scale,
        startViewportX: viewportRef.current.x,
        startViewportY: viewportRef.current.y,
        startMidX: (event.clientX + p0.clientX) / 2 - (rect?.left ?? 0),
        startMidY: (event.clientY + p0.clientY) / 2 - (rect?.top ?? 0),
        secondPointerId: event.pointerId,
        secondClientX: event.clientX,
        secondClientY: event.clientY,
      };
      return;
    }

    canvasRef.current?.setPointerCapture(event.pointerId);
    interaction.node = null;
    interaction.pinch = null;
    interaction.pan = {
      pointerId: event.pointerId,
      viewportX: viewportRef.current.x,
      viewportY: viewportRef.current.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      pressedNodeId,
    };
  }, []);

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest(`.${styles["production-flow-toolbar"]}`) !== null) {
      return;
    }
    startPanOrPinch(event, null);
  }, [startPanOrPinch]);

  const handleNodePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, node: SankeyNode<ProductionFlowNode>) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();

    const interaction = interactionRef.current;
    if (nodeDrag === "pan" || interaction.pan !== null) {
      startPanOrPinch(event, node.id);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.pan = null;
    interaction.pinch = null;
    interaction.node = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX0: node.x0,
      startX1: node.x1,
      startY0: node.y0,
      startY1: node.y1,
      moving: false,
    };
  }, [nodeDrag, startPanOrPinch]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;

    if (interaction.pinch !== null && interaction.pan !== null) {
      const p0 = interaction.pan;
      const pinch = interaction.pinch;
      if (event.pointerId === p0.pointerId) {
        p0.clientX = event.clientX;
        p0.clientY = event.clientY;
      } else if (event.pointerId === pinch.secondPointerId) {
        pinch.secondClientX = event.clientX;
        pinch.secondClientY = event.clientY;
      }

      const currentDistance = Math.hypot(pinch.secondClientX - p0.clientX, pinch.secondClientY - p0.clientY);
      if (pinch.startDistance >= 1) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const midX = (pinch.secondClientX + p0.clientX) / 2 - (rect?.left ?? 0);
        const midY = (pinch.secondClientY + p0.clientY) / 2 - (rect?.top ?? 0);
        const nextScale = clamp(pinch.startScale * currentDistance / pinch.startDistance, MIN_SCALE, MAX_SCALE);
        const ratio = nextScale / pinch.startScale;
        setViewport({
          x: midX - ratio * (pinch.startMidX - pinch.startViewportX),
          y: midY - ratio * (pinch.startMidY - pinch.startViewportY),
          scale: nextScale,
        });
      }
      return;
    }

    if (interaction.pan !== null && interaction.pan.pointerId === event.pointerId) {
      const pan = interaction.pan;
      pan.clientX = event.clientX;
      pan.clientY = event.clientY;
      setViewport({
        x: pan.viewportX + event.clientX - pan.startClientX,
        y: pan.viewportY + event.clientY - pan.startClientY,
        scale: viewportRef.current.scale,
      });
      return;
    }

    const press = interaction.node;
    if (press !== null && press.pointerId === event.pointerId) {
      const screenDx = event.clientX - press.startClientX;
      const screenDy = event.clientY - press.startClientY;
      if (!press.moving && Math.hypot(screenDx, screenDy) < TAP_SLOP_PX) {
        return;
      }
      press.moving = true;
      const scale = viewportRef.current.scale;
      const layerDelta = (orientation === "horizontal" ? screenDx : screenDy) / scale;
      const crossDelta = (orientation === "horizontal" ? screenDy : screenDx) / scale;
      setGraph((current) => {
        const next: SankeyGraph<ProductionFlowNode, ProductionFlowLink> = {
          nodes: current.nodes.map((node) => {
            if (node.id !== press.nodeId) {
              return node;
            }
            node.x0 = press.startX0 + layerDelta;
            node.x1 = press.startX1 + layerDelta;
            node.y0 = press.startY0 + crossDelta;
            node.y1 = press.startY1 + crossDelta;
            return node;
          }),
          links: current.links,
        };
        return updateSankeyLinkBreadths(next);
      });
    }
  }, [orientation, setViewport]);

  const activateNode = useCallback((nodeId: string) => {
    if (onNodeActivate === undefined) return;
    const element = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>("[data-flow-node-id]") ?? [])
      .find((candidate) => candidate.dataset.flowNodeId === nodeId);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (element !== null && element !== undefined && node !== undefined) {
      onNodeActivate(node.source, element.getBoundingClientRect());
    }
  }, [graph.nodes, onNodeActivate]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;

    if (interaction.pan?.pointerId === event.pointerId) {
      const pan = interaction.pan;
      const wasPinching = interaction.pinch !== null;
      interaction.pan = null;
      interaction.pinch = null;
      if (
        !wasPinching
        && event.type === "pointerup"
        && pan.pressedNodeId !== null
        && Math.hypot(event.clientX - pan.startClientX, event.clientY - pan.startClientY) < TAP_SLOP_PX
      ) {
        activateNode(pan.pressedNodeId);
      }
      return;
    }

    if (interaction.pinch?.secondPointerId === event.pointerId) {
      interaction.pinch = null;
      return;
    }

    const press = interaction.node;
    if (press?.pointerId === event.pointerId) {
      interaction.node = null;
      if (!press.moving && event.type === "pointerup") {
        activateNode(press.nodeId);
      }
    }
  }, [activateNode]);

  if (graphInput.nodes.length === 0) {
    return <div className={styles["production-planning-empty"]}>{t("productionPlanning.noRecipes")}</div>;
  }

  const bounds = unionRects(graph.nodes.map((node) => resolveCardRect(node, orientation, metrics)));
  const surfaceWidth = Math.max(960, bounds.left + bounds.width + SURFACE_PADDING * 2);
  const surfaceHeight = Math.max(520, bounds.top + bounds.height + SURFACE_PADDING * 2);
  const labelPositions = layoutEdgeLabels(graph.links, orientation, metrics);
  const nextPreference: OrientationPreference = orientation === "vertical" ? "horizontal" : "vertical";
  const orientationLabel = t(orientation === "vertical" ? "productionPlanning.flowLayoutHorizontal" : "productionPlanning.flowLayoutVertical");

  return (
    <div
      ref={canvasRef}
      className={[
        styles["production-flow-canvas"],
        fitToView ? styles["production-flow-fit"] : null,
        nodeDrag === "pan" ? styles["production-flow-pan"] : null,
        styles[`is-${orientation}`],
      ].filter(Boolean).join(" ")}
      data-flow-orientation={orientation}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
    >
      <div className={styles["production-flow-toolbar"]} role="toolbar">
        <FlowToolbarButton label={t("productionPlanning.flowFit")} onClick={fit}>
          <LucideScan aria-hidden="true" />
        </FlowToolbarButton>
        <FlowToolbarButton label={t("productionPlanning.flowZoomOut")} onClick={() => zoomAroundCenter(1 / 1.2)}>
          <LucideZoomOut aria-hidden="true" />
        </FlowToolbarButton>
        <FlowToolbarButton label={t("productionPlanning.flowZoomIn")} onClick={() => zoomAroundCenter(1.2)}>
          <LucideZoomIn aria-hidden="true" />
        </FlowToolbarButton>
        <FlowToolbarButton label={orientationLabel} onClick={() => setOrientationPreference(nextPreference)}>
          {orientation === "vertical" ? <LucideArrowRightLeft aria-hidden="true" /> : <LucideArrowDownUp aria-hidden="true" />}
        </FlowToolbarButton>
        {nodeDrag === "move" ? (
          <FlowToolbarButton label={t("productionPlanning.resetLayout")} onClick={resetNodeLayout}>
            <LucideRotateCcw aria-hidden="true" />
          </FlowToolbarButton>
        ) : null}
      </div>
      <div
        className={styles["production-flow-surface"]}
        style={{
          width: surfaceWidth,
          height: surfaceHeight,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <svg className={styles["production-flow-edges"]} width={surfaceWidth} height={surfaceHeight}>
          {graph.links.map((link) => (
            <FlowEdgePath key={link.id} link={link} metrics={metrics} orientation={orientation} />
          ))}
        </svg>
        <div className={styles["production-flow-nodes"]}>
          {graph.nodes.map((node) => (
            <FlowNode
              key={node.id}
              metrics={metrics}
              node={node}
              onPointerDown={handleNodePointerDown}
              orientation={orientation}
            />
          ))}
          {graph.links.map((link) => {
            const position = labelPositions.get(link.id);
            return position === undefined ? null : (
              <FlowEdgeLabel key={link.id} link={link} orientation={orientation} position={position} t={t} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FlowToolbarButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button aria-label={label} onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

function FlowNode({
  node,
  orientation,
  metrics,
  onPointerDown,
}: {
  readonly node: SankeyNode<ProductionFlowNode>;
  readonly orientation: ProductionFlowOrientation;
  readonly metrics: CardMetrics;
  readonly onPointerDown: (event: React.PointerEvent<HTMLDivElement>, node: SankeyNode<ProductionFlowNode>) => void;
}) {
  const source = node.source;
  const className = [
    styles["production-flow-node"],
    styles[`is-${source.kind}`],
    styles[`is-${source.tone}`],
    source.isTransient === true ? styles["is-transient"] : null,
    source.isTarget === true ? styles["is-target"] : null,
  ].filter(Boolean).join(" ");
  const rect = resolveCardRect(node, orientation, metrics);
  const tooltip = [source.title, source.subtitle, source.rate].filter((part) => part !== undefined && part !== "").join("\n");

  return (
    <div
      className={className}
      style={{
        left: rect.left + SURFACE_PADDING,
        top: rect.top + SURFACE_PADDING,
        width: rect.width,
        height: rect.height,
      }}
      onPointerDown={(event) => onPointerDown(event, node)}
      data-flow-node-id={node.id}
      title={tooltip}
    >
      <CompositeItemIcon iconSrcs={source.iconSrcs} size={32} />
      <div className={styles["production-flow-node-text"]}>
        <strong>{source.title}</strong>
        <span className={styles["production-flow-node-meta"]}>
          {source.subtitle === "" ? null : <span className={styles["production-flow-node-subtitle"]}>{source.subtitle}</span>}
          {source.rate === undefined ? null : <b className={styles["production-flow-node-rate"]}>{source.rate}</b>}
        </span>
      </div>
    </div>
  );
}

function FlowEdgePath({
  link,
  orientation,
  metrics,
}: {
  readonly link: SankeyLink<ProductionFlowNode, ProductionFlowLink>;
  readonly orientation: ProductionFlowOrientation;
  readonly metrics: CardMetrics;
}) {
  const route = createLinkRoute(link, metrics);
  const className = [
    styles["production-flow-edge"],
    styles[`is-${link.direction}`],
    link.original.sourceSide === "left" ? styles["is-left-exit"] : null,
    link.original.targetSide === "right" ? styles["is-right-entry"] : null,
  ].filter(Boolean).join(" ");

  return (
    <g className={className} data-flow-link-label={link.original.title}>
      <path
        className={styles["production-flow-edge-path"]}
        d={routeToPath(route, orientation)}
        strokeWidth={resolveVisibleLinkWidth(link)}
      />
    </g>
  );
}

function FlowEdgeLabel({
  link,
  orientation,
  position,
  t,
}: {
  readonly link: SankeyLink<ProductionFlowNode, ProductionFlowLink>;
  readonly orientation: ProductionFlowOrientation;
  readonly position: AxisPoint;
  readonly t: (key: string) => string;
}) {
  const midpoint = toScreen(position, orientation);
  const prefix = link.original.isDeviceMinimumConsumption ? `${t("productionPlanning.minimumConsumption")} · ` : "";

  return (
    <span
      className={styles["production-flow-edge-label"]}
      style={{ left: midpoint.x + SURFACE_PADDING, top: midpoint.y + SURFACE_PADDING }}
      title={`${prefix}${link.original.title} ${link.original.label}`}
    >
      {link.original.iconSrc === undefined ? null : <img alt="" src={link.original.iconSrc} />}
      {prefix}{link.original.label}
    </span>
  );
}

const EDGE_LABEL_CROSS_SPACING: Record<ProductionFlowOrientation, number> = { horizontal: 22, vertical: 74 };

/**
 * 前向连线的标签放在目标卡片前的层间空隙里，同一目标的多条入线沿交叉轴并排，互不重叠；
 * 回流连线标签放在绕行段上。层间距不足以容纳标签的连线不显示标签。
 */
function layoutEdgeLabels(
  links: readonly SankeyLink<ProductionFlowNode, ProductionFlowLink>[],
  orientation: ProductionFlowOrientation,
  metrics: CardMetrics,
): Map<string, AxisPoint> {
  const positions = new Map<string, AxisPoint>();
  const forwardByTarget = new Map<string, { readonly link: SankeyLink<ProductionFlowNode, ProductionFlowLink>; readonly route: LinkRoute }[]>();
  for (const link of links) {
    const route = createLinkRoute(link, metrics);
    if (route.kind === "loop") {
      positions.set(link.id, route.midpoint);
      continue;
    }
    if (route.end.layer - route.start.layer < metrics.layerGap * 0.6) {
      continue;
    }
    const group = forwardByTarget.get(link.target.id) ?? [];
    group.push({ link, route });
    forwardByTarget.set(link.target.id, group);
  }

  const spacing = EDGE_LABEL_CROSS_SPACING[orientation];
  for (const group of forwardByTarget.values()) {
    group.sort((left, right) => left.route.end.cross - right.route.end.cross);
    const center = group.reduce((total, entry) => total + entry.route.end.cross, 0) / group.length;
    const layer = Math.max(...group.map((entry) => entry.route.midpoint.layer));
    group.forEach((entry, index) => {
      positions.set(entry.link.id, { layer, cross: center + (index - (group.length - 1) / 2) * spacing });
    });
  }
  return positions;
}

interface AxisPoint {
  readonly layer: number;
  readonly cross: number;
}

interface LinkRoute {
  readonly kind: "forward" | "loop";
  readonly start: AxisPoint;
  readonly end: AxisPoint;
  /** 三次贝塞尔段（forward）或绕行折线的控制点（loop）。 */
  readonly segments: readonly (readonly [AxisPoint, AxisPoint, AxisPoint])[];
  readonly midpoint: AxisPoint;
}

/** 在流向轴（layer）/交叉轴（cross）坐标中构造连线，再统一映射到屏幕坐标。 */
function createLinkRoute(link: SankeyLink<ProductionFlowNode, ProductionFlowLink>, metrics: CardMetrics): LinkRoute {
  const sourceSide = link.original.sourceSide ?? "right";
  const targetSide = link.original.targetSide ?? "left";
  const start: AxisPoint = {
    layer: sourceSide === "left" ? link.source.x0 : link.source.x1,
    cross: mapLinkCrossToCard(link.source, link.y0, metrics),
  };
  const end: AxisPoint = {
    layer: targetSide === "right" ? link.target.x1 : link.target.x0,
    cross: mapLinkCrossToCard(link.target, link.y1, metrics),
  };
  const sideOffset = 48 + Math.max(8, resolveVisibleLinkWidth(link));

  if (sourceSide === targetSide) {
    const controlLayer = sourceSide === "left"
      ? Math.min(start.layer, end.layer) - sideOffset
      : Math.max(start.layer, end.layer) + sideOffset;
    const c1 = { layer: controlLayer, cross: start.cross };
    const c2 = { layer: controlLayer, cross: end.cross };
    return {
      kind: "loop",
      start,
      end,
      segments: [[c1, c2, end]],
      midpoint: { layer: controlLayer - (sourceSide === "left" ? -0.25 : 0.25) * sideOffset, cross: (start.cross + end.cross) / 2 },
    };
  }

  if (link.direction === "forward" && sourceSide === "right") {
    const midLayer = (start.layer + end.layer) / 2;
    return {
      kind: "forward",
      start,
      end,
      segments: [[{ layer: midLayer, cross: start.cross }, { layer: midLayer, cross: end.cross }, end]],
      // 标签放在目标卡片前的层间空隙里：跨多层的长连线中点可能正好落在中间层的卡片上。
      midpoint: { layer: end.layer - Math.min(metrics.layerGap / 2, (end.layer - start.layer) / 2), cross: end.cross },
    };
  }

  // 反向（回流）连线绕到交叉轴外侧，避免穿过中间卡片。
  const outer = Math.max(cardCrossEnd(link.source, metrics), cardCrossEnd(link.target, metrics)) + 40 + Math.max(8, resolveVisibleLinkWidth(link));
  const sourceControl = sourceSide === "left" ? start.layer - 44 : start.layer + 44;
  const targetControl = targetSide === "right" ? end.layer + 44 : end.layer - 44;
  const turnStart = { layer: start.layer, cross: outer };
  const turnEnd = { layer: end.layer, cross: outer };
  return {
    kind: "loop",
    start,
    end,
    segments: [
      [{ layer: sourceControl, cross: start.cross }, { layer: sourceControl, cross: outer }, turnStart],
      [turnStart, turnEnd, turnEnd],
      [{ layer: targetControl, cross: outer }, { layer: targetControl, cross: end.cross }, end],
    ],
    midpoint: { layer: (start.layer + end.layer) / 2, cross: outer },
  };
}

function routeToPath(route: LinkRoute, orientation: ProductionFlowOrientation): string {
  const point = (axis: AxisPoint) => {
    const screen = toScreen(axis, orientation);
    return `${screen.x + SURFACE_PADDING} ${screen.y + SURFACE_PADDING}`;
  };
  const commands = route.segments.map(([c1, c2, end]) => `C ${point(c1)}, ${point(c2)}, ${point(end)}`);
  return `M ${point(route.start)} ${commands.join(" ")}`;
}

function toScreen(point: AxisPoint, orientation: ProductionFlowOrientation): { readonly x: number; readonly y: number } {
  return orientation === "horizontal" ? { x: point.layer, y: point.cross } : { x: point.cross, y: point.layer };
}

function createOrientedLayout(
  graphInput: ProductionFlowGraphInput,
  metrics: CardMetrics,
): SankeyGraph<ProductionFlowNode, ProductionFlowLink> {
  const layerCount = estimateLayerCount(graphInput);
  return createSankeyLayout(graphInput, {
    width: metrics.layer + (layerCount - 1) * (metrics.layer + metrics.layerGap),
    height: 520,
    nodeWidth: metrics.layer,
    nodePadding: metrics.crossGap,
    minNodeBreadth: metrics.cross,
    iterations: 8,
  });
}

function resolveCardRect(node: SankeyNode<ProductionFlowNode>, orientation: ProductionFlowOrientation, metrics: CardMetrics): ScreenRect {
  const crossStart = cardCrossStart(node, metrics);
  return orientation === "horizontal"
    ? { left: node.x0, top: crossStart, width: node.x1 - node.x0, height: metrics.cross }
    : { left: crossStart, top: node.x0, width: metrics.cross, height: node.x1 - node.x0 };
}

function cardCrossStart(node: SankeyNode<ProductionFlowNode>, metrics: CardMetrics): number {
  return node.y0 + Math.max(0, (node.y1 - node.y0 - metrics.cross) / 2);
}

function cardCrossEnd(node: SankeyNode<ProductionFlowNode>, metrics: CardMetrics): number {
  return cardCrossStart(node, metrics) + metrics.cross;
}

function mapLinkCrossToCard(node: SankeyNode<ProductionFlowNode>, linkCross: number, metrics: CardMetrics): number {
  const cardStart = cardCrossStart(node, metrics);
  const virtualBreadth = Math.max(1, node.y1 - node.y0);
  const ratio = clamp((linkCross - node.y0) / virtualBreadth, 0, 1);
  const inset = Math.min(16, metrics.cross / 4);
  return cardStart + inset + ratio * (metrics.cross - inset * 2);
}

function resolveVisibleLinkWidth(link: SankeyLink<ProductionFlowNode, ProductionFlowLink>): number {
  return Math.max(2, Math.min(18, link.width));
}

function unionRects(rects: readonly ScreenRect[]): ScreenRect {
  if (rects.length === 0) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  return {
    left: left + SURFACE_PADDING,
    top: top + SURFACE_PADDING,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** 限制平移，使溢出的图不会在一侧留出大片空白。 */
function clampPan(offset: number, available: number, start: number, extent: number, scale: number, inset: number): number {
  const max = inset - start * scale;
  const min = inset + available - (start + extent) * scale;
  return clamp(offset, min, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeViewportState(value: ViewportState | undefined): ViewportState {
  return {
    x: normalizeFiniteNumber(value?.x, 22),
    y: normalizeFiniteNumber(value?.y, 22),
    scale: clamp(normalizeFiniteNumber(value?.scale, 1), MIN_SCALE, MAX_SCALE),
  };
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cloneSankeyGraph(
  graph: SankeyGraph<ProductionFlowNode, ProductionFlowLink>,
): SankeyGraph<ProductionFlowNode, ProductionFlowLink> {
  const nodeById = new Map<string, SankeyNode<ProductionFlowNode>>();
  const nodes = graph.nodes.map((node) => {
    const clone: SankeyNode<ProductionFlowNode> = {
      ...node,
      sourceLinks: [],
      targetLinks: [],
    };
    nodeById.set(clone.id, clone);
    return clone;
  });
  const links = graph.links.map((link) => {
    const source = nodeById.get(link.source.id);
    const target = nodeById.get(link.target.id);
    if (source === undefined || target === undefined) {
      throw new Error("Unable to clone Sankey graph link endpoint");
    }

    const clone: SankeyLink<ProductionFlowNode, ProductionFlowLink> = {
      ...link,
      source,
      target,
    };
    source.sourceLinks.push(clone);
    target.targetLinks.push(clone);
    return clone;
  });

  return { nodes, links };
}

/** 最长前向路径的层数（忽略环），用于确定流向轴长度。 */
function estimateLayerCount(graphInput: ProductionFlowGraphInput): number {
  const outgoing = new Map<string, string[]>();
  for (const node of graphInput.nodes) {
    outgoing.set(node.id, []);
  }
  for (const link of graphInput.links) {
    outgoing.get(link.source)?.push(link.target);
  }

  const memo = new Map<string, number>();
  const visit = (nodeId: string, visiting: ReadonlySet<string>): number => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);
    let depth = 0;
    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (nextVisiting.has(targetId)) {
        continue;
      }
      depth = Math.max(depth, 1 + visit(targetId, nextVisiting));
    }
    memo.set(nodeId, depth);
    return depth;
  };

  return Math.max(2, ...graphInput.nodes.map((node) => visit(node.id, new Set()) + 1));
}
