import { chooseWorkbenchMenuItem, switchBase } from "./harness/workbench";
import { startCloudflareTestBackend } from "../helpers/cloudflare-test-backend";
/**
 * CF Worker 同步 e2e：冲突解决 → 小检查短路 → 增量同步
 * 本测试名称保留历史称呼，但场景验证的是当前 HTTP 同步实现。
 * 本场景继续验证相同后端协议下的冲突、小检查与增量同步。
 *
 * 全部使用文本/role/data 选择器（CSS Module 在 dev 模式被哈希）。
 */
import { createHash, randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "./harness/fixture";

import {
  CF_SYNC_V2_PROTOCOL,
  type CfV2CommitResult,
  type CfV2PlanResponse,
  type CfV2PrepareResponse,
} from "../../sync/clients/cloudflare/cloudflare-v2-types";

let BACKEND_API_BASE_URL: string;
let localBackend: Awaited<ReturnType<typeof startCloudflareTestBackend>>;
test.beforeEach(async () => {
  localBackend = await startCloudflareTestBackend();
  BACKEND_API_BASE_URL = localBackend.origin;
});
test.afterEach(async () => {
  await localBackend?.close();
});
const TEST_WORLD_DOCUMENT_ASSET_TYPE = "world-document";

type ConflictResolution = "use-local" | "use-remote";

interface BrowserWorldDocument {
  readonly baseId: string;
  readonly entities: Readonly<Record<string, {
    readonly definitionId: string;
  }>>;
}

interface BrowserSyncState {
  readonly settings: {
    readonly enabled: boolean;
  };
  readonly status: {
    readonly phase: string;
    readonly saveState: string;
    readonly currentRunReason: string | null;
    readonly initialSyncStage: string;
    readonly hasCompletedInitialFeatureSync: boolean;
    readonly pendingLocalChangeCount: number;
    readonly lastError: string | null;
    readonly lastUpdateCheckAt: string | null;
  };
  readonly pendingConflict: unknown;
}

interface BrowserAppHost {
  readonly workspace?: {
    readonly editor?: {
      readonly document?: {
        getSnapshot(): BrowserWorldDocument;
      };
    };
    readonly sync?: {
      readonly state: BrowserSyncState;
    };
  };
}

interface BrowserTestWindow {
  readonly __industrialPlannerAppHost?: BrowserAppHost;
}

async function readRemotePlan(
  request: APIRequestContext,
  spaceId: string,
): Promise<CfV2PlanResponse> {
  const response = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as CfV2PlanResponse;
}

async function tryReadRemoteRevision(
  request: APIRequestContext,
  spaceId: string,
): Promise<string | null> {
  const response = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  if (response.status() === 409 || response.status() === 423) {
    return null;
  }
  expect(response.ok(), await response.text()).toBe(true);
  const plan = await response.json() as CfV2PlanResponse;
  return plan.revision;
}

async function seedRemoteWorldDocument(
  request: APIRequestContext,
  spaceId: string,
  assetId: string,
  content: string,
): Promise<string> {
  // 使用当前 revision 作为 baseRevision，不能再次创建空间或固定从 revision 0 提交。
  const planResponse = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  let baseRevision = "0";
  if (planResponse.status() === 404) {
    const createResponse = await request.post(
      `${BACKEND_API_BASE_URL}/v1/sync/spaces`,
      { data: { spaceId } },
    );
    expect(createResponse.status(), await createResponse.text()).toBe(201);
  } else {
    expect(planResponse.ok(), await planResponse.text()).toBe(true);
    baseRevision = (await planResponse.json() as CfV2PlanResponse).revision;
  }

  const contentBytes = Buffer.from(content);
  const prepareResponse = await request.post(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
    {
      data: {
        protocol: CF_SYNC_V2_PROTOCOL,
        action: "prepare",
        baseRevision,
        clientBatchId: randomUUID(),
        objects: [{
          clientMutationId: randomUUID(),
          assetType: TEST_WORLD_DOCUMENT_ASSET_TYPE,
          assetId,
          metadata: "{}",
          blobHash: createHash("sha256").update(contentBytes).digest("hex"),
          blobByteSize: contentBytes.byteLength,
          storageMode: "full",
          schemaVersion: 1,
          encoding: "identity",
          writerAppVersion: "e2e",
          writerBuildId: "playwright",
        }],
        deletions: [],
      },
    },
  );
  expect(prepareResponse.ok(), await prepareResponse.text()).toBe(true);
  const prepare = await prepareResponse.json() as CfV2PrepareResponse;

  for (const upload of prepare.uploads) {
    if (!upload.required) continue;
    expect(upload.url).toBeTruthy();
    const uploadResponse = await request.put(upload.url!, {
      data: contentBytes,
      headers: {
        "content-type": "application/octet-stream",
        ...upload.headers,
      },
    });
    expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);
  }

  const commitResponse = await request.post(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
    {
      data: {
        protocol: CF_SYNC_V2_PROTOCOL,
        action: "commit",
        uploadId: prepare.uploadId,
        commitToken: prepare.commitToken,
      },
    },
  );
  expect(commitResponse.ok(), await commitResponse.text()).toBe(true);
  const commit = await commitResponse.json() as CfV2CommitResult;
  return commit.revision;
}

