import type { SimulationQuery } from "@/domain/simulation/simulation-query";
import type { RegistryQuery } from "@/domain/registry";
import type {
  SimulationDeviceOperatingStatus,
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceRuntimeSlotItemReadModel,
  SimulationDeviceRuntimeStatusReadModel,
  SimulationPerformanceDiagnosticsReadModel,
} from "@/domain/simulation/types/simulation-types";
import { ADMISSION_RATE_WINDOWS_PER_MINUTE } from "@/domain/registry";
import {
  convertSimulationTicksToSeconds,
  type CompiledSimulationTopology,
  type RuntimeDeviceSnapshot,
  type SimulationStateReadWrite,
  type WarehouseStats,
} from "@/simulation/contracts";
import {
  DARK_PIPE_INLET_STORAGE_GROUP_ID,
  DARK_PIPE_OUTLET_STORAGE_GROUP_ID,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import type { SimulationPresentationProjection } from "./presentation-projection";
import { buildDeviceGasCoverage } from "./gas-coverage";

/** 引擎提供当前投影及会话汇总；Query 只负责构建公开读模型。 */
export interface SimulationQueryContext {
  readonly state: SimulationStateReadWrite;
  readonly registryQueries: RegistryQuery;
  getTopology(): CompiledSimulationTopology | null;
  getOperatingStatusTopology(): CompiledSimulationTopology | null;
  getPresentation(): SimulationPresentationProjection | null;
  getTotalPowerDemand(topology: CompiledSimulationTopology, presentation: SimulationPresentationProjection): number | null;
  getWarehouseStats(): WarehouseStats | null;
  getPerformanceDiagnostics(): SimulationPerformanceDiagnosticsReadModel;
  getDebugDataEnabled(): boolean;
  beforeReadDebugData?(): void;
}

interface RuntimeSlotLayoutEntry {
  readonly compiledSlotId: string;
  readonly groupIndex: number;
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly viewRole: SimulationDeviceRuntimeSlotItemReadModel["viewRole"];
}

export function createSimulationQueries(context: SimulationQueryContext): SimulationQuery {
  // 帧级缓存：topology 在同一帧内引用不变，shareCapSlotIds 只需计算一次。
  // BeltCargoDecoration 等 decoration 每帧对多个 entity 调用此方法时命中缓存。
  let cachedTopology: CompiledSimulationTopology | null = null;
  let cachedShareCapSlotIds: Set<string> | null = null;
  const cachedRuntimeSlotLayouts = new Map<string, readonly RuntimeSlotLayoutEntry[]>();
  const cachedRuntimeDeviceIds = new Map<string, string | null>();
  let cachedOperatingTopology: CompiledSimulationTopology | null = null;
  let cachedOperatingPresentation: SimulationPresentationProjection | null = null;
  let cachedOperatingTickNumber: number | null = null;
  let cachedOperatingRunningState: SimulationStateReadWrite["runningState"] | null = null;
  let cachedOperatingPowerOutage = false;
  let cachedDarkPipeStatusSourceByDeviceId = new Map<string, string>();
  const cachedOperatingStatuses = new Map<string, {
    readonly snapshot: RuntimeDeviceSnapshot;
    readonly status: SimulationDeviceOperatingStatus;
  }>();
  return {
    getCurrentTickItemTransfers: () => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (topology === null || presentation === null) return [];
      return presentation.getTransfers().flatMap((transfer) => {
        const edge = topology.transferEdges[transfer.edgeId];
        const source = edge === undefined ? undefined : topology.ports[edge.sourcePortId];
        const target = edge === undefined ? undefined : topology.ports[edge.targetPortId];
        if (!source || !target || source.isPipe || target.isPipe || transfer.amount <= 0) return [];
        const sourceDeviceId = topology.devices[source.deviceId]?.sourceEntityId;
        const targetDeviceId = topology.devices[target.deviceId]?.sourceEntityId;
        if (!sourceDeviceId || !targetDeviceId) return [];
        return [{ sourceDeviceId, targetDeviceId,
          itemId: transfer.itemType, amount: transfer.amount }];
      });
    },
    getStatusRuntimeJson: () => {
      context.beforeReadDebugData?.();
      const presentation = context.getPresentation();
      const state = context.state;
      return JSON.stringify({
        state: {
          runningState: state.runningState,
          simulationSpeed: state.simulationSpeed,
          currentPlaybackTickNumber: state.currentPlaybackTickNumber,
        },
        runtimeStatus: state.runtimeStatus,
        currentTick: presentation === null || presentation.tickNumber === null
          ? null
          : {
              tickNumber: presentation.tickNumber,
              standardTickRate: presentation.standardTickRate,
              tickRate: presentation.tickRate,
              status: presentation.status,
              totalPowerDemand: presentation.totalPowerDemand,
              transferCount: presentation.getTransfers().length,
              diagnosticCount: presentation.getDiagnostics().length,
              ...(context.getDebugDataEnabled() && presentation.debugData !== undefined
                ? { debugData: presentation.debugData } : {}),
            },
      });
    },
    getPerformanceDiagnostics: () => context.getPerformanceDiagnostics(),
    getDocumentRuntimeStatus: () => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (topology === null || presentation === null) return null;
      return {
        tickNumber: presentation.tickNumber,
        standardTickRate: presentation.standardTickRate ?? topology.standardTickRate,
        tickRate: presentation.tickRate ?? topology.standardTickRate,
        totalPowerDemand: context.getTotalPowerDemand(topology, presentation),
        currentPowerGeneration: presentation.currentPowerGeneration,
        isPowerOutage: presentation.isPowerOutage,
        baseBatteryJoules: presentation.baseBatteryJoules,
        baseBatteryCapacity: presentation.baseBatteryCapacity,
      };
    },
    getDeviceOperatingStatus: (deviceId) => {
      const runningState = context.state.runningState;
      const topology = context.getTopology();
      const operatingStatusTopology = context.getOperatingStatusTopology();
      const presentation = context.getPresentation();
      const tickNumber = presentation?.tickNumber ?? null;
      if (topology === null || operatingStatusTopology === null
        || presentation === null || tickNumber === null) {
        return runningState === "stop" ? "closed" : null;
      }

      const topologyChanged = cachedOperatingTopology !== operatingStatusTopology;
      if (topologyChanged
        || cachedOperatingPresentation !== presentation
        || cachedOperatingTickNumber !== tickNumber
        || cachedOperatingRunningState !== runningState
        || cachedOperatingPowerOutage !== presentation.isPowerOutage) {
        cachedOperatingStatuses.clear();
        cachedOperatingTopology = operatingStatusTopology;
        cachedOperatingPresentation = presentation;
        cachedOperatingTickNumber = tickNumber;
        cachedOperatingRunningState = runningState;
        cachedOperatingPowerOutage = presentation.isPowerOutage;
        if (topologyChanged) {
          cachedDarkPipeStatusSourceByDeviceId = resolveDarkPipeStatusSourceByDeviceId(
            operatingStatusTopology,
          );
        }
      }

      const compiledDeviceId = resolveCompiledDeviceId(operatingStatusTopology, deviceId);
      if (compiledDeviceId === null) return null;
      const statusSourceDeviceId = cachedDarkPipeStatusSourceByDeviceId.get(compiledDeviceId)
        ?? compiledDeviceId;
      const device = operatingStatusTopology.devices[statusSourceDeviceId];
      const snapshot = presentation.getOperatingStatusDevice(statusSourceDeviceId);
      if (device === undefined || snapshot === null) return null;

      const cached = cachedOperatingStatuses.get(deviceId);
      if (cached?.snapshot === snapshot) return cached.status;
      const status = resolveDeviceOperatingStatus({
        device,
        snapshot,
        isPowerOutage: presentation.isPowerOutage,
        isIdleAsRunning: context.registryQueries.findEntityDefinition(device.definitionId)
          ?.isIdleAsRunning === true,
      });
      cachedOperatingStatuses.set(deviceId, { snapshot, status });
      return status;
    },
    getDeviceRuntimeStatus: (deviceId) => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (topology !== cachedTopology) {
        cachedTopology = topology;
        cachedShareCapSlotIds = topology === null ? null : resolveShareCapSlotIds(topology);
        cachedRuntimeSlotLayouts.clear();
        cachedRuntimeDeviceIds.clear();
      }
      if (presentation === null) return null;
      return resolveDeviceRuntimeStatus({
        topology, deviceId, presentation, shareCapSlotIds: cachedShareCapSlotIds,
        runtimeCanProgress: context.state.runtimeStatus.mode === "running",
        slotLayouts: cachedRuntimeSlotLayouts,
        compiledDeviceIds: cachedRuntimeDeviceIds,
      });
    },
    getPipeFluidItemId: (deviceId) => {
      const presentation = context.getPresentation();
      if (presentation === null) return null;
      return resolvePipeFluidItemId({
        runningState: context.state.runningState,
        topology: context.getTopology(), deviceId, presentation,
      });
    },
    isPipeDeviceSlotOccupied: (deviceId) => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (context.state.runningState === "stop" || topology === null
        || presentation === null || presentation.tickNumber === null) return false;
      const compiledId = resolveCompiledDeviceId(topology, deviceId);
      const device = compiledId === null ? undefined : topology.devices[compiledId];
      if (device === undefined || device.transportClass !== "strict-pipe") return false;
      // 遍历设备节点的 slot，有任意一个非空即视为占用。
      return device.nodeIds.some((nodeId) => topology.nodes[nodeId]?.slotIds.some((slotId) => {
        const slot = presentation.getSlot(slotId);
        return slot !== null && slot.itemType !== null;
      }) === true);
    },
    getActiveEnvironmentRanges: () => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (topology === null || presentation === null) return [];
      return presentation.getGasDiffusions()
        .filter((diffusion) => topology.devices[diffusion.sourceDeviceId] !== undefined)
        .map((diffusion) => ({
          sourceDeviceId: diffusion.sourceDeviceId,
          rangeId: diffusion.rangeId,
          rotation: diffusion.rotation,
          itemId: diffusion.itemId,
          gridRect: { ...diffusion.gridRect },
        }));
    },
    getDeviceActiveGasItemIds: (deviceId) => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (topology === null || presentation === null || presentation.tickNumber === null) return null;
      const diffusions = presentation.getGasDiffusions().filter(range => context.registryQueries.findItemDefinition(range.itemId)?.tags.includes("gas"));
      if (diffusions.length === 0) return null;
      const compiledId = resolveCompiledDeviceId(topology, deviceId);
      if (compiledId === null) return null;
      const itemIds = buildDeviceGasCoverage(topology, diffusions, context.registryQueries).get(compiledId);
      return itemIds === undefined ? null : [...itemIds];
    },
    getWarehouseStats: () => {
      const stats = context.getWarehouseStats();
      if (stats === null) return null;
      return {
        items: Object.fromEntries(Object.entries(stats.items).map(([itemId, item]) => [itemId, {
          producedPerMinute: item.producedPerMinute,
          consumedPerMinute: item.consumedPerMinute,
          warehouseCount: item.warehouseCount,
          infinite: item.infinite,
          lastChangedTick: item.lastChangedTick,
        }])),
        statsWindowReady: stats.statsWindowReady,
      };
    },
  };
}

