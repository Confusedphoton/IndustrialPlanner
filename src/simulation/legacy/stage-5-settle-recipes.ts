
import type { CompiledSimulationTopology, RegionalWarehouseWriteContext } from "../contracts";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { completeRecipeIfPossible } from "./recipe-completion";

/** Stage5 仅提交旧配方产物，任何新配方均由 Stage7 启动。 */
export function settleRecipes(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  regionalWarehouse?: RegionalWarehouseWriteContext,
): void {
  for (const deviceId of topology.ordering.deviceOrder) {
    const deviceState = state.persistent.devices[deviceId];
    if (deviceState === undefined) {
      continue;
    }

    for (const [chId, recipe] of Object.entries(deviceState.channelRecipes)) {
      if (recipe === null || recipe.state !== "waiting-output") {
        continue;
      }
      if (completeRecipeIfPossible({
        registry,
        topology,
        state,
        deviceId,
        recipe,
        regionalWarehouse,
      })) {
        deviceState.channelRecipes[chId] = null;
        deviceState.block = false;
      }
    }
  }
}
