import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DIRECT_BLUEPRINT_SPRITE_IDS } from './blueprint-direct-sprite-mappings.mjs';

const CELL_SIZE = 128;
const DEVICE_BORDER_INSET_RATIO = 20 / 128;
const DEVICE_BORDER_INSET = CELL_SIZE * DEVICE_BORDER_INSET_RATIO;
const DEVICE_BORDER_STROKE_WIDTH = 4;
const BLUEPRINT_ASSET_TRIM_PX = 2;
// Temporary editing aids only. Future drawing steps will remove this background
// and grid, so generated artwork must not depend on either color or the grid.
// const DEVELOPMENT_BACKGROUND_COLOR = '#e9e9e9';
// const DEVELOPMENT_GRID_LINE_COLOR = '#c9c9c9';
const DEVICE_BORDER_COLOR = '#2a2a2a';
// Some devices are still empty-shell registry definitions and do not expose
// static port coordinates yet. Blueprint drawing uses local overrides until the
// registry migration is finished.
const FLUID_BLUEPRINT_PORT_LAYOUT_OVERRIDES = new Map([
  ['mix_pool_2', [
    { direction: 'output', localCellX: 0, localCellY: 1, edge: 'WEST' },
    { direction: 'output', localCellX: 0, localCellY: 3, edge: 'WEST' },
    { direction: 'input', localCellX: 5, localCellY: 1, edge: 'EAST' },
    { direction: 'input', localCellX: 5, localCellY: 3, edge: 'EAST' },
  ]],
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const defaultOutputDirectory = path.resolve(projectRoot, '.temp', 'device-blueprint-sprites');
const defaultBatchOutputDirectory = path.resolve(projectRoot, 'public', 'blueprint-view', 'sprites');
const blueprintAssetDirectory = path.resolve(projectRoot, '.temp', '素材库', '解包素材库', '设备蓝图资源');
const blueprintPortPartDirectory = path.resolve(projectRoot, 'resources', 'blueprint-port-parts');
const blueprintAssetExistenceCache = new Map();
const blueprintPortPartCache = new Map();
const PIPE_PORT_ASSET_TOKEN = 'fluid';
const SOLID_PORT_ASSET_TOKEN = 'item';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseCliOptions(args);
    if (options === null) {
      process.exitCode = 1;
      return;
    }


    if (options.mode === 'single') {
      const definition = await loadDeviceDefinition(options.deviceId);
      await writeDeviceBlueprintSprite(definition, options.outputFilePath);

      console.log(
        `Wrote ${path.relative(projectRoot, options.outputFilePath)} (${definition.footprint.width * CELL_SIZE}x${definition.footprint.height * CELL_SIZE})`,
      );
      return;
    }

    const registryContract = await loadRegistryContract();
    const batchResult = await generateBlueprintSprites(registryContract, options.outputDirectory);

    console.log(`Generated ${batchResult.generated.length} blueprint sprite(s) into ${path.relative(projectRoot, options.outputDirectory)}.`);

    if (batchResult.failed.length > 0) {
      console.log('Failed to generate:');
      for (const item of batchResult.failed) {
        console.log(`- ${item.id}: ${item.reason}`);
      }
    }

    if (batchResult.unresolved.length > 0) {
      console.log('Registry devices still missing static port definitions:');
      for (const item of batchResult.unresolved) {
        console.log(`- ${item}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function parseCliOptions(argv) {
  const [firstArgument, secondArgument] = argv;


  if (firstArgument === '--all') {
    return {
      mode: 'batch',
      outputDirectory: resolveOutputDirectory(secondArgument),
    };
  }

  if (typeof firstArgument === 'string' && firstArgument.length > 0) {
    return {
      mode: 'single',
      deviceId: firstArgument,
      outputFilePath: resolveOutputFilePath(firstArgument, secondArgument),
    };
  }

  console.error('Usage: npx tsx --tsconfig tsconfig.app.json src/scripts/draw-device-blueprint-sprite.mjs <device-id> [output-file]');
  console.error('   or: npx tsx --tsconfig tsconfig.app.json src/scripts/draw-device-blueprint-sprite.mjs --all [output-directory]');
  return null;
}


export async function createDeviceBlueprintSprite(definition) {
  const baseSvgMarkup = createDeviceBlueprintCanvasSvg(definition);
  const baseBuffer = await sharp(Buffer.from(baseSvgMarkup)).png().toBuffer();
  const borderOverlayBuffer = await sharp(Buffer.from(createDeviceBorderOverlaySvg(definition))).png().toBuffer();
  const solidPortLayers = await createPortCompositeLayers(definition, false);
  const liquidPortLayers = await createPortCompositeLayers(definition, true);

  return sharp(baseBuffer)
    .composite([
      ...solidPortLayers,
      ...liquidPortLayers,
      { input: borderOverlayBuffer, left: 0, top: 0 },
    ])
    .webp({ lossless: true, effort: 6 });
}

function resolveOutputFilePath(deviceId, outputFileArgument) {
  if (typeof outputFileArgument === 'string' && outputFileArgument.length > 0) {
    return path.resolve(outputFileArgument);
  }

  return path.join(defaultOutputDirectory, `${deviceId}.webp`);
}

function resolveOutputDirectory(outputDirectoryArgument) {
  if (typeof outputDirectoryArgument === 'string' && outputDirectoryArgument.length > 0) {
    return path.resolve(outputDirectoryArgument);
  }

  return defaultBatchOutputDirectory;
}

async function loadDeviceDefinition(deviceId) {
  const registryContract = await loadRegistryContract();
  const definition = registryContract.entityDefinitions.find((item) => item.id === deviceId) ?? null;

  if (definition === null) {
    throw new Error(`Unknown device id: ${deviceId}`);
  }

  return definition;
}

async function loadRegistryContract() {
  try {
    const registryModule = await import('../registry/index.ts');
    return registryModule.createRegistryContract();
  } catch (error) {
    throw new Error(
      'Failed to load the TypeScript registry. Run this script through "npx tsx --tsconfig tsconfig.app.json src/scripts/draw-device-blueprint-sprite.mjs <device-id>".',
      { cause: error },
    );
  }
}

async function writeDeviceBlueprintSprite(definition, outputFilePath) {
  const spriteImage = await createDeviceBlueprintSprite(definition);

  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await spriteImage.toFile(outputFilePath);
}

async function generateBlueprintSprites(registryContract, outputDirectory) {
  const generated = [];
  const failed = [];
  const candidates = collectBlueprintGenerationCandidates(registryContract);

  for (const definition of candidates) {
    const outputFilePath = path.join(outputDirectory, `${definition.spriteId}.webp`);

    try {
      await writeDeviceBlueprintSprite(definition, outputFilePath);
      generated.push(definition.id);
    } catch (error) {
      failed.push({
        id: definition.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    generated,
    failed,
    unresolved: collectUnresolvedPortDevices(registryContract),
  };
}

export function collectBlueprintGenerationCandidates(registryContract) {
  return registryContract.entityDefinitions.filter((definition) => (
    !isExcludedFromBlueprintBatch(definition, registryContract.queries)
    && definition.portGroups.some((group) => group.ports.length > 0)
  ));
}

function collectUnresolvedPortDevices(registryContract) {
  const recipeMachineIds = new Set(
    registryContract.recipeDefinitions
      .map((definition) => definition.machineId)
      .filter((machineId) => typeof machineId === 'string' && machineId.length > 0),
  );

  return registryContract.entityDefinitions
    .filter((definition) => (
      !isExcludedFromBlueprintBatch(definition, registryContract.queries)
      && definition.portGroups.length === 0
      && recipeMachineIds.has(definition.id)
    ))
    .map((definition) => definition.id);
}

function isExcludedFromBlueprintBatch(definition, queries) {
  if (DIRECT_BLUEPRINT_SPRITE_IDS.has(definition.spriteId)) {
    return true;
  }


  // 传送带族和管道设备族统一由 RegistryQuery 判定；
  // 其中传送带物流设备不包括传送带节，管道物流设备不包括管道节。
  if (queries.isBeltFamily(definition.id) || queries.isPipeFamily(definition.id)) {
    return true;
  }

  return false;
}

async function loadBlueprintAsset(fileName, rotationDegrees = 0) {
  const assetFilePath = path.join(blueprintAssetDirectory, fileName);
  const metadata = await sharp(assetFilePath).metadata();

  if (typeof metadata.width !== 'number' || typeof metadata.height !== 'number') {
    throw new Error(`Failed to read blueprint asset metadata: ${fileName}`);
  }

  const normalizedRotation = ((rotationDegrees % 360) + 360) % 360;
  const rotatedWidth = normalizedRotation === 90 || normalizedRotation === 270 ? metadata.height : metadata.width;
  const rotatedHeight = normalizedRotation === 90 || normalizedRotation === 270 ? metadata.width : metadata.height;
  const trimmedWidth = rotatedWidth - BLUEPRINT_ASSET_TRIM_PX * 2;
  const trimmedHeight = rotatedHeight - BLUEPRINT_ASSET_TRIM_PX * 2;

  if (trimmedWidth <= 0 || trimmedHeight <= 0) {
    throw new Error(`Blueprint asset is too small to trim: ${fileName}`);
  }

  const pipeline = sharp(assetFilePath);

  if (normalizedRotation !== 0) {
    pipeline.rotate(normalizedRotation, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  const { data, info } = await pipeline
    .extract({
      left: BLUEPRINT_ASSET_TRIM_PX,
      top: BLUEPRINT_ASSET_TRIM_PX,
      width: trimmedWidth,
      height: trimmedHeight,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function loadPngAssetWithoutTrim(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function trimBlueprintAsset(asset, trimPx = BLUEPRINT_ASSET_TRIM_PX) {
  const trimmedWidth = asset.width - trimPx * 2;
  const trimmedHeight = asset.height - trimPx * 2;

  if (trimmedWidth <= 0 || trimmedHeight <= 0) {
    throw new Error('Blueprint asset is too small to trim.');
  }

  const { data, info } = await sharp(asset.input)
    .extract({
      left: trimPx,
      top: trimPx,
      width: trimmedWidth,
      height: trimmedHeight,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}


async function composeBlueprintAsset(width, height, layers) {
  const { data, info } = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function loadBlueprintPortPart(isPipe, direction, part) {
  const assetToken = isPipe ? PIPE_PORT_ASSET_TOKEN : SOLID_PORT_ASSET_TOKEN;
  const cacheKey = `${assetToken}:${direction}:${part}`;
  const cached = blueprintPortPartCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const fileName = `${assetToken}-${direction}-${part}.png`;
  const partPromise = loadPngAssetWithoutTrim(path.join(blueprintPortPartDirectory, fileName));
  blueprintPortPartCache.set(cacheKey, partPromise);
  return partPromise;
}

async function composePortBandAsset(isPipe, direction, edgeSpan, portIndices, options = {}) {
  if (edgeSpan <= 0) {
    throw new Error(`Unsupported port band span: ${edgeSpan}`);
  }

  const partByCellKind = new Map([
    ['left', await loadBlueprintPortPart(isPipe, direction, 'left')],
    ['blank', await loadBlueprintPortPart(isPipe, direction, 'blank')],
    ['port', await loadBlueprintPortPart(isPipe, direction, 'port')],
    ['right', await loadBlueprintPortPart(isPipe, direction, 'right')],
  ]);
  const firstPart = partByCellKind.get('left');
  if (firstPart === undefined) {
    throw new Error(`Missing blueprint port part: ${isPipe ? "pipe" : "solid"}:${direction}:left`);
  }

  const portIndexSet = new Set(portIndices);
  const layers = [];
  for (let cellIndex = 0; cellIndex < edgeSpan; cellIndex += 1) {
    if (
      options.omitBlankEndCells === true
      && !portIndexSet.has(cellIndex)
      && (cellIndex === 0 || cellIndex === edgeSpan - 1)
    ) {
      continue;
    }

    const partKind = portIndexSet.has(cellIndex)
      ? 'port'
      : options.useEndCaps !== false && cellIndex === 0
        ? 'left'
        : options.useEndCaps !== false && cellIndex === edgeSpan - 1
          ? 'right'
          : 'blank';
    const part = partByCellKind.get(partKind);

    if (part === undefined) {
      throw new Error(`Missing blueprint port part: ${isPipe ? "pipe" : "solid"}:${direction}:${partKind}`);
    }

    layers.push({
      input: part.input,
      left: cellIndex * CELL_SIZE,
      top: 0,
    });
  }

  const composedAsset = await composeBlueprintAsset(
    edgeSpan * CELL_SIZE,
    firstPart.height,
    layers,
  );

  return trimBlueprintAsset(composedAsset);
}

async function rotateBlueprintAsset(asset, rotationDegrees) {
  const normalizedRotation = ((rotationDegrees % 360) + 360) % 360;
  if (normalizedRotation === 0) {
    return asset;
  }

  const { data, info } = await sharp(asset.input)
    .rotate(normalizedRotation, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function flipBlueprintAssetVertically(asset) {
  const { data, info } = await sharp(asset.input)
    .flip()
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function loadBlueprintAssetForEdge(fileName, edge) {
  if (edge === 'SOUTH') {
    return flipBlueprintAssetVertically(await loadBlueprintAsset(fileName));
  }

  return loadBlueprintAsset(fileName, resolveEdgeRotationDegrees(edge));
}

async function orientBlueprintAssetForEdge(asset, edge) {
  if (edge === 'SOUTH') {
    return flipBlueprintAssetVertically(asset);
  }

  return rotateBlueprintAsset(asset, resolveEdgeRotationDegrees(edge));
}

async function maybeCreateSpecialPortCompositeLayer(definition, isPipe, portEdge) {
  if (definition.id !== 'sp_hub_1' || isPipe) {
    return null;
  }

  let asset = null;
  if (
    portEdge.direction === 'input'
    && portEdge.portCount === 7
    && portEdge.edgeSpan === 9
    && (portEdge.edge === 'NORTH' || portEdge.edge === 'SOUTH')
  ) {
    asset = await createSpHubInputCompositeAsset(portEdge.edge);
  }

  if (
    portEdge.direction === 'output'
    && portEdge.portCount === 3
    && portEdge.edgeSpan === 9
    && (portEdge.edge === 'WEST' || portEdge.edge === 'EAST')
  ) {
    asset = await createSpHubOutputCompositeAsset(portEdge.edge);
  }

  if (asset === null) {
    return null;
  }

  const position = resolveEdgeAssetPosition(definition.footprint, portEdge.edge, asset);

  return {
    input: asset.input,
    left: position.left,
    top: position.top,
  };
}

async function createSpHubInputCompositeAsset(edge) {
  const composedAsset = await composePortBandAsset(false, 'input', 9, [1, 2, 3, 4, 5, 6, 7]);

  return orientBlueprintAssetForEdge(composedAsset, edge);
}

async function createSpHubOutputCompositeAsset(edge) {
  const composedAsset = await composePortBandAsset(false, 'output', 9, [1, 4, 7], {
    useEndCaps: false,
    omitBlankEndCells: true,
  });

  return rotateBlueprintAsset(composedAsset, resolveEdgeRotationDegrees(edge));
}

async function createPortCompositeLayers(definition, isPipe) {
  const portEdges = collectPortEdges(definition, isPipe);

  const edgeLayers = await Promise.all(portEdges.map(async (portEdge) => {
    const specialCompositeLayer = await maybeCreateSpecialPortCompositeLayer(definition, isPipe, portEdge);
    if (specialCompositeLayer !== null) {
      return [specialCompositeLayer];
    }

    const assetSource = await resolvePortAssetSource(definition, isPipe, portEdge);
    const asset = assetSource.asset === undefined
      ? await loadBlueprintAssetForEdge(assetSource.fileName, portEdge.edge)
      : await orientBlueprintAssetForEdge(assetSource.asset, portEdge.edge);
    const position = resolveEdgeAssetPosition(
      definition.footprint,
      portEdge.edge,
      asset,
      assetSource.segmentStart,
      assetSource.segmentSpan,
    );

    return {
      input: asset.input,
      left: position.left,
      top: position.top,
    };
  }));

  return edgeLayers.flat();
}

function collectPortEdges(definition, isPipe) {
  const groups = new Map();

  for (const port of resolveBlueprintPorts(definition, isPipe)) {
    const key = `${port.direction}:${port.edge}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        direction: port.direction,
        edge: port.edge,
        portCount: 1,
        edgeSpan: resolveEdgeSpan(definition.footprint, port.edge),
        boundaryIndices: [resolveBoundaryCellIndexForSide(definition.footprint, port.edge, port)],
      });
      continue;
    }

    existing.portCount += 1;
    existing.boundaryIndices.push(resolveBoundaryCellIndexForSide(definition.footprint, port.edge, port));
  }

  return [...groups.values()].map((group) => ({
    ...group,
    boundaryIndices: [...new Set(group.boundaryIndices)].sort((left, right) => left - right),
  }));
}

