import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import LucideArrowDownUp from "~icons/lucide/arrow-down-up";
import LucideArrowRightLeft from "~icons/lucide/arrow-right-left";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideLocateFixed from "~icons/lucide/locate-fixed";
import LucideScan from "~icons/lucide/scan";
import LucideZoomIn from "~icons/lucide/zoom-in";
import LucideZoomOut from "~icons/lucide/zoom-out";
import { resolveWheelZoomDirection } from "@/shared/browser/wheel-zoom";

import type { ProductionPlanningDisplayMode, ProductionPlanningIndex, ProductionPlanningResult } from "../production-planning-model";
import { CompositeItemIcon } from "@/app/shell/shared";
import type { PanelPlacementDrag } from "@/app/shell/shared/panel-placement-drag";
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
  /**
   * 从卡片开始的拖动离开流程图区域时调用：返回放置拖动则交给它（拖到画布上放下该节点的设备），
   * 卡片位置与视图恢复到按下时；返回 null 则照常移动卡片或平移。
   */
  readonly onNodeDragOut?: (node: ProductionFlowNode) => PanelPlacementDrag | null;
  /** 工具栏行左侧的附加内容（例如调用方的搜索框）。 */
  readonly toolbarLeading?: React.ReactNode;
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
  /** 按下前该卡片相对自动布局的位移；拖出流程图交给放置时恢复。 */
  readonly startOffset: { readonly layer: number; readonly cross: number } | undefined;
  clientX: number;
  clientY: number;
  moving: boolean;
}

