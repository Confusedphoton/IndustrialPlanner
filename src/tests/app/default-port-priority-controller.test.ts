import { describe, expect, it, vi } from "vitest";
import { DefaultPortPriorityController } from "@/app/port-priority";
import { resolvePortPriorityGroupRows } from "@/app/shell/inspector/port-priority-group-model";
import { createRegistryContract } from "@/registry";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";

const load = (name: string) => createWorldDocumentFromBlueprint(loadBlueprintFromFile(
  `src/tests/fixtures/blueprints/simulation/default-port-priorities/${name}.schema7.json`,
));

describe("编辑文档默认端口优先级缓存", () => {
  it("只在布局或顺序变化时重算，Inspector 读取及用户覆盖不查询邻接", () => {
    const registry = createRegistryContract();
    const query = vi.spyOn(registry.queries, "resolveDefaultPortPriorityGroups");
    const controller = new DefaultPortPriorityController(registry);
    const document = load("stash-splitter-last");
    const before = JSON.stringify(document);
    controller.update(document);
    const defaults = controller.get("target");
    const calls = query.mock.calls.length;
    const definition = registry.queries.findEntityDefinition("storager_1")!;
    expect(resolvePortPriorityGroupRows(definition, document.entities.target!, defaults)
      .filter((row) => row.portGroup.direction === "input").map((row) => row.priorityGroup)).toEqual([9, 9, 1]);
    controller.update({ ...document });
    const custom = { ...document.entities.target!, config: { customPortPriorityGroups: true, portPriorityGroups: {} } };
    controller.update({ ...document, entities: { ...document.entities, target: custom } });
    expect(controller.get("target")).toBe(defaults);
    expect(resolvePortPriorityGroupRows(definition, custom, defaults).every((row) => row.priorityGroup === 5)).toBe(true);
    expect(query).toHaveBeenCalledTimes(calls);
    expect(JSON.stringify(document)).toBe(before);
    controller.update({ ...document, entityOrder: ["splitter-a", "splitter-b", "belt", "target", "converger-a", "converger-b", "output-belt"] });
    expect(controller.get("target")?.filter((row) => row.portGroupId === "item_input").map((row) => row.priorityGroup)).toEqual([1, 1, 9]);
    controller.dispose();
    query.mockRestore();
  });

  it("移除、移动、旋转邻居及撤销恢复都会刷新结果", () => {
    const registry = createRegistryContract();
    const controller = new DefaultPortPriorityController(registry);
    const document = load("outlet-converger");
    controller.update(document);
    expect(controller.get("target")?.map((port) => port.priorityGroup)).toEqual([9]);
    const neighbor = document.entities.converger!;
    controller.update({ ...document, entities: { ...document.entities, converger: { ...neighbor, position: { x: 30, y: 30 } } } });
    expect(controller.get("target")).toBeNull();
    controller.update(document);
    expect(controller.get("target")).not.toBeNull();
    controller.update({ ...document, entities: { ...document.entities, converger: { ...neighbor, rotation: 90 } } });
    expect(controller.get("target")).toBeNull();
    const remaining = Object.fromEntries(Object.entries(document.entities).filter(([id]) => id !== "converger"));
    controller.update({ ...document, entities: remaining, entityOrder: document.entityOrder.filter((id) => id !== "converger") });
    expect(controller.get("target")).toBeNull();
    controller.update(document);
    expect(controller.get("target")).not.toBeNull();
    controller.dispose();
  });

  it("运输类型不匹配不构成直接连接", () => {
    const registry = createRegistryContract();
    const controller = new DefaultPortPriorityController(registry);
    const document = load("outlet-converger");
    controller.update({ ...document, entities: { ...document.entities, converger: { ...document.entities.converger!, definitionId: "log_converger" } } });
    expect(controller.get("target")).toBeNull();
    controller.dispose();
  });
});
