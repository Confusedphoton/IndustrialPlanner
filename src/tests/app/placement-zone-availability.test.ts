import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorldDocument } from "@/domain/document/world-document";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { type EditorHost } from "@/editor/editor-host";
import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import {
  canPlaceEntityDefinitionInBase, canPlaceEntityDefinitionInCurrentBase,
  canPlaceBlueprintDocumentInCurrentBase, hasPlaceableEntityDefinitionInCurrentBase,
} from "@/app/placement-zone-availability";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

describe("当前基地设备资格", () => {
  let session: ReturnType<typeof createAppTestWorkspace>;
  let editor: EditorHost;
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    session = createAppTestWorkspace();
    editor = createEditorTestHost(session.workspace);
    await editor.internalDocuments.ready();
  });
  afterEach(async () => {
    try {
      await editor.internalHistory.flush();
      await editor.internalDocuments.flush();
      await editor.internalDocuments.settleMaintenance();
    } finally {
      editor.dispose(); session.app.dispose(); localStorage.clear(); vi.unstubAllGlobals();
    }
  });
  const blueprint = (definitionId: string) => createBlueprintDocument({
    name: "设备资格回归", baseId: "wuling_protocol_core", initialGridPoint: { x: 0, y: 0 }, slotLinks: [],
    entities: {
    device: { id: "device", definitionId, position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
  }, entityOrder: ["device"] });

  it("协议核心继续区分手动入口与蓝图入口", () => {
    const core = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "sp_hub_1")!;
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "wuling_protocol_core" }));
    expect(canPlaceEntityDefinitionInCurrentBase(session.app.mainCanvas, core)).toBe(false);
    expect(canPlaceBlueprintDocumentInCurrentBase(session.app.mainCanvas, blueprint(core.id))).toBe(true);
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
    expect(canPlaceEntityDefinitionInCurrentBase(session.app.mainCanvas, core)).toBe(true);
  });
  it("真实地区设备白名单保留原资格，当前地图未确定时不开放入口", () => {
    const pipe = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "pipe_splitter")!;
    const ordinary = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "grinder_1")!;
    for (const baseId of ["valley4_protocol_core", "wuling_protocol_core", "draft_box"]) {
      expect(canPlaceEntityDefinitionInBase(session.app, pipe, baseId)).toBe(baseId !== "valley4_protocol_core");
      expect(canPlaceEntityDefinitionInBase(session.app, ordinary, baseId)).toBe(true);
    }
    expect(canPlaceEntityDefinitionInBase(session.app, pipe, null)).toBe(false);
    expect(canPlaceEntityDefinitionInBase(session.app, ordinary, "unknown-base")).toBe(false);
  });
  it("只允许子区域的型号在整个地图入口可用，地区标签不覆盖白名单", () => {
    const ordinary = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "grinder_1")!;
    const restricted = { ...ordinary, tags: ["四号谷地"], placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }] };
    expect(canPlaceEntityDefinitionInBase(session.app, restricted, "wuling_agricultural_land")).toBe(true);
    expect(canPlaceEntityDefinitionInBase(session.app, restricted, "valley4_protocol_core")).toBe(false);
    expect(canPlaceEntityDefinitionInBase(session.app, restricted, "draft_box")).toBe(false);
    expect(canPlaceEntityDefinitionInBase(session.app, { ...restricted, placementWhitelist: undefined }, "valley4_protocol_core")).toBe(true);
    expect(canPlaceEntityDefinitionInBase(session.app, { ...restricted, placementWhitelist: [] }, "wuling_agricultural_land")).toBe(false);
  });
  it("设备组和蓝图入口遵守相同地图资格", () => {
    for (const baseId of ["valley4_protocol_core", "wuling_protocol_core", "draft_box"]) {
      editor.internalDocument.setSnapshot(createWorldDocument({ baseId }));
      expect(hasPlaceableEntityDefinitionInCurrentBase(session.app.mainCanvas, "pipeLogistics")).toBe(baseId !== "valley4_protocol_core");
      expect(canPlaceBlueprintDocumentInCurrentBase(session.app.mainCanvas, blueprint("pipe_splitter"))).toBe(baseId !== "valley4_protocol_core");
    }
  });
});
