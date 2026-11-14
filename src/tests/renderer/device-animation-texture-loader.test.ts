import { Assets, loadTextures } from "pixi.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadDeviceAnimationTexture } from "@/renderer/texture/device-animation-texture-loader";

const loadedPaths = new Set<string>();
const preferWorkers = loadTextures.config!.preferWorkers;
let nextPath = 0;

beforeAll(async () => {
  // 使用真实 Assets/Texture；仅替代 jsdom 缺失的网络与位图解码边界。
  loadTextures.config!.preferWorkers = false;
  await Assets.init({ skipDetections: true });
});

afterEach(async () => {
  for (const path of loadedPaths) await Assets.unload(path);
  loadedPaths.clear();
  vi.unstubAllGlobals();
});

afterAll(() => { loadTextures.config!.preferWorkers = preferWorkers; });


function preparePublishedBitmap(options: { decodeError?: Error } = {}) {
  const bitmap = { width: 3, height: 2, close: vi.fn() };
  const blob = new Blob(["fixture"], { type: "image/webp" });
  const decode = vi.fn(async () => {
    if (options.decodeError) throw options.decodeError;
    return bitmap;
  });
  const fetch = vi.fn(async () => ({ ok: true, blob: async () => blob }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("createImageBitmap", decode);
  return { bitmap, blob, decode, fetch, path: `/3d-top-view/animations/fixture/published-${nextPath++}.webp` };
}

describe("published animation texture loading", () => {
  it.each([0.5, 1])("只解码一次，按清单恢复逻辑尺寸，共享缓存并在卸载时关闭位图：%s", async (resolution) => {
    const context = preparePublishedBitmap();
    const [texture, shared] = await Promise.all([
      loadDeviceAnimationTexture(context.path, resolution),
      loadDeviceAnimationTexture(context.path, resolution),
    ]);
    loadedPaths.add(context.path);
    expect(shared).toBe(texture);
    expect(context.fetch).toHaveBeenCalledTimes(1);
    expect(context.decode).toHaveBeenCalledExactlyOnceWith(context.blob);
    expect(texture).toMatchObject({
      width: 3 / resolution, height: 2 / resolution,
      source: { pixelWidth: 3, pixelHeight: 2, resolution,
        resource: context.bitmap, alphaMode: "premultiplied-alpha" },
    });
    expect(context.bitmap.close).not.toHaveBeenCalled();
    await Assets.unload(context.path);
    loadedPaths.delete(context.path);
    expect(texture.destroyed).toBe(true);
    expect(context.bitmap.close).toHaveBeenCalledTimes(1);
    const reloaded = await loadDeviceAnimationTexture(context.path, resolution);
    loadedPaths.add(context.path);
    expect(reloaded).not.toBe(texture);
    expect(context.decode).toHaveBeenCalledTimes(2);
  });

  it("传播解码错误，不尝试缩放或创建第二份位图", async () => {
    const context = preparePublishedBitmap({ decodeError: new Error("decode failed") });
    await expect(loadDeviceAnimationTexture(context.path, 0.5)).rejects.toThrow("decode failed");
    expect(context.decode).toHaveBeenCalledExactlyOnceWith(context.blob);
    expect(context.bitmap.close).not.toHaveBeenCalled();
  });

  it.each([0, -1, 2, Number.NaN, Number.POSITIVE_INFINITY])("在请求图片前拒绝无效分辨率：%s", async (resolution) => {
    const context = preparePublishedBitmap();
    await expect(loadDeviceAnimationTexture(context.path, resolution)).rejects.toThrow("valid resolution");
    expect(context.fetch).not.toHaveBeenCalled();
  });
});
