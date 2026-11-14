import { BufferImageSource, ImageSource, Rectangle, Texture } from 'pixi.js';
import type { LogisticsStaticManifest } from '@/shared/logistics-material';
import type { LogisticsBakedManifest } from '@/shared/logistics-baked';
import { createPublicAssetUrl } from '@/shared/browser/public-asset-url';

const ROOT = '3d-top-view/logistics';

export interface LogisticsDynamicAssets {
  readonly manifest: LogisticsBakedManifest;
  readonly textures: ReadonlyMap<string, Texture>;
}

export interface LogisticsDynamicSession {
  readonly ready: Promise<LogisticsDynamicAssets>;
  release(): void;
}

interface LoadedImage { texture: Texture; bitmap: ImageBitmap | null }

/** 公共烘焙资源按渲染器生命周期常驻；没有按物品染色的独立图片或 RenderTexture。 */
export class LogisticsMaterialTextureCache {
  private readonly controller = new AbortController();
  private readonly images: LoadedImage[] = [];
  private readonly frames = new Map<string, Promise<Texture>>();
  private readonly subtextures = new Set<Texture>();
  private readonly staticPages = new Map<string, Promise<Texture>>();
  private staticManifest: Promise<LogisticsStaticManifest> | null = null;
  private dynamic: Promise<LogisticsDynamicAssets> | null = null;
  private owners = 0;
  private dynamicTextures = 0;
  private destroyed = false;

  public constructor(private readonly upload: (texture: Texture) => void = () => undefined) {}

  private async fetch(url: string): Promise<Response> {
    const response = await fetch(createPublicAssetUrl(url), { credentials: 'same-origin', signal: this.controller.signal });
    if (!response.ok) throw new Error(`Logistics asset request failed: ${response.status} ${url}`);
    return response;
  }

  private async loadImage(url: string, width: number, height: number, data = false,
    filter: 'linear' | 'nearest' = 'linear'): Promise<LoadedImage> {
    const response = await this.fetch(url);
    let bitmap: ImageBitmap | null = null;
    let texture: Texture;
    if (data) {
      if (!response.body) throw new Error(`Empty numeric texture: ${url}`);
      const rgba = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      if (rgba.length !== width * height * 4) throw new Error(`Numeric texture dimensions differ: ${url}`);
      texture = new Texture({ source: new BufferImageSource({ resource: rgba, width, height, format: 'rgba8unorm',
        alphaMode: 'no-premultiply-alpha', scaleMode: filter, addressMode: 'clamp-to-edge', autoGenerateMipmaps: false }) });
    } else {
      bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
      if (bitmap.width !== width || bitmap.height !== height) { bitmap.close(); throw new Error(`Texture dimensions differ: ${url}`); }
      texture = new Texture({ source: new ImageSource({ resource: bitmap, alphaMode: 'premultiplied-alpha',
        scaleMode: filter, addressMode: 'clamp-to-edge', autoGenerateMipmaps: false }) });
    }
    texture.source.label = url;
    texture.source.autoGarbageCollect = false;
    if (this.destroyed) { texture.destroy(true); bitmap?.close(); throw new Error('Logistics texture cache destroyed'); }
    try { this.upload(texture); }
    catch (error) { texture.destroy(true); bitmap?.close(); throw error; }
    const image = { texture, bitmap }; this.images.push(image); return image;
  }

