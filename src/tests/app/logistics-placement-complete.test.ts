import { getTestView } from "@/tests/helpers/app-test-workspace";
// @vitest-environment jsdom

import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

import { type AppHost } from "@/app/host/app-host";
import { createAppTestHost } from "@/tests/helpers/app-test-workspace";
import type {
  GestureKeyboardEventLike,
  GesturePointerEventLike,
} from "@/app/input/gesture/adapter";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { type EditorHost } from "@/editor/editor-host";
import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createRegistryContract } from "@/registry";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

/**
 * 物流布设模式完全测试集
 *
 * 该测试集中的用例全部由用户手工创建和提供。后续修改也必须由用户手工提供用例，
 * 自动创建的测试用例不能放在这里。
 *
 * 如果该测试集中的测试 failed，则说明当前物流布设模式有问题。请开发人员检查代码和逻辑，
 * 不要随意修改测试用例。
 */
describe("物流布设模式完全测试集", () => {
  let appHost: AppHost;
  let editorHost: EditorHost;
  let nextPointerId: number;

  beforeEach(async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const workspace = createWorkspace();
    editorHost = createEditorTestHost(workspace);
    const initialDocumentKey = editorHost.internalDocument.getSnapshot().documentKey;
    await waitForEditorInitialDocumentLoad(editorHost, initialDocumentKey);
    appHost = createAppTestHost(workspace);
    nextPointerId = 1;

    resetCanvasFromUserBlueprint(editorHost);
    getTestView(editorHost.workspace).actions.setViewportClientRect({
      left: 100,
      top: 80,
      width: 1200,
      height: 800,
    });

    runInAction(() => {
      appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = true;
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = false;
    });

    enterBeltLogisticsPlacement(appHost);
    clickCell(appHost, editorHost, { x: 10, y: 2 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    rightClickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);

    expect(appHost.mainCanvas.state.runtime.logisticsPlacement.phase).toBe("idle");
    expect(editorHost.queries.resolveLogisticsDraftState()).toBeNull();

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 10, y: 6 },
      rotation: 270,
    });
  });

  afterEach(async () => {
    try {
      await editorHost.internalHistory.flush();
      await editorHost.internalDocuments.flush();
    } finally {
      appHost.dispose();
      editorHost.dispose();
      localStorage.clear();
      vi.unstubAllGlobals();
    }
  });

  it("从 6,3 布设到 2,5 后生成两个顺时针弯道", async () => {
    clickCell(appHost, editorHost, { x: 6, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 2, y: 5 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 2, y: 5 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 6, y: 5 },
      rotation: 270,
    }, { soft: true });
    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 2, y: 5 },
      rotation: 0,
    }, { soft: true });
  });

  it("从 6,3 布设到 1,5 后在 2,5 生成桥接器", async () => {
    clickCell(appHost, editorHost, { x: 6, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 1, y: 5 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 1, y: 5 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 6, y: 5 },
      rotation: 270,
    }, { soft: true });
    expectEntityAt(editorHost, {
      definitionId: "log_connector",
      position: { x: 2, y: 5 },
    }, { soft: true });
  });

  it("连续放置时不会被起笔处端口干扰", async () => {
    // 第一段：从 (2,4) 到 (4,3)
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    // 第二段：从 (4,3) 续接到 (4,6)，不应被起笔处的端口方向干扰
    await moveToCell(appHost, editorHost, { x: 4, y: 6 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 6 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 4, y: 3 },
      rotation: 180,
    });
  });

  it("右键结束布设后从已有传送带端点重新起笔到(5,6)生成转角", async () => {
    // 第一段：从 (2,4) 到 (4,3)
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    // 右键结束布设
    rightClickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    expect(appHost.mainCanvas.state.runtime.logisticsPlacement.phase).toBe("idle");

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 3 },
      rotation: 0,
    });

    // 第二段：从已有传送带的 (4,3) 起笔到 (5,6)，应生成转角
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 5, y: 6 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 5, y: 6 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 4, y: 3 },
      rotation: 180,
    });
  });

  it("右键结束布设后从已有传送带端点重新起笔纵穿生成桥接器", async () => {
    // 第一段：从 (2,4) 到 (4,3)
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    // 右键结束布设
    rightClickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    expect(appHost.mainCanvas.state.runtime.logisticsPlacement.phase).toBe("idle");

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 3 },
      rotation: 0,
    });

    // 第二段：从已有传送带的 (4,2) 起笔纵穿到 (4,7)，(4,3) 应生成桥接器
    clickCell(appHost, editorHost, { x: 4, y: 2 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 7 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 7 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "log_connector",
      position: { x: 4, y: 3 },
    });
  });

  it("从物流桥 A 拉到物流桥 B 时绕开中间物流桥 M 且不产生堆叠", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_BRIDGE_CROSSING);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 11, y: 8 }, nextPointerId++);
    expect(editorHost.queries.resolveLogisticsDraftState()?.source).toMatchObject({
      type: "device-port",
      entityId: "bridge-a",
      portGroupId: "item_output_ew",
      portId: "out_e",
      outsideGridPoint: { x: 12, y: 8 },
    });

    await moveToCell(appHost, editorHost, { x: 11, y: 10 }, nextPointerId++);
    await waitForGestureFrame();

    const draftBeforeApply = editorHost.queries.resolveLogisticsDraftState();
    expect(draftBeforeApply?.cells.some((cell) =>
      cell.gridPoint.x === 11 && cell.gridPoint.y === 9
    )).toBe(false);
    expect(draftBeforeApply).toMatchObject({
      canApply: true,
      invalidReason: null,
    });

    clickCell(appHost, editorHost, { x: 11, y: 10 }, nextPointerId++);
    const entitiesAtMiddleBridge = Object.values(
      editorHost.document.getSnapshot().entities,
    ).filter((entity) => entity.position.x === 11 && entity.position.y === 9);
    expect(entitiesAtMiddleBridge).toEqual([
      expect.objectContaining({ id: "bridge-m", definitionId: "log_connector" }),
    ]);
  });

  it("从已有传送带端点续接时切换线序生成弯道", async () => {
    // 第一段：从 (2,4) 到 (4,3)
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    // 右键结束布设
    rightClickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    expect(appHost.mainCanvas.state.runtime.logisticsPlacement.phase).toBe("idle");

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 3 },
      rotation: 0,
    });

    // 第二段：从已有传送带 (4,3) 起笔到 (5,6)
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 5, y: 6 }, nextPointerId++);
    // 按下 R 切换为先横后竖
    pressRouteOrderShortcut(appHost);
    // 原地点击完成布设
    clickCell(appHost, editorHost, { x: 5, y: 6 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 3 },
      rotation: 0,
    });
  });

  it("场景2-从5,3横先布设到2,4生成弯道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE2);
    enterBeltLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);

    clickCell(appHost, editorHost, { x: 5, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 5, y: 3 },
      rotation: 270,
    });
    expectEntityAt(editorHost, {
      definitionId: "belt_turn_ccw_1x1",
      position: { x: 2, y: 3 },
      rotation: 90,
    });
  });

  it("就近原则A", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE3);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 6, y: 5 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "log_connector",
      position: { x: 5, y: 3 },
    });
  });

  it("就近原则B", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE3);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 6, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 5 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 5 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "log_connector",
      position: { x: 5, y: 5 },
    });
  });

  it("场景4-管道从7,6经9,6布设到9,5生成逆时针弯道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE4);
    enterPipeLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);

    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    expect.soft(appHost.mainCanvas.state.runtime.logisticsPlacement).toMatchObject({
      kind: "pipe",
      phase: "drawing",
      isHoverPreview: false,
      lastPreviewGridPoint: { x: 7, y: 6 },
    });
    expect.soft(editorHost.queries.resolveLogisticsDraftState()?.source).toMatchObject({
      type: "device-port",
      entityId: "pipe_admission:2",
      portDirection: "output",
      outsideGridPoint: { x: 8, y: 6 },
    });

    await moveToCell(appHost, editorHost, { x: 9, y: 6 }, nextPointerId++);
    await waitForGestureFrame();
    expect.soft(appHost.mainCanvas.state.runtime.logisticsPlacement).toMatchObject({
      phase: "drawing",
      lastPreviewGridPoint: { x: 9, y: 6 },
      headGridPoint: { x: 9, y: 6 },
    });
    expect.soft(editorHost.queries.resolveLogisticsDraftState()?.cells.map((cell) => ({
      position: cell.gridPoint,
      shape: cell.shape,
      rotation: cell.rotation,
    }))).toEqual([
      { position: { x: 8, y: 6 }, shape: "straight", rotation: 0 },
      { position: { x: 9, y: 6 }, shape: "straight", rotation: 0 },
    ]);

    await moveToCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    await waitForGestureFrame();

    const draftBeforeApply = editorHost.queries.resolveLogisticsDraftState();
    expect.soft(draftBeforeApply?.canApply).toBe(true);
    expect.soft(draftBeforeApply?.invalidReason).toBeNull();
    expect.soft(draftBeforeApply?.cells.map((cell) => ({
      position: cell.gridPoint,
      shape: cell.shape,
      rotation: cell.rotation,
    }))).toEqual([
      { position: { x: 8, y: 6 }, shape: "straight", rotation: 0 },
      { position: { x: 9, y: 6 }, shape: "turn-ccw", rotation: 270 },
      { position: { x: 9, y: 5 }, shape: "straight", rotation: 270 },
    ]);
    expect.soft(draftBeforeApply?.cells.find((cell) =>
      cell.gridPoint.x === 9 && cell.gridPoint.y === 6
    )).toMatchObject({
      shape: "turn-ccw",
      rotation: 270,
    });

    clickCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    expect.soft(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
      source: {
        type: "logistics-entity",
        gridPoint: { x: 9, y: 5 },
      },
    });

    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_ccw_1x1",
      position: { x: 9, y: 6 },
      rotation: 270,
    });
  });

  it("场景4-删除9,5的重叠传送带后可连接已有管道", async () => {
    const blueprintWithoutOverlappingBelt = loadBlueprintFromFile("src/tests/fixtures/blueprints/logistics-placement-complete/scene-4-without-overlapping-belt.schema7.json");
    resetCanvasFromUserBlueprint(editorHost, blueprintWithoutOverlappingBelt);
    enterPipeLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);

    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 9, y: 6 }, nextPointerId++);
    await waitForGestureFrame();
    await moveToCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    await waitForGestureFrame();
    clickCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    expect.soft(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
      source: {
        type: "logistics-entity",
        gridPoint: { x: 9, y: 5 },
      },
    });

    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_ccw_1x1",
      position: { x: 9, y: 6 },
      rotation: 270,
    });
  });

  it("场景4-9,5的传送带位于管道命中层之上时仍应连接管道", async () => {
    const blueprintWithOverlappingBeltOnTop = loadBlueprintFromFile("src/tests/fixtures/blueprints/logistics-placement-complete/scene-4-belt-on-top.schema7.json");
    resetCanvasFromUserBlueprint(editorHost, blueprintWithOverlappingBeltOnTop);
    enterPipeLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);

    expect(editorHost.document.getSnapshot().entityOrder.at(-1)).toBe(
      "logistics-draft:belt:572:3",
    );
    expect(editorHost.queries.findLogisticsDraftEndpointAtGridPoint(
      { x: 9, y: 5 },
      "pipe",
    )).toMatchObject({
      type: "logistics-entity",
      entityId: "logistics-draft:pipe:584:3",
    });

    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 9, y: 6 }, nextPointerId++);
    await waitForGestureFrame();
    await moveToCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    await waitForGestureFrame();

    const draftBeforeApply = editorHost.queries.resolveLogisticsDraftState();
    expect(draftBeforeApply?.cells.find((cell) =>
      cell.gridPoint.x === 9 && cell.gridPoint.y === 6
    )).toMatchObject({
      shape: "turn-ccw",
      rotation: 270,
    });
    expect(draftBeforeApply).toMatchObject({
      canApply: true,
      invalidReason: null,
    });

    clickCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_ccw_1x1",
      position: { x: 9, y: 6 },
      rotation: 270,
    });
  });

  it("断头管道末端前一格起笔-空地起笔关闭时从5,4布设到6,4生成直管", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_DEADEND);

    // 关闭空地起笔，此时仅允许从设备端口或断头物流末端前一格起笔
    runInAction(() => {
      appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = false;
    });

    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 5, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 6, y: 4 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 6, y: 4 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "pipe_straight_1x1",
      position: { x: 5, y: 4 },
      rotation: 0,
    });
  });

  it("反应池内侧端口(7,6)布设到(6,9)时自动选合法管道线序", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_ROUTE_PRIORITY_REACTOR_POOLS);
    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 6, y: 9 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 6, y: 9 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_cw_1x1",
      position: { x: 8, y: 8 },
      rotation: 270,
    });
  });

  it("铺传送带时从管道输出口起笔改铺管道", () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_ROUTE_PRIORITY_REACTOR_POOLS);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 8, y: 6 }, nextPointerId++);

    expect(appHost.mainCanvas.state.runtime.logisticsPlacement.kind).toBe("pipe");
    expect(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
      kind: "pipe",
      source: { type: "device-port", portGroupId: "fluid_output_a" },
    });
  });

  it("反应池外侧端口(8,6)布设到(6,9)时自动选合法管道线序", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_ROUTE_PRIORITY_REACTOR_POOLS);
    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 8, y: 6 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 6, y: 9 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 6, y: 9 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_cw_1x1",
      position: { x: 8, y: 8 },
      rotation: 270,
    });
  });

  it("管道从已有管道起笔分叉-开启自动分流器时指向液燃炉会绕开它接进输入口", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_BRANCH);
    runInAction(() => {
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = true;
    });
    enterPipeLogisticsPlacement(appHost);

    // (51,3) 起笔，指针移到 (51,2) 的液燃炉上：不穿过设备，而是自动绕到它的输入口。
    clickCell(appHost, editorHost, { x: 51, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 51, y: 2 }, nextPointerId++);
    const draft = editorHost.queries.resolveLogisticsDraftState();
    expect(draft?.canApply).toBe(true);
    expect(draft?.target?.type).toBe("device-port");
    expect(draft?.cells.some((cell) => cell.gridPoint.x === 51 && cell.gridPoint.y === 2)).toBe(false);
    const entitiesBeforeConfirm = editorHost.document.getSnapshot().entities;
    clickCell(appHost, editorHost, { x: 51, y: 2 }, nextPointerId++);
    expect(editorHost.document.getSnapshot().entities).not.toEqual(entitiesBeforeConfirm);
  });

  it("管道从已有管道起笔分叉-关闭自动分流器时指向液燃炉会绕开它接进输入口", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_BRANCH);
    runInAction(() => {
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = false;
    });
    enterPipeLogisticsPlacement(appHost);

    // (51,3) 起笔，指针移到 (51,2) 的液燃炉上：不穿过设备，而是自动绕到它的输入口。
    clickCell(appHost, editorHost, { x: 51, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 51, y: 2 }, nextPointerId++);
    const draft = editorHost.queries.resolveLogisticsDraftState();
    expect(draft?.canApply).toBe(true);
    expect(draft?.target?.type).toBe("device-port");
    expect(draft?.cells.some((cell) => cell.gridPoint.x === 51 && cell.gridPoint.y === 2)).toBe(false);
    const entitiesBeforeConfirm = editorHost.document.getSnapshot().entities;
    clickCell(appHost, editorHost, { x: 51, y: 2 }, nextPointerId++);
    expect(editorHost.document.getSnapshot().entities).not.toEqual(entitiesBeforeConfirm);
  });

  it("连续布设管道绕回穿越已有直管时(2,2)应生成管道桥接器", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_CONTINUOUS_CROSSING);
    runInAction(() => {
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = true;
    });
    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 2, y: 1 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 3, y: 1 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 3, y: 1 }, nextPointerId++);

    await moveToCell(appHost, editorHost, { x: 3, y: 2 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 1, y: 2 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 1, y: 2 }, nextPointerId++);
    rightClickCell(appHost, editorHost, { x: 1, y: 2 }, nextPointerId++);

    expect(appHost.mainCanvas.state.runtime.logisticsPlacement.phase).toBe("idle");
    expectEntityAt(editorHost, {
      definitionId: "pipe_connector",
      position: { x: 2, y: 2 },
    });
  });

  it("被压制的管道不干扰传送带布设-从(2,3)到(4,3)生成直道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SUPPRESSION_OVERLAP);
    enterBeltLogisticsPlacement(appHost);
    // belt 模式下压制管道
    editorHost.actions.setLogisticsSuppression("pipe", true);

    clickCell(appHost, editorHost, { x: 2, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 3, y: 3 },
      rotation: 0,
    });
  });

  it("场景2-从配件机8,5输出口布设到10,6生成逆时针弯道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE2);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 8, y: 5 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 10, y: 6 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 10, y: 6 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_ccw_1x1",
      position: { x: 7, y: 6 },
      rotation: 0,
    });
  });

  it("场景2-从液燃炉4,2输入口布设到3,0生成顺时针弯道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE2);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 4, y: 2 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 3, y: 0 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 3, y: 0 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 3, y: 3 },
      rotation: 0,
    });
  });

});