function resolveBlueprintPorts(definition, isPipe) {
  const registryPorts = definition.portGroups.flatMap((group) => {
    if (group.isPipe !== isPipe) {
      return [];
    }

    return group.ports.map((port) => ({
      direction: normalizePortDirection(group.direction),
      localCellX: port.localCellX,
      localCellY: port.localCellY,
      edge: normalizePortEdge(port.edge),
    }));
  });
  if (registryPorts.length > 0) {
    return registryPorts;
  }

  const overridePorts = isPipe
    ? (FLUID_BLUEPRINT_PORT_LAYOUT_OVERRIDES.get(definition.id) ?? []).map((port) => ({
      direction: normalizePortDirection(port.direction),
      localCellX: port.localCellX,
      localCellY: port.localCellY,
      edge: normalizePortEdge(port.edge),
    }))
    : [];

  return [...registryPorts, ...overridePorts];
}

function normalizePortDirection(direction) {
  switch (direction) {
    case 'input':
    case 'output':
      return direction;
    default:
      throw new Error(`Unsupported port direction: ${direction}`);
  }
}

function normalizePortEdge(edge) {
  switch (edge) {
    case 'N':
    case 'NORTH':
      return 'NORTH';
    case 'E':
    case 'EAST':
      return 'EAST';
    case 'S':
    case 'SOUTH':
      return 'SOUTH';
    case 'W':
    case 'WEST':
      return 'WEST';
    default:
      throw new Error(`Unsupported port edge: ${edge}`);
  }
}