  public getStatic(key: string): Promise<Texture> {
    if (this.destroyed) return Promise.reject(new Error('Logistics texture cache destroyed'));
    // 普通静态回退与虚影只显示空管，流体统一由路线 Mesh 绘制。
    const normalized = key.replace(/^pipe\/[^/]+\//, 'pipe/empty/');
    let frame = this.frames.get(normalized);
    if (!frame) { frame = this.loadStatic(normalized); this.frames.set(normalized, frame); }
    return frame;
  }

  private async loadStatic(key: string): Promise<Texture> {
    this.staticManifest ??= this.fetch(`${ROOT}/static/manifest.json`).then((response) => response.json() as Promise<LogisticsStaticManifest>);
    const manifest = await this.staticManifest;
    if (manifest.schemaVersion !== 1 || manifest.materialContractVersion !== 2) throw new Error('Invalid logistics static manifest');
    const frame = manifest.frames[key];
    const page = frame && manifest.pages[frame.page];
    if (!frame || !page || !/^[\w-]+\.webp$/.test(page.file)) throw new Error(`Missing static frame: ${key}`);
    let image = this.staticPages.get(frame.page);
    if (!image) {
      image = this.loadImage(`${ROOT}/static/${page.file}`, page.width, page.height).then((loaded) => loaded.texture);
      this.staticPages.set(frame.page, image);
    }
    const parent = await image;
    if (this.destroyed) throw new Error('Logistics texture cache destroyed');
    const texture = new Texture({ source: parent.source, frame: new Rectangle(...frame.rect) });
    this.subtextures.add(texture); return texture;
  }

  public acquireDynamic(): LogisticsDynamicSession {
    if (this.destroyed) throw new Error('Logistics texture cache destroyed');
    this.dynamic ??= this.loadDynamic().catch((error: unknown) => { this.dynamic = null; throw error; });
    this.owners++;
    let released = false;
    return { ready: this.dynamic, release: () => { if (!released) { released = true; this.owners--; } } };
  }

  private async loadDynamic(): Promise<LogisticsDynamicAssets> {
    const manifest = await (await this.fetch(`${ROOT}/baked/manifest.json`)).json() as LogisticsBakedManifest;
    if (manifest.schemaVersion !== 2 || manifest.format !== 'logistics-spritesheet-v2') throw new Error('Invalid baked logistics manifest');
    const textures = new Map<string, Texture>();
    const loaded: LoadedImage[] = [];
    try {
      const results = await Promise.allSettled(Object.entries(manifest.pages).map(async ([id, page]) => {
        if (!/^[\w-]+\.(?:webp|rgba\.bin)$/.test(page.file)) throw new Error(`Unsafe baked resource: ${page.file}`);
        const image = await this.loadImage(`${ROOT}/baked/${page.file}`, page.width, page.height, page.data, page.filter);
        loaded.push(image); textures.set(id, image.texture);
      }));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (this.destroyed) throw new Error('Logistics texture cache destroyed');
      for (const [id, frame] of Object.entries(manifest.frames)) {
        const page = textures.get(frame.page);
        if (!page) throw new Error(`Missing baked frame page: ${id}`);
        const texture = new Texture({ source: page.source, frame: new Rectangle(...frame.rect),
          orig: new Rectangle(0, 0, ...frame.sourceSize), trim: new Rectangle(...frame.spriteSourceSize) });
        this.subtextures.add(texture); textures.set(id, texture);
      }
      this.dynamicTextures = loaded.length;
      return { manifest, textures };
    } catch (error) {
      // 等所有并发请求结束后回收本次失败加载，避免迟到结果重新写入缓存。
      for (const image of loaded) {
        const index = this.images.indexOf(image);
        if (index >= 0) { this.images.splice(index, 1); image.texture.destroy(true); image.bitmap?.close(); }
      }
      throw error;
    }
  }

  public getStats() {
    return { staticPages: this.staticPages.size, staticFrames: this.frames.size,
      dynamicOwners: this.owners, dynamicTextures: this.dynamicTextures,
      residentBytes: this.images.reduce((sum, image) => sum + image.texture.source.width * image.texture.source.height * 4, 0) };
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.controller.abort();
    for (const texture of this.subtextures) texture.destroy();
    for (const image of this.images.splice(0)) { image.texture.destroy(true); image.bitmap?.close(); }
    this.subtextures.clear(); this.frames.clear(); this.staticPages.clear(); this.dynamic = null; this.dynamicTextures = 0;
  }
}

