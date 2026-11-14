import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import {
  type SlotLinkDefinition,
  WORLD_DOCUMENT_SCHEMA_VERSION,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import type {
  BlueprintSimulationReport,
  BlueprintSimulationTickReport,
} from "./blueprint-runner";

export type DeviceStatus = BlueprintSimulationTickReport["devices"][string];
export type DeviceSlotItem = DeviceStatus["slotItems"][number];

/**
 * 创建仓库物品 slot link（设备槽位 → 仓库物品槽位）。
 * 用于替代旧 config["links[N].*"] 方式。
 */
export function createWarehouseSlotLink(entityId: string, itemId: string, storageSlotGroupId = "unloader_buffer", slotId = "slot_1"): SlotLinkDefinition {
  return {
    id: `warehouse-link:${entityId}:${storageSlotGroupId}:${slotId}`,
    linkType: "share-all",
    source: { entityId, storageSlotGroupId, slotId },
    target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: itemId },
  };
}

export const BASE_ID = "wuling_protocol_core";
export const TIMESTAMP = new Date(0).toISOString();



export function createEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"] = 0,
  config: WorldEntity["config"] = {},
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation,
    config,
    tags: [],
  };
}

export function getTick(
  report: BlueprintSimulationReport,
  tickNumber: number,
): BlueprintSimulationTickReport {
  const tick = report.ticks.find((candidate) => candidate.tickNumber === tickNumber);
  if (tick === undefined) {
    throw new Error(`Expected tick ${tickNumber} to be captured.`);
  }
  return tick;
}

export function resolveFirstTickNumberAtSimulationMilliseconds(
  standardTickRate: number,
  elapsedMilliseconds: number,
): number {
  if (!Number.isSafeInteger(standardTickRate) || standardTickRate <= 0) {
    throw new Error(
      `Expected standardTickRate to be a positive safe integer, received: ${standardTickRate}.`,
    );
  }
  if (!Number.isSafeInteger(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw new Error(
      `Expected elapsedMilliseconds to be a non-negative safe integer, received: ${elapsedMilliseconds}.`,
    );
  }

  const scaledTickOffset = elapsedMilliseconds * standardTickRate;
  if (
    !Number.isSafeInteger(scaledTickOffset)
    || scaledTickOffset % 1_000 !== 0
  ) {
    throw new Error(
      `Simulation time ${elapsedMilliseconds}ms is not exactly representable at ${standardTickRate} TPS.`,
    );
  }

  return (scaledTickOffset / 1_000) + 1;
}

export function resolveSimulationMillisecondsAtFirstTick(
  standardTickRate: number,
  tickNumber: number,
): number {
  if (!Number.isSafeInteger(standardTickRate) || standardTickRate <= 0) {
    throw new Error(
      `Expected standardTickRate to be a positive safe integer, received: ${standardTickRate}.`,
    );
  }
  if (!Number.isSafeInteger(tickNumber) || tickNumber < 1) {
    throw new Error(`Expected tickNumber to be a positive safe integer, received: ${tickNumber}.`);
  }

  const scaledMilliseconds = (tickNumber - 1) * 1_000;
  if (
    !Number.isSafeInteger(scaledMilliseconds)
    || scaledMilliseconds % standardTickRate !== 0
  ) {
    throw new Error(
      `Simulation tick ${tickNumber} is not an exact first-tick millisecond phase at ${standardTickRate} TPS.`,
    );
  }

  return scaledMilliseconds / standardTickRate;
}

/**
 * 返回指定仿真毫秒相位下的第一个执行 tick。
 * tick 1 是 0ms 相位，因此 Legacy 20 TPS 下 500ms/1000ms 分别对应 tick 11/21。
 */
export function getFirstTickAtSimulationMilliseconds(
  report: BlueprintSimulationReport,
  elapsedMilliseconds: number,
): BlueprintSimulationTickReport {
  return getTick(
    report,
    resolveFirstTickNumberAtSimulationMilliseconds(
      report.topology.standardTickRate,
      elapsedMilliseconds,
    ),
  );
}

export function getLastTick(
  report: BlueprintSimulationReport,
): BlueprintSimulationTickReport {
  const tick = report.ticks.at(-1);
  if (tick === undefined) {
    throw new Error("Expected at least one captured simulation tick.");
  }
  return tick;
}

export function findFirstTick(
  report: BlueprintSimulationReport,
  predicate: (tick: BlueprintSimulationTickReport) => boolean,
): BlueprintSimulationTickReport {
  const tick = report.ticks.find(predicate);
  if (tick === undefined) {
    throw new Error("Expected a simulation tick matching the requested business state.");
  }
  return tick;
}

export function getDevice(
  report: BlueprintSimulationReport,
  tickNumber: number,
  deviceId: string,
): DeviceStatus {
  const device = getTick(report, tickNumber).devices[deviceId];
  if (device === undefined) {
    throw new Error(`Expected ${deviceId} to be projected at tick ${tickNumber}.`);
  }
  return device;
}

export function findSlot(
  report: BlueprintSimulationReport,
  tickNumber: number,
  deviceId: string,
  storageGroupId: string,
  slotId: string,
  viewRole?: DeviceSlotItem["viewRole"],
): DeviceSlotItem {
  const slot = getDevice(report, tickNumber, deviceId).slotItems.find((candidate) =>
    candidate.storageGroupId === storageGroupId
    && candidate.slotId === slotId
    && (viewRole === undefined || candidate.viewRole === viewRole),
  );
  if (slot === undefined) {
    throw new Error(`Expected ${deviceId}:${storageGroupId}:${slotId} at tick ${tickNumber}.`);
  }
  return slot;
}

export function findSlotWithItem(
  report: BlueprintSimulationReport,
  tickNumber: number,
  deviceId: string,
  itemType: string,
): DeviceSlotItem {
  const slot = getDevice(report, tickNumber, deviceId).slotItems.find((candidate) =>
    candidate.itemType === itemType && candidate.count > 0,
  );
  if (slot === undefined) {
    throw new Error(`Expected ${deviceId} to contain ${itemType} at tick ${tickNumber}.`);
  }
  return slot;
}

/**
 * 从 JSON 文件路径加载并校验 BlueprintDocument。
 * 内部使用 normalizeBlueprintDocument 进行运行时校验。
 */
export function loadBlueprintFromFile(filePath: string): BlueprintDocument {
  const absolutePath = resolve(filePath);
  let content: string;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    throw new Error(`Cannot read blueprint file: ${absolutePath}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Invalid JSON in blueprint file: ${absolutePath}`);
  }

  const blueprint = normalizeBlueprintDocument(payload);
  if (blueprint === null) {
    throw new Error(`Blueprint document validation failed: ${absolutePath}`);
  }

  return blueprint;
}

