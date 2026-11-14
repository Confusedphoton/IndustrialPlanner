import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { publishLogisticsBaked } from '../publish-logistics-baked.mjs';
import { resolveBuildingAssetPublishTargets } from '../building-asset-publish-config.mjs';

const manifest = JSON.parse(await readFile('public/3d-top-view/logistics/baked/manifest.json', 'utf8'));
const sourceRootArgument = process.env.BUILDING_ASSET_SOURCE_ROOT;
if (!sourceRootArgument) {
  throw new Error('物流网站原件不再保存在仓库；请使用 import-building-assets，或显式设置 BUILDING_ASSET_SOURCE_ROOT 指向临时批次 site 目录。');
}
const sourceRoot = path.resolve(sourceRootArgument);
const outputRoot = path.resolve(process.argv[2] ? path.join(process.argv[2], '..') : 'public/3d-top-view');
for (const target of resolveBuildingAssetPublishTargets(outputRoot)) {
  await publishLogisticsBaked({ sourceDirectory: path.join(sourceRoot, 'buildings/logistics'),
    outputDirectory: path.join(target.outputDirectory, 'logistics'), spriteDirectory: path.join(target.outputDirectory, 'sprites'),
    maskDirectory: process.argv[3] ? path.resolve(process.argv[3], path.relative(outputRoot, target.outputDirectory))
      : path.join(target.outputDirectory, 'sprite-masks'),
    resolution: target.resolution, sourceSite: manifest.sourceSite });
}

