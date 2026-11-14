// 订正 2026-10-07：原首行 `#!/usr/bin/env node` 已删除。Vite/Vitest 的 SSR 变换不剥离 shebang，
// 导入本模块的测试会在 transform 阶段直接 `SyntaxError: Invalid or unexpected token`；而本模块的所有
// 入口都以 `node src/scripts/sync-device-sprites.mjs` 方式调用，不依赖 shebang。
// 原首行：#!/usr/bin/env node

/**
 * 同步设备原始精灵图到运行时资源目录。
 * 下文旧来源、映射和无选项用法已失效；当前仅保留通用发布函数、--animations 和 --blueprint。
 * 网站导入统一使用 .agents/skills/import-building-assets/SKILL.md。
 *
 * 作用：
 * 1. 从 resources/device-sprite-original 读取按中文设备名命名的 PNG 原图。
 * 2. 按 DEVICE_SPRITE_MAPPINGS 映射为运行时使用的 spriteId。
 * 3. 输出无损 WebP 精灵图到 public/3d-top-view/sprites。
 * 4. 基于原图 alpha 通道生成对应的遮罩图到 public/3d-top-view/sprite-masks。
 *
 * 用法：
 *   node src/scripts/sync-device-sprites.mjs [sourceDir] [spriteDir] [maskDir]
 *   node src/scripts/sync-device-sprites.mjs --blueprint
 *   node src/scripts/sync-device-sprites.mjs --animations [sourceDir] [spriteDir] [maskDir] [animationDir]
 *
 * 参数：
 * - sourceDir: 原始 PNG 目录，默认 resources/device-sprite-original
 * - spriteDir: 精灵图输出目录，默认 public/3d-top-view/sprites
 * - maskDir: 遮罩图输出目录，默认 public/3d-top-view/sprite-masks
 * - --blueprint: 为 public/blueprint-view/sprites 下的蓝图精灵生成 mask
 */

import { access, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { tsImport } from 'tsx/esm/api';


import { publishPaginatedDeviceSpriteAnimations } from './device-sprite-animation-publisher.mjs';
import { publishedImageSize, resolveAssetScale } from './building-asset-image.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const defaultSpriteDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprites');
const defaultMaskDirectory = path.join(projectRoot, 'public', '3d-top-view', 'sprite-masks');
const defaultMaskOverrideDirectory = path.join(projectRoot, 'resources', 'device-sprite-mask-overrides');
const defaultAnimationSourceDirectory = path.join(projectRoot, 'resources', 'device-sprite-animation');
const defaultAnimationDirectory = path.join(projectRoot, 'public', '3d-top-view', 'animations');
const animationProtocol = await tsImport('../shared/device-sprite-animation.ts', {
  parentURL: import.meta.url,
  tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
});

