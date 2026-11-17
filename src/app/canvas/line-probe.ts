import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import type { GridPoint } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";

/**
 * 线上读数：笔或鼠标悬停在一段传送带/管道上时，在指针旁显示这条线运的物品、上游产量、线的运力与下游用量，
 * 仿真运行时再加实测流量，并高亮整条线。手指改为点选单段线时显示。
 */
export interface LineProbeState {
  readonly kind: LogisticsKind;
  readonly cell: GridPoint;
  /** 悬停的指针位置；点选单段线时为 null，读数贴在该格旁。 */
  readonly pointer: ClientPixelPoint | null;
}
