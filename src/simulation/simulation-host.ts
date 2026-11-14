import type { SimulationEngineKind } from "@/domain/simulation/types/simulation-types";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { CreateSimulationHostOptions, SimulationHost, SimulationHostFactory } from "./contracts";
import { createLegacySimulationHost } from "./legacy";
import { assertDataMigrationIdle } from "@/shared/data-migration";

export type { SimulationEngineKind } from "@/domain/simulation/types/simulation-types";
export type { CreateSimulationHostOptions, SimulationHost, SimulationHostWorkerMode } from "./contracts";

const SIMULATION_ENGINE_REGISTRY = {
  legacy: createLegacySimulationHost,
} satisfies Record<SimulationEngineKind, SimulationHostFactory>;

/** 所有公开可选的仿真引擎；测试矩阵与运行时入口共用这一份注册表。 */
export const SUPPORTED_SIMULATION_ENGINE_KINDS = Object.freeze(Object.keys(SIMULATION_ENGINE_REGISTRY) as SimulationEngineKind[]);

export function createSimulationHost(workspace: WorkspaceContract, options: CreateSimulationHostOptions = {}): SimulationHost {
  const host = SIMULATION_ENGINE_REGISTRY[options.engineKind ?? "legacy"](workspace, options);
  const start = host.actions.start.bind(host.actions);
  host.actions.start = async () => { assertDataMigrationIdle(); await start(); };
  return host;
}