interface PanDragState {
  readonly pointerId: number;
  viewportX: number;
  viewportY: number;
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  /** 从卡片上开始的平移；抬笔时若未移动则视为点按该卡片。 */
  pressedNodeId: string | null;
  /** 参与过双指缩放的手指抬起时不算点按，避免缩放结束误触发卡片操作或点按放大。 */
  tapEligible: boolean;
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
/** 总览大图时需要远小于可读比例的缩放。 */
const MIN_SCALE = 0.05;
const MAX_SCALE = 3.0;
/** 低于该缩放时文字难以辨认；适配视图改为只适配交叉轴，沿流向平移查看。 */
const MIN_READABLE_FIT_SCALE = 0.85;
/** 总览里低于该比例时屏幕尺寸的名称标签会高过层间距、压到下一层卡片，不再显示。 */
const MIN_OVERVIEW_LABEL_SCALE = 0.2;
const TAP_SLOP_PX = 6;
const ORIENTATION_HYSTERESIS = 1.15;
const FIT_MARGIN = 16;
/** 自动适配时，聚焦视图能完整看到的卡片少于该比例就改用总览。 */
const AUTO_OVERVIEW_VISIBLE_FRACTION = 0.3;
/** 视口变化在手势停顿后才通知外部，避免每次移动都写入持久化存储。 */
const VIEWPORT_NOTIFY_DELAY_MS = 250;

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
  onNodeDragOut,
  toolbarLeading,
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
  const graphRef = useRef(graph);
  const hasVisibleFitRef = useRef(false);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  const [viewport, setRawViewport] = useState<ViewportState>(() => normalizeViewportState(initialViewport));
  const viewportRef = useRef(viewport);
  const onViewportChangeRef = useRef(onViewportChange);
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);
  useEffect(() => () => {
    if (notifyTimerRef.current !== null) clearTimeout(notifyTimerRef.current);
  }, []);

  const setViewport = useCallback((update: ViewportUpdate) => {
    const nextViewport = normalizeViewportState(typeof update === "function" ? update(viewportRef.current) : update);
    viewportRef.current = nextViewport;
    setRawViewport(nextViewport);
    if (notifyTimerRef.current !== null) clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(() => {
      notifyTimerRef.current = null;
      onViewportChangeRef.current?.(viewportRef.current);
    }, VIEWPORT_NOTIFY_DELAY_MS);
  }, []);

  /**
   * "focus"：保持可读缩放并把规划目标放进视野；整图放不下时沿流向平移查看。
   * "overview"：不设可读下限，整条产线一次显示；随后点按空白处可在该处放大到可读比例。
   */
  const fit = useCallback((
    mode: "focus" | "overview" | "auto" = "auto",
    // 默认按当前（可能被手动移动过的）卡片位置适配；换布局时由调用方传入新布局。
    layoutNodes: readonly SankeyNode<ProductionFlowNode>[] = graphRef.current.nodes,
  ) => {
    const element = canvasRef.current;
    if (element === null || layoutNodes.length === 0) return;
    // 隐藏时（尺寸为 0）适配没有意义，留待显示后再做。
    if (element.clientWidth === 0 || element.clientHeight === 0) return;
    hasVisibleFitRef.current = true;
    const rects = layoutNodes.map((node) => resolveCardRect(node, orientation, metrics));
    // 溢出时锚定规划目标；没有标记目标时退回到所有终端节点（副产物也是终端，但不是用户要看的产物）。
    const targetNodes = layoutNodes.filter((node) => node.source.isTarget === true);
    const sinkRects = (targetNodes.length > 0
      ? targetNodes
      : layoutNodes.filter((node) => !node.sourceLinks.some((link) => link.direction === "forward")))
      .map((node) => resolveCardRect(node, orientation, metrics));
    const bounds = unionRects(rects);
    const sinkBounds = unionRects(sinkRects.length > 0 ? sinkRects : rects);
    const margin = FIT_MARGIN;
    const availableWidth = Math.max(1, element.clientWidth - margin * 2);
    const availableHeight = Math.max(1, element.clientHeight - margin * 2);
    const fullScale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    const crossScale = orientation === "vertical" ? availableWidth / bounds.width : availableHeight / bounds.height;
    const place = (overview: boolean): ViewportState => {
      const scale = clamp(
        Math.min(1, overview || fullScale >= MIN_READABLE_FIT_SCALE
          ? fullScale
          : Math.max(MIN_READABLE_FIT_SCALE, crossScale)),
        MIN_SCALE,
        MAX_SCALE,
      );
      const centerX = (availableWidth - bounds.width * scale) / 2 + margin - bounds.left * scale;
      const centerY = (availableHeight - bounds.height * scale) / 2 + margin - bounds.top * scale;
      const overflowsX = bounds.width * scale > availableWidth;
      const overflowsY = bounds.height * scale > availableHeight;
      // 沿流向贴住产物一端，交叉轴以产物为中心。
      const sinkCenterX = margin + availableWidth / 2 - (sinkBounds.left + sinkBounds.width / 2) * scale;
      const sinkCenterY = margin + availableHeight / 2 - (sinkBounds.top + sinkBounds.height / 2) * scale;
      const anchoredX = orientation === "horizontal"
        ? margin + availableWidth - (sinkBounds.left + sinkBounds.width) * scale
        : sinkCenterX;
      const anchoredY = orientation === "vertical"
        ? margin + availableHeight - (sinkBounds.top + sinkBounds.height) * scale
        : sinkCenterY;
      return {
        x: overflowsX ? clampPan(anchoredX, availableWidth, bounds.left, bounds.width, scale, margin) : centerX,
        y: overflowsY ? clampPan(anchoredY, availableHeight, bounds.top, bounds.height, scale, margin) : centerY,
        scale,
      };
    };
    // 自动适配（打开、尺寸变化）时，若聚焦视图只能看到很小一部分产线，就先给总览；点按任意处即可放大。
    // 总览小到连名称都显示不了（矮窗口里的长产线）时没有可读的内容，仍停在规划目标上。
    const focus = place(mode === "overview");
    const overview = place(true);
    const useOverview = mode === "auto"
      && overview.scale >= MIN_OVERVIEW_LABEL_SCALE
      && countVisibleCards(rects, focus, element.clientWidth, element.clientHeight) < rects.length * AUTO_OVERVIEW_VISIBLE_FRACTION;
    setViewport(useOverview ? overview : focus);
  }, [metrics, orientation, setViewport]);

  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

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
    // 图被暂时隐藏（尺寸为 0，例如展开合计时）不适配，重新显示时也保留原视口；只有真实的尺寸变化才重新适配。
    // 只有重新显示时尺寸与隐藏前一致才保留视口；隐藏期间尺寸变了（窗口缩放、叠放切换）就按新尺寸重新定向并适配。
    let lastVisibleSize = { width: element.clientWidth, height: element.clientHeight };
    let hidden = lastVisibleSize.width === 0 || lastVisibleSize.height === 0;
    const observer = new ResizeObserver(() => {
      const size = { width: element.clientWidth, height: element.clientHeight };
      const nowHidden = size.width === 0 || size.height === 0;
      const revealedUnchanged = hidden && !nowHidden && hasVisibleFitRef.current
        && size.width === lastVisibleSize.width && size.height === lastVisibleSize.height;
      hidden = nowHidden;
      if (nowHidden) return;
      lastVisibleSize = size;
      if (revealedUnchanged) return;
      resolveAutoOrientation();
      if (fitToView) fitRef.current();
    });
    observer.observe(element);
    resolveAutoOrientation();
    return () => observer.disconnect();
  }, [fitToView]);

  // 换向后旧视口对新布局没有意义：适配视图的图每次换布局都重新适配，其余图只在方向改变时适配。
  // 何时自动适配：换向、换了一张节点不同的新图、或首次显示时没有保存的视口。
  // 只改变速率/设备数而节点不变（例如在节点菜单里调整产量或换配方）时保留当前视口，用户不会被甩回总览。
  const nodeSetKey = useMemo(() => initialLayout.nodes.map((node) => node.id).sort().join("|"), [initialLayout]);
  const fittedOrientationRef = useRef(orientation);
  const fittedNodeSetRef = useRef<string | null>(initialViewport === undefined ? null : nodeSetKey);
  useEffect(() => {
    const orientationChanged = fittedOrientationRef.current !== orientation;
    const nodeSetChanged = fittedNodeSetRef.current !== nodeSetKey;
    fittedOrientationRef.current = orientation;
    fittedNodeSetRef.current = nodeSetKey;
    if (orientationChanged || nodeSetChanged) fit("auto", initialLayout.nodes);
    // initialLayout 随 nodeSetKey 一起变化；只因数值变化而重建的布局不触发适配。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, nodeSetKey, orientation]);

  const interactionRef = useRef<{
    node: NodePressState | null;
    pan: PanDragState | null;
    pinch: PinchState | null;
    dragOut: { readonly pointerId: number; readonly drag: PanelPlacementDrag } | null;
  }>({
    node: null,
    pan: null,
    pinch: null,
    dragOut: null,
  });

  // 手动拖动过的卡片相对自动布局的位移（布局坐标）。数值或显示方式变化而重建布局时按节点 id 保留，
  // 换向（层方向与横向互换）、换成节点不同的另一张图或重置布局时清空。
  const movedNodeOffsetsRef = useRef(new Map<string, { layer: number; cross: number }>());
  const offsetsLayoutKeyRef = useRef(`${orientation}#${nodeSetKey}`);
  const initialLayoutRef = useRef(initialLayout);
  useEffect(() => {
    initialLayoutRef.current = initialLayout;
    const layoutKey = `${orientation}#${nodeSetKey}`;
    if (offsetsLayoutKeyRef.current !== layoutKey) {
      offsetsLayoutKeyRef.current = layoutKey;
      movedNodeOffsetsRef.current.clear();
    }
    setGraph(applyMovedNodeOffsets(cloneSankeyGraph(initialLayout), movedNodeOffsetsRef.current));
  }, [initialLayout, nodeSetKey, orientation]);

  const resetNodeLayout = useCallback(() => {
    movedNodeOffsetsRef.current.clear();
    setGraph(cloneSankeyGraph(initialLayout));
    fit("auto", initialLayout.nodes);
  }, [fit, initialLayout]);

  /** 以容器内一点为锚缩放到指定比例。 */
  const zoomAt = useCallback((anchorX: number, anchorY: number, scale: number) => {
    setViewport((current) => {
      const nextScale = clamp(scale, MIN_SCALE, MAX_SCALE);
      const ratio = nextScale / current.scale;
      return {
        x: anchorX - ratio * (anchorX - current.x),
        y: anchorY - ratio * (anchorY - current.y),
        scale: nextScale,
      };
    });
  }, [setViewport]);

  const zoomAroundCenter = useCallback((factor: number) => {
    const element = canvasRef.current;
    zoomAt((element?.clientWidth ?? 0) / 2, (element?.clientHeight ?? 0) / 2, viewportRef.current.scale * factor);
  }, [zoomAt]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
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

  const hasNodes = graphInput.nodes.length > 0;
  // React 的 onWheel 是被动监听，无法阻止页面缩放/滚动；改为原生非被动监听。
  useEffect(() => {
    const element = canvasRef.current;
    if (element === null) return;
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
    // 图从空到有节点时画布元素才挂载，需要重新绑定。
  }, [handleWheel, hasNodes]);

  const startPanOrPinch = useCallback((event: React.PointerEvent<HTMLDivElement>, pressedNodeId: string | null) => {
    const interaction = interactionRef.current;

    // 卡片按压中第二指落下（无论落在卡片还是空白处）：按压转为平移基准，随后进入双指缩放。
    if (interaction.node !== null && interaction.node.pointerId !== event.pointerId) {
      const press = interaction.node;
      interaction.node = null;
      interaction.pan = createPanFromCurrent(press.pointerId, press.clientX, press.clientY, viewportRef.current);
    }

    if (interaction.pan !== null && interaction.pan.pointerId !== event.pointerId) {
      const p0 = interaction.pan;
      p0.tapEligible = false;
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
      tapEligible: true,
    };
  }, []);

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) {
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
    if (nodeDrag === "pan" || interaction.pan !== null || interaction.node !== null) {
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
      startOffset: movedNodeOffsetsRef.current.get(node.id),
      clientX: event.clientX,
      clientY: event.clientY,
      moving: false,
    };
  }, [nodeDrag, startPanOrPinch]);

  /** 从卡片开始的拖动离开流程图区域时交给放置拖动；返回是否已交出。 */
  const tryHandOffNodeDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, nodeId: string): boolean => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (onNodeDragOut === undefined || rect === undefined) return false;
    const inside = event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    const node = graphRef.current.nodes.find((candidate) => candidate.id === nodeId);
    const drag = inside || node === undefined ? null : onNodeDragOut(node.source);
    if (drag === null) return false;

    const interaction = interactionRef.current;
    const pan = interaction.pan;
    if (pan !== null) {
      setViewport({ x: pan.viewportX, y: pan.viewportY, scale: viewportRef.current.scale });
    }
    const press = interaction.node;
    if (press !== null) {
      if (press.startOffset === undefined) movedNodeOffsetsRef.current.delete(press.nodeId);
      else movedNodeOffsetsRef.current.set(press.nodeId, press.startOffset);
      setGraph((current) => updateSankeyLinkBreadths({
        nodes: current.nodes.map((candidate) => {
          if (candidate.id !== press.nodeId) return candidate;
          candidate.x0 = press.startX0;
          candidate.x1 = press.startX1;
          candidate.y0 = press.startY0;
          candidate.y1 = press.startY1;
          return candidate;
        }),
        links: current.links,
      }));
    }
    interaction.pan = null;
    interaction.node = null;
    interaction.pinch = null;
    interaction.dragOut = { pointerId: event.pointerId, drag };
    drag.move(event.clientX, event.clientY);
    return true;
  }, [onNodeDragOut, setViewport]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;

    if (interaction.dragOut?.pointerId === event.pointerId) {
      interaction.dragOut.drag.move(event.clientX, event.clientY);
      return;
    }

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
      if (pan.pressedNodeId !== null && tryHandOffNodeDrag(event, pan.pressedNodeId)) {
        return;
      }
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
      press.clientX = event.clientX;
      press.clientY = event.clientY;
      const screenDx = event.clientX - press.startClientX;
      const screenDy = event.clientY - press.startClientY;
      if (!press.moving && Math.hypot(screenDx, screenDy) < TAP_SLOP_PX) {
        return;
      }
      if (tryHandOffNodeDrag(event, press.nodeId)) {
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
            const laidOut = initialLayoutRef.current.nodes.find((candidate) => candidate.id === node.id);
            if (laidOut !== undefined) {
              movedNodeOffsetsRef.current.set(node.id, { layer: node.x0 - laidOut.x0, cross: node.y0 - laidOut.y0 });
            }
            return node;
          }),
          links: current.links,
        };
        return updateSankeyLinkBreadths(next);
      });
    }
  }, [orientation, setViewport, tryHandOffNodeDrag]);

  const activateNode = useCallback((nodeId: string) => {
    if (onNodeActivate === undefined) return;
    const element = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>("[data-flow-node-id]") ?? [])
      .find((candidate) => candidate.dataset.flowNodeId === nodeId);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (element !== null && element !== undefined && node !== undefined) {
      onNodeActivate(node.source, element.getBoundingClientRect());
    }
  }, [graph.nodes, onNodeActivate]);

  // 总览（低于可读比例）时，无论点在卡片还是空白处都先以该点为中心放大到可读比例；
  // 卡片缩到只有几像素时，点中与否不应决定完全不同的结果。可读比例下点卡片才打开操作。
  const handleTap = useCallback((event: React.PointerEvent<HTMLDivElement>, nodeId: string | null) => {
    if (viewportRef.current.scale < MIN_READABLE_FIT_SCALE) {
      const element = canvasRef.current;
      const node = nodeId === null ? undefined : graphRef.current.nodes.find((candidate) => candidate.id === nodeId);
      if (element !== null && node !== undefined) {
        // 点中卡片：把这张卡片放到视图中央并放大到可读比例，保证它完整可见。
        const card = resolveCardRect(node, orientation, metrics);
        const scale = MIN_READABLE_FIT_SCALE;
        setViewport({
          x: element.clientWidth / 2 - (card.left + SURFACE_PADDING + card.width / 2) * scale,
          y: element.clientHeight / 2 - (card.top + SURFACE_PADDING + card.height / 2) * scale,
          scale,
        });
        return;
      }
      const rect = element?.getBoundingClientRect();
      zoomAt(event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0), MIN_READABLE_FIT_SCALE);
      return;
    }
    if (nodeId !== null) {
      activateNode(nodeId);
    }
  }, [activateNode, metrics, orientation, setViewport, zoomAt]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;

    const dragOut = interaction.dragOut;
    if (dragOut?.pointerId === event.pointerId) {
      interaction.dragOut = null;
      if (event.type === "pointerup") dragOut.drag.drop(event.clientX, event.clientY);
      else dragOut.drag.cancel();
      return;
    }

    if (interaction.pan?.pointerId === event.pointerId) {
      const pan = interaction.pan;
      const pinch = interaction.pinch;
      interaction.pinch = null;
      // 双指缩放时先抬起第一指：由剩下的手指从当前视口继续平移。
      interaction.pan = pinch === null ? null : createPanFromCurrent(
        pinch.secondPointerId,
        pinch.secondClientX,
        pinch.secondClientY,
        viewportRef.current,
      );
      const isTap = pinch === null
        && pan.tapEligible
        && event.type === "pointerup"
        && Math.hypot(event.clientX - pan.startClientX, event.clientY - pan.startClientY) < TAP_SLOP_PX;
      if (isTap) {
        handleTap(event, pan.pressedNodeId);
      }
      return;
    }

    if (interaction.pinch?.secondPointerId === event.pointerId) {
      interaction.pinch = null;
      // 第二指抬起：剩下的手指以当前视口和位置为新起点，避免跳回缩放前的平移原点。
      if (interaction.pan !== null) {
        interaction.pan = createPanFromCurrent(
          interaction.pan.pointerId,
          interaction.pan.clientX,
          interaction.pan.clientY,
          viewportRef.current,
        );
      }
      return;
    }

    const press = interaction.node;
    if (press?.pointerId === event.pointerId) {
      interaction.node = null;
      if (!press.moving && event.type === "pointerup") {
        handleTap(event, press.nodeId);
      }
    }
  }, [handleTap]);

  const surfaceSize = useMemo(() => {
    const bounds = unionRects(graph.nodes.map((node) => resolveCardRect(node, orientation, metrics)));
    return {
      width: Math.max(960, bounds.left + bounds.width + SURFACE_PADDING * 2),
      height: Math.max(520, bounds.top + bounds.height + SURFACE_PADDING * 2),
    };
  }, [graph, metrics, orientation]);

  if (graphInput.nodes.length === 0) {
    return <div className={styles["production-planning-empty"]}>{t("productionPlanning.noRecipes")}</div>;
  }

  const nextPreference: OrientationPreference = orientation === "vertical" ? "horizontal" : "vertical";
  const orientationLabel = t(orientation === "vertical" ? "productionPlanning.flowLayoutHorizontal" : "productionPlanning.flowLayoutVertical");

  return (
    <div
      className={[
        styles["production-flow-graph"],
        fitToView ? styles["production-flow-fit"] : null,
      ].filter(Boolean).join(" ")}
    >
      <div className={styles["production-flow-toolbar"]}>
        {toolbarLeading === undefined ? null : <div className={styles["production-flow-toolbar-leading"]}>{toolbarLeading}</div>}
        <div className={styles["production-flow-toolbar-buttons"]} role="toolbar">
        <FlowToolbarButton
          label={t("productionPlanning.flowOverview")}
          onClick={() => fit("overview")}
          text={t("productionPlanning.flowOverviewShort")}
        >
          <LucideScan aria-hidden="true" />
        </FlowToolbarButton>
        <FlowToolbarButton
          label={t("productionPlanning.flowFocusTarget")}
          onClick={() => fit("focus")}
          text={t("productionPlanning.flowFocusTargetShort")}
        >
          <LucideLocateFixed aria-hidden="true" />
        </FlowToolbarButton>
        <span aria-hidden="true" className={styles["production-flow-toolbar-divider"]} />
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
      </div>
      <div
        ref={canvasRef}
        className={[
          styles["production-flow-canvas"],
          nodeDrag === "pan" ? styles["production-flow-pan"] : null,
          styles[`is-${orientation}`],
        ].filter(Boolean).join(" ")}
        data-flow-orientation={orientation}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        <div
          className={styles["production-flow-surface"]}
          style={{
            width: surfaceSize.width,
            height: surfaceSize.height,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            "--flow-scale": viewport.scale,
          } as React.CSSProperties}
        >
          <FlowSurfaceContent
            compact={viewport.scale < MIN_READABLE_FIT_SCALE}
            overviewLabelScale={viewport.scale >= MIN_OVERVIEW_LABEL_SCALE ? Math.round(viewport.scale * 50) / 50 : null}
            graph={graph}
            metrics={metrics}
            onNodePointerDown={handleNodePointerDown}
            orientation={orientation}
            surfaceSize={surfaceSize}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}