const USER_PROVIDED_BLUEPRINT: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/scene-1.schema7.json",
);

const USER_PROVIDED_BLUEPRINT_SCENE2: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/scene-2.schema7.json",
);

const USER_PROVIDED_BLUEPRINT_SCENE3: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/scene-3.schema7.json",
);

const USER_PROVIDED_BLUEPRINT_SCENE4: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/scene-4.schema7.json",
);

const USER_PROVIDED_BLUEPRINT_BRIDGE_CROSSING: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/bridge-crossing.schema7.json",
);

const USER_PROVIDED_BLUEPRINT_PIPE_DEADEND: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/pipe-deadend.schema7.json",
);

const USER_PROVIDED_BLUEPRINT_PIPE_BRANCH: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/pipe-branch.schema7.json",
);

const USER_PROVIDED_BLUEPRINT_PIPE_CONTINUOUS_CROSSING: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/pipe-continuous-crossing.schema7.json",
);

const USER_PROVIDED_BLUEPRINT_PIPE_ROUTE_PRIORITY_REACTOR_POOLS: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/pipe-route-priority-reactor-pools.schema7.json",
);

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

async function waitForEditorInitialDocumentLoad(
  editorHost: EditorHost,
  initialDocumentKey: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (editorHost.internalDocument.getSnapshot().documentKey !== initialDocumentKey) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("等待 editor 初始文档加载超时");
}

