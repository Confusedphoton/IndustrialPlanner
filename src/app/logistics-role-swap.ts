import type { EditorContract } from "@/domain/editor/editor-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { LogisticsKind, LogisticsRole } from "@/domain/shared/logistics";

/**
 * 物流设备（分流器/汇流器/桥接器/准入口）的角色解析与原位替换。
 * 供属性面板“设备类型”切换与 Y/O/J/I 快捷键共用。
 */
export const LOGISTICS_ROLE_ORDER: readonly LogisticsRole[] = ["splitter", "converger", "connector", "admission"];

/** 物流设备所属族；非物流设备返回 null。 */
export function resolveLogisticsDeviceKind(
  registry: Pick<RegistryContract, "queries">,
  definitionId: string,
): LogisticsKind | null {
  if (registry.queries.isPipeLogistics(definitionId)) {
    return "pipe";
  }
  if (registry.queries.isBeltLogistics(definitionId)) {
    return "belt";
  }
  return null;
}

/** 指定族与角色的物流设备 definition ID。 */
export function resolveLogisticsDeviceIdForRole(
  registry: Pick<RegistryContract, "queries" | "entityDefinitions">,
  kind: LogisticsKind,
  role: LogisticsRole,
): string | null {
  const definition = registry.entityDefinitions.find((candidate) => (
    (kind === "pipe" ? registry.queries.isPipeLogistics(candidate.id) : registry.queries.isBeltLogistics(candidate.id))
    && registry.queries.resolveLogisticsRole(candidate.id) === role
  ));
  return definition?.id ?? null;
}

/** 当前选择恰为单个物流设备时返回其 ID 与族，否则 null。 */
export function resolveSingleSelectedLogisticsDevice(
  editor: EditorContract,
  registry: Pick<RegistryContract, "queries">,
): { readonly entityId: string; readonly kind: LogisticsKind; readonly role: LogisticsRole } | null {
  const selection = editor.state.collections.selection;
  if (selection.length !== 1) {
    return null;
  }
  const entity = editor.queries.getEntityById(selection[0]!);
  if (entity === null) {
    return null;
  }
  const kind = resolveLogisticsDeviceKind(registry, entity.definitionId);
  const role = registry.queries.resolveLogisticsRole(entity.definitionId);
  return kind === null || role === null ? null : { entityId: entity.id, kind, role };
}

/** 原位替换为同族的另一种物流设备（保留位置与朝向）；返回是否替换成功。 */
export function swapLogisticsDeviceRole(options: {
  readonly editor: EditorContract;
  readonly registry: Pick<RegistryContract, "queries" | "entityDefinitions">;
  readonly entityId: string;
  readonly role: LogisticsRole;
}): boolean {
  const entity = options.editor.queries.getEntityById(options.entityId);
  if (entity === null) {
    return false;
  }
  const kind = resolveLogisticsDeviceKind(options.registry, entity.definitionId);
  if (kind === null || options.registry.queries.resolveLogisticsRole(entity.definitionId) === options.role) {
    return false;
  }
  const nextDefinitionId = resolveLogisticsDeviceIdForRole(options.registry, kind, options.role);
  return nextDefinitionId !== null && options.editor.actions.replaceEntityDefinition(options.entityId, nextDefinitionId);
}
