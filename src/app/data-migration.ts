import { prepareLocalJsonMigration } from "@/shared/storage/migration-records";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { DataMigrationJob, DataMigrationPlan } from "@/shared/data-migration";
import { prepareModuleBalancingMigration } from "./storage/module-balancing-storage";
import { prepareRegionalSettingsMigration } from "./regional-settings/storage";
import { createUiStateReadWrite, type AppSettingsReadWrite } from "./state/state-impl";
import { APP_SETTINGS_LOCAL_STORAGE_KEY, WORKBENCH_STATE_LOCAL_STORAGE_KEY,
  normalizePersistedAppSettings, normalizePersistedWorkbenchState } from "./state/storage-hook";

export async function prepareAppDataMigration(registry: RegistryContract, version = "app-7"): Promise<DataMigrationPlan> {
  const jobs: DataMigrationJob[] = [];
  const defaults = createUiStateReadWrite();
  const plans = [
    await prepareLocalJsonMigration(APP_SETTINGS_LOCAL_STORAGE_KEY,
      value => normalizePersistedAppSettings(value as AppSettingsReadWrite, defaults.settings), "应用设置", version),
    await prepareLocalJsonMigration(WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      value => normalizePersistedWorkbenchState(value, defaults.workbench), "工作台设置", version),
    await prepareModuleBalancingMigration(version),
    await prepareRegionalSettingsMigration(registry.itemDefinitions, version),
  ];
  for (const plan of plans) jobs.push(...plan.jobs);
  return { jobs, get issues() { return plans.flatMap(plan => plan.issues ?? []); } };
}
