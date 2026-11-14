import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createRegistryContract } from "@/registry";

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


describe("Bug #24 - mix_pool_2 传送带预览", () => {
  /**
   * 模拟场景: mix_pool_2 旁边有一个掉头传送带。
   * mix_pool_2 在 (10,10)，6x5 占地。
   * 掉头传送带从 mix_pool_2 南侧输入口旁经过。
   *
   * 布局:
   *   mix_pool_2 占地 x=10..15, y=10..14
   *   输入端口在 SOUTH (y=14), x=11,12,13,14
   *   在 mix_pool_2 下方有一组传送带形成 U 型路径
   */
  it("从 mix_pool_2 下方 U-turn 传送带起笔能正确创建预览", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorTestHost(workspace);

    editorHost.internalDocument.setSnapshot({
      ...createDummyWorldDocument(),
      entities: loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/editor/bug-24-mix-pool-2-conveyor/scene-01-variant-1.schema7.json").entities,
      entityOrder: ["mix-pool"],
    });

    // mix_pool_2 输入端口在 SOUTH 侧 (y=14), x=11,12,13,14
    // 下方 outsideGridPoint 在 y=15
    // 模拟从输入端口下方 (11,16) 起笔
    const startResult = editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "mix-pool",
        pointerGridPoint: { x: 11, y: 16 },
      },
    });

    console.log("startResult:", JSON.stringify(startResult, null, 2));
    const draft = editorHost.queries.resolveLogisticsDraftState();
    console.log("draft source:", JSON.stringify(draft?.source, null, 2));

    expect(startResult.status).toBe("created");
    expect(startResult.sourceEntityId).toBe("mix-pool");

    // 从输入端口起笔不应有预览 cell（这是设备端口，等待 move）
    expect(draft?.cells.length).toBe(0);
  });
});
