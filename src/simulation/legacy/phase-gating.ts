import type { CompiledSimulationDevice, CompiledSimulationTopology } from "../contracts";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { RuntimeDeviceRecipeState, SimulationMutableRuntimeState } from "./runtime-state";
import {
  DYNAMIC_SIMULATION_TICK_RATES,
  convertSimulationSecondsToTicksExact,
  isDynamicTickRateCompatibleWithTransferUnits,
  resolveRecipePhaseTicks,
} from "../contracts";
import {
  BELT_TRANSPORT_DURATION_SECONDS,
  PIPE_TRANSPORT_DURATION_SECONDS,
} from "@/domain/registry";

export interface TransportRecipeTiming {
  readonly durationTicks: number;
  readonly recipeIdSuffix: "dynamic-belt-transfer" | "dynamic-pipe-transfer";
}


export function isPhaseGatedLogisticsDevice(
  registry: RegistryContract,
  device: CompiledSimulationDevice,
): boolean {
  // 修复传送带相位门禁丢失：2026-07-23 重构把 dedicated 门禁替换为 phase-gated 时只认
  // PipeFamily，导致 BeltFamily 在运行时恒放行（逐 tick 传输），不符合《仿真Tick计算规则
  // 和物流门控说明》§3 的物流相位对齐规则。现恢复为两族都受门禁。
  return registry.queries.isBeltFamily(device.definitionId)
    || registry.queries.isPipeFamily(device.definitionId);
}

export function resolveTransportRecipeTiming(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): TransportRecipeTiming | null {
  const isBelt = registry.queries.isBeltFamily(device.definitionId);
  const isPipe = registry.queries.isPipeFamily(device.definitionId);

  if (!isBelt && !isPipe) {
    return null;
  }

  const durationSeconds = isBelt ? BELT_TRANSPORT_DURATION_SECONDS : PIPE_TRANSPORT_DURATION_SECONDS;
  const durationTicks = convertSimulationSecondsToTicksExact(
    durationSeconds,
    topology.standardTickRate,
  );
  if (durationTicks === null) {
    throw new Error(
      `Transport duration ${durationSeconds}s is not exactly representable at ${topology.standardTickRate} TPS.`,
    );
  }
  return {
    durationTicks,
    recipeIdSuffix: isBelt ? "dynamic-belt-transfer" : "dynamic-pipe-transfer",
  };
}



export function resolvePhaseGatedLogisticsTransferUnitTicks(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): number | null {
  if (!isPhaseGatedLogisticsDevice(registry, device)) {
    return null;
  }

  const timing = resolveTransportRecipeTiming(registry, topology, device);
  if (timing === null) {
    return null;
  }

  return Math.min(timing.durationTicks, topology.standardTickRate);
}

export function resolveActivePhaseGatedLogisticsTransferUnitTicks(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): readonly number[] {
  const transferUnitTicks = new Set<number>();
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    const unitTicks = resolvePhaseGatedLogisticsTransferUnitTicks(registry, topology, device);
    if (unitTicks !== null) {
      transferUnitTicks.add(unitTicks);
    }
  }

  return [...transferUnitTicks].sort((left, right) => left - right);
}

export function resolveDynamicTickRateSwitchIntervalTicks(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): number {
  const transferUnitTicks = resolveActivePhaseGatedLogisticsTransferUnitTicks(registry, topology);
  const recipePhaseTicks = resolveRecipePhaseTicks(topology.standardTickRate);
  if (recipePhaseTicks === null) {
    return 0;
  }
  return transferUnitTicks.reduce(
    (currentLcm, transferUnitTicks) => lcm(currentLcm, transferUnitTicks),
    recipePhaseTicks,
  );
}

export function canAdjustDynamicTickRateAtTick(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly standardTick: number;
}): boolean {
  const switchIntervalTicks = resolveDynamicTickRateSwitchIntervalTicks(options.registry, options.topology);
  return options.standardTick === 0
    || (switchIntervalTicks > 0
      && (options.standardTick - 1) % switchIntervalTicks === 0);
}

export function resolveLegalDynamicTickRates(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): readonly number[] {
  const transferUnitTicks = resolveActivePhaseGatedLogisticsTransferUnitTicks(registry, topology);
  const recipePhaseTicks = resolveRecipePhaseTicks(topology.standardTickRate);
  if (recipePhaseTicks === null) {
    return [];
  }
  return DYNAMIC_SIMULATION_TICK_RATES.filter((dynamicTickRate) =>
    isDynamicTickRateCompatibleWithTransferUnits({
      dynamicTickRate,
      transferUnitTicks: [...transferUnitTicks, recipePhaseTicks],
      standardTickRate: topology.standardTickRate,
    }),
  );
}


export function canPhaseGatedLogisticsTransferAtTick(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly device: CompiledSimulationDevice;
  readonly standardTick: number;
}): boolean {
  const transferUnitTicks = resolvePhaseGatedLogisticsTransferUnitTicks(
    options.registry,
    options.topology,
    options.device,
  );
  if (transferUnitTicks === null) {
    return true;
  }

  return (options.standardTick - 1) % transferUnitTicks === 0;
}

export function canDeviceTransferAtCurrentPhase(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
): boolean {
  return canPhaseGatedLogisticsTransferAtTick({
    registry,
    topology,
    device,
    standardTick: state.tickNumber,
  });
}

export function canRecipeFinishAtCurrentPhase(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  if (!canRecipeLifecycleTransitionAtCurrentPhase(topology, state)) {
    return false;
  }
  const device = resolveRecipeDevice(topology, recipe);
  if (device === null) {
    return true;
  }

  return canDeviceTransferAtCurrentPhase(registry, topology, state, device);
}

export function canRecipeLifecycleTransitionAtCurrentPhase(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): boolean {
  const phaseTicks = resolveRecipePhaseTicks(topology.standardTickRate);
  return phaseTicks !== null
    && (state.tickNumber - 1) % phaseTicks === 0;
}


function resolveRecipeDevice(
  topology: CompiledSimulationTopology,
  recipe: RuntimeDeviceRecipeState,
): CompiledSimulationDevice | null {
  for (const nodeId of [...recipe.plan.ingredientNodeIds, ...recipe.plan.productNodeIds]) {
    const deviceId = topology.nodes[nodeId]?.deviceId;
    const device = deviceId === undefined ? undefined : topology.devices[deviceId];
    if (device !== undefined) {
      return device;
    }
  }

  return null;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function lcm(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return Math.abs(left * right) / gcd(left, right);
}