function resolveEdgeSpan(footprint, edge) {
  switch (edge) {
    case 'NORTH':
    case 'SOUTH':
      return footprint.width;
    case 'EAST':
    case 'WEST':
      return footprint.height;
    default:
      throw new Error(`Unsupported edge span lookup: ${edge}`);
  }
}

async function resolvePortAssetSource(definition, isPipe, portEdge) {
  const directFileName = resolvePortAssetFileName(isPipe, portEdge);

  if (await hasBlueprintAsset(directFileName)) {
    return {
      fileName: directFileName,
      segmentStart: 0,
      segmentSpan: portEdge.edgeSpan,
    };
  }

  const fallbackSegment = resolveFallbackPortSegment(definition, isPipe, portEdge);
  if (fallbackSegment !== null) {
    const fallbackFileName = await resolveFallbackPortAssetFileName(isPipe, portEdge, fallbackSegment.segmentSpan);

    if (fallbackFileName !== null) {
      return {
        fileName: fallbackFileName,
        segmentStart: fallbackSegment.segmentStart,
        segmentSpan: fallbackSegment.segmentSpan,
      };
    }

    return {
      asset: await composePortBandAsset(
        isPipe,
        portEdge.direction,
        fallbackSegment.segmentSpan,
        // 合成前须将注册表的自上而下索引映射回源图索引，避免非对称端口上下错位。
        portEdge.boundaryIndices.map((index) => portEdge.edge === 'WEST'
          ? fallbackSegment.segmentStart + fallbackSegment.segmentSpan - 1 - index
          : index - fallbackSegment.segmentStart),
      ),
      segmentStart: fallbackSegment.segmentStart,
      segmentSpan: fallbackSegment.segmentSpan,
    };
  }

  throw new Error(`Input file is missing: ${path.join(blueprintAssetDirectory, directFileName)}`);
}

