// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { normalizeDeviceSpriteAnimationDefinition } from "@/shared/device-sprite-animation";
// @ts-expect-error 发布配置为 Node mjs；测试直接核对实际配置。
import { BUILDING_ASSET_PUBLISH_RESOLUTIONS } from "../../scripts/building-asset-publish-config.mjs";

interface ImportedBuilding {
  entityId: string;
  spriteId: string;
  sourcePath: string;
  package: string;
  packageSha256: string;
  animated: boolean;
  projectFootprintRectCells?: { left: number; top: number; width: number; height: number };
  spriteOffset: { x: number; y: number; width: number; height: number };
  sourceMetadata: {
    sourceSite: { siteUrl: string; indexSha256: string; releaseId: string };
    spatial: {
      canvasCells: { width: number; height: number };
      footprintRectCells: { left: number; top: number; width: number; height: number };
      solidPorts?: {
        kind: "input" | "output";
        cellCenterPixels: { x: number; y: number };
      }[];
      verticalTransform: { operation: string };
    };
    publishedTransform: { operation: string };
  };
}

const collection = JSON.parse(await readFile(path.resolve("resources/building-top-view-v15.json"), "utf8")) as {
  sourceSite: { siteUrl: string; indexSha256: string; releaseId: string };
  sourceCoordinateTransform: unknown;
  entries: ImportedBuilding[];
};
const bodyAliases = JSON.parse(await readFile(path.resolve("public/3d-top-view/body-aliases.json"), "utf8")) as Record<string, string>;

