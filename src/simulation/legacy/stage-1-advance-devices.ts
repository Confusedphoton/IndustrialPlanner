import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
  RegionalWarehouseWriteContext,
} from "../contracts";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import type { RuntimeDeviceRecipeState, RuntimeDeviceState } from "./runtime-state";
import { completeRecipeIfPossible } from "./recipe-completion";
import { isDeviceInRequiredGasDiffusion } from "./gas-diffusion";
import { isDeviceConsumptionAuthorizedForFrame } from "./consumption-channel";
import type { RegistryContract } from "@/domain/registry/registry-contract";


/**
 * 对应《仿真运行原理》§5.1 Tick 阶段 1：推进设备内部状态。
 * 该阶段只处理已经启动的配方：累计进度，完成后尝试把产物写入输出缓存；
 * 输出缓存不足时保持 waiting-output，等待本 tick 后续输送或二次结算释放空间。
 */
export function advanceDevices(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  standardStepTicks = 1,
  powerMode: "real" | "infinite" = "infinite",
  currentPowerGeneration = Infinity,
  effectiveTotalPowerDemand = topology.totalPowerDemand,
  regionalWarehouse?: RegionalWarehouseWriteContext,
): void {
  const progressTicks = Math.max(1, Math.trunc(standardStepTicks));
  const powerInsufficient = powerMode === "real"
    && currentPowerGeneration < effectiveTotalPowerDemand;

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    const hasDevicePower = device.powerStatus !== "out-of-power-range"
      && !(powerInsufficient && device.requiresPower);
    const consumptionAuthorized = isDeviceConsumptionAuthorizedForFrame(device, state);

    for (const channel of device.recipeChannels) {
      const chId = channel.id;
      const recipe = deviceState.channelRecipes[chId] ?? null;
      if (recipe === null) {
        continue;
      }

      if (recipe.state === "running" && channel.type !== "consumption-channel") {
        if (!hasDevicePower || !consumptionAuthorized) {
          continue;
        }
        if (!isDeviceInRequiredGasDiffusion({
          topology,
          state,
          device,
          requiredEnvironmentAnyOf: recipe.plan.requiredEnvironmentAnyOf,
        })) {
          continue;
        }
      }

      deviceState.channelRecipes[chId] = advanceChannelRecipe({
        registry,
        topology,
        state,
        device,
        deviceState,
        recipe,
        progressTicks,
        regionalWarehouse,
      });
    }
  }
}

function advanceChannelRecipe(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly device: CompiledSimulationDevice;
  readonly deviceState: RuntimeDeviceState;
  readonly recipe: RuntimeDeviceRecipeState;
  readonly progressTicks: number;
  readonly regionalWarehouse?: RegionalWarehouseWriteContext;
}): RuntimeDeviceRecipeState | null {
  const recipe = options.recipe;

  if (recipe.state === "running") {
    recipe.progressTicks = Math.min(
      recipe.durationTicks,
      recipe.progressTicks + options.progressTicks,
    );
    if (recipe.progressTicks < recipe.durationTicks) {
      return recipe;
    }
    recipe.state = "waiting-output";
  }

  if (!completeRecipeIfPossible({
    registry: options.registry,
    topology: options.topology,
    state: options.state,
    deviceId: options.device.id,
    recipe,
    regionalWarehouse: options.regionalWarehouse,
  })) {
    recipe.progressTicks = recipe.durationTicks;
    recipe.state = "waiting-output";
    options.deviceState.block = true;
    return recipe;
  }

  options.deviceState.block = false;
  return null;
}