function resolvePortAssetFileName(isPipe, portEdge) {
  return resolvePortAssetFileNameByValues(isPipe, portEdge.direction, portEdge.edgeSpan, portEdge.portCount);
}

function resolvePortAssetFileNameByValues(isPipe, direction, edgeSpan, portCount) {
  const directionToken = direction === 'input' ? 'in' : 'out';
  const variantToken = portCount === edgeSpan
    ? `${edgeSpan}`
    : `${edgeSpan}_${portCount}`;
  const prefix = isPipe ? 'pipe_port' : 'port';

  return `${prefix}_${directionToken}_${variantToken}.png`;
}

function resolveCollapsedSinglePortAssetFileName(isPipe, direction, edgeSpan) {
  const directionToken = direction === 'input' ? 'in' : 'out';
  const prefix = isPipe ? 'pipe_port' : 'port';

  return `${prefix}_${directionToken}_${edgeSpan}.png`;
}

async function resolveFallbackPortAssetFileName(isPipe, portEdge, segmentSpan) {
  const candidateFileNames = [
    resolvePortAssetFileNameByValues(isPipe, portEdge.direction, segmentSpan, portEdge.portCount),
  ];

  if (portEdge.portCount === 1 && segmentSpan === 1) {
    candidateFileNames.push(resolveCollapsedSinglePortAssetFileName(isPipe, portEdge.direction, segmentSpan));
  }

  for (const fileName of candidateFileNames) {
    if (await hasBlueprintAsset(fileName)) {
      return fileName;
    }
  }

  return null;
}