export function resolveDeviceOperatingStatus(options: {
  device: CompiledSimulationTopology["devices"][string];
  snapshot: RuntimeDeviceSnapshot;
  isPowerOutage: boolean;
  isIdleAsRunning: boolean;
}): SimulationDeviceOperatingStatus {
  if (options.device.powerStatus === "out-of-power-range") return "not-in-power-net";
  if (options.device.requiresPower && options.isPowerOutage) return "no-power";

  let hasProgressingRecipe = false;
  for (const recipe of Object.values(options.snapshot.channelRecipes)) {
    if (recipe?.state === "waiting-output") return "blocked";
    hasProgressingRecipe ||= recipe?.state === "running" && recipe.isProgressing;
  }
  return hasProgressingRecipe || (options.isIdleAsRunning && !options.isPowerOutage)
    ? "normal"
    : "idle";
}



/**
 * 已直连暗管以出口运输配方作为整对设备的展示状态源。
 * 索引仅在 topology 变化时构建，逐设备状态查询不扫描 links。
 */
export function resolveDarkPipeStatusSourceByDeviceId(
  topology: CompiledSimulationTopology,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const link of Object.values(topology.links)) {
    if (link.linkType !== "share-all") continue;
    const outletDeviceId = resolveDarkPipeLinkEndpointDeviceId({
      topology,
      slotIds: link.sourceSlotIds,
      expectedRole: "outlet",
      expectedStorageGroupId: DARK_PIPE_OUTLET_STORAGE_GROUP_ID,
    });
    const inletDeviceId = resolveDarkPipeLinkEndpointDeviceId({
      topology,
      slotIds: link.targetSlotIds,
      expectedRole: "inlet",
      expectedStorageGroupId: DARK_PIPE_INLET_STORAGE_GROUP_ID,
    });
    if (outletDeviceId === null || inletDeviceId === null) continue;
    result.set(outletDeviceId, outletDeviceId);
    result.set(inletDeviceId, outletDeviceId);
  }
  return result;
}

