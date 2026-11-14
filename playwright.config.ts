import { defineConfig } from "playwright/test";

// 同一次运行由父进程设置，worker 继承同一路径，失败证据不覆盖历史轮次。
const runDirectory = process.env.E2E_RUN_DIRECTORY ?? `.temp/playwright-test/e2e/${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
process.env.E2E_RUN_DIRECTORY = runDirectory;

export default defineConfig({
  testDir: "./src/tests/e2e",
  outputDir: runDirectory,
  globalSetup: "./scripts/e2e/setup.mjs",
  timeout: 90_000,
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: `${runDirectory}/report.json` }]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    // 取证随受管 context 关闭；框架自动 tracing 会与 CLI/自建 context 重复启动。
    screenshot: "off",
    trace: "off",
  },
});
