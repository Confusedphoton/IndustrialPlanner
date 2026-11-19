import type { ClientPixelPoint, ClientPixelRect, GridPoint } from "./types/editor-view-types";

export interface EditorViewQuery {
  findGridCellForClientPixelPoint(point: ClientPixelPoint): GridPoint | null;
  findClientRectForGridCell(cell: GridPoint): ClientPixelRect | null;
  getZoomRange(): { readonly min: number; readonly max: number };
  hasPendingMotion(): boolean;
}