function resolveDarkPipeLinkEndpointDeviceId(options: {
  readonly topology: CompiledSimulationTopology;
  readonly slotIds: readonly string[];
  readonly expectedRole: "inlet" | "outlet";
  readonly expectedStorageGroupId: string;
}): string | null {
  let resolvedDeviceId: string | null = null;
  for (const slotId of options.slotIds) {
    const slot = options.topology.slots[slotId];
    if (slot?.sourceStorageSlotGroupId !== options.expectedStorageGroupId) continue;
    const node = options.topology.nodes[slot.nodeId];
    const device = node === undefined ? undefined : options.topology.devices[node.deviceId];
    if (device === undefined || resolveDarkPipeRole(device.definitionId) !== options.expectedRole) continue;
    if (resolvedDeviceId !== null && resolvedDeviceId !== device.id) return null;
    resolvedDeviceId = device.id;
  }
  return resolvedDeviceId;
}



function resolvePipeFluidItemId(options: {
  runningState: SimulationStateReadWrite["runningState"];
  topology: CompiledSimulationTopology | null;
  deviceId: string;
  presentation: SimulationPresentationProjection;
}): string | null {
  if (
    options.runningState === "stop"
    || options.topology === null
    || options.presentation.tickNumber === null
  ) {
    return null;
  }

  const device = options.topology.devices[options.deviceId]
    ?? options.topology.devices[`device:${options.deviceId}`];
  if (device === undefined || device.transportClass !== "strict-pipe") {
    return null;
  }

  const componentId = device.transportComponentId;
  if (componentId === null) {
    return null;
  }

  return options.presentation.getTransportComponentItemType(componentId);
}



