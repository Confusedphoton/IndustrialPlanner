import { describe, expect, it } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
    audio: null,
  };
}

describe("placing a device linked to a depot item", () => {
  it("commits the device and its depot link as one undo step", () => {
    const editor = createEditorTestHost(createWorkspace());
    editor.actions.createSinglePlacementDraft({ definitionId: "log_hongs_bus", centerGridPoint: { x: 10, y: 20 } });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    const depthBefore = editor.state.history.undoDepth;

    editor.actions.createSinglePlacementDraft({
      definitionId: "unloader_1",
      centerGridPoint: { x: 10, y: 25 },
      warehouseItemId: "item_iron_ore",
    });
    expect(editor.actions.applyPlacementDraft()).toBe(true);

    const placed = editor.document.getSnapshot();
    const unloader = Object.values(placed.entities).find((entity) => entity.definitionId === "unloader_1");
    expect(unloader).toBeDefined();
    expect(placed.slotLinks).toContainEqual(expect.objectContaining({
      source: expect.objectContaining({ entityId: unloader!.id, storageSlotGroupId: "unloader_buffer" }),
      target: expect.objectContaining({ entityId: "warehouse", slotId: "item_iron_ore" }),
    }));
    expect(editor.state.history.undoDepth).toBe(depthBefore + 1);

    editor.actions.undoDocumentHistory();
    const undone = editor.document.getSnapshot();
    expect(Object.values(undone.entities).some((entity) => entity.definitionId === "unloader_1")).toBe(false);
    expect(undone.slotLinks.some((link) => link.target.slotId === "item_iron_ore")).toBe(false);
  });
});
