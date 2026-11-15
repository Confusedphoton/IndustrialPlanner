import { afterEach, describe, expect, it } from "vitest";

import { driveMousePlacementPreview } from "@/app/input/gesture/actions/hypergryph/hypergryph-single-placement-gesture-module";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length > 0) cleanups.pop()?.(); });

function createDraggedPreview() {
  const test = createCanvasTestSession({ activeTool: "single-placement" });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
  test.editor.actions.createSinglePlacementDraft({ definitionId: "power_sta_1", centerGridPoint: { x: 0, y: 0 } });
  const redrive = (position: { x: number; y: number }) => {
    driveMousePlacementPreview({ canvas: test.canvas, editor: test.editor, position });
  };
  const previewRect = () => test.editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview)!;
  return { test, redrive, previewRect };
}

describe("preview edge pan", () => {
  it("pans the map while a dragged preview is pushed past the canvas edge and keeps it under the pointer", () => {
    const { test, redrive, previewRect } = createDraggedPreview();
    test.canvas.edgePan.track({ x: 400, y: 300 }, redrive);
    expect(test.canvas.edgePan.needsFrame()).toBe(false);

    const edge = { x: 799, y: 300 };
    redrive(edge);
    test.canvas.edgePan.track(edge, redrive);
    const centerBefore = test.view.state.center.x;
    const previewBefore = previewRect().x;
    expect(test.canvas.edgePan.needsFrame()).toBe(true);
    for (let frame = 0; frame <= 30; frame += 1) test.canvas.edgePan.advanceFrame(frame * 16);

    expect(test.view.state.center.x).toBeGreaterThan(centerBefore);
    expect(previewRect().x).toBeGreaterThan(previewBefore);
  });

  it("does not pan toward an edge the preview was already past when the drag began", () => {
    const { test, redrive } = createDraggedPreview();
    const edge = { x: 799, y: 300 };
    redrive(edge);
    test.canvas.edgePan.track(edge, redrive);

    expect(test.canvas.edgePan.needsFrame()).toBe(false);
  });

  it("stops panning when the drag ends", () => {
    const { test, redrive } = createDraggedPreview();
    test.canvas.edgePan.track({ x: 400, y: 300 }, redrive);
    redrive({ x: 799, y: 300 });
    test.canvas.edgePan.track({ x: 799, y: 300 }, redrive);
    test.canvas.edgePan.stop();

    expect(test.canvas.edgePan.needsFrame()).toBe(false);
  });
});