function resolveDeviceRuntimeStatus(options: {
  topology: CompiledSimulationTopology | null;
  deviceId: string;
  presentation: SimulationPresentationProjection;
  shareCapSlotIds: Set<string> | null;
  runtimeCanProgress: boolean;
  slotLayouts: Map<string, readonly RuntimeSlotLayoutEntry[]>;
  compiledDeviceIds: Map<string, string | null>;
}): SimulationDeviceRuntimeStatusReadModel | null {
  const currentTickNumber = options.presentation.tickNumber;
  if (options.topology === null || currentTickNumber === null) {
    return null;
  }

  let compiledDeviceId = options.compiledDeviceIds.get(options.deviceId);
  if (compiledDeviceId === undefined) {
    compiledDeviceId = resolveCompiledDeviceId(options.topology, options.deviceId);
    options.compiledDeviceIds.set(options.deviceId, compiledDeviceId);
  }
  if (compiledDeviceId === null) {
    return null;
  }

  const deviceSnapshot = options.presentation.getDevice(compiledDeviceId);
  if (deviceSnapshot === null) {
    return null;
  }

  const channelRecipes: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null> = {};
  if (deviceSnapshot.channelRecipes) {
    for (const [chId, chRecipe] of Object.entries(deviceSnapshot.channelRecipes)) {
      channelRecipes[chId] = chRecipe === null
        ? null
        : {
            channelId: chId,
            recipeId: chRecipe.recipeId,
            progressSeconds: convertSimulationTicksToSeconds(
              chRecipe.progressTicks,
              options.topology.standardTickRate,
            ),
            desiredSeconds: convertSimulationTicksToSeconds(
              chRecipe.durationTicks,
              options.topology.standardTickRate,
            ),
            isProgressing: chRecipe.isProgressing && options.runtimeCanProgress,
            state: chRecipe.state,
          };
    }
  }

  return {
    channelRecipes,
    ...(deviceSnapshot.deviceState === undefined ? {} : { deviceState: deviceSnapshot.deviceState }),
    ...(deviceSnapshot.cultivation === undefined ? {} : { cultivation: deviceSnapshot.cultivation }),
    admissionCounters: Object.fromEntries(
      Object.entries(deviceSnapshot.admissionCounters ?? {}).map(([portRef, counter]) => {
        const windowTicks = options.topology!.standardTickRate * 10;
        const currentWindowStartTick = options.topology!.standardTickRate > 0
          ? 1 + Math.floor(Math.max(0, currentTickNumber - 1) / windowTicks) * windowTicks
          : 1;
        const cutoff = currentTickNumber - options.topology!.standardTickRate * 60;
        // pastWindowCounts 存 6 个已完成窗口：[0]=最旧（可能部分超出 60s）, [1..5]=完整窗口。
        // oneMinuteCount = 精算最旧窗口在 cutoff 内的部分 + 累加 [1..5] + 当前窗口。
        const oldestWindowStart = currentWindowStartTick - ADMISSION_RATE_WINDOWS_PER_MINUTE * windowTicks;
        const earliestFullWindowStart = currentWindowStartTick - (ADMISSION_RATE_WINDOWS_PER_MINUTE - 1) * windowTicks;
        const oldestPartial = (counter.moveTicks ?? []).reduce(
          (sum, t) => t >= oldestWindowStart && t < earliestFullWindowStart && t > cutoff ? sum + 1 : sum,
          0,
        );
        const fullWindowsSum = counter.pastWindowCounts.slice(1).reduce((sum, c) => sum + c, 0);
        const oneMinuteCount = oldestPartial + fullWindowsSum + counter.rateWindowCount;
        return [
          portRef,
          {
            portGroupId: counter.portGroupId,
            portId: counter.portDefinitionId,
            itemType: counter.itemId,
            limit: counter.limit,
            count: counter.count,
            perMinuteLimit: counter.perMinuteLimit,
            rateWindowCount: counter.rateWindowCount,
            oneMinuteCount,
          },
        ] as const;
      }),
    ),
    powerStatus: options.topology.devices[compiledDeviceId]?.powerStatus ?? null,
    slotItems: resolveDeviceRuntimeSlotItems({
      topology: options.topology,
      compiledDeviceId,
      presentation: options.presentation,
      shareCapSlotIds: options.shareCapSlotIds,
      slotLayouts: options.slotLayouts,
    }),
  };
}



