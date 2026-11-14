import { EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY, normalizeEditorPersistState } from "@/shared/storage/editor-persist-state-storage";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import type { DataMigrationPlan } from "@/shared/data-migration";
import { prepareStoredJsonMigration, prepareLocalJsonMigration } from "@/shared/storage/migration-records";
import { applyIndexedDbTransactionMutations, readFromIndexedDb, readRawFromIndexedDb } from "@/shared/storage/browser-storage";
import { WORLD_DOCUMENT_DATABASE_LOCATION, normalizeWorldDocument } from "./document-storage";
import { normalizePersistedEditorHistoryState } from "./history";
import { LEGACY_REGIONAL_SETTINGS_LOCATION, readLegacyRegionalDarkPipeAsset, planLegacyRegionalDarkPipeMigration } from "@/shared/legacy-regional-dark-pipe";
import { emitStorageChange } from "@/shared/storage/storage-change-event";

export async function prepareEditorDataMigration(registry: RegistryContract, version = "editor-7"): Promise<DataMigrationPlan> {
  const documents = await prepareStoredJsonMigration(WORLD_DOCUMENT_DATABASE_LOCATION, (raw, key) => {
    const document = normalizeWorldDocument(raw);
    return document?.documentKey === key ? document : null;
  }, "基地文档", version, value => emitStorageChange({ assetType: "world-document",
    assetId: value.documentKey, origin: "local", timestamp: Date.now() }));
  const migrated = new Map([...documents.values].map(([key, value]) => [String(key), value]));
  const history = await prepareStoredJsonMigration({ ...WORLD_DOCUMENT_DATABASE_LOCATION, storeName: "editorhistory" },
    (raw, key) => normalizePersistedEditorHistoryState(raw, String(key), migrated.get(String(key)) ?? null), "编辑历史", version);
  const jobs = [...documents.jobs, ...history.jobs];
  const raw = await readRawFromIndexedDb(LEGACY_REGIONAL_SETTINGS_LOCATION);
  let asset: ReturnType<typeof readLegacyRegionalDarkPipeAsset> = null;
  // App 的同库 JSON 迁移负责地区设置原文隔离；Editor 只提取可读的旧关系。
  try { asset = readLegacyRegionalDarkPipeAsset(typeof raw === "string" ? JSON.parse(raw) : raw); }
  catch { /* 原件仍由 App 迁移计划保留。 */ }
  if (asset !== null) {
    const latest = new Map<string, WorldDocument>();
    for (const document of migrated.values()) {
      const before = latest.get(document.baseId);
      if (before === undefined || before.meta.updatedAt < document.meta.updatedAt) latest.set(document.baseId, document);
    }
    const plan = planLegacyRegionalDarkPipeMigration({ asset, documents: [...latest.values()], bases: registry.baseDefinitions });
    if (plan.diagnostics.length > 0) console.warn("旧跨基地关系保留待补齐。", plan.diagnostics);
    if (plan.changed) jobs.push({ label: "跨基地关系", run: async () => {
      const current = readLegacyRegionalDarkPipeAsset(await readFromIndexedDb(LEGACY_REGIONAL_SETTINGS_LOCATION, { strict: true }));
      if (current === null) throw new Error("跨基地关系原件不可读取。");
      const plan = planLegacyRegionalDarkPipeMigration({ asset: current, documents: [...latest.values()], bases: registry.baseDefinitions });
      if (!await applyIndexedDbTransactionMutations<unknown>(WORLD_DOCUMENT_DATABASE_LOCATION, [
        { storeName: WORLD_DOCUMENT_DATABASE_LOCATION.storeName, operations: plan.changes.map(({ after }) => ({ type: "put", key: after.documentKey, value: after })) },
        { storeName: LEGACY_REGIONAL_SETTINGS_LOCATION.storeName, operations: [{ type: "put", key: LEGACY_REGIONAL_SETTINGS_LOCATION.key, value: plan.nextAsset }] },
      ])) throw new Error("跨基地关系升级未能保存。");
      for (const { after } of plan.changes) emitStorageChange({ assetType: "world-document", assetId: after.documentKey, origin: "local", timestamp: Date.now() });
      emitStorageChange({ assetType: "regional-settings", assetId: LEGACY_REGIONAL_SETTINGS_LOCATION.key, origin: "local", timestamp: Date.now() });
    } });
  }
  const index = await prepareLocalJsonMigration(EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY, normalizeEditorPersistState, "基地索引", version);
  jobs.push(...index.jobs);
  return { jobs, get issues() { return [...documents.issues, ...history.issues, ...index.issues]; } };
}
