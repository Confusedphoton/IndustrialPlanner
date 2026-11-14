import {
  Assets,
  ExtensionType,
  ImageSource,
  WorkerManager,
  createTexture,
  extensions,
  loadImageBitmap,
  loadTextures,
} from "pixi.js";
import type { Loader, LoaderParser, ResolvedAsset, Texture } from "pixi.js";

/** 原始素材和帧坐标保持不变；仅将上传位图的两个边长减半。 */

const PARSER_ID = "device-animation-published-bitmap";
let registered = false;

/** 通过 Assets 共享加载 Promise 和卸载生命周期，避免同一页被多个设备重复缩放。 */
export function loadDeviceAnimationTexture(path: string, resolution: number): Promise<Texture> {
  if (!registered) {
    const parser: LoaderParser<Texture> = {
      extension: ExtensionType.LoadParser,
      id: PARSER_ID,
      load: loadPublishedTexture,
      unload: (texture) => { texture.destroy(true); },
    };
    extensions.add(parser);
    registered = true;
  }
  return Assets.load<Texture>({ src: path, parser: PARSER_ID, data: { resolution } });
}


/** 已发布图片只解码一次；像素密度恢复逻辑帧坐标，不生成第二份位图。 */
async function loadPublishedTexture(
  url: string,
  asset?: ResolvedAsset,
  loader?: Loader,
): Promise<Texture> {
  const resolution: unknown = asset?.data?.resolution;
  if (loader === undefined || typeof resolution !== "number"
    || !Number.isFinite(resolution) || resolution <= 0 || resolution > 1) {
    throw new Error("Published animation texture requires a valid resolution and loader");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("Published animation textures require ImageBitmap support");
  }
  const bitmap = loadTextures.config?.preferWorkers && await WorkerManager.isImageBitmapSupported()
    ? await WorkerManager.loadImageBitmap(url)
    : await loadImageBitmap(url);
  try {
    const source = new ImageSource({ resource: bitmap, resolution, alphaMode: "premultiplied-alpha" });
    source.once("destroy", () => bitmap.close());
    return createTexture(source, loader, url);
  } catch (error) {
    bitmap.close();
    throw error;
  }
}