function resolveCompiledDeviceId(
  topology: CompiledSimulationTopology,
  deviceId: string,
): string | null {
  if (topology.devices[deviceId] !== undefined) {
    return deviceId;
  }

  const directCompiledId = `device:${deviceId}`;
  if (topology.devices[directCompiledId] !== undefined) {
    return directCompiledId;
  }

  return topology.ordering.deviceOrder.find((topologyDeviceId) =>
    topology.devices[topologyDeviceId]?.sourceEntityId === deviceId
    || `device:${topology.devices[topologyDeviceId]?.sourceEntityId}` === deviceId,
  ) ?? null;
}



function resolveShareCapSlotIds(
  topology: CompiledSimulationTopology,
): Set<string> {
  return new Set(
    Object.values(topology.links)
      .filter((link) => link.linkType === "share-cap")
      .flatMap((link) => [...link.sourceSlotIds, ...link.targetSlotIds]),
  );
}



function resolveDeviceRuntimeSlotItems(options: {
  topology: CompiledSimulationTopology;
  compiledDeviceId: string;
  presentation: SimulationPresentationProjection;
  shareCapSlotIds: Set<string> | null;
  slotLayouts: Map<string, readonly RuntimeSlotLayoutEntry[]>;
}): SimulationDeviceRuntimeSlotItemReadModel[] {
  let layout = options.slotLayouts.get(options.compiledDeviceId);
  if (layout === undefined) {
    layout = compileDeviceRuntimeSlotLayout(options);
    options.slotLayouts.set(options.compiledDeviceId, layout);
  }
  const slotItems: SimulationDeviceRuntimeSlotItemReadModel[] = [];
  const itemIndexesByGroup: Array<number | undefined> = [];
  for (const slot of layout) {
    const snapshot = options.presentation.getSlot(slot.compiledSlotId);
    if (snapshot === null) continue;
    const itemIndex = itemIndexesByGroup[slot.groupIndex];
    if (itemIndex === undefined) {
      const item: SimulationDeviceRuntimeSlotItemReadModel = {
        storageGroupId: slot.storageGroupId,
        slotId: slot.slotId,
        viewRole: slot.viewRole,
        itemType: snapshot.itemType,
        count: Math.max(0, snapshot.count),
        reserved: Math.max(0, snapshot.reserved),
        ignoreStock: snapshot.ignoreStock,
      };
      itemIndexesByGroup[slot.groupIndex] = slotItems.length;
      slotItems.push(item);
    } else {
      const existing = slotItems[itemIndex]!;
      slotItems[itemIndex] = {
        storageGroupId: slot.storageGroupId,
        slotId: slot.slotId,
        viewRole: slot.viewRole,
        itemType: existing.itemType ?? snapshot.itemType,
        count: Math.max(existing.count, snapshot.count),
        reserved: Math.max(existing.reserved, snapshot.reserved),
        ignoreStock: existing.ignoreStock || snapshot.ignoreStock,
      };
    }
  }
  return slotItems;
}

