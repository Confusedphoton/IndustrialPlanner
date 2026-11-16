import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import type { PlacementGroup } from "@/app/state/state-impl";
import type { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { EntityVariantDefinition } from "@/domain/registry/types/entity-variant-definition";
import {
  collapseEntityVariantDefinitions,
  resolveEntityCraftGroupKey,
  resolveEntityVariantDefinitions,
  resolveEntityVariantName,
} from "@/shared/entity-variants";
import type { ComponentProps } from "react";

/**
 * 放置目录：当前基地可放置的设备按分类分组，可切换模式的设备按设置折叠为一项。
 * 放置面板、环形菜单与设备架共用同一份分类与顺序。
 */
// ─── uiGroup → 分组配置映射 ───
const UI_GROUP_SECTION_CONFIG: Record<PlacementGroup, {
  titleKey: string;
  shortcutKeyId?: ShortcutKeyId;
}> = {
  beltLogistics: {
    titleKey: "workbench.section.beltLogistics",
    shortcutKeyId: SHORTCUT_KEY.PLACE_CONVEYOR,
  },
  pipeLogistics: {
    titleKey: "workbench.section.pipeLogistics",
    shortcutKeyId: SHORTCUT_KEY.PLACE_PIPE,
  },
  resourcePower: {
    titleKey: "workbench.section.resourcePower",
    shortcutKeyId: SHORTCUT_KEY.RESOURCES_POWER,
  },
  warehouse: {
    titleKey: "workbench.section.warehouse",
    shortcutKeyId: SHORTCUT_KEY.WAREHOUSE,
  },
  basicProduction: {
    titleKey: "workbench.section.production",
    shortcutKeyId: SHORTCUT_KEY.BASIC_PRODUCTION,
  },
  advancedManufacturing: {
    titleKey: "workbench.section.advancedManufacturing",
    shortcutKeyId: SHORTCUT_KEY.SYNTHESIS,
  },
  agriculture: {
    titleKey: "workbench.section.agriculture",
  },
  cheat: {
    titleKey: "workbench.section.cheat",
    shortcutKeyId: SHORTCUT_KEY.CHEAT,
  },
};

/** 设备分组在面板中的显示顺序 */
const DEVICE_SECTION_ORDER: readonly PlacementGroup[] = [
  "beltLogistics",
  "pipeLogistics",
  "resourcePower",
  "warehouse",
  "basicProduction",
  "advancedManufacturing",
  "agriculture",
  "cheat",
];

// ─── 类型定义 ───

export interface PlacementButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: string;
  readonly entityVariant?: EntityVariantDefinition;
  readonly craftGroupKey?: string;
  readonly variantDefinitions?: readonly EntityDefinition[];
  readonly icon?: ComponentProps<typeof WorkbenchIcon>["kind"];
  readonly iconSrc?: string;
  readonly hotkey?: string | null;
  readonly hotkeyKeyId?: ShortcutKeyId;
  readonly visibleWhen?: (appHost: AppHost) => boolean;
  readonly activeWhen?: (appHost: AppHost) => boolean;
}

export interface PlacementSectionDefinition {
  readonly uiGroup: PlacementGroup;
  readonly titleKey: string;
  readonly shortcutKey: string | null;
  readonly buttons: readonly PlacementButtonDefinition[];
}

// ─── 动态构建设备分组 ───

export function buildPlacementDeviceSections(appHost: AppHost): readonly PlacementSectionDefinition[] {
  // 1. 按 uiGroup 分组设备（过滤 hidden，组内按 id 排序）
  const groupedByUiGroup = new Map<PlacementGroup, EntityDefinition[]>();
  for (const group of DEVICE_SECTION_ORDER) {
    groupedByUiGroup.set(group, []);
  }

  for (const entity of appHost.workspace.registry.entityDefinitions) {
    if (entity.uiGroup === "hidden") continue;
    if (entity.tags.includes("不可摆放")) continue;
    if (!canPlaceEntityDefinitionInCurrentBase(appHost.mainCanvas, entity)) continue;
    const group = groupedByUiGroup.get(entity.uiGroup);
    if (group) {
      group.push(entity);
    }
  }

  // 组内按 displayOrder 排序（order 越小越靠前），同 order 按 id 兜底
  for (const [, entities] of groupedByUiGroup) {
    entities.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  }

  // 2. 构建设备分组 section
  const deviceSections: PlacementSectionDefinition[] = DEVICE_SECTION_ORDER
    .map((uiGroup) => {
      const config = UI_GROUP_SECTION_CONFIG[uiGroup];
      const entities = groupedByUiGroup.get(uiGroup) ?? [];
      const shortcutKey = config.shortcutKeyId === undefined
        ? null
        : appHost.internalActions.getKeyboardShortcutFor(config.shortcutKeyId);

      const visibleEntities = appHost.state.settings.collapseDeviceModes
        ? collapseEntityVariantDefinitions({
            definitions: entities,
            selectedVariantNameByCraftGroup:
              appHost.state.workbench.selectedPlacementVariantByCraftGroup,
          })
        : entities;
      const buttons: PlacementButtonDefinition[] = visibleEntities.map((entity) => {
        const variantDefinitions = resolveEntityVariantDefinitions({
          definitionId: entity.id,
          definitions: entities,
        });
        const variantName = resolveEntityVariantName(entity);
        const entityVariant = variantDefinitions.length > 1 && variantName !== null
          ? appHost.workspace.registry.entityVariantDefinitions[variantName]
          : undefined;

        return {
          uiButtonId: `placement-${entity.id}`,
          labelKey: entity.nameKey,
          entityVariant,
          craftGroupKey: entityVariant === undefined
            ? undefined
            : resolveEntityCraftGroupKey(entity) ?? undefined,
          variantDefinitions: entityVariant === undefined ? undefined : variantDefinitions,
        };
      });

      return {
        uiGroup,
        titleKey: config.titleKey,
        shortcutKey: shortcutKey || null,
        buttons,
      };
    })
    .filter((section) => section.buttons.length > 0);

  return deviceSections;
}


