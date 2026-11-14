import type { SceneViewInput } from "@/domain/document/scene-view-input";
import type { WorldEntity } from '@/domain/document/world-document';
import type { EntityDefinition } from '@/domain/registry/types/entity-definition';
import { EntityCollectionType } from '@/domain/editor/types/editor-types';
import { LOGISTICS_STATIC_ARROW_PHASE,
  type LogisticsMaterialEntityState, type LogisticsMaterialFrameState,
  type LogisticsMaterialRoutePlacement } from '@/shared/logistics-material';
import { PipeFluidPlayback, type LogisticsPipeRoute, type LogisticsBakedManifest, type PipeFluidInput } from '@/shared/logistics-baked';
import { resolveLogisticsMaterialTopology } from './logistics-material-topology';
import { resolveLogisticsEffects } from './logistics-interaction';

/** 文档变化重建路线，仿真快照变化查询占用；逐帧只推进路线状态和共享时间。 */
export class LogisticsMaterialSceneState {
  private documentVersion = -1;
  private committedEntities: readonly WorldEntity[] = [];
  private committedDefinitions: ReadonlyMap<string, EntityDefinition> | null = null;
  private committed: ReadonlyMap<string, LogisticsMaterialRoutePlacement> | undefined;
  private simulationVersion = -1;
  private presentationVersion = -1;
  private placements: ReadonlyMap<string, LogisticsMaterialRoutePlacement> = new Map();
  private previewIds: ReadonlySet<string> = new Set();
  private inputs = new Map<string, PipeFluidInput>();
  private lastTick = -1;
  private wasSeeking = false;
  private wasStopped = true;
  private paused = true;
  private timing: LogisticsBakedManifest['cycle'] | null = null;
  private interactionSignature = '';
  private hoverId: string | null = null;
  private readonly frame = {
    entities: new Map<string, LogisticsMaterialEntityState>(), routes: new Map<string, LogisticsPipeRoute>(),
    beltSeconds: LOGISTICS_STATIC_ARROW_PHASE, animationEnabled: false,
    effects: new Map() as LogisticsMaterialFrameState['effects'], effectVersion: 0,
    previewHeadId: null as string | null, pipeWallReflection: false,
  };

  public setTiming(timing: LogisticsBakedManifest['cycle'] | null): void { this.timing = timing; }