describe("v1.5 建筑素材发布", () => {
  it("使用当前设备 ID 关联颜色资源与高度特效视图", async () => {
    const manifest = JSON.parse(await readFile(path.resolve("public/3d-top-view/port-effects/manifest.json"), "utf8"));
    expect(Object.keys(manifest.definitions).sort()).toEqual(collection.entries.map((entry) => entry.entityId).sort());
    for (const entry of collection.entries) {
      expect(manifest.definitions[entry.entityId]).toBe(entry.sourcePath);
      expect(manifest.views[entry.sourcePath]).toBeDefined();
    }
  });

  it.each([
    ["filling_pd_mc_1_liquid", "liquid__0", "filling_powder_mc_1/top-gasliquid", undefined],
    ["shaper_1_gas", "gas__0", "shaper_1/top-gas", [{
      role: "input",
      index: 3,
      position: [-1.5, 3, 0],
      yaw: 0,
      bindings: {
        on: "v1.5/fx/P_interactive_large_pipeon_in_01",
        off: "v1.5/fx/P_interactive_large_pipeoff_in_01",
        activateOn: null,
        activateOff: null,
      },
    }]],
  ] as const)("%s 只使用对应素材视图中明确交付的管道变体", async (entityId, variantKey, expectedViewKey, expectedPorts) => {
    const manifest = JSON.parse(await readFile(path.resolve("public/3d-top-view/port-effects/manifest.json"), "utf8"));
    const viewKey = manifest.definitions[entityId];
    const ports = manifest.views[viewKey]?.variants[variantKey];

    expect(viewKey).toBe(expectedViewKey);
    expect(ports).toEqual(expectedPorts);
  });

  it("启用液体灌装机现有动画资源", () => {
    expect(ENTITY_DEFINITIONS.find((definition) => definition.id === "filling_pd_mc_1_liquid")?.spriteAnimation)
      .toEqual({ closeIdleMode: "hold-last" });
  });

  it.each(collection.entries)("$entityId 的注册表、静态首帧、遮罩和分页尺寸一致", async (entry) => {
    const entity = ENTITY_DEFINITIONS.find((candidate) => candidate.id === entry.entityId);
    expect(entity?.spriteId).toBe(entry.spriteId);
    expect(entity?.spriteOffset?.topView ?? { x: 0, y: 0, ...entity?.footprint }).toEqual(entry.spriteOffset);
    const footprint = entry.projectFootprintRectCells ?? entry.sourceMetadata.spatial.footprintRectCells;
    expect(entry.spriteOffset).toEqual({
      x: footprint.left === 0
        ? 0
        : -footprint.left,
      y: footprint.top
        + footprint.height
        - entry.sourceMetadata.spatial.canvasCells.height,
      width: entry.sourceMetadata.spatial.canvasCells.width,
      height: entry.sourceMetadata.spatial.canvasCells.height,
    });
    const width = entry.spriteOffset.width * 128;
    const height = entry.spriteOffset.height * 128;
    const bodyId = bodyAliases[entry.spriteId] ?? entry.spriteId;
    for (const directory of ["sprites", "sprite-masks"]) {
      const image = await sharp(path.resolve(`public/3d-top-view/${directory}/${bodyId}.webp`)).metadata();
      expect([image.width, image.height]).toEqual([width * BUILDING_ASSET_PUBLISH_RESOLUTIONS[0], height * BUILDING_ASSET_PUBLISH_RESOLUTIONS[0]]);
    }
    if (!entry.animated) {
      expect(entity?.spriteAnimation).toBeUndefined();
      expect(entry.package).toMatch(/^buildings\/.+\/package\.json$/);
      expect(entry.packageSha256).toMatch(/^[0-9a-f]{64}$/);
      return;
    }
    const directory = path.resolve(`public/3d-top-view/animations/${entry.spriteId}`);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    expect(manifest.sharedAnimationId).toBe(bodyAliases[entry.spriteId]);
    expect(manifest.sourceSite.indexSha256).toBe(entry.sourceMetadata.sourceSite.indexSha256);
    const animation = normalizeDeviceSpriteAnimationDefinition(entity?.spriteAnimation, manifest);
    expect(animation.resolution).toBe(BUILDING_ASSET_PUBLISH_RESOLUTIONS[0]);
    expect([animation.frameWidth, animation.frameHeight]).toEqual([width, height]);
    const pageDirectory = bodyAliases[entry.spriteId]
      ? path.resolve(`public/3d-top-view/animations/${bodyId}`) : directory;
    for (const clip of Object.values(animation.clips)) {
      expect(clip.frameEndTimesMs).toHaveLength(clip.frameCount);
      expect(clip.frameEndTimesMs.at(-1)).toBe(clip.durationMs);
      for (const page of clip.pages) {
        const image = await sharp(path.join(pageDirectory, page.file)).metadata();
        expect([image.width, image.height]).toEqual([page.columns * width * animation.resolution, page.rows * height * animation.resolution]);
        expect(image.hasAlpha).toBe(true);
        expect(Math.max(image.width ?? 0, image.height ?? 0)).toBeLessThan(4096);
      }
    }
    const mask = await sharp(path.join(pageDirectory, animation.maskFile)).metadata();
    expect([mask.width, mask.height]).toEqual([width * animation.resolution, height * animation.resolution]);
  });

  it("注册完整且不重复的建筑素材集合", () => {
    const ids = collection.entries.map((entry) => entry.entityId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(collection.entries).toHaveLength(76);
    expect(collection.entries.filter((entry) => entry.animated)).toHaveLength(60);
    expect(ids).toEqual(expect.arrayContaining([
      "filling_pd_mc_1",
      "grinder_1",
      "liquid_cleaner_1",
      "liquid_purifier_1",
      "mix_pool_2",
      "thickener_1",
      "tools_asm_mc_1",
      "winder_1",
      "cmpt_mc_1",
      "mix_pool_1",
      "filling_pd_mc_1_liquid",
      "log_admission",
      "log_connector",
      "log_converger",
      "log_splitter",
      "pipe_admission",
      "pipe_connector",
      "pipe_converger",
      "pipe_splitter",
      "sp_sub_hub_1",
      "squirter_1",
      "int_system_farm_terminal",
    ]));
  });

  it("记录网站发布与索引 hash，并锁定 source→project 的逐帧坐标变换", () => {
    expect(collection.sourceSite.indexSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(collection.sourceCoordinateTransform).toEqual({
      imageAxes: { x: "+sourceX", y: "+sourceZ" },
      operation: "projectY = depth - 1 - sourceZ",
      rasterOperation: "flip-top-bottom per frame cell",
    });
    expect(collection.entries.some((entry) => entry.sourceMetadata.sourceSite.indexSha256
      === collection.sourceSite.indexSha256)).toBe(true);
    for (const entry of collection.entries) {
      const source = entry.sourceMetadata.sourceSite;
      expect(source.indexSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source.releaseId).toMatch(/^v[\w.-]+-cst$/);
      expect(source.siteUrl).toBe(collection.sourceSite.siteUrl);
      if (source.indexSha256 === collection.sourceSite.indexSha256) {
        expect(source.releaseId).toBe(collection.sourceSite.releaseId);
      }
      expect(entry.package).toBe(`buildings/${entry.sourcePath}/package.json`);
      expect(entry.packageSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.sourceMetadata.publishedTransform.operation)
        .toBe("flip-top-bottom per frame");
    }
  });

  it.each([
    "dismantler_1",
    "furnance_1",
    "furnance_1_liquid",
    "grinder_1",
    "liquid_purifier_1_gas",
    "transmuter_2_gastrans",
    "transmuter_2_solidtrans",
    "xiranite_oven_1",
  ])("$0 的 RAW 端口经发布坐标变换后与 Registry 物理坐标和角色一致", (entityId) => {
    const entry = collection.entries.find((candidate) => candidate.entityId === entityId);
    const entity = ENTITY_DEFINITIONS.find((candidate) => candidate.id === entityId);
    const ports = entry?.sourceMetadata.spatial.solidPorts ?? [];
    expect(ports.length).toBeGreaterThan(0);
    const expected = ports.map((port) => {
      const x = entry?.spriteOffset.x ?? 0;
      const y = entry?.spriteOffset.y ?? 0;
      return `${port.kind}:${x + port.cellCenterPixels.x / 128 - 0.5},${y + (entry?.spriteOffset.height ?? 0) - port.cellCenterPixels.y / 128 - 0.5}`;
    }).sort();
    const actual = (entity?.portGroups ?? []).filter((group) => !group.isPipe).flatMap((group) => group.ports.map((port) => (
      `${group.direction === "input" ? "input" : "output"}:${port.localCellX},${port.localCellY}`
    ))).sort();
    expect(actual).toEqual(expect.arrayContaining(expected));
  });
});