function createMaskBuffer(sourceBuffer, width, height, channels) {
  const pixelCount = width * height;
  const maskBuffer = Buffer.alloc(pixelCount * 4);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const alpha = sourceBuffer[pixelIndex * channels + 3];
    const outputOffset = pixelIndex * 4;

    maskBuffer[outputOffset] = alpha;
    maskBuffer[outputOffset + 1] = alpha;
    maskBuffer[outputOffset + 2] = alpha;
    maskBuffer[outputOffset + 3] = 255;
  }

  return maskBuffer;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function publishDeviceSprite(
  sourceFilePath,
  spriteOutputFilePath,
  maskOutputFilePath,
  maskOverrideFilePath,
  rotation = 0,
  { frameTransform = null, crop = null, resolution = 1, sourceResolution = 1 } = {},
) {
  if (frameTransform !== null && frameTransform !== 'flip-top-bottom') {
    throw new Error('frameTransform must be null or flip-top-bottom');
  }
  await mkdir(path.dirname(spriteOutputFilePath), { recursive: true });
  await mkdir(path.dirname(maskOutputFilePath), { recursive: true });

  // 先构建旋转后的像素数据用于遮罩生成
  const rotatedPipeline = sharp(sourceFilePath)
    .ensureAlpha();

  if (crop) rotatedPipeline.extract(crop);
  if (frameTransform === 'flip-top-bottom') rotatedPipeline.flip();
  if (rotation !== 0) {
    rotatedPipeline.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }

  const { data, info } = await rotatedPipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  const scale = resolveAssetScale(sourceResolution, resolution);
  const published = publishedImageSize(info.width, info.height, scale);

  const webpPipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  if (scale !== 1) webpPipeline.resize(published.width, published.height, { kernel: 'lanczos3' });
  await webpPipeline
    .webp({ lossless: true, effort: 6 })
    .toFile(spriteOutputFilePath);

  if (await fileExists(maskOverrideFilePath)) {
    const override = await sharp(maskOverrideFilePath).metadata();
    if (!override.width || !override.height || override.width * published.height !== override.height * published.width) {
      throw new Error('Mask override aspect ratio differs from published frame');
    }
    await sharp(maskOverrideFilePath).resize(published.width, published.height, { kernel: 'lanczos3' })
      .webp({ lossless: true, effort: 6 }).toFile(maskOutputFilePath);
  } else {
    const maskBuffer = createMaskBuffer(data, info.width, info.height, info.channels);

    await sharp(maskBuffer, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .resize(published.width, published.height, { kernel: 'lanczos3' })
      .webp({ lossless: true, effort: 6 })
      .toFile(maskOutputFilePath);
  }

  return {
    width: published.width,
    height: published.height,
  };
}

async function generateMaskOnly(sourceFilePath, maskOutputFilePath) {
  await mkdir(path.dirname(maskOutputFilePath), { recursive: true });

  const { data, info } = await sharp(sourceFilePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const maskBuffer = createMaskBuffer(data, info.width, info.height, info.channels);

  await sharp(maskBuffer, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .webp({ lossless: true, effort: 6 })
    .toFile(maskOutputFilePath);

  return {
    width: info.width,
    height: info.height,
  };
}

async function processBlueprintMasks(spriteDirectoryArgument, maskDirectoryArgument) {
  const spriteDir = path.resolve(
    spriteDirectoryArgument ?? path.join(projectRoot, 'public', 'blueprint-view', 'sprites'),
  );
  const maskDir = path.resolve(
    maskDirectoryArgument ?? path.join(projectRoot, 'public', 'blueprint-view', 'sprite-masks'),
  );

  const entries = await readdir(spriteDir, { withFileTypes: true });
  const webpFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.webp'))
    .map((entry) => entry.name);

  if (webpFiles.length === 0) {
    console.log('No WebP files found in blueprint-view/sprites.');
    return;
  }

  console.log(`Found ${webpFiles.length} blueprint sprites. Generating masks...`);

  for (const fileName of webpFiles) {
    const spriteId = fileName.replace(/\.webp$/, '');
    const sourceFilePath = path.join(spriteDir, fileName);
    const maskOutputFilePath = path.join(maskDir, `${spriteId}.webp`);

    const { width, height } = await generateMaskOnly(sourceFilePath, maskOutputFilePath);
    console.log(`  ${spriteId}: ${width}x${height}`);
  }

  console.log('Blueprint masks generated.');
}

async function readRegistryAnimationDefinitions() {
  const { createRegistryContract } = await tsImport('../registry/index.ts', {
    parentURL: import.meta.url,
    tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
  });
  return createRegistryContract().entityDefinitions;
}

/** 直接消费 Registry 声明，生成链不维护独立的行列或帧时长清单。 */
export async function publishDeviceSpriteAnimations({
  definitions,
  spriteIds,
  sourceDirectory = defaultAnimationSourceDirectory,
  sourceAssetRoot,
  spriteDirectory = defaultSpriteDirectory,
  maskDirectory = defaultMaskDirectory,
  animationDirectory = defaultAnimationDirectory,
  maskOverrideDirectory = defaultMaskOverrideDirectory,
  maxTextureSize = animationProtocol.DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE,
  resolution,
} = {}) {
  return publishPaginatedDeviceSpriteAnimations({
    definitions,
    spriteIds,
    sourceDirectory,
    sourceAssetRoot,
    spriteDirectory,
    maskDirectory,
    animationDirectory,
    maskOverrideDirectory,
    maxTextureSize,
    resolution,
    animationProtocol,
    readRegistryAnimationDefinitions,
  });
}

async function main() {
  const isBlueprintMode = process.argv.includes('--blueprint');

  if (isBlueprintMode) {
    const [spriteDirectoryArgument, maskDirectoryArgument] = process.argv
      .slice(2)
      .filter((argument) => argument !== '--blueprint');
    await processBlueprintMasks(spriteDirectoryArgument, maskDirectoryArgument);
    return;
  }

  if (process.argv.includes('--animations')) {
    throw new Error('动画原件不再保存在仓库；请通过 import-building-assets 技能从网站下载并发布。');
  }

  throw new Error('旧静态素材导入入口已移除；网站导入请使用 import-building-assets 技能。本地仅支持 --blueprint。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Failed to sync device sprites.');
    console.error(error);
    process.exitCode = 1;
  });
}
