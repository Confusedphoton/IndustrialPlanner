import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { publishedImageSize, resizeAssetRgba, resolveAssetScale } from './building-asset-image.mjs';

const TILE = 128;
const PADDING = 2;

/** 编码 sRGB 数值空间的 straight-alpha source-over，与 contract2 的离线规范一致。 */
export function compositeLogisticsLayers(layers) {
  const pixelCount = layers[0]?.pixels.length / 4;
  const tileSize = Math.sqrt(pixelCount);
  if (!Number.isSafeInteger(tileSize) || layers.some(({ pixels }) => pixels.length !== pixelCount * 4)) {
    throw new Error('Logistics layers must share one square RGBA canvas');
  }
  const output = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < output.length; i += 4) {
    let a = 0;
    const rgb = [0, 0, 0];
    for (const { pixels, tint = [1, 1, 1] } of layers) {
      const sa = pixels[i + 3] / 255;
      for (let channel = 0; channel < 3; channel++) {
        rgb[channel] = pixels[i + channel] / 255 * tint[channel] * sa + rgb[channel] * (1 - sa);
      }
      a = sa + a * (1 - sa);
    }
    for (let channel = 0; channel < 3; channel++) output[i + channel] = a ? Math.round(rgb[channel] / a * 255) : 0;
    output[i + 3] = Math.round(a * 255);
  }
  return output;
}

/** 固定小图集及挤出边缘；运行时仅创建子纹理，不合成画布或 RenderTexture。 */
export async function publishAtlas(directory, name, entries, manifest, resolution, sourceResolution = 1) {
  const sourceTileSize = Math.sqrt(entries[0]?.[1].length / 4);
  if (!Number.isSafeInteger(sourceTileSize) || sourceTileSize / sourceResolution !== TILE) {
    throw new Error('Logistics atlas tile density differs');
  }
  const scale = resolveAssetScale(sourceResolution, resolution);
  const tileSize = publishedImageSize(sourceTileSize, sourceTileSize, scale).width;
  const STRIDE = tileSize + PADDING * 2;
  const columns = Math.min(4, entries.length);
  const rows = Math.ceil(entries.length / columns);
  const width = columns * STRIDE;
  const height = rows * STRIDE;
  const pixels = Buffer.alloc(width * height * 4);
  for (const [index, [key, sourceTile]] of entries.entries()) {
    const { data: tile } = await resizeAssetRgba(sourceTile, sourceTileSize, sourceTileSize, scale);
    const left = index % columns * STRIDE;
    const top = Math.floor(index / columns) * STRIDE;
    for (let y = 0; y < STRIDE; y++) {
      for (let x = 0; x < STRIDE; x++) {
        const sx = Math.min(tileSize - 1, Math.max(0, x - PADDING));
        const sy = Math.min(tileSize - 1, Math.max(0, y - PADDING));
        tile.copy(pixels, ((top + y) * width + left + x) * 4, (sy * tileSize + sx) * 4, (sy * tileSize + sx) * 4 + 4);
      }
    }
    manifest.frames[key] = { page: name, rect: [left + PADDING, top + PADDING, tileSize, tileSize] };
  }
  const file = `${name}.webp`;
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .webp({ lossless: true }).toFile(path.join(directory, file));
  manifest.pages[name] = { file, width, height };
}


