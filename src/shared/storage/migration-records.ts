import { openIndexedDbStores, waitForTransaction, type IndexedDbStoreLocation, applyRawIndexedDbTransactionMutations, saveToLocalStorage } from "./browser-storage";
import { createStableJsonHash } from "./hash-utils";

export interface MigrationRecord { readonly key: IDBValidKey; readonly value: unknown }

/** 迁移必须保留真实主键，不能凭记录字段猜测或把损坏原件当作缺席。 */
export async function readMigrationRecords(location: IndexedDbStoreLocation, options: { readonly raw?: boolean } = {}): Promise<MigrationRecord[]> {
  const database = await openIndexedDbStores(location, [location.storeName]);
  if (database === null) throw new Error("无法读取待升级的数据。");
  try {
    const transaction = database.transaction(location.storeName, "readonly");
    const done = waitForTransaction(transaction);
    void done.catch(() => undefined);
    const objectStore = transaction.objectStore(location.storeName);
    const keysRequest = objectStore.getAllKeys();
    const valuesRequest = objectStore.getAll();
    const [keys, values] = await Promise.all([
      new Promise<IDBValidKey[]>((resolve, reject) => {
        keysRequest.onsuccess = () => resolve(keysRequest.result);
        keysRequest.onerror = () => reject(keysRequest.error);
      }),
      new Promise<unknown[]>((resolve, reject) => {
        valuesRequest.onsuccess = () => resolve(valuesRequest.result);
        valuesRequest.onerror = () => reject(valuesRequest.error);
      }),
    ]);
    const records = keys.map((key, index) => ({ key,
      value: !options.raw && typeof values[index] === "string" ? JSON.parse(values[index]) as unknown : values[index],
    }));
    await done;
    return records;
  } finally { database.close(); }
}

export const MIGRATION_QUARANTINE_STORE = "data-migration-originals";
interface MigrationOriginal {
  readonly storeName: string;
  readonly key: IDBValidKey;
  readonly value: unknown;
  readonly version: string;
  readonly message: string;
}

/** JSON 转换失败只隔离该条原件。修复版本重试，绝不覆盖用户后来新建的同键内容。 */
export async function prepareStoredJsonMigration<T>(location: IndexedDbStoreLocation,
  normalize: (value: unknown, key: IDBValidKey) => T | null, label: string, version: string,
  onWritten?: (value: T) => void,
) {
  const current = await readMigrationRecords(location, { raw: true });
  const originals = await readMigrationRecords({ ...location, storeName: MIGRATION_QUARANTINE_STORE }, { raw: true });
  const retry = originals.map(record => record.value as MigrationOriginal).filter(record =>
    record.storeName === location.storeName && record.version !== version
    && !current.some(active => JSON.stringify(active.key) === JSON.stringify(record.key)));
  // 新输入可能触发同版本重扫；尚未重试的原件仍代表升级未完成。
  const issues = originals.map(record => record.value as MigrationOriginal)
    .filter(record => record.storeName === location.storeName && !retry.includes(record))
    .map(record => record.message);
  const values = new Map<IDBValidKey, T>();
  const jobs = [...current, ...retry].flatMap(record => {
    const originalKey = JSON.stringify([location.storeName, record.key]);
    const archived = retry.includes(record as MigrationOriginal);
    let value: T;
    try {
      const source: unknown = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
      const normalized = normalize(source, record.key);
      if (normalized === null) throw new Error(`${label}格式无法转换`);
      value = normalized;
      values.set(record.key, value);
      if (!archived && createStableJsonHash(source) === createStableJsonHash(value)) return [];
    } catch (error) {
      const message = `${label}：${error instanceof Error ? error.message : String(error)}`;
      return [{ label, run: async () => {
        // 只有原件与活动移除同事务提交成功，才把失败视为已隔离；不发业务删除事件。
        if (!await applyRawIndexedDbTransactionMutations<unknown>(location, [
          { storeName: MIGRATION_QUARANTINE_STORE, operations: [{ type: "put", key: originalKey,
            value: { storeName: location.storeName, key: record.key, value: record.value, version, message } satisfies MigrationOriginal }] },
          { storeName: location.storeName, operations: archived ? [] : [{ type: "delete", key: record.key }] },
        ])) throw new Error("无法保留升级失败的原件，请释放存储空间后重试。");
        issues.push(message);
      } }];
    }
    return [{ label, run: async () => {
      if (!await applyRawIndexedDbTransactionMutations<unknown>(location, [
        { storeName: location.storeName, operations: [{ type: "put", key: record.key, value: JSON.stringify(value) }] },
        { storeName: MIGRATION_QUARANTINE_STORE, operations: archived ? [{ type: "delete", key: originalKey }] : [] },
      ])) throw new Error(`${label}升级未能保存，原件已保留。`);
      onWritten?.(value);
    } }];
  });
  return { jobs, values, issues };
}

/** localStorage 无跨库事务：先保留原文，再移出活动键；中途关闭可安全重复。 */
export async function prepareLocalJsonMigration<T>(key: string, normalize: (raw: unknown) => T, label: string, version: string) {
  const location = { databaseName: "v3-industrial-planner", storeName: MIGRATION_QUARANTINE_STORE };
  const originalKey = JSON.stringify(["localStorage", key]);
  const originals = await readMigrationRecords(location, { raw: true });
  const retained = originals.find(record => record.key === originalKey)?.value as MigrationOriginal | undefined;
  const active = localStorage.getItem(key);
  const source = active ?? (retained?.version !== version ? retained?.value : null);
  const issues = retained && (active !== null || retained.version === version) ? [retained.message] : [];
  if (typeof source !== "string") return { jobs: [], issues };
  let value: T;
  try {
    const raw: unknown = JSON.parse(source);
    value = normalize(raw);
    if (active !== null && createStableJsonHash(raw) === createStableJsonHash(value)) return { jobs: [], issues };
  } catch (error) {
    const message = `${label}：${error instanceof Error ? error.message : String(error)}`;
    return { issues, jobs: [{ label, run: async () => {
      if (!await applyRawIndexedDbTransactionMutations(location, [{ storeName: location.storeName, operations: [{
        type: "put", key: originalKey, value: { storeName: "localStorage", key, value: source, version, message } satisfies MigrationOriginal,
      }] }])) throw new Error("无法保留升级失败的原件。");
      localStorage.removeItem(key);
      issues.push(message);
    } }] };
  }
  return { issues, jobs: [{ label, run: async () => {
    saveToLocalStorage(key, value);
    if (retained && active === null && !await applyRawIndexedDbTransactionMutations(location, [{ storeName: location.storeName,
      operations: [{ type: "delete", key: originalKey }] }])) throw new Error("升级结果已保存，但原件状态未能更新。");
  } }] };
}