/** 节点、连线与标签只随布局变化重绘；平移缩放只改变外层 transform。 */
const FlowSurfaceContent = memo(function FlowSurfaceContent({
  compact,
  overviewLabelScale,
  graph,
  orientation,
  metrics,
  surfaceSize,
  onNodePointerDown,
  t,
}: {
  /** 低于可读比例（总览）时卡片只显示放大的图标与速率，连线标签隐藏；只在越过阈值时重绘。 */
  readonly compact: boolean;
  /** 总览时在卡片下方显示屏幕尺寸固定的名称标签；值为取整后的缩放比例，用来估算标签能放下的字数，null 时不显示。 */
  readonly overviewLabelScale: number | null;
  readonly graph: SankeyGraph<ProductionFlowNode, ProductionFlowLink>;
  readonly orientation: ProductionFlowOrientation;
  readonly metrics: CardMetrics;
  readonly surfaceSize: { readonly width: number; readonly height: number };
  readonly onNodePointerDown: (event: React.PointerEvent<HTMLDivElement>, node: SankeyNode<ProductionFlowNode>) => void;
  readonly t: (key: string) => string;
}) {
  const labelPositions = useMemo(() => layoutEdgeLabels(graph.links, orientation, metrics), [graph, metrics, orientation]);
  const cardClearances = useMemo(
    () => (compact ? resolveCardClearances(graph.nodes, orientation, metrics) : null),
    [compact, graph, metrics, orientation],
  );
  return (
    <>
      <svg className={styles["production-flow-edges"]} width={surfaceSize.width} height={surfaceSize.height}>
        {graph.links.map((link) => (
          <FlowEdgePath key={link.id} link={link} metrics={metrics} orientation={orientation} />
        ))}
      </svg>
      <div className={[styles["production-flow-nodes"], compact ? styles["is-compact"] : null].filter(Boolean).join(" ")}>
        {graph.nodes.map((node) => (
          <FlowNode
            compact={compact}
            key={node.id}
            overviewLabelPlacement={compact && overviewLabelScale !== null
              ? resolveOverviewLabelPlacement(cardClearances?.get(node.id), overviewLabelScale)
              : null}
            overviewLabelScale={compact ? overviewLabelScale : null}
            metrics={metrics}
            node={node}
            onPointerDown={onNodePointerDown}
            orientation={orientation}
          />
        ))}
        {compact ? null : graph.links.map((link) => {
          const position = labelPositions.get(link.id);
          return position === undefined ? null : (
            <FlowEdgeLabel key={link.id} link={link} orientation={orientation} position={position} t={t} />
          );
        })}
      </div>
    </>
  );
});

