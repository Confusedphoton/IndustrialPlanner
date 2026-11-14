import type { RecipeRandomSource } from "../recipe-selection";
import { isSimulationWholeSecondTick } from "../contracts";
import { stateRequestedRecipe, hasEnvironmentDemand } from "./stage-6-process-device-states";
import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipeChannel,
  CompiledSimulationTopology,
  RegionalWarehouseWriteContext,
} from "../contracts";
import type { RuntimeDeviceRecipeState, SimulationMutableRuntimeState } from "./runtime-state";
import {
  adjustReservedAmounts,
  consumeSelections,
  createStartableRecipeForChannel,
} from "./runtime-slot-access";
import { computeActiveGasDiffusions, getGasDiffusionRecipeSourceDeviceIds } from "./gas-diffusion";
import {
  computeActiveConsumptionDeviceIds,
  getConsumptionChannelDeviceIds,
  isDeviceConsumptionAuthorizedForFrame,
  resolveConsumptionChannelCount,
} from "./consumption-channel";

import { canDeviceTransferAtCurrentPhase, canRecipeLifecycleTransitionAtCurrentPhase } from "./phase-gating";
import type { RegistryContract } from "@/domain/registry/registry-contract";


/**
 * 对应《仿真运行原理》§5.5 Tick 阶段 5 二次结算，以及 §4 设备与配方状态。
 * 阶段职责：先让 waiting-output 的配方再次尝试落产物，然后为空闲设备按计划启动一轮配方。
 * instant 配方在结算阶段直接消耗输入并尝试输出；reserved-item 配方只预留输入，完成时再扣除。
 */
export function startRecipes(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipeRandom: RecipeRandomSource,
  powerMode: "real" | "infinite" = "infinite",
  currentPowerGeneration = Infinity,
  effectiveTotalPowerDemand = topology.totalPowerDemand,

): void {

  if (!canRecipeLifecycleTransitionAtCurrentPhase(topology, state)) {
    return;
  }
  startIdleDeviceChannels({
    registry,
    topology,
    state,
    channelType: "consumption-channel",
    recipeRandom,
    powerMode,
    currentPowerGeneration,
    effectiveTotalPowerDemand,
  });
  state.transient.activeConsumptionDeviceIds =
    computeActiveConsumptionDeviceIds(topology, state);
  state.transient.activeEnvironments = computeActiveGasDiffusions(registry, topology, state);
  startIdleDeviceChannels({ registry, topology, state, channelType: "normal-channel", recipeRandom, powerMode, currentPowerGeneration, effectiveTotalPowerDemand, providersOnly: true });
  state.transient.activeEnvironments = computeActiveGasDiffusions(registry, topology, state);
  startIdleDeviceChannels({
    registry,
    topology,
    state,
    channelType: "normal-channel",
    recipeRandom,
    powerMode,
    currentPowerGeneration,
    effectiveTotalPowerDemand,
  });
}

function startIdleDeviceChannels(options: {
  registry: RegistryContract;
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  channelType: CompiledSimulationRecipeChannel["type"];
  recipeRandom: RecipeRandomSource;
  powerMode: "real" | "infinite";
  currentPowerGeneration: number;
  effectiveTotalPowerDemand: number;
  regionalWarehouse?: RegionalWarehouseWriteContext;
  providersOnly?: boolean;
}): void {
  const powerInsufficient = options.powerMode === "real"
    && options.currentPowerGeneration < options.effectiveTotalPowerDemand;

  const deviceIds = options.channelType === "consumption-channel"
    ? getConsumptionChannelDeviceIds(options.topology)
    : options.providersOnly ? getGasDiffusionRecipeSourceDeviceIds(options.registry, options.topology) : options.topology.ordering.deviceOrder;
  for (const deviceId of deviceIds) {
    const device = options.topology.devices[deviceId];
    const deviceState = options.state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    if (options.channelType === "normal-channel") {
      if (device.powerStatus === "out-of-power-range") {
        continue;
      }
      if (powerInsufficient && device.requiresPower) {
        continue;
      }
      if (!isDeviceConsumptionAuthorizedForFrame(device, options.state)) {
        continue;
      }
      if (!canDeviceTransferAtCurrentPhase(options.registry, options.topology, options.state, device)) {
        continue;
      }
    }

    const consumptionChannelCount = resolveConsumptionChannelCount(device);
    const channelStartIndex = options.channelType === "consumption-channel"
      ? 0
      : consumptionChannelCount;
    const channelEndIndex = options.channelType === "consumption-channel"
      ? consumptionChannelCount
      : device.recipeChannels.length;
    for (
      let channelIndex = channelStartIndex;
      channelIndex < channelEndIndex;
      channelIndex += 1
    ) {
      const channel = device.recipeChannels[channelIndex];
      if (channel === undefined) {
        continue;
      }
      if (options.channelType === "normal-channel" && (channel.startPolicy === "environment-demand") !== (options.providersOnly === true)) continue;
      if (channel.startPolicy === "environment-demand" && !isSimulationWholeSecondTick(options.state.tickNumber, options.topology.standardTickRate)) continue;
      // Skip channels already running a recipe
      if (deviceState.channelRecipes[channel.id] !== undefined && deviceState.channelRecipes[channel.id] !== null) {
        continue;
      }

      const recipe = createStartableRecipeForChannel({
        registry: options.registry, topology: options.topology, state: options.state,
        device, channel, recipeRandom: options.recipeRandom,
        shouldStartPlan: plan => {
          if (channel.startPolicy === "state" && plan.recipeId !== stateRequestedRecipe(options.registry, options.topology, options.state, device.id)) return false;
          if (channel.startPolicy === "environment-demand" && !hasEnvironmentDemand(options.registry, options.topology, options.state, device.id, plan.recipeId)) return false;
          return true;
        },
      });
      if (recipe === null) {
        continue;
      }
      commitStartedRecipe(options.registry, options.state, device, recipe);
      deviceState.channelRecipes[channel.id] = recipe;

    }

    if (options.channelType === "normal-channel") {
      // Block if any channel is stuck
      const hasWaitingOutput = Object.values(deviceState.channelRecipes)
        .some((recipe) => recipe?.state === "waiting-output");
      const hasRunningRecipe = Object.values(deviceState.channelRecipes)
        .some((recipe) => recipe?.state === "running");
      const waitingForTime = deviceState.deviceState?.endsAtSeconds != null;
      const hasRequestedWork = device.recipeChannels.some(channel => channel.startPolicy !== "environment-demand")
        || options.registry.queries.findRecipeDefinitionsByMachine(device.definitionId)
          .some(recipe => hasEnvironmentDemand(options.registry, options.topology, options.state, device.id, recipe.id));
      deviceState.block = hasWaitingOutput || (!hasRunningRecipe && !waitingForTime && hasRequestedWork);
    }
  }
}

function commitStartedRecipe(
  registry: RegistryContract,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
  recipe: RuntimeDeviceRecipeState,
): void {
  if (recipe.recipeType === "immediate-consume") {
    consumeSelections(state.persistent.slots, recipe.reservations);
    // 记录 immediate-consume 配方的消耗统计（仅生产设备）
    if (registry.queries.findEntityDefinition(device.definitionId)?.tags.includes("Producer") === true) {
      const delta = state.transient.recipeStatsDelta;
      for (const input of recipe.inputItems) {
        delta.consumed[input.itemType] = (delta.consumed[input.itemType] ?? 0) + input.amount;
      }
    }
    recipe.reservations = [];
    return;
  }

  adjustReservedAmounts(state, recipe.reservations, 1);
}






