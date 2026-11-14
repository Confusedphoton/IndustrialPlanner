import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import {
  applyIndexedDbTransactionMutations,
  deleteFromIndexedDb,
  readFromIndexedDb,
  type IndexedDbStorageLocation,
} from "@/shared/storage/browser-storage";
import { LEGACY_REGIONAL_SETTINGS_LOCATION } from "@/shared/legacy-regional-dark-pipe";
import {
  readFromIndexedDbWithMigration,
  prepareVersionedStorageMigration,
  type StorageMigration,
} from "@/shared/storage/migration";
import {
  emitStorageChange,
  type StorageWriteOptions,
} from "@/shared/storage/storage-change-event";
import {
  normalizeRegionalSettingsAsset,
  REGIONAL_SETTINGS_ASSET_ID,
  REGIONAL_SETTINGS_SCHEMA_VERSION,
  type RegionalSettingsAsset,
} from "./model";

const REGIONAL_SETTINGS_STORE_LOCATION: IndexedDbStorageLocation = {
  ...LEGACY_REGIONAL_SETTINGS_LOCATION,
};

export async function prepareRegionalSettingsMigration(itemDefinitions: readonly ItemDefinition[], version?: string) {
  const normalize = (raw: unknown) => normalizeRegionalSettingsAsset(raw, itemDefinitions);
  const plan = await prepareVersionedStorageMigration(REGIONAL_SETTINGS_STORE_LOCATION, REGIONAL_SETTINGS_SCHEMA_VERSION,
    [{ version: REGIONAL_SETTINGS_SCHEMA_VERSION, migrate: normalize }], undefined, normalize, "地区设置", version);
  return { ...plan, jobs: plan.jobs.map(job => ({ ...job, run: async () => {
    const issuesBefore = plan.issues.length;
    await job.run();
    if (plan.issues.length !== issuesBefore) return;
    emitRegionalSettingsStorageChange({ origin: "local" });
  } })) };
}

export async function loadRegionalSettingsAsset(
  itemDefinitions: readonly ItemDefinition[],
): Promise<RegionalSettingsAsset | null> {
  const migrations: readonly StorageMigration<RegionalSettingsAsset, readonly ItemDefinition[]>[] = [{
    version: REGIONAL_SETTINGS_SCHEMA_VERSION,
    migrate: (raw, definitions) => normalizeRegionalSettingsAsset(raw, definitions),
  }];
  const asset = await readFromIndexedDbWithMigration(
    REGIONAL_SETTINGS_STORE_LOCATION,
    REGIONAL_SETTINGS_SCHEMA_VERSION,
    migrations,
    itemDefinitions,
  );
  return asset === null ? null : normalizeRegionalSettingsAsset(asset, itemDefinitions);
}

export async function saveRegionalSettingsAsset(
  asset: RegionalSettingsAsset,
  options: StorageWriteOptions = {},
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await readFromIndexedDb<{ data?: { darkPipeLinks?: unknown } }>(REGIONAL_SETTINGS_STORE_LOCATION);
    // 本地资源编辑无权新增旧格式关系；同步输入保留旧记录供 Editor 消费。
    const data = options.origin === "remote-sync" ? asset : {
      ...asset, darkPipeLinks: stored?.data?.darkPipeLinks ?? [],
    };
    const { storeName, key } = REGIONAL_SETTINGS_STORE_LOCATION;
    if (await applyIndexedDbTransactionMutations<unknown>(REGIONAL_SETTINGS_STORE_LOCATION, [{
      storeName, operations: [{ type: "put", key, value: { _v: REGIONAL_SETTINGS_SCHEMA_VERSION, data } }],
    }], {}, { expectedValues: [{ storeName, key, value: stored }] })) {
      emitRegionalSettingsStorageChange(options);
      return;
    }
  }
  throw new Error("Regional settings changed during saving or could not be persisted.");
}


export async function deleteRegionalSettingsAsset(
  options: StorageWriteOptions = {},
): Promise<void> {
  await deleteFromIndexedDb(REGIONAL_SETTINGS_STORE_LOCATION);
  emitRegionalSettingsStorageChange(options);
}

function emitRegionalSettingsStorageChange(options: StorageWriteOptions): void {
  emitStorageChange({
    assetType: "regional-settings",
    assetId: REGIONAL_SETTINGS_ASSET_ID,
    origin: options.origin ?? "local",
    timestamp: Date.now(),
  });
}
