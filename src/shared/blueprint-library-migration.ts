import type { DataMigrationPlan } from "./data-migration";
import { BLUEPRINT_STORE_LOCATION, normalizeBlueprintStorageEntry } from "./storage/blueprint-storage";
import { prepareStoredJsonMigration } from "./storage/migration-records";
import { emitStorageChange } from "./storage/storage-change-event";

export async function prepareBlueprintLibraryMigration(version = "blueprints-7"): Promise<DataMigrationPlan> {
  return prepareStoredJsonMigration(BLUEPRINT_STORE_LOCATION, normalizeBlueprintStorageEntry, "蓝图库", version, value => {
    emitStorageChange({ assetType: value.kind === "folder" ? "blueprint-folder" : "blueprint",
      assetId: value.kind === "folder" ? value.folderId : value.blueprintId, origin: "local", timestamp: Date.now() });
  });
}
