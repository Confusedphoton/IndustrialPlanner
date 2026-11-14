import { findEntityRange, resolveLocalRangeGridRect } from "@/shared/geometry/entity-range";
import { buildDeviceGasCoverage } from "@/simulation/projection";
import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
  RuntimeEnvironmentSnapshot,
} from "../contracts";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";



interface GasDiffusionTopologyIndex {
  readonly registryQueries: RegistryContract["queries"];
  readonly sourceDeviceIds: readonly string[];
  readonly recipeSourceDeviceIds: readonly string[];
}

interface GasDiffusionRuntimeIndex {
  readonly topology: CompiledSimulationTopology;
  activeEnvironments: readonly RuntimeEnvironmentSnapshot[];
  coveredGasItemIdsByDeviceId: ReadonlyMap<string, ReadonlySet<string>>;
}

const EMPTY_GAS_DIFFUSIONS: readonly RuntimeEnvironmentSnapshot[] = [];

const topologyIndexByTopology = new WeakMap<CompiledSimulationTopology, GasDiffusionTopologyIndex>();
const runtimeIndexByState = new WeakMap<SimulationMutableRuntimeState, GasDiffusionRuntimeIndex>();

/**
 * 派生索引通过 WeakMap 绑定运行时状态，不进入每 tick 的深拷贝；拓扑迁移或状态恢复会自然创建新索引。
 */
export function computeActiveGasDiffusions(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): readonly RuntimeEnvironmentSnapshot[] {
  const topologyIndex = ensureGasDiffusionTopologyIndex(registry, topology);
  return topologyIndex.sourceDeviceIds.length === 0
    ? EMPTY_GAS_DIFFUSIONS
    : collectActiveGasDiffusions(registry, topology, state, topologyIndex.sourceDeviceIds);
}

/** 气体配方的首轮启动只需要访问这些设备，普通设备不应为此被重复扫描。 */
export function getGasDiffusionRecipeSourceDeviceIds(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): readonly string[] {
  return ensureGasDiffusionTopologyIndex(registry, topology).recipeSourceDeviceIds;
}

export function isDeviceInRequiredGasDiffusion(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly device: CompiledSimulationDevice;
  readonly requiredEnvironmentAnyOf: readonly string[] | null;
}): boolean {
  if (options.requiredEnvironmentAnyOf === null) {
    return true;
  }

  const runtimeIndex = ensureGasDiffusionRuntimeIndex(options.topology, options.state);
  const covered = runtimeIndex.coveredGasItemIdsByDeviceId.get(options.device.id);
  return options.requiredEnvironmentAnyOf.some(itemId => covered?.has(itemId));
}

/** 获取设备当前完全处于的气体 itemId 集合。无任何气体覆盖时返回 null。 */
export function getDeviceCoveredGasItemIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  deviceId: string,
): ReadonlySet<string> | null {
  const runtimeIndex = ensureGasDiffusionRuntimeIndex(topology, state);
  return runtimeIndex.coveredGasItemIdsByDeviceId.get(deviceId) ?? null;
}

function ensureGasDiffusionRuntimeIndex(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): GasDiffusionRuntimeIndex {
  const activeEnvironments = state.transient.activeEnvironments;
  let runtimeIndex = runtimeIndexByState.get(state);
  if (
    runtimeIndex === undefined
    || runtimeIndex.topology !== topology
    || runtimeIndex.activeEnvironments !== activeEnvironments
  ) {
    runtimeIndex = {
      topology,
      activeEnvironments,
      coveredGasItemIdsByDeviceId: buildDeviceGasCoverage(topology, activeEnvironments, topologyIndexByTopology.get(topology)?.registryQueries),
    };
    runtimeIndexByState.set(state, runtimeIndex);
  }
  return runtimeIndex;
}

function ensureGasDiffusionTopologyIndex(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): GasDiffusionTopologyIndex {
  const cached = topologyIndexByTopology.get(topology);
  if (cached !== undefined) {
    return cached;
  }

  const recipeSourceDeviceIds: string[] = [];
  const sourceDeviceIds: string[] = [];

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    const canRunGasDiffusionRecipe = registry.queries
      .findRecipeDefinitionsByMachine(device.definitionId)
      .some((recipe) =>
        isRecipeAvailableByActivity(recipe, topology.activeActivityIds)
        && recipe.environmentOutput !== undefined,
      )
      && (device.recipeChannels ?? []).length > 0;
    if (canRunGasDiffusionRecipe) {
      recipeSourceDeviceIds.push(deviceId);
    }
    if (canRunGasDiffusionRecipe) {
      sourceDeviceIds.push(deviceId);
    }
  }

  const result = { sourceDeviceIds, recipeSourceDeviceIds, registryQueries: registry.queries };
  topologyIndexByTopology.set(topology, result);
  return result;
}

function collectActiveGasDiffusions(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  sourceDeviceIds: readonly string[],
): readonly RuntimeEnvironmentSnapshot[] {
  const result: RuntimeEnvironmentSnapshot[] = [];
  const seenSourceGasPairs = new Set<string>();

  for (const deviceId of sourceDeviceIds) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    for (const channel of device.recipeChannels) {
      const recipe = deviceState.channelRecipes[channel.id];
      if (channel.type !== "consumption-channel"
        && (device.powerStatus === "out-of-power-range" || (device.requiresPower && state.transient.isPowerOutage))) continue;
      if (recipe?.state !== "running") {
        continue;
      }
      const output = recipe?.plan.environmentOutput ?? null;
      if (output === null) {
        continue;
      }
      const sourceGasKey = `${device.id}\u0000${output.itemId}\u0000${output.rangeId}`;
      if (seenSourceGasPairs.has(sourceGasKey)) {
        continue;
      }

      const gridRect = resolveDeviceRangeRect(device, registry, output.rangeId);
      if (gridRect === null) {
        continue;
      }

      result.push({
        sourceDeviceId: device.id,
        rangeId: output.rangeId,
        rotation: device.rotation!,
        itemId: output.itemId,
        gridRect,
      });
      seenSourceGasPairs.add(sourceGasKey);
    }
  }

  return result;
}

function resolveDeviceRangeRect(
  device: CompiledSimulationDevice, registry: RegistryContract, rangeId: string,
): RuntimeEnvironmentSnapshot["gridRect"] | null {
  if (device.position === null || device.rotation === null || device.footprint === null) return null;
  const definition = registry.queries.findEntityDefinition(device.definitionId);
  if (!definition) throw new Error(`Unknown range provider: ${device.definitionId}`);
  return resolveLocalRangeGridRect(device.position, device.footprint, device.rotation, findEntityRange(definition, rangeId).localRect);
}
