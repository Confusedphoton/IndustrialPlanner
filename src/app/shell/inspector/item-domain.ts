import type { ItemDomain } from "@/domain/registry/types/entity-definition";
import type { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";

export type InspectorItemDomainFilter = ItemDomainFlag;

export function matchesItemDomainFilter(
  item: ItemDefinition,
  domain: InspectorItemDomainFilter,
  resolveItemDomain: (itemId: string) => ItemDomain | null,
): boolean {
  const itemDomain = resolveItemDomain(item.id);
  return itemDomain !== null && (itemDomain & domain) !== 0;
}