function compileDeviceRuntimeSlotLayout(options: {
  topology: CompiledSimulationTopology;
  compiledDeviceId: string;
  shareCapSlotIds: Set<string> | null;
}): readonly RuntimeSlotLayoutEntry[] {
  const device = options.topology.devices[options.compiledDeviceId];
  if (device === undefined) {
    return [];
  }

  const shareCapSlotIds = options.shareCapSlotIds ?? new Set<string>();
  const groupIndexes = new Map<string, number>();
  const layout: RuntimeSlotLayoutEntry[] = [];
  for (const nodeId of device.nodeIds) {
    const node = options.topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }

    for (const compiledSlotId of node.slotIds) {
      const compiledSlot = options.topology.slots[compiledSlotId];
      if (compiledSlot === undefined) {
        continue;
      }

      const isShareCapSlot = shareCapSlotIds.has(compiledSlotId);
      const storageGroupId = compiledSlot.sourceStorageSlotGroupId ?? "synthetic";
      const sourceSlotId = compiledSlot.sourceSlotId ?? compiledSlot.id;
      const realSlotKey = isShareCapSlot
        ? compiledSlotId
        : `${storageGroupId}:${sourceSlotId}`;
      let groupIndex = groupIndexes.get(realSlotKey);
      if (groupIndex === undefined) {
        groupIndex = groupIndexes.size;
        groupIndexes.set(realSlotKey, groupIndex);
      }
      layout.push({
        compiledSlotId,
        groupIndex,
        storageGroupId,
        slotId: sourceSlotId,
        viewRole: isShareCapSlot ? node.viewRole : "single-view",
      });
    }
  }

  return layout;
}