async function clearRemoteTestAssets(
  request: APIRequestContext,
  spaceId: string,
): Promise<void> {
  const planResponse = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/plan`,
  );
  if (planResponse.status() === 404) return;
  expect(planResponse.ok(), await planResponse.text()).toBe(true);

  const plan = await planResponse.json() as CfV2PlanResponse;
  let baseRevision = plan.revision;
  for (let offset = 0; offset < plan.assets.length; offset += 32) {
    const assets = plan.assets.slice(offset, offset + 32);
    const prepareResponse = await request.post(
      `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
      {
        data: {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "prepare",
          baseRevision,
          clientBatchId: randomUUID(),
          objects: [],
          deletions: assets.map((asset) => ({
            clientMutationId: randomUUID(),
            assetType: asset.assetType,
            assetId: asset.assetId,
          })),
        },
      },
    );
    expect(prepareResponse.ok(), await prepareResponse.text()).toBe(true);
    const prepare = await prepareResponse.json() as CfV2PrepareResponse;

    const commitResponse = await request.post(
      `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
      {
        data: {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "commit",
          uploadId: prepare.uploadId,
          commitToken: prepare.commitToken,
        },
      },
    );
    expect(commitResponse.ok(), await commitResponse.text()).toBe(true);
    const commit = await commitResponse.json() as CfV2CommitResult;
    baseRevision = commit.revision;
  }
}

function createWorldDocumentVariant(
  content: string,
  name: string,
): string {
  const document = JSON.parse(content) as Record<string, unknown>;
  const meta = document.meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new Error("World document metadata is unavailable.");
  }

  return JSON.stringify({
    ...document,
    meta: {
      ...meta,
      name,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function readCurrentWorldDocumentProjection(page: Page): Promise<{
  readonly assetId: string;
  readonly content: string;
}> {
  return await page.evaluate(async () => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const documentSnapshot = host?.workspace?.editor?.document?.getSnapshot();
    if (!documentSnapshot) {
      throw new Error("Current world document is unavailable.");
    }
    const syncHostModuleUrl = "/src/sync/sync-host.ts";
    const { createWorldDocumentRemoteValue } = await import(
      /* @vite-ignore */ syncHostModuleUrl
    );
    return {
      assetId: documentSnapshot.baseId as string,
      content: JSON.stringify(createWorldDocumentRemoteValue(documentSnapshot)),
    };
  });
}

async function mutateStoredWorldDocument(
  page: Page,
  baseId: string,
  name: string,
  options: {
    readonly notifyDirty?: boolean;
  } = {},
): Promise<void> {
  const mutationResult = await page.evaluate(async ({
    targetBaseId,
    nextName,
    notifyDirty,
  }) => {
    const storageModuleUrl = "/src/shared/storage/world-document-storage.ts";
    const storage = await import(/* @vite-ignore */ storageModuleUrl);
    const documents = await storage.listLatestWorldDocumentsByBase({});
    const document = documents.get(targetBaseId);
    if (document === undefined) {
      throw new Error(`Stored world document is unavailable: ${targetBaseId}`);
    }

    const nextDocument = {
      ...document,
      meta: {
        ...document.meta,
        name: nextName,
        updatedAt: new Date().toISOString(),
      },
    };
    // 直接写入持久化层用于构造“非当前基地已在另一标签页发生本地改动”的真实同步输入；
    // 不调用编辑器 action，避免测试过程切换到目标基地并提前触发同步。
    // storage change，使测试输入与正式本地写入链路一致。startup 场景重建服务并执行未知状态 hash。
    await storage.writeWorldDocument(nextDocument);
    if (notifyDirty) {
      const storageChangeModuleUrl = "/src/shared/storage/storage-change-event.ts";
      const { emitStorageChange } = await import(
        /* @vite-ignore */ storageChangeModuleUrl
      );
      emitStorageChange({
        assetType: "world-document",
        assetId: nextDocument.documentKey,
        origin: "local",
        timestamp: Date.now(),
      });
    }
    return {
      baseId: nextDocument.baseId as string,
      name: nextDocument.meta.name as string,
    };
  }, {
    targetBaseId: baseId,
    nextName: name,
    notifyDirty: options.notifyDirty ?? false,
  });

  expect(mutationResult).toEqual({ baseId, name });
}

async function configureCloudflareTestSpace(
  page: Page,
  spaceId: string,
): Promise<void> {
  await page.addInitScript(() => {
    // 清空 provider，否则 startup 回归阶段会被错误切回 none，根本不会启动同步。
    const initializedKey = "e2e-cf-inactive-base-provider-initialized";
    if (sessionStorage.getItem(initializedKey) !== "true") {
      localStorage.setItem("v3-sync-provider", "none");
      sessionStorage.setItem(initializedKey, "true");
    }
  });
  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync,
    )
  );

  const configurationResult = await page.evaluate(async ({ apiBaseUrl, targetSpaceId }) => {
    const backendAddressModuleUrl = "/src/shared/storage/backend-api-address.ts";
    const cloudflareSettingsModuleUrl = "/src/shared/storage/cloudflare-sync-settings.ts";
    const [backendAddress, cloudflareSettings] = await Promise.all([
      import(/* @vite-ignore */ backendAddressModuleUrl),
      import(/* @vite-ignore */ cloudflareSettingsModuleUrl),
    ]);
    backendAddress.writeBackendApiAddressOverride(apiBaseUrl);
    const settings = await cloudflareSettings.writeCloudflareSyncSettings({
      spaceName: targetSpaceId,
      remoteMode: "anonymous",
    });
    return {
      apiBaseUrl: backendAddress.resolveBackendApiBaseUrl(),
      spaceId: cloudflareSettings.resolveCloudflareSpaceId(settings),
    };
  }, {
    apiBaseUrl: BACKEND_API_BASE_URL,
    targetSpaceId: spaceId,
  });

  expect(configurationResult).toEqual({
    apiBaseUrl: BACKEND_API_BASE_URL,
    spaceId,
  });
  await page.getByRole("button", { name: "菜单", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForStableSync(page: Page): Promise<void> {
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          settingsEnabled: sync.state.settings.enabled,
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          currentRunReason: sync.state.status.currentRunReason,
          initialSyncStage: sync.state.status.initialSyncStage,
          hasCompletedInitialFeatureSync:
            sync.state.status.hasCompletedInitialFeatureSync,
          pendingConflict: sync.state.pendingConflict,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "同步应完成并回到无冲突、无待上传内容的 idle 状态",
    timeout: 90_000,
    intervals: [500],
  }).toEqual({
    settingsEnabled: true,
    phase: "idle",
    saveState: "idle",
    currentRunReason: null,
    initialSyncStage: "ready",
    hasCompletedInitialFeatureSync: true,
    pendingConflict: null,
    pendingLocalChangeCount: 0,
    lastError: null,
  });
}

async function enableCloudflareSync(page: Page): Promise<void> {
  await chooseWorkbenchMenuItem(page, "设置");
  await expect(page.getByRole("heading", { name: "设置" }).first())
    .toBeVisible({ timeout: 10_000 });

  const hasSidebar = await page.getByRole("tree").isVisible().catch(() => false);
  if (hasSidebar) {
    await page.getByRole("treeitem", { name: "其他" }).click();
  }

  const experimentalToggle = page.locator(
    'input[name="other-experimental-features"]',
  );
  await expect(experimentalToggle).toBeVisible({ timeout: 5_000 });
  if (!(await experimentalToggle.isChecked())) {
    await page.locator('label[for="setting-other-experimental-features"]').click();
    await page.getByRole("button", { name: "开启实验性功能" }).click();
  }

  if (hasSidebar) {
    await page.getByRole("treeitem", { name: "实验性" }).click();
  }
  await page.locator('select[name="sync-provider"]').selectOption("cloudflare");
  const cloudflareDialog = page.getByRole("dialog", { name: "Cloudflare 同步状态" });
  await expect(cloudflareDialog).toBeVisible();
  const activateCloudflareButton = cloudflareDialog.getByRole("button", {
    name: "使用此 Space ID 并启用",
  });
  await expect(activateCloudflareButton).toBeEnabled();
  await activateCloudflareButton.click();
  await waitForStableSync(page);

  await cloudflareDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(cloudflareDialog).not.toBeVisible();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  const settingsCloseButton = settingsDialog.getByRole("button", {
    name: "关闭",
    exact: true,
  });
  await expect(settingsCloseButton).toBeVisible();
  await settingsCloseButton.click();
  await expect(settingsDialog).not.toBeVisible();
}

async function resolveVisibleConflictUsingRemote(page: Page): Promise<void> {
  const conflictTitle = page.getByRole("heading", { name: "同步冲突" });
  await expect(conflictTitle).toBeVisible({ timeout: 90_000 });

  const useRemoteButton = page.getByRole("button", { name: "全部使用远端" });
  if (await useRemoteButton.isVisible().catch(() => false)) {
    await useRemoteButton.click();
  } else {
    const radios = page.locator('input[value="use-remote"]');
    await Promise.all(
      Array.from({ length: await radios.count() }, (_, index) =>
        radios.nth(index).check({ force: true })
      ),
    );
  }

  await page.getByRole("button", { name: "应用" }).click();
  await expect(conflictTitle).not.toBeVisible({ timeout: 30_000 });
  await waitForStableSync(page);
}

test.setTimeout(240_000);

test("Cloudflare conflict: use remote", async ({ page, request }) => {
  const spaceId = `e2e-cf-conflict-use-remote-${randomUUID()}`;
  try {
    await runConflictScenario({
      page,
      request,
      spaceId,
      resolution: "use-remote",
    });
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

test("Cloudflare conflict: use local", async ({ page, request }) => {
  const spaceId = `e2e-cf-conflict-use-local-${randomUUID()}`;
  try {
    await runConflictScenario({
      page,
      request,
      spaceId,
      resolution: "use-local",
    });
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

test("Cloudflare inactive base conflict: dirty local change and startup", async ({
  page,
  request,
}) => {
  test.setTimeout(360_000);
  const spaceId = `e2e-cf-inactive-${randomUUID()}`;
  try {
    await runInactiveBaseConflictScenario({ page, request, spaceId });
  } finally {
    await clearRemoteTestAssets(request, spaceId);
  }
});

async function runInactiveBaseConflictScenario(options: {
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly spaceId: string;
}): Promise<void> {
  const { page, request, spaceId } = options;
  const currentBaseId = "wuling_protocol_core";
  const inactiveBaseId = "stm_hongs_3";

  // ─── Phase 1: 建立两个基地的共同同步基线，并停留在协议核心区 ───
  await configureCloudflareTestSpace(page, spaceId);
  await switchBase(page, inactiveBaseId);
  const inactiveBaseBaseline = await readCurrentWorldDocumentProjection(page);
  expect(inactiveBaseBaseline.assetId).toBe(inactiveBaseId);
  await switchBase(page, currentBaseId);
  await seedRemoteWorldDocument(
    request,
    spaceId,
    inactiveBaseId,
    inactiveBaseBaseline.content,
  );
  await enableCloudflareSync(page);

  const revisionAfterInitialSync = (await readRemotePlan(request, spaceId)).revision;
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  )).toBe(currentBaseId);

  const intervalRemoteContent = createWorldDocumentVariant(
    inactiveBaseBaseline.content,
    "inactive-remote-interval",
  );
  const intervalRemoteRevision = await seedRemoteWorldDocument(
    request,
    spaceId,
    inactiveBaseId,
    intervalRemoteContent,
  );
  expect(intervalRemoteRevision).not.toBe(revisionAfterInitialSync);
  await mutateStoredWorldDocument(
    page,
    inactiveBaseId,
    "inactive-local-interval",
    { notifyDirty: true },
  );


  const conflictTitle = page.getByRole("heading", { name: "同步冲突" });
  await expect(conflictTitle).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.pendingConflict ?? null
  )).toMatchObject({
    phase: "awaiting-resolution",
    items: [{
      adapterId: "world-documents",
      assetId: inactiveBaseId,
      kind: "conflict",
    }],
  });
  expect(await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  )).toBe(currentBaseId);
  await resolveVisibleConflictUsingRemote(page);
  expect((await readRemotePlan(request, spaceId)).revision)
    .toBe(intervalRemoteRevision);

  // ─── Phase 3: 刷新后的 startup/background 同步也必须发现同一类冲突 ───
  await mutateStoredWorldDocument(
    page,
    inactiveBaseId,
    "inactive-local-startup",
  );
  const startupRemoteContent = createWorldDocumentVariant(
    intervalRemoteContent,
    "inactive-remote-startup",
  );
  const startupRemoteRevision = await seedRemoteWorldDocument(
    request,
    spaceId,
    inactiveBaseId,
    startupRemoteContent,
  );
  expect(startupRemoteRevision).not.toBe(intervalRemoteRevision);

  await page.reload();
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync,
    )
  );
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  ), {
    message: "刷新后仍应停留在原当前基地",
    timeout: 30_000,
  }).toBe(currentBaseId);
  await expect(conflictTitle).toBeVisible({ timeout: 90_000 });
  expect(await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.pendingConflict ?? null
  )).toMatchObject({
    phase: "awaiting-resolution",
    items: [{
      adapterId: "world-documents",
      assetId: inactiveBaseId,
      kind: "conflict",
    }],
  });
  expect(await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.editor?.document?.getSnapshot()?.baseId ?? null
  )).toBe(currentBaseId);
  await resolveVisibleConflictUsingRemote(page);
  expect((await readRemotePlan(request, spaceId)).revision)
    .toBe(startupRemoteRevision);

  // ─── Phase 4: 纯导航到已存在、已同步的基地不得制造上传 ───
  const revisionBeforeNavigation = (
    await readRemotePlan(request, spaceId)
  ).revision;
  await switchBase(page, inactiveBaseId);
  // 本地变化的空闲上传去抖为 5 秒；跨过该窗口后 revision 仍不变，才可证明纯导航未入队。
  await page.waitForTimeout(12_000);
  await waitForStableSync(page);
  expect((await readRemotePlan(request, spaceId)).revision)
    .toBe(revisionBeforeNavigation);
}

async function runConflictScenario(options: {
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly resolution: ConflictResolution;
  readonly spaceId: string;
}): Promise<void> {
  const {
    page,
    request,
    resolution,
    spaceId,
  } = options;
  // ─── 日志收集 ───
  const syncLogs: string[] = [];
  const backendRequestFailures: string[] = [];
  const backendHttpErrors: string[] = [];
  const backendCheckResponses: number[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("sync-service")) {
      syncLogs.push(`[${msg.type()}] ${msg.text()}`);
      console.log(`[SYNC] ${msg.text()}`);
    }
  });
  page.on("requestfailed", (failedRequest) => {
    const errorText = failedRequest.failure()?.errorText ?? "unknown";
    if (
      failedRequest.url().startsWith(BACKEND_API_BASE_URL)
      && errorText !== "net::ERR_ABORTED"
    ) {
      backendRequestFailures.push(
        `${failedRequest.method()} ${failedRequest.url()}: ${errorText}`,
      );
    }
  });
  page.on("response", (response) => {
    const responseUrl = new URL(response.url());
    if (
      responseUrl.origin === BACKEND_API_BASE_URL
      && responseUrl.pathname
        === `/v1/sync/spaces/${encodeURIComponent(spaceId)}/check`
    ) {
      backendCheckResponses.push(response.status());
    }
    if (
      response.url().startsWith(BACKEND_API_BASE_URL)
      && response.status() >= 400
    ) {
      backendHttpErrors.push(
        `${response.request().method()} ${response.url()}: HTTP ${response.status()}`,
      );
    }
  });

  // ─── Phase 1: 预设环境（addInitScript 在 goto 前注入，无需 reload）───
  await page.addInitScript(() => {
    localStorage.setItem("v3-sync-provider", "none");
  });

  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.sync,
    )
  );
  // 设置 debug 日志级别、后端地址与独立 Cloudflare 空间，并检查同步状态
  // effect 会在 debugMode=false 时把 logger 回写为 warn，与测试注入的 debug 级别形成竞态；
  // 改为在 Phase 4 通过应用设置开关（other-debug-mode）开启，由应用统一管理 logger 级别。
  const configurationResult = await page.evaluate(async ({ apiBaseUrl, spaceId }) => {
    try {
      const backendAddressModuleUrl = "/src/shared/storage/backend-api-address.ts";
      const cloudflareSettingsModuleUrl = "/src/shared/storage/cloudflare-sync-settings.ts";
      const [backendAddress, cloudflareSettings] = await Promise.all([
        import(/* @vite-ignore */ backendAddressModuleUrl),
        import(/* @vite-ignore */ cloudflareSettingsModuleUrl),
      ]);
      backendAddress.writeBackendApiAddressOverride(apiBaseUrl);
      const settings = await cloudflareSettings.writeCloudflareSyncSettings({
        spaceName: spaceId,
        remoteMode: "anonymous",
      });
      return {
        ok: true,
        apiBaseUrl: backendAddress.resolveBackendApiBaseUrl(),
        spaceId: cloudflareSettings.resolveCloudflareSpaceId(settings),
      };
    } catch (e: unknown) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, {
    apiBaseUrl: BACKEND_API_BASE_URL,
    spaceId,
  });
  console.log(`[TEST] configuration result: ${JSON.stringify(configurationResult)}`);
  expect(configurationResult).toEqual({
    ok: true,
    apiBaseUrl: BACKEND_API_BASE_URL,
    spaceId,
  });

  // 同时通过 appHost 直接验证同步状态
  const syncStatus = await page.evaluate(() => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const sync = host?.workspace?.sync;
    if (!sync) return "sync=null";
    const s = sync.state;
    return `enabled=${s.settings.enabled} phase=${s.status.phase} provider=${localStorage.getItem("v3-sync-provider")}`;
  });
  console.log(`[TEST] Initial sync status: ${syncStatus}`);
  await page.getByRole("button", { name: "菜单", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(2000);

  // ─── Phase 2: 切换基地 → 盈天台建设站 ───
  await switchBase(page, "stm_hongs_3");

  const remoteSeed = await page.evaluate(async () => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const documentSnapshot = host?.workspace?.editor?.document?.getSnapshot();
    if (!documentSnapshot) {
      throw new Error("Current world document is unavailable.");
    }
    const syncHostModuleUrl = "/src/sync/sync-host.ts";
    const { createWorldDocumentRemoteValue } = await import(
      /* @vite-ignore */ syncHostModuleUrl
    );
    return {
      assetId: documentSnapshot.baseId as string,
      content: JSON.stringify(createWorldDocumentRemoteValue(documentSnapshot)),
    };
  });
  expect(remoteSeed.assetId).toBe("stm_hongs_3");

  // ─── Phase 3: 放置精炼炉 ───
  await chooseWorkbenchMenuItem(page, "放置模式");
  await page.waitForTimeout(800);

  const furnace = page.locator('[data-ui-button-id="placement-furnance_1"]');
  await furnace.scrollIntoViewIfNeeded();
  await expect(furnace).toBeVisible({ timeout: 15_000 });
  await furnace.click();
  await page.waitForTimeout(300);

  const box = (await page.locator("canvas").first().boundingBox())!;
  await page.locator("canvas").first().click({
    position: { x: box.width / 2 + 50, y: box.height / 2 + 50 },
    force: true,
  });
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-sync-save-state]')).toHaveCount(0, { timeout: 3000 });

  const seededRevision = await seedRemoteWorldDocument(
    request,
    spaceId,
    remoteSeed.assetId,
    remoteSeed.content,
  );
  expect(seededRevision).not.toBe("0");

  // ─── Phase 4: 开启实验性功能 + CF Worker 同步 ───
  await chooseWorkbenchMenuItem(page, "设置");
  await expect(page.getByRole("heading", { name: "设置" }).first()).toBeVisible({ timeout: 10_000 });

  const hasSidebar = await page.getByRole("tree").isVisible().catch(() => false);
  if (hasSidebar) await page.getByRole("treeitem", { name: "其他" }).click();

  const expToggle = page.locator('input[name="other-experimental-features"]');
  await expect(expToggle).toBeVisible({ timeout: 5000 });
  if (!(await expToggle.isChecked())) {
    await page.locator('label[for="setting-other-experimental-features"]').click();
    await page.getByRole("button", { name: "开启实验性功能" }).click();
    await page.waitForTimeout(800);
  }

  // 直接调用 logger.setLogLevel 会被应用在 debugMode=false 时回写为 warn（Phase 1 断言不稳定）。
  const debugModeToggle = page.locator('input[name="other-debug-mode"]');
  await expect(debugModeToggle).toBeVisible({ timeout: 5000 });
  if (!(await debugModeToggle.isChecked())) {
    await debugModeToggle.check({ force: true });
  }
  await expect.poll(async () => await page.evaluate(async () => {
    const loggerModuleUrl = "/src/shared/logging/logger.ts";
    const logger = await import(/* @vite-ignore */ loggerModuleUrl);
    return (logger as { getLogLevel(): string }).getLogLevel();
  }), {
    message: "应用设置开启调试模式后 logger 级别应变为 debug",
    timeout: 10_000,
    intervals: [250],
  }).toBe("debug");

  if (hasSidebar) await page.getByRole("treeitem", { name: "实验性" }).click();
  await page.locator('select[name="sync-provider"]').selectOption("cloudflare");
  await page.waitForTimeout(1000);
  // 必须先解决冲突并等待同步结束，再点击设置关闭按钮。
  // 冲突解决后还需要先关闭 Cloudflare 状态窗口，再关闭设置窗口。
  const cloudflareDialog = page.getByRole("dialog", { name: "Cloudflare 同步状态" });
  await expect(cloudflareDialog).toBeVisible();
  const activateCloudflareButton = cloudflareDialog.getByRole("button", {
    name: "使用此 Space ID 并启用",
  });
  await expect(activateCloudflareButton).toBeEnabled();
  await activateCloudflareButton.click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  const settingsCloseButton = settingsDialog.getByRole("button", {
    name: "关闭",
    exact: true,
  });
  await expect(settingsCloseButton).toBeVisible();
  await page.waitForTimeout(5000);

  // ─── Phase 5: 查看同步启动日志 ───
  console.log(`[TEST] Sync logs after enabling (${syncLogs.length}):`);
  syncLogs.forEach((l) => console.log(`  ${l}`));

  // 直接检查同步状态
  const syncStateAfterEnable = await page.evaluate(() => {
    const host = (window as unknown as BrowserTestWindow).__industrialPlannerAppHost;
    const sync = host?.workspace?.sync;
    if (!sync) return "sync=null";
    const s = sync.state;
    return `enabled=${s.settings.enabled} phase=${s.status.phase} saveState=${s.status.saveState} stage=${s.status.initialSyncStage} lastError=${s.status.lastError ?? "none"}`;
  });
  console.log(`[TEST] Sync state after enable: ${syncStateAfterEnable}`);

  // 处理冲突对话框
  const conflictTitle = page.getByRole("heading", { name: "同步冲突" });
  let conflictResolved = false;
  try {
    await expect(conflictTitle).toBeVisible({ timeout: 20_000 });
    console.log("[TEST] Conflict appeared");

    const batchBtn = page.getByRole("button", {
      name: resolution === "use-remote" ? "全部使用远端" : "全部使用我的",
    });
    if (await batchBtn.isVisible().catch(() => false)) {
      await batchBtn.click();
    } else {
      await Promise.all(
        Array.from({
          length: await page.locator(`input[value="${resolution}"]`).count(),
        }, (_, i) =>
          page.locator(`input[value="${resolution}"]`).nth(i).check({ force: true }),
        ),
      );
    }

    await page.getByRole("button", { name: "应用" }).click();
    await expect(conflictTitle).not.toBeVisible({ timeout: 30_000 });
    conflictResolved = true;
    console.log("[TEST] Conflict resolved");
  } catch (error) {
    console.log("[TEST] No conflict appeared");
    await page.screenshot({ path: ".temp/playwright-test/post-sync-state.png" });
    throw error;
  }
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          pendingConflict: sync.state.pendingConflict,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "冲突解决后同步应回到无错误的 idle 状态",
    timeout: 60_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    pendingConflict: null,
    pendingLocalChangeCount: 0,
    lastError: null,
  });

  const localFurnaceCountAfterResolution = await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  );
  if (resolution === "use-remote") {
    expect(localFurnaceCountAfterResolution).toBe(0);
    expect((await readRemotePlan(request, spaceId)).revision).toBe(seededRevision);
  } else {
    expect(localFurnaceCountAfterResolution).toBeGreaterThan(0);
    await expect.poll(async () => {
      const revision = await tryReadRemoteRevision(request, spaceId);
      return revision !== null && revision !== seededRevision;
    }, {
      message: "使用本地应将本地冲突内容上传并推进远端 revision",
      timeout: 45_000,
      intervals: [1000],
    }).toBe(true);

    const planAfterUseLocal = await readRemotePlan(request, spaceId);
    const remoteWorldDocumentAfterUseLocal = planAfterUseLocal.assets.find((asset) =>
      asset.assetType === TEST_WORLD_DOCUMENT_ASSET_TYPE
      && asset.assetId === remoteSeed.assetId
    );
    expect(remoteWorldDocumentAfterUseLocal).toBeDefined();
    const downloadAfterUseLocal = await request.get(
      remoteWorldDocumentAfterUseLocal!.downloadUrl,
    );
    expect(
      downloadAfterUseLocal.ok(),
      await downloadAfterUseLocal.text(),
    ).toBe(true);
    const uploadedLocalDocument = await downloadAfterUseLocal.json() as BrowserWorldDocument;
    expect(
      Object.values(uploadedLocalDocument.entities)
        .some((entity) => entity.definitionId === "furnance_1"),
    ).toBe(true);
  }
  const revisionAfterConflictResolution = (
    await readRemotePlan(request, spaceId)
  ).revision;
  await cloudflareDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(cloudflareDialog).not.toBeVisible();
  await settingsCloseButton.click();
  await expect(settingsDialog).not.toBeVisible();

  // ─── Phase 6: 小检查 (~35s) ───
  const preCheck = syncLogs.length;
  const preCheckResponseCount = backendCheckResponses.length;
  const previousUpdateCheckAt = await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastUpdateCheckAt ?? null
  );
  const checkTimingBaseline = await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return {
      observedAt: new Date().toISOString(),
      performanceNow: performance.now(),
      visibilityState: document.visibilityState,
      phase: sync?.state.status.phase ?? null,
      currentRunReason: sync?.state.status.currentRunReason ?? null,
      lastUpdateCheckAt: sync?.state.status.lastUpdateCheckAt ?? null,
    };
  });
  console.log(
    `[TEST] Update-check timing baseline: ${JSON.stringify(checkTimingBaseline)}`,
  );
  console.log("[TEST] Waiting for the next update check...");
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
      ?.workspace?.sync?.state.status.lastUpdateCheckAt ?? null
  ), {
    message: "应在一个默认检查周期内完成更新检查",
    timeout: 70_000,
    intervals: [1000],
  }).not.toBe(previousUpdateCheckAt);

  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          currentRunReason: sync.state.status.currentRunReason,
          pendingConflict: sync.state.pendingConflict,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "更新检查触发的后续同步应完成并回到稳定状态",
    timeout: 60_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    currentRunReason: null,
    pendingConflict: null,
    pendingLocalChangeCount: 0,
    lastError: null,
  });

  const checkLogs = syncLogs.slice(preCheck);
  const updateCheckResponses = backendCheckResponses.slice(preCheckResponseCount);
  expect((await readRemotePlan(request, spaceId)).revision)
    .toBe(revisionAfterConflictResolution);
  // 独立向当前 test 的空间发送同一 knownRevision 检查，以 HTTP 结果作为权威断言。
  const verificationCheck = await request.get(
    `${BACKEND_API_BASE_URL}/v1/sync/spaces/${encodeURIComponent(spaceId)}`
      + `/check?knownRevision=${revisionAfterConflictResolution}`,
  );
  const shortCircuited = verificationCheck.status() === 204;
  const remoteChanged = verificationCheck.status() === 200;
  console.log(`[TEST] Update check: short-circuited=${shortCircuited}, changed=${remoteChanged}`);
  console.log(
    `[TEST] Page check HTTP statuses: ${updateCheckResponses.join(", ")}; `
      + `verification=${verificationCheck.status()}`,
  );
  checkLogs.forEach((l) => console.log(`  [CHECK] ${l}`));
  expect(shortCircuited).toBe(true);
  expect(remoteChanged).toBe(false);

  // ─── Phase 7: 增量同步 ───
  console.log("[TEST] Second furnace...");
  // 不重复点击"放置模式"：left dock 在 Phase 3 之后一直保持打开，重复点击会关闭它

  const revisionBeforeIncrementalSync = (
    await readRemotePlan(request, spaceId)
  ).revision;
  const entityCountBeforeIncrementalSync = await page.evaluate(() =>
    Object.keys(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).length
  );
  const furnaceCountBeforeIncrementalSync = await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  );

  const furnace2 = page.locator('[data-ui-button-id="placement-furnance_1"]');
  await furnace2.scrollIntoViewIfNeeded();
  await expect(furnace2).toBeVisible({ timeout: 10_000 });
  await furnace2.click();
  await page.waitForTimeout(300);

  const box2 = await page.locator("canvas").first().boundingBox();
  if (box2) {
    await page.locator("canvas").first().click({
      position: { x: box2.width / 2 + 150, y: box2.height / 2 + 150 },
      force: false,
    });
  }
  await expect.poll(async () => await page.evaluate(() =>
    Object.values(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).filter((entity) => entity.definitionId === "furnance_1").length
  ), {
    message: "第二次放置应在当前文档中创建精炼炉",
    timeout: 10_000,
  }).toBeGreaterThan(furnaceCountBeforeIncrementalSync);
  await expect.poll(async () => {
    const revision = await tryReadRemoteRevision(request, spaceId);
    if (revision === null || revision === revisionBeforeIncrementalSync) {
      return false;
    }
    const plan = await readRemotePlan(request, spaceId);
    const remoteWorldDocument = plan.assets.find((asset) =>
      asset.assetType === TEST_WORLD_DOCUMENT_ASSET_TYPE
      && asset.assetId === remoteSeed.assetId
    );
    if (remoteWorldDocument === undefined) {
      return false;
    }
    const response = await request.get(remoteWorldDocument.downloadUrl);
    if (!response.ok()) {
      return false;
    }
    const uploadedDocument = await response.json() as BrowserWorldDocument;
    return Object.values(uploadedDocument.entities)
      .some((entity) => entity.definitionId === "furnance_1");
  }, {
    message: "本地变化应触发增量上传并推进远端 revision",
    timeout: 45_000,
    intervals: [1000],
  }).toBe(true);
  const planAfterIncrementalSync = await readRemotePlan(request, spaceId);
  const remoteWorldDocument = planAfterIncrementalSync.assets.find((asset) =>
    asset.assetType === TEST_WORLD_DOCUMENT_ASSET_TYPE
    && asset.assetId === remoteSeed.assetId
  );
  expect(remoteWorldDocument).toBeDefined();
  const downloadResponse = await request.get(remoteWorldDocument!.downloadUrl);
  expect(downloadResponse.ok(), await downloadResponse.text()).toBe(true);
  const uploadedDocument = await downloadResponse.json() as BrowserWorldDocument;
  expect(
    Object.values(uploadedDocument.entities)
      .some((entity) => entity.definitionId === "furnance_1"),
  ).toBe(true);
  await expect.poll(async () => await page.evaluate(() => {
    const sync = (window as unknown as BrowserTestWindow)
      .__industrialPlannerAppHost?.workspace?.sync;
    return sync === null || sync === undefined
      ? null
      : {
          phase: sync.state.status.phase,
          saveState: sync.state.status.saveState,
          pendingLocalChangeCount: sync.state.status.pendingLocalChangeCount,
          lastError: sync.state.status.lastError,
        };
  }), {
    message: "增量上传后同步应完成本地状态落盘并回到 idle",
    timeout: 30_000,
  }).toEqual({
    phase: "idle",
    saveState: "idle",
    pendingLocalChangeCount: 0,
    lastError: null,
  });
  const entityCountAfterIncrementalSync = await page.evaluate(() =>
    Object.keys(
      (window as unknown as BrowserTestWindow).__industrialPlannerAppHost
        ?.workspace?.editor?.document?.getSnapshot()?.entities ?? {},
    ).length
  );
  expect(entityCountAfterIncrementalSync).toBeGreaterThan(entityCountBeforeIncrementalSync);

  const hasError = await page.locator('[data-sync-save-state="error"]').isVisible().catch(() => false);
  console.log(`[TEST] Save error: ${hasError}`);

  const incrLogs = syncLogs.slice(preCheck + checkLogs.length);
  console.log("[TEST] Incremental sync logs:");
  incrLogs.slice(-15).forEach((l) => console.log(`  [INCR] ${l}`));

  // ─── 汇总 ───
  console.log(`\n[TEST] SUMMARY: logs=${syncLogs.length} conflict=${conflictResolved} shortCircuited=${shortCircuited} saveError=${hasError}`);
  expect(conflictResolved).toBe(true);
  expect(hasError).toBe(false);
  expect(backendRequestFailures).toEqual([]);
  expect(backendHttpErrors).toEqual([]);
}
