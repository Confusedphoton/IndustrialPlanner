import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createRegistryContract } from '@/registry';
import type { WorldEntity } from '@/domain/document/world-document';
import { resolveBaseBuiltinEntities } from '@/domain/registry/types/base-definition';
import { resolveSpriteGridRect } from '@/shared/geometry/grid';
import type { BuildingEffectsManifest, HeightField, SurfacePlacement } from '@/renderer/building-effects/types';
import { decodeHeight, fieldBounds, rasterizeHeightTile, HEIGHT_TILE_PIXELS, tileKeys } from '@/renderer/building-effects/height-field';
import {
  resolveBuildingEffectScene,
  resolveEffectFrame,
  syncStateHeightSurfaces,
  selectRingEffectPlacements,
} from '@/renderer/building-effects/placements';
import { resolveBuildingEffectStatusKey } from '@/renderer/building-effects/status';

const manifest = JSON.parse(await readFile('public/3d-top-view/port-effects/manifest.json', 'utf8')) as BuildingEffectsManifest;
const registry = createRegistryContract();
const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
const entity: WorldEntity = { id: 'device', definitionId: 'transmuter_1_gastrans',
  position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };


describe('建筑高度与端口特效', () => {
  it('自动农植机底座半格偏移修正后，5×5 颜色画布与高度范围在两处默认朝向一致', () => {
    const terminals = resolveBaseBuiltinEntities({ baseDefinitions: registry.baseDefinitions, baseId: 'wuling_agricultural_land' })
      .filter(item => item.definitionId === 'int_system_farm_terminal');
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: terminals });
    expect(scene.issues).toEqual([]);
    expect(scene.surfaces).toHaveLength(2);
    const alignedBounds = [
      { x: 4, y: 46.5, width: 5, height: 5 },
      { x: 140.5, y: 18, width: 5, height: 5 },
    ];
    for (const [index, terminal] of terminals.entries()) {
      const definition = definitions.get(terminal.definitionId)!;
      expect(definition.footprint).toEqual({ width: 3, height: 3 });
      for (const offset of Object.values(definition.spriteOffset!)) {
        const rect = resolveSpriteGridRect(terminal.position, definition.footprint, offset, terminal.rotation);
        expect(rect).toEqual(alignedBounds[index]);
        const bounds = fieldBounds(scene.surfaces[index]!);
        expect(bounds.left).toBeCloseTo(rect.x);
        expect(bounds.top).toBeCloseTo(rect.y);
        expect(bounds.right).toBeCloseTo(rect.x + rect.width);
        expect(bounds.bottom).toBeCloseTo(rect.y + rect.height);
      }
    }
  });
  it('阶段高度只绑定有状态外观的实体；相同外观不替换表面，成熟恢复默认高度', () => {
    const plot = { ...entity, id: 'plot', definitionId: 'soil_grass_1' };
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: [entity, plot] });
    const view = manifest.views['soil_grass_1/top']!;
    expect(scene.issues).toEqual([]);
    expect(scene.stateSurfaces).toHaveLength(1);
    const original = scene.surfaces[0];
    const read = (key: string | null) => (id: string) => { expect(id).toBe('plot'); return key; };
    expect(syncStateHeightSurfaces(scene, read('empty'))).toBe(true);
    expect(scene.surfaces[1]!.field).toBe(view.fields.empty);
    expect(scene.surfaces[0]).toBe(original);
    expect(syncStateHeightSurfaces(scene, read('seedling'))).toBe(true);
    const seedling = scene.surfaces[1];
    const irrigatedField = view.fields[view.stateMapping['state:irrigated']!];
    expect(syncStateHeightSurfaces(scene, read('irrigated'))).toBe(seedling!.field !== irrigatedField);
    expect(scene.surfaces[1]!.field).toBe(irrigatedField);
    const irrigated = scene.surfaces[1];
    expect(syncStateHeightSurfaces(scene, read('irrigated'))).toBe(false);
    expect(scene.surfaces[1]).toBe(irrigated);
    expect(syncStateHeightSurfaces(scene, read('mature-irrigated'))).toBe(true);
    expect(scene.surfaces[1]!.field).toBe(view.fields.mature);
    expect(syncStateHeightSurfaces(scene, read(null))).toBe(false);
    const stateless = resolveBuildingEffectScene({ manifest, definitions, entities: [entity] });
    expect(syncStateHeightSurfaces(stateless, () => { throw new Error('无状态机设备不应查询状态'); })).toBe(false);
  });
  it('按世界单位解码不同范围，空像素不遮挡；移除最高表面后恢复下层', () => {
    const field: HeightField = { file: 'fixture', width: 2, height: 1, min: -5, max: 5,
      pivot: [0, 0], center: [0, 0], pixelsPerCell: 128 };
    const data = new Map([['fixture', new Uint8Array([255, 255, 0, 255, 255, 255, 0, 0])]]);
    const surface: SurfacePlacement = { id: 'self', field, x: 0, y: 0, rotation: 0, baseY: -2 };
    const neighbor = { ...surface, id: 'neighbor', baseY: 1 };
    const composed = rasterizeHeightTile('0,0', [surface, neighbor], data, -10, 10);
    expect(decodeHeight(composed[0]!, composed[1]!, -10, 10)).toBeCloseTo(6, 3);
    expect(composed[7]).toBe(0);
    const removed = rasterizeHeightTile('0,0', [surface], data, -10, 10);
    expect(decodeHeight(removed[0]!, removed[1]!, -10, 10)).toBeCloseTo(3, 3);
    expect(rasterizeHeightTile('0,0', [], data, -10, 10).every((value) => value === 0)).toBe(true);
  });

  it('区域跨负坐标边界并保留旋转后的不对称高度与原点', () => {
    expect(tileKeys({ left: -1, top: -1, right: 1, bottom: 1 })).toEqual(['-1,-1', '0,-1', '-1,0', '0,0']);
    const field: HeightField = { file: 'fixture', width: 2, height: 1, min: 0, max: 1,
      pivot: [0, 0], center: [0, 0], pixelsPerCell: 128 };
    const surface = { id: 'rotated', field, x: 1, y: 1, rotation: 90, baseY: 0 };
    const data = new Map([['fixture', new Uint8Array([255, 255, 0, 255, 0, 0, 0, 0])]]);
    const bytes = rasterizeHeightTile('0,0', [surface], data, 0, 1);
    expect(bytes[(128 * HEIGHT_TILE_PIXELS + 127) * 4 + 3]).toBe(255);
    expect(bytes[(129 * HEIGHT_TILE_PIXELS + 127) * 4 + 3]).toBe(0);
    expect(fieldBounds(surface).left).toBeCloseTo(1 - 1 / 128);
  });

  it.each([
    ['transmuter_1_gastrans', 5, 7],
    ['transmuter_1_liquidtrans', 5, 7],
    ['shaper_1_gas', 1, 0],
  ] as const)('%s 按项目坐标契约匹配 Registry，不反转 Registry 或猜测环状态', (definitionId, portCount, ringCount) => {
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: [{ ...entity, definitionId }] });
    expect(scene.surfaces).toHaveLength(1);
    expect(scene.effects).toHaveLength(portCount);
    expect(scene.portKeys.size).toBe(portCount);
    expect(new Set(scene.portKeys.values()).size).toBe(portCount);
    expect(scene.ringEffects).toHaveLength(ringCount);
    expect(scene.issues).toHaveLength(0);
  });

  it.each([
    ['closed', 1],
    ['idle', 3],
    ['normal', 4],
    ['blocked', 5],
    ['no-power', 6],
    ['not-in-power-net', 7],
  ] as const)('将仿真状态 %s 映射到素材 statusKey %s', (status, statusKey) => {
    expect(resolveBuildingEffectStatusKey(status)).toBe(statusKey);
  });

  it('同一设备的多个环候选只查询一次状态并选择精确枚举', () => {
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: [entity] });
    let queryCount = 0;
    const rings = selectRingEffectPlacements(scene.ringEffects, () => {
      queryCount += 1;
      return 4;
    });

    expect(queryCount).toBe(1);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({
      entityId: entity.id,
      statusKey: 4,
      resourceId: 'v1.5/fx/P_fxfac_interactive_mixpool_green_2502',
    });
  });

  it.each([
    ['filling_pd_mc_1_liquid', 'fluid_input', 'in_e_2'],
    ['shaper_1_gas', 'gas_input', 'in_e_1'],
  ])('%s 缺少对应模式时不借用其他管道特效', (definitionId) => {
    const fixture = structuredClone(manifest);
    const view = fixture.views[fixture.definitions[definitionId]!]!;
    // 显式构造仅含其他模式的交付，避免负例随正式素材补齐而失效。
    view.variants = { unrelated__0: Object.values(view.variants)[0]! };
    const target: WorldEntity = { ...entity, id: definitionId, definitionId };
    const scene = resolveBuildingEffectScene({ manifest: fixture, definitions, entities: [target] });

    expect(scene.effects).toHaveLength(0);
    expect(scene.issues).toHaveLength(0);
    expect(scene.portKeys.size).toBe(0);
  });

  it('输入锚点发生明确偏移时拒绝该端口绑定', () => {
    const fixture = structuredClone(manifest);
    fixture.views['transmuter_1/top']!.variants['gastrans__0']![0]!.position[0] += 0.125;
    const scene = resolveBuildingEffectScene({ manifest: fixture, definitions, entities: [entity] });
    expect(scene.effects).toHaveLength(4);
    expect(scene.issues).toEqual(['transmuter_1_gastrans/gastrans__0/input:0: source anchor or direction conflicts with Registry']);
    expect(scene.portKeys.has('device:gastrans__0:input:0')).toBe(false);
  });

  it('验证单端口 ON/OFF、反向邻居、实体旋转和移除', () => {
    // Registry 的 transmuter 输出朝东；直管默认 W→E，因此位置相同且 rotation=0 时由输入 W 反向相连。
    const pipe: WorldEntity = { ...entity, id: 'pipe', definitionId: 'pipe_straight_1x1', position: { x: 5, y: 1 }, rotation: 0 };
    const render = (entities: WorldEntity[]) => resolveBuildingEffectScene({ manifest, definitions, entities });
    const disconnected = render([entity]);
    expect(disconnected.effects).toHaveLength(5);
    expect(disconnected.effects.every((effect) => effect.resourceId.includes('pipeoff'))).toBe(true);
    const connected = render([entity, pipe]);
    expect(connected.effects.filter((effect) => effect.resourceId.includes('pipeon'))).toHaveLength(1);
    expect(render([entity, { ...pipe, rotation: 180 }]).effects.every((effect) => effect.resourceId.includes('pipeoff'))).toBe(true);
    const rotated = render([{ ...entity, rotation: 90 }]);
    expect(rotated.effects[0]!.x).toBeCloseTo(1.5);
    expect(rotated.effects[0]!.y).toBeCloseTo(0);
    expect(rotated.effects[0]!.rotation).toBeCloseTo(90);
    expect(render([]).effects).toHaveLength(0);
  });

  it.each([
    ['udpipe_loader_1', [{ id: 'pipe-1', x: -1, y: 1 }]],
    ['udpipe_unloader_1', [{ id: 'pipe-1', x: 3, y: 1 }]],
    ['udpipe_loader_2', [{ id: 'pipe-1', x: -1, y: 1 }, { id: 'pipe-2', x: -1, y: 3 }]],
    ['udpipe_unloader_2', [{ id: 'pipe-1', x: 3, y: 3 }, { id: 'pipe-2', x: 3, y: 1 }]],
  ] as const)('%s 的每个端口按连接状态选择 on/off 并持续播放', (definitionId, pipePositions) => {
    const target: WorldEntity = { ...entity, id: 'dark-pipe', definitionId };
    const pipes = pipePositions.map(({ id, x, y }) => ({
      ...entity,
      id,
      definitionId: 'pipe_straight_1x1',
      position: { x, y },
      rotation: 0 as const,
    }));
    const connected = resolveBuildingEffectScene({ manifest, definitions, entities: [target, ...pipes] });
    const targetEffects = connected.effects.filter((effect) => effect.id.startsWith(`${target.id}:`));

    expect(connected.issues).toEqual([]);
    expect(targetEffects).toHaveLength(pipePositions.length);
    for (const effect of targetEffects) {
      expect(effect.resourceId).toContain('pipeon');
      const resource = manifest.effects[effect.resourceId]!;
      expect(resource.playback.mode).toBe('loop');
      expect(resolveEffectFrame(resource, 100)).toBeGreaterThan(resolveEffectFrame(resource, 0));
    }

    const disconnected = resolveBuildingEffectScene({ manifest, definitions, entities: [target] });
    expect(disconnected.effects).toHaveLength(pipePositions.length);
    for (const effect of disconnected.effects) {
      expect(effect.resourceId).toContain('pipeoff');
      const resource = manifest.effects[effect.resourceId]!;
      expect(resource.playback.mode).toBe('loop');
      expect(resolveEffectFrame(resource, 100)).toBeGreaterThan(resolveEffectFrame(resource, 0));
    }
  });

  it('按明确状态过滤环，重复绑定只绘制一次；模式切换保留对应变体', () => {
    const fixture = structuredClone(manifest);
    const isolatedView = fixture.views['transmuter_1/top']!;
    const ring = isolatedView.rings.find((candidate) => candidate.statusKey === 1)!;
    isolatedView.rings.push(structuredClone(ring));
    const scene = resolveBuildingEffectScene({ manifest: fixture, definitions, entities: [entity], ringStatus: new Map([[entity.id, 1]]) });
    expect(scene.ringEffects).toHaveLength(7);
    expect(scene.effects.filter((effect) => effect.ring)).toHaveLength(1);
    const changed = resolveBuildingEffectScene({ manifest: fixture, definitions,
      entities: [{ ...entity, definitionId: 'transmuter_1_liquidtrans' }], ringStatus: new Map([[entity.id, -1]]) });
    expect(changed.effects.filter((effect) => effect.ring)).toHaveLength(0);
    expect(changed.effects).toHaveLength(5);
    expect(changed.effects.every((effect) => effect.id.startsWith('device:liquidtrans__0:'))).toBe(true);
    expect(changed.issues).toHaveLength(0);
  });

  it('动画使用逐帧时长，独立于建筑动画帧号', () => {
    const resource = structuredClone(Object.values(manifest.effects)[0]!);
    resource.frames = [0, 1, 2].map((index) => ({ ...resource.frames[0]!, durationMs: [25, 75, 100][index]! }));
    resource.playback.mode = 'loop';
    resource.playback.staticFrame = 2;
    expect([0, 24, 25, 99, 100, 199, 200].map((time) => resolveEffectFrame(resource, time))).toEqual([0, 0, 1, 1, 2, 2, 0]);
  });


  it('所有已发布高度数值文件和特效颜色页完整且编码合法', async () => {
    const fields = new Map<string, { field: HeightField; reflected: boolean }>();
    for (const view of Object.values(manifest.views)) for (const field of Object.values(view.fields)) {
      fields.set(field.file, { field, reflected: view.coordinateSpace === 'project-reflected-source' });
    }
    for (const resource of Object.values(manifest.effects)) {
      fields.set(resource.height.file, { field: resource.height, reflected: resource.coordinateSpace === 'project-reflected-source' });
      for (const page of resource.pages) expect((await readFile(`public/3d-top-view/port-effects/${page.file}`)).length).toBeGreaterThan(0);
    }
    for (const { field } of fields.values()) {
      const productPath = `public/3d-top-view/port-effects/${field.file}`;
      const compressed = await readFile(productPath);
      const delivered = gunzipSync(compressed);
      expect(delivered.length, field.file).toBe(field.width * field.height * 4);
      let invalidBluePixels = 0;
      let invalidAlphaPixels = 0;
      for (let offset = 0; offset < delivered.length; offset += 4) {
        if (delivered[offset + 2] !== 0) invalidBluePixels += 1;
        if (delivered[offset + 3] !== 0 && delivered[offset + 3] !== 255) invalidAlphaPixels += 1;
      }
      expect(invalidBluePixels, field.file).toBe(0);
      expect(invalidAlphaPixels, field.file).toBe(0);
    }
  });

  it.each(Object.keys(manifest.effects))('发布特效 %s 的分页、帧边界和时长自洽', async (resourceId) => {
    const resource = manifest.effects[resourceId]!;
    for (const [pageIndex, page] of resource.pages.entries()) {
      const metadata = await sharp(`public/3d-top-view/port-effects/${page.file}`).metadata();
      expect(metadata).toMatchObject({ width: page.width, height: page.height, format: 'webp' });
      const pageFrames = resource.frames.filter((frame) => frame.page === pageIndex);
      for (const frame of pageFrames) {
        expect(frame.durationMs).toBeGreaterThan(0);
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.y).toBeGreaterThanOrEqual(0);
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
        expect(frame.x + frame.width).toBeLessThanOrEqual(page.width);
        expect(frame.y + frame.height).toBeLessThanOrEqual(page.height);
      }
    }
  });
});