async function waitForGestureFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function resetCanvasFromUserBlueprint(
  editorHost: EditorHost,
  blueprint: BlueprintDocument = USER_PROVIDED_BLUEPRINT,
): void {
  const emptyDocument = createWorldDocument({
    baseId: blueprint.baseId,
  });
  editorHost.internalDocument.setSnapshot(emptyDocument);

  const entities = structuredClone(blueprint.entities);
  const blueprintDocument: WorldDocument = {
    ...emptyDocument,
    entities,
    entityOrder: [...blueprint.entityOrder],
    slotLinks: structuredClone(blueprint.slotLinks),
    documentSettings: {
      ...emptyDocument.documentSettings,
      viewport: {
        center: { ...blueprint.initialGridPoint },
        gridSize: emptyDocument.documentSettings.viewport?.gridSize ?? 1,
        displayRotation: 0,
      },
    },
  };
  editorHost.internalDocument.setSnapshot(blueprintDocument);
}

function enterBeltLogisticsPlacement(appHost: AppHost): void {
  runInAction(() => {
    const runtime = appHost.mainCanvas.state.runtime.logisticsPlacement;
    runtime.kind = "belt";
    runtime.shortcutPlacementGroup = "beltLogistics";
    runtime.pointerMode = "mouse";
    runtime.phase = "idle";
    runtime.routeOrder = "vertical-first";
    appHost.mainCanvas.state.runtime.selectingPlacementGroup = "beltLogistics";
  });
  appHost.internalActions.setActiveTool("logistics-placement");
}