function resolveFallbackPortSegment(definition, isPipe, portEdge) {
  if (portEdge.boundaryIndices.length === 0) {
    return null;
  }

  const boundaryOccupancy = resolveBoundaryOccupancy(definition, isPipe, portEdge.edge);
  const minIndex = portEdge.boundaryIndices[0];
  const maxIndex = portEdge.boundaryIndices[portEdge.boundaryIndices.length - 1];
  let segmentStart = minIndex;
  let segmentEnd = maxIndex;

  while (segmentStart > 0 && boundaryOccupancy[segmentStart - 1] !== 'other') {
    segmentStart -= 1;
  }

  while (segmentEnd < portEdge.edgeSpan - 1 && boundaryOccupancy[segmentEnd + 1] !== 'other') {
    segmentEnd += 1;
  }

  for (let index = segmentStart; index <= segmentEnd; index += 1) {
    if (boundaryOccupancy[index] === 'other') {
      return null;
    }
  }

  return {
    segmentStart,
    segmentSpan: segmentEnd - segmentStart + 1,
  };
}

function resolveBoundaryOccupancy(definition, isPipe, edge) {
  const boundarySpan = resolveEdgeSpan(definition.footprint, edge);
  const occupancy = Array.from({ length: boundarySpan }, () => 'empty');

  for (const portGroup of definition.portGroups) {
    for (const port of portGroup.ports) {
      const normalizedPort = {
        localCellX: port.localCellX,
        localCellY: port.localCellY,
      };

      if (!doesPortOccupyBoundarySide(definition.footprint, edge, normalizedPort)) {
        continue;
      }

      const boundaryIndex = resolveBoundaryCellIndexForSide(definition.footprint, edge, normalizedPort);
      const nextState = portGroup.isPipe === isPipe ? 'same' : 'other';

      if (nextState === 'other' || occupancy[boundaryIndex] === 'empty') {
        occupancy[boundaryIndex] = nextState;
      }
    }
  }

  return occupancy;
}

