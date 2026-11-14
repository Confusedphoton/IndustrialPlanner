import { beginDataMigration, isDataMigrationSettled, writeDataMigrationCompletion } from "./storage/data-migration-state";
import { RECOVERY_LOCK } from "./storage/storage-generation";

export interface DataMigrationJob {
  readonly label: string;
  readonly run: () => Promise<void>;
}

export interface DataMigrationPlan {
  readonly jobs: readonly DataMigrationJob[];
  /** 无旧内容的新安装仍需建立资源初始化记录，不显示进度遮罩。 */
  readonly finish?: () => Promise<void>;
  readonly issues?: readonly string[];
}

export interface DataMigrationParticipant {
  readonly label?: string;
  readonly prepare: (version: string) => Promise<DataMigrationPlan>;
}

export interface DataMigrationProgress {
  readonly phase: "idle" | "checking" | "reloading" | "migrating" | "committing" | "failed";
  readonly visible: boolean;
  readonly completed: number;
  readonly total: number;
  readonly label: string;
  readonly error: string | null;
  readonly notice?: string;
}

const idle: DataMigrationProgress = { phase: "idle", visible: false, completed: 0, total: 0, label: "", error: null };
let state = idle;
const listeners = new Set<() => void>();
let controller: ReturnType<typeof createDataMigrationController> | null = null;

export const readDataMigrationProgress = (): DataMigrationProgress => state;
export function subscribeDataMigration(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function isDataMigrationFrozen(): boolean { return state.phase !== "idle"; }
export function hasDataMigrationController(): boolean { return controller !== null; }
export function assertDataMigrationIdle(): void {
  if (isDataMigrationFrozen()) throw new Error("正在升级本地数据，请等待升级完成。");
}

function publish(next: DataMigrationProgress): void {
  state = next;
  for (const listener of listeners) listener();
}

/** 唯一执行点是工作台创建前的启动阶段；运行期输入只使标记失效并刷新。 */
export function createDataMigrationController(version: string, participants: readonly DataMigrationParticipant[],
  reload: () => void = () => window.location.reload(),
) {
  let running: Promise<void> | null = null;
  const execute = async (): Promise<void> => {
    if (await isDataMigrationSettled(version)) return;
    publish({ ...idle, phase: "checking" });
    try {
      await beginDataMigration(version);
      const plans: DataMigrationPlan[] = [];
      for (const participant of participants) {
        if (participant.label) publish({ ...state, label: participant.label });
        plans.push(await participant.prepare(version));
      }
      const jobs = plans.flatMap(plan => plan.jobs);
      if (jobs.length > 0) {
        publish({ ...state, phase: "migrating", visible: true, total: jobs.length });
        for (const job of jobs) {
          publish({ ...state, label: job.label });
          // 每项之间交还绘制机会；转换自身只处理 JSON。
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          await job.run();
          publish({ ...state, completed: state.completed + 1 });
        }
      }
      publish({ ...state, phase: "committing" });
      for (const plan of plans) await plan.finish?.();
      const issues = plans.flatMap(plan => plan.issues ?? []);
      await writeDataMigrationCompletion(version, issues.length === 0, issues.length > 0);
      if (issues.length > 0) throw new Error(`部分数据未能升级，原件已保留。重新加载后可以继续使用其他数据。\n${issues.join("\n")}`);
      publish(idle);
    } catch (error) {
      publish({ ...state, phase: "failed", visible: true, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  return {
    run(): Promise<void> {
      // 同一页面仅允许一次启动迁移；失败通过刷新重试，不能在运行态再进入。
      return running ??= (async () => {
        if (await isDataMigrationSettled(version)) return;
        const lifecycle = () => globalThis.navigator?.locks
          ? navigator.locks.request(RECOVERY_LOCK, { mode: "exclusive" }, execute) : execute();
        if (globalThis.navigator?.locks) await navigator.locks.request("sync-service", { mode: "exclusive" }, lifecycle);
        else await lifecycle();
      })();
    },
    async adopt(jobs: readonly DataMigrationJob[], deferReload: boolean): Promise<void> {
      if (jobs.length === 0) return;
      // 不运行迁移参与者，也不刷新或恢复任何 Host。此处仅保存已采纳的输入。
      await writeDataMigrationCompletion(version, false);
      publish({ ...idle, phase: "reloading", visible: true });
      try {
        for (const job of jobs) await job.run();
      } finally {
        if (!deferReload) reload();
      }
    },
    reloadIfPending(): void { if (state.phase === "reloading") reload(); },
  };
}

export function installDataMigrationController(value: ReturnType<typeof createDataMigrationController>): () => void {
  controller = value;
  return () => { if (controller === value) { controller = null; publish(idle); } };
}

/** 采纳旧输入后刷新。同步调用方须在整批提交和释放网络资源后完成刷新。 */
export async function adoptIncomingDataAndReload(jobs: readonly DataMigrationJob[], deferReload = false): Promise<void> {
  if (controller === null) {
    for (const job of jobs) await job.run();
    return;
  }
  await controller.adopt(jobs, deferReload);
}

export function reloadPendingDataMigration(): void { controller?.reloadIfPending(); }

/** 已隔离的数据不等于当前写入失败；工作台继续编辑时使用独立提示。 */
export function notifyDataMigrationAbandoned(): void {
  publish({ ...idle, notice: "部分数据已隔离保存。可继续本地编辑，网络同步将在升级成功后恢复。" });
}