function enterPipeLogisticsPlacement(appHost: AppHost): void {
  runInAction(() => {
    const runtime = appHost.mainCanvas.state.runtime.logisticsPlacement;
    runtime.kind = "pipe";
    runtime.shortcutPlacementGroup = "pipeLogistics";
    runtime.pointerMode = "mouse";
    runtime.phase = "idle";
    runtime.routeOrder = "vertical-first";
    appHost.mainCanvas.state.runtime.selectingPlacementGroup = "pipeLogistics";
  });
  appHost.internalActions.setActiveTool("logistics-placement");
}

function pressRouteOrderShortcut(appHost: AppHost): void {
  appHost.gestureAdapter.handleKeyDown(keyEvent({
    code: "KeyR",
    key: "r",
    keyCode: 82,
  }));
}

const pointerGridPointByAppHost = new WeakMap<
  AppHost,
  { readonly x: number; readonly y: number }
>();

function clickCell(
  appHost: AppHost,
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
  pointerId: number,
): void {
  const point = resolveClientPixelPointForGridCell(editorHost, cell);
  appHost.gestureAdapter.handlePointerDown(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    buttons: 1,
  }));
  appHost.gestureAdapter.handlePointerUp(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    buttons: 0,
  }));
  pointerGridPointByAppHost.set(appHost, cell);
}