function resolveEdgeRotationDegrees(edge) {
  switch (edge) {
    case 'NORTH':
      return 0;
    case 'EAST':
      return 90;
    case 'SOUTH':
      return 180;
    case 'WEST':
      return 270;
    default:
      throw new Error(`Unsupported edge rotation: ${edge}`);
  }
}

function doesPortOccupyBoundarySide(footprint, edge, port) {
  switch (edge) {
    case 'NORTH':
      return port.localCellY === 0;
    case 'EAST':
      return port.localCellX === footprint.width - 1;
    case 'SOUTH':
      return port.localCellY === footprint.height - 1;
    case 'WEST':
      return port.localCellX === 0;
    default:
      throw new Error(`Unsupported boundary occupancy lookup: ${edge}`);
  }
}

function resolveBoundaryCellIndexForSide(footprint, edge, port) {
  switch (edge) {
    case 'NORTH':
    case 'SOUTH':
      return port.localCellX;
    case 'EAST':
    case 'WEST':
      return port.localCellY;
    default:
      throw new Error(`Unsupported boundary cell index lookup: ${edge}`);
  }
}

async function hasBlueprintAsset(fileName) {
  const cached = blueprintAssetExistenceCache.get(fileName);
  if (cached !== undefined) {
    return cached;
  }

  const assetExistsPromise = access(path.join(blueprintAssetDirectory, fileName))
    .then(() => true)
    .catch(() => false);

  blueprintAssetExistenceCache.set(fileName, assetExistsPromise);
  return assetExistsPromise;
}

