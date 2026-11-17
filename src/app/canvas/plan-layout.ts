import type { GridPoint, GridRect } from "@/domain/shared/grid";

/**
 * 把钉住的规划倒进圈出的空地：按原料到产物分成若干阶段，每个阶段一列（放不下就再起一列），
 * 列与列之间留出铺线的空隙。只摆设备，线由用户（或自动寻路）接上。
 */
export interface PlanMachine {
  readonly recipeId: string;
  readonly machineId: string;
  /** 还要放的台数。 */
  readonly count: number;
  readonly width: number;
  readonly height: number;
  readonly inputItemIds: readonly string[];
  readonly outputItemIds: readonly string[];
}

export interface PlannedMachinePlacement {
  readonly recipeId: string;
  readonly machineId: string;
  readonly position: GridPoint;
}

/** 同一阶段内相邻两台设备、两列之间的空隙。 */
const MACHINE_GAP = 1;
/** 阶段之间留给传送带的空隙。 */
const STAGE_GAP = 3;

/** 按依赖分层：只用外部原料的配方在第 0 层，其余排在给它供料的配方之后；环路按先到先排处理。 */
export function orderPlanStages(machines: readonly PlanMachine[]): PlanMachine[][] {
  const producers = new Map<string, PlanMachine[]>();
  for (const machine of machines) {
    for (const itemId of machine.outputItemIds) {
      producers.set(itemId, [...producers.get(itemId) ?? [], machine]);
    }
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (machine: PlanMachine): number => {
    const known = depth.get(machine.recipeId);
    if (known !== undefined) return known;
    if (visiting.has(machine.recipeId)) return 0;
    visiting.add(machine.recipeId);
    const feeders = machine.inputItemIds.flatMap((itemId) => producers.get(itemId) ?? [])
      .filter((feeder) => feeder.recipeId !== machine.recipeId);
    const value = feeders.length === 0 ? 0 : 1 + Math.max(...feeders.map(depthOf));
    visiting.delete(machine.recipeId);
    depth.set(machine.recipeId, value);
    return value;
  };
  const stages: PlanMachine[][] = [];
  for (const machine of machines) {
    if (machine.count <= 0) continue;
    const stage = depthOf(machine);
    (stages[stage] ??= []).push(machine);
  }
  return stages.filter((stage) => stage !== undefined && stage.length > 0);
}

/**
 * 在矩形里从左到右排各阶段：阶段内设备自上而下竖排，超出列高就另起一列；一行排不下的阶段换到下一行。
 * 依次试整个高度、一半、三分之一作列高，取第一种放得下的，整块居中。都放不下时 fits 为 false。
 */
export function layoutPlanInRect(stages: readonly (readonly PlanMachine[])[], rect: GridRect): {
  readonly placements: PlannedMachinePlacement[];
  readonly width: number;
  readonly height: number;
  readonly fits: boolean;
} {
  const candidates = [1, 2, 3].map((divisor) => layoutInBands(stages, rect.width, Math.floor(rect.height / divisor)));
  const chosen = candidates.find((layout) => layout.width <= rect.width && layout.height <= rect.height) ?? candidates[0]!;
  const offset = {
    x: rect.x + Math.floor((rect.width - chosen.width) / 2),
    y: rect.y + Math.floor((rect.height - chosen.height) / 2),
  };
  return {
    placements: chosen.placements.map((placement) => ({
      ...placement,
      position: { x: placement.position.x + offset.x, y: placement.position.y + offset.y },
    })),
    width: chosen.width,
    height: chosen.height,
    fits: chosen.width <= rect.width && chosen.height <= rect.height,
  };
}

/** 各阶段排成一块块（列高不超过 columnHeight），从左到右放，超出宽度换到下一行。坐标从 (0,0) 起。 */
function layoutInBands(stages: readonly (readonly PlanMachine[])[], maxWidth: number, columnHeight: number): {
  placements: PlannedMachinePlacement[];
  width: number;
  height: number;
} {
  const placements: PlannedMachinePlacement[] = [];
  let bandX = 0;
  let bandY = 0;
  let bandHeight = 0;
  let width = 0;
  for (const stage of stages) {
    const block = layoutStageBlock(stage, columnHeight);
    if (bandX > 0 && bandX + STAGE_GAP + block.width > maxWidth) {
      bandY += bandHeight + STAGE_GAP;
      bandX = 0;
      bandHeight = 0;
    }
    const x = bandX === 0 ? 0 : bandX + STAGE_GAP;
    for (const placement of block.placements) {
      placements.push({ ...placement, position: { x: x + placement.position.x, y: bandY + placement.position.y } });
    }
    bandX = x + block.width;
    bandHeight = Math.max(bandHeight, block.height);
    width = Math.max(width, bandX);
  }
  return { placements, width, height: bandY + bandHeight };
}

/** 一个阶段的设备：自上而下竖排，超出列高另起一列。 */
function layoutStageBlock(stage: readonly PlanMachine[], columnHeight: number): {
  placements: PlannedMachinePlacement[];
  width: number;
  height: number;
} {
  const placements: PlannedMachinePlacement[] = [];
  let x = 0;
  let y = 0;
  let columnWidth = 0;
  let height = 0;
  for (const machine of stage) {
    for (let copy = 0; copy < machine.count; copy += 1) {
      if (y > 0 && y + machine.height > columnHeight) {
        x += columnWidth + MACHINE_GAP;
        columnWidth = 0;
        y = 0;
      }
      placements.push({ recipeId: machine.recipeId, machineId: machine.machineId, position: { x, y } });
      columnWidth = Math.max(columnWidth, machine.width);
      y += machine.height + MACHINE_GAP;
      height = Math.max(height, y - MACHINE_GAP);
    }
  }
  return { placements, width: x + columnWidth, height };
}