/** 将文件中的完整场景按保存顺序交给只接受实体数组的查询接口。 */
export function getBlueprintEntityArray(blueprint: BlueprintDocument): WorldEntity[] {
  return blueprint.entityOrder.map((id) => {
    const entity = blueprint.entities[id];
    if (entity === undefined) {
      throw new Error(`Missing entity ${id} in blueprint ${blueprint.blueprintId}.`);
    }
    return entity;
  });
}

/** 参数只选择已落盘的完整场景，不在运行时拼装或修改建筑。 */
export function loadBlueprintVariantFromFile(
  catalogPath: string,
  scene: string,
  parameters: Record<string, unknown>,
): BlueprintDocument {
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), "utf8")) as {
    formatVersion: number;
    fixtureRevision: number;
    scenes: Record<string, { parameters: Record<string, unknown>; file: string }[]>;
  };
  if (catalog.formatVersion !== 1 || !Number.isInteger(catalog.fixtureRevision)) {
    throw new Error(`Unsupported blueprint fixture catalog: ${catalogPath}`);
  }
  const serializedParameters: unknown = JSON.parse(JSON.stringify(parameters));
  const matches = (catalog.scenes[scene] ?? []).filter((entry) =>
    isDeepStrictEqual(entry.parameters, serializedParameters),
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one blueprint fixture: ${catalogPath} / ${scene} / ${JSON.stringify(parameters)}; found ${matches.length}.`);
  }
  return loadBlueprintFromFile(resolve(dirname(catalogPath), matches[0]!.file));
}

/**
 * 加载蓝图文件并注入额外设备，返回合并后的 BlueprintDocument。
 *
 * 用于测试场景：蓝图本身不完整（缺少供料/消耗设施），通过 extraEntities
 * 在测试中补全所需设备，而不修改原始蓝图文件。
 *
 * extraEntities 会生成 test-extra-{index} 格式的 ID，不会与蓝图中已有的
 * legacy_ 前缀实体冲突。
 */

// ===============================
// Blueprint → WorldDocument 转换
// ===============================

/**
 * 将 BlueprintDocument 转换为 WorldDocument，用于仿真测试。
 */
export function createWorldDocumentFromBlueprint(
	blueprint: BlueprintDocument,
): WorldDocument {
	return {
		schemaVersion: WORLD_DOCUMENT_SCHEMA_VERSION,
		documentKey: blueprint.blueprintId,
		baseId: blueprint.baseId,
		meta: {
			id: `blueprint-${blueprint.blueprintId}`,
			name: blueprint.name,
			createdAt: blueprint.createdAt,
			updatedAt: blueprint.updatedAt,
		},
		entities: cloneBlueprintEntities(blueprint.entities),
		entityOrder: [...blueprint.entityOrder],
		slotLinks: blueprint.slotLinks.map(cloneSlotLinkDefinition),
		regions: blueprint.regions.map((region) => ({
			...region,
			rects: region.rects.map((rect) => ({ ...rect })),
		})),
		documentSettings: {
			viewport: {
				center: {
					x: 0,
					y: 0,
				},
				gridSize: 1,
				displayRotation: 0,
			},
			powerMode: "infinite",
		},
	};
}

function cloneBlueprintEntities(
	entities: BlueprintDocument["entities"],
): Record<string, WorldEntity> {
	const nextEntities: Record<string, WorldEntity> = {};

	for (const [entityId, entity] of Object.entries(entities)) {
		nextEntities[entityId] = {
			...entity,
			position: {
				x: entity.position.x,
				y: entity.position.y,
			},
			config: { ...entity.config },
			tags: [...entity.tags],
		};
	}

	return nextEntities;
}

function cloneSlotLinkDefinition(slotLink: SlotLinkDefinition): SlotLinkDefinition {
	return {
		...slotLink,
		source: {
			...slotLink.source,
		},
		target: {
			...slotLink.target,
		},
	};
}