function rightClickCell(
  appHost: AppHost,
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
  pointerId: number,
): void {
  const point = resolveClientPixelPointForGridCell(editorHost, cell);
  appHost.gestureAdapter.handlePointerDown(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    button: 2,
    buttons: 2,
  }));
  appHost.gestureAdapter.handlePointerUp(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    button: 2,
    buttons: 0,
  }));
  pointerGridPointByAppHost.set(appHost, cell);
}

async function moveToCell(
  appHost: AppHost,
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
  pointerId: number,
): Promise<void> {
  const startCell = pointerGridPointByAppHost.get(appHost);
  if (startCell === undefined) {
    throw new Error("平滑移动前必须先通过测试夹具定位指针起点");
  }

  await waitForGestureFrame();
  for (const pathCell of resolveGridCellCenterPath(startCell, cell)) {
    const point = resolveClientPixelPointForGridCell(editorHost, pathCell);
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId,
      clientX: point.x,
      clientY: point.y,
      button: -1,
      buttons: 0,
    }));
    pointerGridPointByAppHost.set(appHost, pathCell);
    await waitForGestureFrame();
  }
}

function resolveGridCellCenterPath(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): readonly { readonly x: number; readonly y: number }[] {
  if (start.x === end.x && start.y === end.y) {
    return [];
  }

  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const stepX = Math.sign(deltaX);
  const stepY = Math.sign(deltaY);
  const timeDeltaX = deltaX === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(deltaX);
  const timeDeltaY = deltaY === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(deltaY);
  let timeToNextX = deltaX === 0 ? Number.POSITIVE_INFINITY : timeDeltaX / 2;
  let timeToNextY = deltaY === 0 ? Number.POSITIVE_INFINITY : timeDeltaY / 2;
  let currentX = start.x;
  let currentY = start.y;
  const path: { x: number; y: number }[] = [];

  while (currentX !== end.x || currentY !== end.y) {
    const reachesGridCorner = Math.abs(timeToNextX - timeToNextY) <= 1e-12;
    if (reachesGridCorner) {
      currentX += stepX;
      currentY += stepY;
      timeToNextX += timeDeltaX;
      timeToNextY += timeDeltaY;
    } else if (timeToNextX < timeToNextY) {
      currentX += stepX;
      timeToNextX += timeDeltaX;
    } else {
      currentY += stepY;
      timeToNextY += timeDeltaY;
    }
    path.push({ x: currentX, y: currentY });
  }

  return path;
}

