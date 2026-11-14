// @vitest-environment node
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { LogisticsBakedManifest } from '@/shared/logistics-baked';

describe('网站烘焙物流发布', () => {
  it('正式产物使用完整相位序列和共享数值场，端帽与来源证明完整', async () => {
    const root = path.resolve('public/3d-top-view/logistics/baked');
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as LogisticsBakedManifest & {
      sourceSite: { siteUrl: string; releaseId: string; indexSha256: string };
    };
    expect(manifest.sourceSite.siteUrl).toBe('https://hsyhhssyy.github.io/Endfield-Building-TopView-Assets/');
    expect(manifest.sourceSite.releaseId).toMatch(/^v1\.5-/);
    expect(manifest.sourceSite.indexSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceSite).not.toHaveProperty('root');
    expect(manifest).not.toHaveProperty('fluidProfiles');
    for (const key of [manifest.endpointConnector.composite, manifest.endpointConnector.whitening]) expect(manifest.frames[`static/${key}`]).toBeDefined();
    expect(Object.entries(manifest.pages).filter(([, value]) => value.data).map(([id]) => id).sort()).toEqual(['fluid-data', 'gas-field']);
    for (const [id, page] of Object.entries(manifest.pages)) {
      const bytes = await readFile(path.join(root, page.file));
      expect(createHash('sha256').update(bytes).digest('hex'), id).toBe(page.sha256);
      if (!page.data) expect(await sharp(bytes).metadata()).toMatchObject({ width: page.width, height: page.height });
      else expect(gunzipSync(bytes).length, id).toBe(page.width * page.height * 4);
    }
    const statics = JSON.parse(await readFile('public/3d-top-view/logistics/static/manifest.json', 'utf8'));
    expect(Object.keys(statics.frames).filter((key) => key.startsWith('pipe/')).every((key) => key.startsWith('pipe/empty/'))).toBe(true);
  });

  it('正式静态图集与默认物流精灵的分页边界和分辨率一致', async () => {
    const baked = JSON.parse(await readFile('public/3d-top-view/logistics/baked/manifest.json', 'utf8')) as LogisticsBakedManifest;
    const statics = JSON.parse(await readFile('public/3d-top-view/logistics/static/manifest.json', 'utf8'));
    for (const page of Object.values(statics.pages) as { file: string; width: number; height: number }[]) {
      expect(await sharp(path.join('public/3d-top-view/logistics/static', page.file)).metadata())
        .toMatchObject({ width: page.width, height: page.height });
    }
    for (const frame of Object.values(statics.frames) as { page: string; rect: [number, number, number, number] }[]) {
      const page = statics.pages[frame.page];
      const [x, y, width, height] = frame.rect;
      expect(x + width).toBeLessThanOrEqual(page.width);
      expect(y + height).toBeLessThanOrEqual(page.height);
    }
    expect((await sharp('public/3d-top-view/sprites/pipe_straight_1x1.webp').metadata()).width)
      .toBe(128 * baked.resolution);
  });
});

