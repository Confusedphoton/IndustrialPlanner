import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import Icons from "unplugin-icons/vite";
import { VitePWA } from "vite-plugin-pwa";

const PWA_MAX_CACHE_FILE_BYTES = 50 * 1024 * 1024;
let PWA_DIST_DIRECTORY = fileURLToPath(new URL("./dist/", import.meta.url));
const APP_VERSION_CACHE_KEY = encodeURIComponent(process.env.VITE_APP_VERSION?.trim() || "dev");
const PUBLIC_BASE_PATH = process.env.VITE_PUBLIC_BASE_PATH?.trim() || "./";

interface WorkboxManifestEntryWithSize {
  readonly integrity?: string;
  readonly revision: string | null;
  readonly size: number;
  readonly url: string;
}

interface IndustrialPlannerPrecacheManifestEntry extends WorkboxManifestEntryWithSize {
  readonly bytes: number;
  readonly sha256: string;
}

async function createIndustrialPlannerPrecacheManifestEntry(
  entry: WorkboxManifestEntryWithSize,
): Promise<IndustrialPlannerPrecacheManifestEntry> {
  const fileBuffer = await readFile(resolvePrecacheFilePath(entry.url));

  return {
    integrity: entry.integrity,
    revision: entry.revision,
    size: entry.size,
    bytes: fileBuffer.byteLength,
    sha256: createHash("sha256").update(fileBuffer).digest("hex"),
    url: entry.url,
  };
}

function resolvePrecacheFilePath(entryUrl: string): string {
  const url = new URL(entryUrl, "https://industrial-planner.local/");
  const relativeFilePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const filePath = resolve(PWA_DIST_DIRECTORY, relativeFilePath);
  const pathInsideDist = relative(PWA_DIST_DIRECTORY, filePath);

  if (pathInsideDist.startsWith("..") || isAbsolute(pathInsideDist)) {
    throw new Error(`Invalid PWA precache path: ${entryUrl}`);
  }

  return filePath;
}

function rewriteOAuthCallbackPath(requestUrl: string | undefined): string | undefined {
  return requestUrl?.replace(
    /^\/(auth|oauth)\/callback(?=\?|$)/u,
    "/$1/callback/",
  );
}

export default defineConfig({
  base: PUBLIC_BASE_PATH,
  define: {
    "import.meta.env.VITE_APP_VERSION_CACHE_KEY": JSON.stringify(APP_VERSION_CACHE_KEY),
  },
  build: {
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        yituliuOAuthCallback: fileURLToPath(new URL("./oauth/callback/index.html", import.meta.url)),
        oauthCallback: fileURLToPath(
          new URL("./auth/callback/index.html", import.meta.url),
        ),
      },
    },
  },
  plugins: [
    {
      name: "pwa-output-directory",
      configResolved(config) {
        PWA_DIST_DIRECTORY = resolve(config.root, config.build.outDir);
      },
    },
    {
      name: "oauth-callback-path-rewrite",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          request.url = rewriteOAuthCallbackPath(request.url);
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
          request.url = rewriteOAuthCallbackPath(request.url);
          next();
        });
      },
    },
    react(),
    Icons({
      compiler: "jsx",
      jsx: "react",
    }),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/app/pwa",
      filename: "sw.ts",
      injectRegister: false,
      registerType: "prompt",
      scope: "./",
      manifestFilename: "manifest.webmanifest",
      includeAssets: ["pwa-icon.svg", "pwa-icon-192.webp", "pwa-icon-512.webp"],
      manifest: {
        name: "集成工业仿真",
        short_name: "工业仿真",
        description: "离线可用的工业规划与仿真工具",
        lang: "zh-CN",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#15231f",
        theme_color: "#15231f",
        icons: [
          {
            src: "pwa-icon-192.webp",
            sizes: "192x192",
            type: "image/webp",
            purpose: "any maskable",
          },
          {
            src: "pwa-icon-512.webp",
            sizes: "512x512",
            type: "image/webp",
            purpose: "any maskable",
          },
          {
            src: "pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      injectManifest: {
        // 高度与物流数值图均使用原始 RGBA；动画目录中的数据图随既有动画分区离线下载。
        globPatterns: ["**/*.{js,css,html,webp,svg,json,webmanifest,md,mp3}", "3d-top-view/**/*.rgba.bin"],
        globIgnores: [
          "**/sw.js",
          "**/workbox-*.js",
        ],
        maximumFileSizeToCacheInBytes: PWA_MAX_CACHE_FILE_BYTES,
        manifestTransforms: [
          async (entries) => ({
            manifest: await Promise.all(entries.map(createIndustrialPlannerPrecacheManifestEntry)),
            warnings: [],
          }),
        ],
      },
    }),
    {
      name: "oauth-callback-manifest-path",
      enforce: "post",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          if (!html.includes('id="oauth-callback-root"')) {
            return html;
          }
          return html.replace(
            'href="./manifest.webmanifest"',
            'href="../../manifest.webmanifest"',
          );
        },
      },
    },
  ],
  server: {
    allowedHosts: [".hsyhhssyy.net"],
    watch: {
      ignored: ["**/.temp/**"],
    },
  },
  preview: {
    allowedHosts: [".hsyhhssyy.net"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 全局配置（reporter、coverage 等放这里）
    environment: "jsdom",
    globals: true,
    setupFiles: [],

    projects: [
      {
        // 常规测试，继承根配置，默认并行
        extends: true,
        test: {
          name: "normal",
          include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
          // 按本机核数并行（半数核心，32 核下即 16，已验证稳定）；原先固定 2 个 worker 是上游机器上的权宜之计。
          maxWorkers: "50%",
          testTimeout: 30_000,
          exclude: [
            "src/tests/e2e/**",
            "src/tests/simulation/blueprint/**",
          ],
        },
      },
      {
        // 真实蓝图长时间仿真回归，仅显式运行（npm run test:blueprint）
        extends: true,
        test: {
          name: "blueprint",
          include: ["src/tests/simulation/blueprint/**"],
          // 蓝图仿真测试内存密集，串行执行防止 OOM
          fileParallelism: false,
          maxConcurrency: 1,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