function expectEntityAt(
  editorHost: EditorHost,
  expected: Pick<WorldEntity, "definitionId" | "position"> & {
    readonly rotation?: WorldEntity["rotation"];
  },
  options: { readonly soft?: boolean } = {},
): void {
  const matchingEntity = Object.values(editorHost.document.getSnapshot().entities).find((entity) =>
    entity.position.x === expected.position.x
    && entity.position.y === expected.position.y
    && entity.definitionId === expected.definitionId
    && (expected.rotation === undefined || entity.rotation === expected.rotation),
  );

  const assertion = options.soft === true ? expect.soft : expect;
  assertion(matchingEntity, [
    `未在 (${expected.position.x}, ${expected.position.y}) 找到`,
    expected.rotation === undefined
      ? expected.definitionId
      : `${expected.definitionId} rotation=${expected.rotation}`,
  ].join(" ")).toBeDefined();
}

function pointerEvent(
  overrides: Partial<GesturePointerEventLike>,
): GesturePointerEventLike {
  return {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function keyEvent(
  overrides: Partial<GestureKeyboardEventLike>,
): GestureKeyboardEventLike {
  return {
    code: "",
    key: "",
    keyCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

const USER_PROVIDED_BLUEPRINT_SUPPRESSION_OVERLAP: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/suppression-overlap.schema7.json",
);

function resolveClientPixelPointForGridCell(
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const gridCellSize = getTestView(editorHost.workspace).state.gridCellPixelSize;

  return {
    x:
      getTestView(editorHost.workspace).state.clientRect.left
      + getTestView(editorHost.workspace).state.clientRect.width / 2
      + (cell.x + 0.5 - getTestView(editorHost.workspace).state.center.x) * gridCellSize,
    y:
      getTestView(editorHost.workspace).state.clientRect.top
      + getTestView(editorHost.workspace).state.clientRect.height / 2
      + (cell.y + 0.5 - getTestView(editorHost.workspace).state.center.y) * gridCellSize,
  };
}