function resolveEdgeAssetPosition(footprint, edge, asset, segmentStart = 0, segmentSpan = resolveEdgeSpan(footprint, edge)) {
  const spriteWidth = footprint.width * CELL_SIZE;
  const spriteHeight = footprint.height * CELL_SIZE;
  const segmentSize = segmentSpan * CELL_SIZE;

  switch (edge) {
    case 'NORTH':
      return {
        left: segmentStart * CELL_SIZE + Math.round((segmentSize - asset.width) / 2),
        top: 0,
      };
    case 'EAST':
      return {
        left: spriteWidth - asset.width,
        top: segmentStart * CELL_SIZE + Math.round((segmentSize - asset.height) / 2),
      };
    case 'SOUTH':
      return {
        left: segmentStart * CELL_SIZE + Math.round((segmentSize - asset.width) / 2),
        top: spriteHeight - asset.height,
      };
    case 'WEST':
      return {
        left: 0,
        top: segmentStart * CELL_SIZE + Math.round((segmentSize - asset.height) / 2),
      };
    default:
      throw new Error(`Unsupported edge placement: ${edge}`);
  }
}

function createDeviceBlueprintCanvasSvg(definition) {
  const width = definition.footprint.width * CELL_SIZE;
  const height = definition.footprint.height * CELL_SIZE;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    // '  <defs>',
    // '    <style>',
    // `      .canvas-background { fill: ${DEVELOPMENT_BACKGROUND_COLOR}; }`,
    // `      .cell-guide { fill: none; stroke: ${DEVELOPMENT_GRID_LINE_COLOR}; stroke-width: 1; shape-rendering: crispEdges; }`,
    // `      .device-border { fill: none; stroke: ${DEVICE_BORDER_COLOR}; stroke-width: ${DEVICE_BORDER_STROKE_WIDTH}; }`,
    // '    </style>',
    // '  </defs>',
    // '  <!-- Temporary editing aids only: do not depend on this background or grid. -->',
    // `  <rect class="canvas-background" x="0" y="0" width="${width}" height="${height}" />`,
    // ...createCellGuideMarkup(definition.footprint),
    '</svg>',
  ].join('\n');
}

function createDeviceBorderOverlaySvg(definition) {
  const width = definition.footprint.width * CELL_SIZE;
  const height = definition.footprint.height * CELL_SIZE;
  const borderMarkup = createDeviceBorderMarkup(width, height);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    '  <defs>',
    '    <style>',
    `      .device-border { fill: none; stroke: ${DEVICE_BORDER_COLOR}; stroke-width: ${DEVICE_BORDER_STROKE_WIDTH}; }`,
    '    </style>',
    '  </defs>',
    '  <g id="device-blueprint-border">',
    borderMarkup,
    '  </g>',
    '</svg>',
  ].join('\n');
}

function createDeviceBorderMarkup(width, height) {
  const borderWidth = width - DEVICE_BORDER_INSET * 2;
  const borderHeight = height - DEVICE_BORDER_INSET * 2;

  return `    <rect class="device-border" x="${DEVICE_BORDER_INSET}" y="${DEVICE_BORDER_INSET}" width="${borderWidth}" height="${borderHeight}" />`;
}

function createCellGuideMarkup(footprint) {
  const guides = [];

  for (let cellY = 0; cellY < footprint.height; cellY += 1) {
    for (let cellX = 0; cellX < footprint.width; cellX += 1) {
      guides.push(
        `  <rect class="cell-guide" x="${cellX * CELL_SIZE}" y="${cellY * CELL_SIZE}" width="${CELL_SIZE}" height="${CELL_SIZE}" />`,
      );
    }
  }

  return guides;
}
