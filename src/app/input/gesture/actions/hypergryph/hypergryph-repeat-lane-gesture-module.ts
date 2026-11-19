import { createSelectionBlueprintDocument } from "@/app/blueprint/save-blueprint";
import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { countPlacedMachines } from "@/app/shell/panels/placement-todo-list";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { GestureMappingModule } from "../types";
import { resolvePinnedPlanPlacementEntries } from "./plan-lasso";

const MAX_PREVIEW_ENTITIES = 1200;
const MAX_COPIES = 40;

interface LaneDrag {
  readonly id: string;
  readonly canvas: CanvasInteractionController;
  readonly editor: EditorContract;
  readonly document: WorldDocument;
  readonly lane: BlueprintDocument;
  readonly bounds: GridRect;
  readonly start: GridPoint;
  readonly copies: number;
  pitch: GridPoint | null;
  firstPreviewId: string | null;
}

export function createHypergryphRepeatLaneGestureModule(): GestureMappingModule<AppHost> {
  let drag: LaneDrag | null = null;

  function clear() {
    const previous = drag;
    drag = null;
    if (previous === null) return;
    previous.canvas.edgePan.stop("pointer");
    discardPreview(previous);
  }

  return {
    id: "hypergryph-repeat-lane",
    // Claim drags from the selected lane before the marquee starts a new box.
    priority: 145,
    cancel: clear,
    handle(event, { canvas, appHost }) {
      switch (event.type) {
        case "on-exit-active-tool":
          if (drag?.canvas === canvas) clear();
          return { status: "ignored" };
        case "mouse dragstart":
        case "touch dragstart": {
          const editor = canvas.editor;
          if (
            drag !== null || editor === null
            || canvas.state.activeTool !== "marquee"
            || canvas.state.toolInfo.marqueeType === EntityCollectionType.reverseMarquee
            || (event.type === "mouse dragstart" ? event.originButton !== 0 : event.activeTouchCount !== 1)
            || event.longPress
            || editor.state.collections.selection.length < 2
            || editor.state.collections.preview.length > 0
            || !canvas.isOperationEnabled("copy")
            || !canvas.isOperationEnabled("blueprint-placement")
            || !canvas.isOperationEnabled("confirm-placement")
          ) return { status: "ignored" };

          const source = editor.queries.findEntityAtClientPixelPoint(event.startPosition, canvas.view.state);
          if (source === null || !editor.state.collections.selection.includes(source.id)
            || canvas.registry.queries.isGeneralLogisticsDevice(source.definitionId)) {
            return { status: "ignored" };
          }

          const start = canvas.view.queries.findGridCellForClientPixelPoint(event.startPosition);
          const bounds = editor.queries.findEntityCollectionGridRect(EntityCollectionType.selection);
          const lane = createSelectionBlueprintDocument({ editor, name: appHost.actions.translate("repeatLane.name") });
          if (start === null || bounds === null || lane === null
            || lane.entityOrder.some((id) => canvas.registry.queries.isProtocolCore(lane.entities[id]!.definitionId))) {
            return { status: "ignored" };
          }

          const copies = resolveCopyCount(appHost, editor, lane);
          drag = { id: event.gestureId, canvas, editor, document: editor.document.getSnapshot(),
            lane, bounds, start, copies, pitch: null, firstPreviewId: null };
          updatePreview(drag, event.position);
          return { status: "claimed" };
        }

        case "mouse dragmove":
        case "touch dragmove":
          if (drag?.id !== event.gestureId) return { status: "ignored" };
          if (event.type === "touch dragmove" && event.activeTouchCount !== 1) clear();
          else updatePreview(drag, event.position);
          return { status: "handled" };

        case "mouse dragend":
        case "touch dragend": {
          if (drag?.id !== event.gestureId) return { status: "ignored" };
          const current = drag;
          const viewport = canvas.view.state.clientRect;
          const { x, y } = event.position;
          if (event.reason === "release" && canvas.editor === current.editor && current.editor.document.getSnapshot() === current.document
            && x >= viewport.left && x < viewport.left + viewport.width
            && y >= viewport.top && y < viewport.top + viewport.height) {
            updatePreview(current, event.position);
            const preview = current.editor.state.collections.preview;
            if (current.copies === 0) {
              canvas.actions.showCanvasToast("repeatLane.planFull");
            } else if (current.pitch === null) {
              canvas.actions.showCanvasToast("repeatLane.spacing");
            } else if (
              preview.length !== current.lane.entityOrder.length * current.copies
              || preview[0] !== current.firstPreviewId
              || preview.some((id) => !current.editor.queries.getEntityPlacementValidation(id).canPlace)
              || !current.editor.actions.applyPlacementDraft()
            ) {
              canvas.actions.showCanvasToast("repeatLane.blocked");
            } else {
              const cell = canvas.view.queries.findGridCellForClientPixelPoint(event.position);
              if (cell !== null) canvas.offerRepeatLaneUndo(cell, current.editor);
            }
          }
          clear();
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

function resolveCopyCount(appHost: AppHost, editor: EditorContract, lane: BlueprintDocument): number {
  const { byRecipe } = countPlacedMachines(lane);
  const plan = resolvePinnedPlanPlacementEntries(appHost, editor);
  const matching = plan?.filter((entry) => (byRecipe[entry.recipeId] ?? 0) > 0) ?? [];
  const needed = matching.length === 0 ? 1 : Math.min(...matching.map((entry) =>
    Math.floor((entry.needed - entry.placed) / byRecipe[entry.recipeId]!)));
  return Math.max(0, Math.min(needed, MAX_COPIES, Math.max(1, Math.floor(MAX_PREVIEW_ENTITIES / lane.entityOrder.length))));
}

function updatePreview(drag: LaneDrag, position: GesturePosition, trackEdge = true): void {
  const { canvas, editor, lane, start, bounds, copies } = drag;
  const cell = canvas.view.queries.findGridCellForClientPixelPoint(position);
  const preview = editor.state.collections.preview;
  if (copies === 0 || canvas.editor !== editor || editor.document.getSnapshot() !== drag.document
    || (preview.length > 0 && preview[0] !== drag.firstPreviewId)) return;

  if (trackEdge) canvas.edgePan.track(position, (next) => updatePreview(drag, next, false), "pointer");
  const dx = cell === null ? 0 : cell.x - start.x;
  const dy = cell === null ? 0 : cell.y - start.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const pitch = horizontal ? { x: dx, y: 0 } : { x: 0, y: dy };
  if (horizontal ? Math.abs(dx) < bounds.width : Math.abs(dy) < bounds.height) {
    discardPreview(drag);
    return;
  }
  if (drag.pitch?.x === pitch.x && drag.pitch.y === pitch.y) return;
  drag.pitch = pitch;
  editor.actions.createBlueprintPlacementDraft?.(repeatBlueprint(lane, pitch, copies), lane.initialGridPoint);
  drag.firstPreviewId = preview[0] ?? null;
}

function discardPreview(drag: LaneDrag): void {
  if (drag.editor.state.collections.preview[0] === drag.firstPreviewId) {
    drag.editor.actions.cancelPlacementDraft();
  }
  drag.firstPreviewId = null;
  drag.pitch = null;
}

/** Give every copy its own endpoint namespace so internal links cannot cross between copies. */
function repeatBlueprint(lane: BlueprintDocument, pitch: GridPoint, copies: number): BlueprintDocument {
  const entities: Record<string, WorldEntity> = {};
  const slotLinks: BlueprintDocument["slotLinks"] = [];
  for (let copy = 1; copy <= copies; copy += 1) {
    const copyId = (id: string) => `${copy}:${id}`;
    for (const id of lane.entityOrder) {
      const entity = lane.entities[id]!;
      const nextId = copyId(id);
      entities[nextId] = {
        ...entity,
        id: nextId,
        position: { x: entity.position.x + pitch.x * copy, y: entity.position.y + pitch.y * copy },
      };
    }
    for (const link of lane.slotLinks) {
      slotLinks.push({
        ...link,
        id: copyId(link.id),
        source: { ...link.source, entityId: copyId(link.source.entityId) },
        target: { ...link.target, entityId: copyId(link.target.entityId) },
      });
    }
  }
  return { ...lane, entities, entityOrder: Object.keys(entities), slotLinks };
}
