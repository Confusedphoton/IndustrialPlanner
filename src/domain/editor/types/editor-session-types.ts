import type { WorldDocument, WorldEntity } from "../../document/world-document";
import type { CanvasOperationAvailability, CanvasOperationId } from "../../shared/canvas-operation";
import type { GridPoint, GridRotation } from "../../shared/grid";
import type { SceneSpace } from "../../shared/scene-space";
import type { EditorHistoryActionDescriptor } from "../editor-history";

export interface EditorSessionSnapshot<TIntent> {
  readonly document: WorldDocument;
  readonly intent: TIntent;
  readonly revision: number;
}

export interface EditorDocumentTransition {
  readonly before: WorldDocument;
  readonly after: WorldDocument;
  readonly action: EditorHistoryActionDescriptor;
}

export interface EditorSessionPolicy<TIntent> {
  getOperationAvailability(operation: CanvasOperationId): CanvasOperationAvailability;
  resolvePlacementAreaIds(entity: WorldEntity, space: SceneSpace): readonly string[];
  validateTransition(transition: EditorDocumentTransition, intent: TIntent): readonly string[];
}

export interface SinglePlacementRequest {
  readonly definitionId: string;
  readonly centerGridPoint: GridPoint;
  readonly entityId?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  /** 初始朝向；仅对方形占地设备生效（非方形设备的落点按 0° 占地计算）。 */
  readonly rotation?: GridRotation;
  /** 放下即把设备的仓库物品链接（如仓库取货口的取货物品）接到该物品，与放置同一步撤销。 */
  readonly warehouseItemId?: string;
}

/** 按确定位置与朝向放置的设备（例如沿存取线延伸出的一串基段）。 */
export interface PositionedPlacementRequest {
  readonly definitionId: string;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  /** 覆盖在设备默认配置之上的初始配置（例如配方）。 */
  readonly config?: Readonly<Record<string, unknown>>;
}

export type { CanvasOperationAvailability, CanvasOperationId } from "../../shared/canvas-operation";