  public sync(options: {
    input: SceneViewInput; entities: readonly WorldEntity[]; definitions: ReadonlyMap<string, EntityDefinition>;
    documentVersion: number; simulationVersion: number; presentationVersion: number; deltaMs: number; collectionsVersion?: number;
  }): LogisticsMaterialFrameState {
    const { input } = options;
    const settings = input.presentation.getSnapshot().settings;
    const enabled = settings?.gameUseBlueprintStyleDeviceImages !== true;
    const source = input.source;
    const draft = source?.queries.resolveLogisticsDraftState?.();
    const signature = `${options.documentVersion}:${options.collectionsVersion}:${options.presentationVersion}`;
    if (signature !== this.interactionSignature) {
      this.interactionSignature = signature;
      this.frame.effects = enabled && source.snapshot.getSnapshot().interaction !== null ? resolveLogisticsEffects({ entities: options.entities, definitions: options.definitions,
        collections: source.snapshot.getSnapshot().interaction!.collections, hoverId: source.snapshot.getSnapshot().interaction?.hoverTarget?.entity?.id,
        replacingId: draft?.replacingEntityId, invalidDraft: draft?.invalidReason != null }) : new Map();
      this.frame.effectVersion++;
      this.frame.previewHeadId = draft?.headDraftEntityId ?? null;
    }
    const hoverId = enabled ? source.snapshot.getSnapshot().interaction?.hoverTarget?.entity?.id ?? null : null;
    if (hoverId !== this.hoverId) {
      const effects = new Map(this.frame.effects);
      if (this.hoverId && effects.get(this.hoverId) === 'hover') effects.delete(this.hoverId);
      if (hoverId && !effects.has(hoverId) && this.frame.entities.get(hoverId)?.kind === 'pipe') effects.set(hoverId, 'hover');
      this.frame.effects = effects; this.frame.effectVersion++; this.hoverId = hoverId;
    }
    this.frame.pipeWallReflection = enabled && settings?.gamePipeWallReflection === true;
    const exact = settings?.gameShowPipeExactFluidPosition === true;
    const simulation = input.simulation;
    const seeking = simulation?.state.timeline?.isSeeking === true;
    const stopped = simulation?.state.runningState === 'stop';
    const paused = simulation?.state.runningState === 'pause' || seeking;
    const tick = simulation?.queries.getDocumentRuntimeStatus?.()?.tickNumber ?? -1;
    const reset = tick < this.lastTick || (this.wasSeeking && !seeking) || (stopped && !this.wasStopped);
    const topologyChanged = this.documentVersion !== options.documentVersion;
    const changed = topologyChanged || reset || this.simulationVersion !== options.simulationVersion
      || this.presentationVersion !== options.presentationVersion;
    let committedTopologyChanged = false;
    if (topologyChanged) {
      const actual = options.entities.filter((entity) => !("originalEntityId" in entity));
      committedTopologyChanged = this.committedDefinitions !== options.definitions
        || actual.length !== this.committedEntities.length
        || actual.some((entity, index) => entity !== this.committedEntities[index]);
      const topology = resolveLogisticsMaterialTopology({
        entities: options.entities, definitions: options.definitions, registry: input.source.registry.queries,
        committed: committedTopologyChanged ? undefined : this.committed,
        hiddenEntityIds: new Set(input.source.snapshot.getSnapshot().interaction?.collections[EntityCollectionType.ghost] ?? []),
        replacingEntityId: input.source?.queries.resolveLogisticsDraftState?.()?.replacingEntityId,
      });
      if (committedTopologyChanged) {
        const entities = new Map(options.entities.map((entity) => [entity.id, entity]));
        const routes = new Map<string, LogisticsPipeRoute>();
        for (const [id, placement] of topology.committed) {
          if (placement.kind !== 'pipe') continue;
          let route = routes.get(placement.routeId);
          if (!route) {
            route = { id: placement.routeId, segments: [], closed: placement.closed === true, occupied: new Set(), exact,
              playback: new PipeFluidPlayback(), seconds: 0, flowing: false, fluidColors: null, gas: false };
            routes.set(route.id, route);
          }
          const entity = entities.get(id)!;
          route.segments.push({ id, x: entity.position.x + .5, y: entity.position.y + .5,
            rotation: entity.rotation + placement.rotation, shape: placement.shape, start: placement.start, support: placement.support });
        }
        for (const [id, route] of routes) {
          const previous = this.frame.routes.get(id);
          // 编辑无关建筑时保留播放进度；路线本身改变则依据当前快照重建，不制造首格进液事件。
          if (previous && previous.closed === route.closed && JSON.stringify(previous.segments) === JSON.stringify(route.segments)) routes.set(id, previous);
        }
        this.frame.routes = routes;
      }
      this.committed = topology.committed;
      this.committedEntities = actual;
      this.committedDefinitions = options.definitions;
      this.placements = topology.placements;
      this.previewIds = topology.previewIds;
    }
    if (committedTopologyChanged || reset || this.simulationVersion !== options.simulationVersion
      || this.presentationVersion !== options.presentationVersion) {
      this.inputs = new Map();
      for (const [id, route] of this.frame.routes) {
        const occupied = new Set(route.segments.filter((segment) => simulation?.queries.isPipeDeviceSlotOccupied(segment.id) === true).map((segment) => segment.id));
        // 域锁可能覆盖路线外部，排空判定以本条连续管道的真实槽位为准。
        const itemId = occupied.size ? simulation?.queries.getPipeFluidItemId(id) ?? null : null;
        if (occupied.size !== route.occupied.size || [...occupied].some((key) => !route.occupied.has(key))) route.occupied = occupied;
        route.exact = exact;
        route.flowing = itemId !== null;
        this.inputs.set(id, { itemId, firstOccupied: occupied.has(id), length: route.segments.length, closed: route.closed, exact });
      }
    }
    const delta = enabled && !paused && !this.paused && !reset ? Math.max(0, options.deltaMs / 1000) : 0;
    if (reset) this.frame.beltSeconds = LOGISTICS_STATIC_ARROW_PHASE;
    else this.frame.beltSeconds += delta;
    let entityStateChanged = changed;
    for (const [id, route] of this.frame.routes) {
      const input = this.inputs.get(id);
      if (!input) continue;
      if (reset) route.seconds = 0;
      const previousFluid = route.playback.itemId;
      if (this.timing) route.playback.update({ ...input, reset }, delta, this.timing);
      entityStateChanged ||= previousFluid !== route.playback.itemId;
      if (route.flowing || route.playback.thickness > 0) route.seconds += delta;
      const fluidId = enabled ? route.playback.itemId : input.itemId;
      if (fluidId !== null) {
        const definition = options.input.source.registry.queries.findItemDefinition(fluidId);
        route.fluidColors = definition?.fluidColors ?? null;
        route.gas = definition?.tags.includes('gas') === true;
      }
    }
    // 对象仅在可见语义改变时替换，避免为每帧的粗细动画重做整场 Sprite 布局。
    if (entityStateChanged) {
      const next = new Map<string, LogisticsMaterialEntityState>();
      for (const [id, placement] of this.placements) {
        const preview = this.previewIds.has(id) ? true : undefined;
        const route = preview ? undefined : this.frame.routes.get(placement.routeId);
        const actual = this.inputs.get(placement.routeId)?.itemId ?? null;
        const filled = route && (enabled ? route.playback.itemId !== null : actual !== null)
          && (!exact || route.occupied.has(id));
        const fluidItemId = filled ? (enabled ? route.playback.itemId : actual) : null;
        const previous = this.frame.entities.get(id);
        next.set(id, previous && previous.fluidItemId === fluidItemId && previous.start === placement.start
          && previous.support === placement.support && previous.marker === placement.marker
          && previous.shape === placement.shape && previous.rotation === placement.rotation
          && previous.preview === preview && previous.pipeFlow === route
          ? previous : { ...placement, fluidItemId, preview, pipeFlow: route });
      }
      this.frame.entities = next;
    }
    this.frame.animationEnabled = enabled;
    this.wasSeeking = seeking; this.paused = paused; this.wasStopped = stopped; this.lastTick = tick;
    this.documentVersion = options.documentVersion; this.simulationVersion = options.simulationVersion;
    this.presentationVersion = options.presentationVersion;
    return this.frame;
  }
}

