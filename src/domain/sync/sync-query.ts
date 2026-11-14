/**
 * 预留给不适合表达为可观察状态的同步查询。
 */
export interface SyncQuery {
  readonly _syncQueryBrand?: never;
}