function FlowToolbarButton({
  label,
  onClick,
  text,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  /** 常用的视图操作带短文字，便于一眼认出；工具栏变窄时只留图标。 */
  readonly text?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className={text === undefined ? undefined : styles["has-text"]}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
      {text === undefined ? null : <span className={styles["production-flow-toolbar-text"]}>{text}</span>}
    </button>
  );
}

function FlowNode({
  compact,
  overviewLabelPlacement,
  overviewLabelScale,
  node,
  orientation,
  metrics,
  onPointerDown,
}: {
  readonly compact: boolean;
  /** 总览名称标签放在卡片下方还是上方；两侧都放不下（会压到相邻卡片）时为 null，不显示。 */
  readonly overviewLabelPlacement: "below" | "above" | null;
  readonly overviewLabelScale: number | null;
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
  const tooltip = [source.title, source.subtitle, source.machineCount, source.rate]
    .filter((part) => part !== undefined && part !== "")
    .join("\n");
  // 物品模式下设备名只在提示与点按详情中出现，卡片上以设备图标 + 数量常驻。
  const showSubtitle = source.subtitle !== "" && (source.kind === "recipe" || source.machineCount === undefined);
  const rateText = compact ? source.rateValue ?? source.rate : source.rate;

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
      <CompositeItemIcon iconSrcs={source.iconSrcs} size={compact ? 44 : 32} />
      <div className={styles["production-flow-node-text"]}>
        <strong>{source.title}</strong>
        <span className={styles["production-flow-node-meta"]}>
          {source.machineCount === undefined ? null : (
            <span className={styles["production-flow-node-machine"]}>
              {source.machineIconSrc === undefined ? null : <img alt="" src={source.machineIconSrc} />}
              {source.machineCount}
            </span>
          )}
          {showSubtitle ? <span className={styles["production-flow-node-subtitle"]}>{source.subtitle}</span> : null}
          {rateText === undefined ? null : (
            <b
              className={styles["production-flow-node-rate"]}
              style={compact ? { "--flow-rate-max": `${resolveCompactRateFontPx(rateText, rect.width)}px` } as React.CSSProperties : undefined}
            >
              {rateText}
            </b>
          )}
        </span>
      </div>
      {overviewLabelScale === null || overviewLabelPlacement === null ? null : (
        <span className={[styles["production-flow-node-overview-label"], styles[`is-${overviewLabelPlacement}`]].join(" ")}>
          {truncateOverviewLabel(source.title, rect.width * overviewLabelScale - OVERVIEW_LABEL_PADDING_PX)}
        </span>
      )}
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

const EDGE_LABEL_HEIGHT = 20;
const EDGE_LABEL_GAP = 4;
const EDGE_LABEL_SHIFT_STEP = 6;
const EDGE_LABEL_MAX_SHIFTS = 24;

/**
 * 连线速率标签布局：前向连线放在目标卡片前的层间空隙，同一目标的入线以目标为中心并排；
 * 回流连线放在绕行段。随后对全部标签做一次碰撞消解，沿交叉轴移到最近的空位，
 * 层间距不足以容纳标签的短连线不显示标签。
 */
function layoutEdgeLabels(
  links: readonly SankeyLink<ProductionFlowNode, ProductionFlowLink>[],
  orientation: ProductionFlowOrientation,
  metrics: CardMetrics,
): Map<string, AxisPoint> {
  const desired: { readonly id: string; readonly point: AxisPoint; readonly width: number }[] = [];
  const forwardByTarget = new Map<string, { readonly link: SankeyLink<ProductionFlowNode, ProductionFlowLink>; readonly route: LinkRoute }[]>();
  for (const link of links) {
    const route = createLinkRoute(link, metrics);
    if (route.kind === "loop") {
      desired.push({ id: link.id, point: route.midpoint, width: estimateEdgeLabelWidth(link) });
      continue;
    }
    if (route.end.layer - route.start.layer < metrics.layerGap * 0.6) {
      continue;
    }
    const group = forwardByTarget.get(link.target.id) ?? [];
    group.push({ link, route });
    forwardByTarget.set(link.target.id, group);
  }

  for (const group of forwardByTarget.values()) {
    group.sort((left, right) => left.route.end.cross - right.route.end.cross);
    let layer = Number.NEGATIVE_INFINITY;
    let crossSum = 0;
    for (const entry of group) {
      layer = Math.max(layer, entry.route.midpoint.layer);
      crossSum += entry.route.end.cross;
    }
    const sizes = group.map((entry) => crossExtentOf(estimateEdgeLabelWidth(entry.link), orientation));
    const total = sizes.reduce((sum, size) => sum + size, 0) + EDGE_LABEL_GAP * (group.length - 1);
    let cursor = crossSum / group.length - total / 2;
    group.forEach((entry, index) => {
      const size = sizes[index] ?? 0;
      desired.push({ id: entry.link.id, point: { layer, cross: cursor + size / 2 }, width: estimateEdgeLabelWidth(entry.link) });
      cursor += size + EDGE_LABEL_GAP;
    });
  }

  desired.sort((left, right) => left.point.layer - right.point.layer || left.point.cross - right.point.cross);
  const placed: { readonly point: AxisPoint; readonly layerHalf: number; readonly crossHalf: number }[] = [];
  const positions = new Map<string, AxisPoint>();
  for (const label of desired) {
    const layerHalf = layerExtentOf(label.width, orientation) / 2 + EDGE_LABEL_GAP / 2;
    const crossHalf = crossExtentOf(label.width, orientation) / 2 + EDGE_LABEL_GAP / 2;
    const collides = (point: AxisPoint) => placed.some((other) => (
      Math.abs(other.point.layer - point.layer) < other.layerHalf + layerHalf
      && Math.abs(other.point.cross - point.cross) < other.crossHalf + crossHalf
    ));
    let point = label.point;
    for (let attempt = 1; attempt <= EDGE_LABEL_MAX_SHIFTS && collides(point); attempt += 1) {
      const offset = Math.ceil(attempt / 2) * EDGE_LABEL_SHIFT_STEP * (attempt % 2 === 1 ? 1 : -1);
      point = { layer: label.point.layer, cross: label.point.cross + offset };
    }
    if (collides(point)) {
      continue;
    }
    placed.push({ point, layerHalf, crossHalf });
    positions.set(label.id, point);
  }
  return positions;
}

function estimateEdgeLabelWidth(link: SankeyLink<ProductionFlowNode, ProductionFlowLink>): number {
  const iconWidth = link.original.iconSrc === undefined ? 0 : 19;
  return 12 + iconWidth + link.original.label.length * 6.6;
}

function crossExtentOf(width: number, orientation: ProductionFlowOrientation): number {
  return orientation === "vertical" ? width : EDGE_LABEL_HEIGHT;
}

function layerExtentOf(width: number, orientation: ProductionFlowOrientation): number {
  return orientation === "vertical" ? EDGE_LABEL_HEIGHT : width;
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

function countVisibleCards(rects: readonly ScreenRect[], viewport: ViewportState, width: number, height: number): number {
  let visible = 0;
  for (const rect of rects) {
    const left = viewport.x + (rect.left + SURFACE_PADDING) * viewport.scale;
    const top = viewport.y + (rect.top + SURFACE_PADDING) * viewport.scale;
    if (
      left >= 0
      && top >= 0
      && left + rect.width * viewport.scale <= width
      && top + rect.height * viewport.scale <= height
    ) {
      visible += 1;
    }
  }
  return visible;
}

function createPanFromCurrent(pointerId: number, clientX: number, clientY: number, viewport: ViewportState): PanDragState {
  return {
    pointerId,
    viewportX: viewport.x,
    viewportY: viewport.y,
    startClientX: clientX,
    startClientY: clientY,
    clientX,
    clientY,
    pressedNodeId: null,
    tapEligible: false,
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

function applyMovedNodeOffsets(
  graph: SankeyGraph<ProductionFlowNode, ProductionFlowLink>,
  offsets: ReadonlyMap<string, { layer: number; cross: number }>,
): SankeyGraph<ProductionFlowNode, ProductionFlowLink> {
  if (offsets.size === 0) {
    return graph;
  }
  for (const node of graph.nodes) {
    const offset = offsets.get(node.id);
    if (offset !== undefined) {
      node.x0 += offset.layer;
      node.x1 += offset.layer;
      node.y0 += offset.cross;
      node.y1 += offset.cross;
    }
  }
  return updateSankeyLinkBreadths(graph);
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

/** 总览标签约 11px 字号下每个西文字符的屏幕宽度；中日韩字符按两个计。 */
/** 总览名称标签的屏幕字号、左右内边距与占用高度（含与卡片的间隔），与样式表一致。 */
const OVERVIEW_LABEL_FONT = "600 11px";
const OVERVIEW_LABEL_PADDING_PX = 8;
const OVERVIEW_LABEL_HEIGHT_PX = 17;
/** 无法测量文字时按每个西文字符的平均宽度估算（中日韩字符按两个计）。 */
const OVERVIEW_LABEL_CHAR_PX = 6.4;
/** 总览卡片除速率外占用的宽度（布局单位）：内边距、边框、44px 图标与间距。 */
const COMPACT_RATE_INSET = 70;
/** 速率粗体等宽数字的字宽（em）。 */
const COMPACT_RATE_DIGIT_EM = 0.62;
const COMPACT_RATE_MAX_FONT_PX = 46;

/** 总览速率的字号上限（布局单位）：整个数值放得进卡片的文字区，不会被截掉位数。 */
function resolveCompactRateFontPx(rate: string, cardWidth: number): number {
  const fitted = (cardWidth - COMPACT_RATE_INSET) / (Array.from(rate).length * COMPACT_RATE_DIGIT_EM);
  return Math.max(1, Math.min(COMPACT_RATE_MAX_FONT_PX, Math.floor(fitted)));
}

/** 每张卡片正上方与正下方到最近一张卡片的空隙（布局单位）；没有遮挡时为无穷大。 */
function resolveCardClearances(
  nodes: readonly SankeyNode<ProductionFlowNode>[],
  orientation: ProductionFlowOrientation,
  metrics: CardMetrics,
): ReadonlyMap<string, { readonly above: number; readonly below: number }> {
  const rects = nodes.map((node) => ({ id: node.id, rect: resolveCardRect(node, orientation, metrics) }));
  return new Map(rects.map(({ id, rect }) => {
    let above = Infinity;
    let below = Infinity;
    for (const other of rects) {
      const overlapsX = other.id !== id
        && other.rect.left < rect.left + rect.width
        && other.rect.left + other.rect.width > rect.left;
      if (!overlapsX) continue;
      if (other.rect.top >= rect.top + rect.height) {
        below = Math.min(below, other.rect.top - rect.top - rect.height);
      } else if (other.rect.top + other.rect.height <= rect.top) {
        above = Math.min(above, rect.top - other.rect.top - other.rect.height);
      }
    }
    return [id, { above, below }];
  }));
}

/** 名称标签优先放在卡片下方，下方放不下就放上方，两边都会压到相邻卡片时不显示。 */
function resolveOverviewLabelPlacement(
  clearance: { readonly above: number; readonly below: number } | undefined,
  scale: number,
): "below" | "above" | null {
  const needed = OVERVIEW_LABEL_HEIGHT_PX / scale;
  if (clearance === undefined || clearance.below >= needed) return "below";
  return clearance.above >= needed ? "above" : null;
}

let overviewLabelContext: CanvasRenderingContext2D | null | undefined;

/** 标签文字在屏幕上的宽度：有画布时按实际字体测量，否则按字数估算。 */
function measureOverviewLabel(text: string): number {
  if (overviewLabelContext === undefined) {
    overviewLabelContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (overviewLabelContext !== null) {
      overviewLabelContext.font = `${OVERVIEW_LABEL_FONT} ${getComputedStyle(document.body).fontFamily}`;
    }
  }
  if (overviewLabelContext !== null) {
    return overviewLabelContext.measureText(text).width;
  }
  return Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e7f ? 2 : 1), 0) * OVERVIEW_LABEL_CHAR_PX;
}

/**
 * 按标签在屏幕上可用的宽度截短总览名称，保留最后一个词（“…Powder”“…Ore”），
 * 同一前缀的物品（矿石与粉末、种子与作物）截短后仍能区分。截短结果本身就放得下，样式不会再加省略号。
 */
export function truncateOverviewLabel(
  title: string,
  screenWidth: number,
  measure: (text: string) => number = measureOverviewLabel,
): string {
  if (measure(title) <= screenWidth) {
    return title;
  }
  const take = (text: string, limit: number) => {
    let result = "";
    for (const char of text) {
      if (measure(result + char) > limit) break;
      result += char;
    }
    return result.trimEnd();
  };
  const ellipsis = measure("…");
  const lastSpace = title.lastIndexOf(" ");
  const lastWord = lastSpace > 0 ? title.slice(lastSpace + 1) : "";
  // 末词前至少留两个字符，否则截短结果看不出是哪个物品。
  if (lastWord !== "" && measure(lastWord) + ellipsis + measure(title.slice(0, 2)) <= screenWidth) {
    return `${take(title, screenWidth - measure(lastWord) - ellipsis)}…${lastWord}`;
  }
  return `${take(title, screenWidth - ellipsis)}…`;
}
