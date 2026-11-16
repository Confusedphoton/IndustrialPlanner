import type { EntityAcceptRuleDefinition, ItemDomain } from "@/domain/registry/types/entity-definition";

/** 端口接收规则是否放行该物品：先看排除列表，再按物品域或指定物品判断。 */
export function matchesItemAcceptRule(
  itemId: string,
  acceptRule: EntityAcceptRuleDefinition,
  resolveItemDomain: (itemId: string) => ItemDomain | null,
): boolean {
  if (acceptRule.exclude.includes(itemId)) {
    return false;
  }

  switch (acceptRule.base.kind) {
    case "domain":
      return ((resolveItemDomain(itemId) ?? 0) & acceptRule.base.flags) !== 0;
    case "item":
      return itemId === acceptRule.base.itemId;
    case "none":
      return false;
  }
}
