import { observer } from "mobx-react-lite";
import { useId, useState, type ReactNode } from "react";
import LucideBoxes from "~icons/lucide/boxes";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideChevronRight from "~icons/lucide/chevron-right";
import LucideFactory from "~icons/lucide/factory";
import LucideInfinity from "~icons/lucide/infinity";
import LucidePackagePlus from "~icons/lucide/package-plus";
import LucidePlus from "~icons/lucide/plus";
import LucideSprout from "~icons/lucide/sprout";
import LucideTrash2 from "~icons/lucide/trash-2";

import type { AppHost } from "@/app/host/app-host";
import { createProductionPlanningModule } from "@/app/shell/production-planning/production-planning-module";
import {
  computeItemDefaultPerMinute,
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  type ProductionPlanningIndex,
  type ProductionPlanningResult,
} from "@/app/shell/production-planning/production-planning-model";
import { NumberInput } from "@/app/shell/shared/number-input";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { recipeTreeOverlayState } from "./recipe-tree-state";

type Translate = (key: string) => string;

/**
 * 配方树的规划设置：外部供给、来源策略与模块。取代主体区域显示，作用于全部钉住目标。
 */
export const RecipeTreePlanSettings = observer(function RecipeTreePlanSettings({
  appHost,
  index,
  plan,
  t,
}: {
  appHost: AppHost;
  index: ProductionPlanningIndex;
  plan: ProductionPlanningResult | null;
  t: Translate;
}) {
  const state = recipeTreeOverlayState;
  const pickItem = async () => await appHost.encyclopediaPicker.pickItem({
    includeInactiveActivityItems: appHost.internalState.settings.toolboxShowAllActivityContent,
    title: t("encyclopediaPicker.title.item"),
  });
  const addSupply = async () => {
    const itemId = await pickItem();
    if (itemId !== null) {
      state.addSupply(itemId, computeItemDefaultPerMinute(itemId, index));
    }
  };
  const replaceSupplyItem = async (supplyId: string) => {
    const itemId = await pickItem();
    if (itemId !== null) {
      state.updateSupply(supplyId, { itemId });
    }
  };
  // 模块平衡打开转换出的模块草稿，用户在那里命名、确认后保存。
  const convertToModule = () => {
    if (plan === null) {
      return;
    }
    appHost.internalActions.openCustomModuleDraft(createProductionPlanningModule({
      index,
      plan,
      targets: state.pins.map((pin) => ({ id: pin.id, itemId: pin.itemId, perMinute: pin.perMinute })),
      translate: t,
    }));
  };

  return (
    <div className={cm(styles, "recipe-tree-body recipe-tree-plan-settings")}>
      <section className={cm(styles, "production-planning-config-section")}>
        <div className={cm(styles, "production-planning-section-header")}>
          <h3><LucidePackagePlus /><span>{t("productionPlanning.supplies")}</span></h3>
          <button className={cm(styles, "production-planning-icon-text-button")} onClick={() => void addSupply()} type="button">
            <LucidePlus />
            <span>{t("productionPlanning.addSupply")}</span>
          </button>
        </div>
        <div className={cm(styles, "production-planning-line-list")}>
          {state.supplies.map((supply) => (
            <div className={cm(styles, "production-planning-line-row has-infinite-toggle")} key={supply.id}>
              <button
                className={cm(styles, "production-planning-item-picker-button")}
                onClick={() => void replaceSupplyItem(supply.id)}
                type="button"
              >
                <img alt="" src={resolveProductionPlanningItemIconSrc(supply.itemId, index)} />
                <span>{resolveProductionPlanningItemName(supply.itemId, index, t)}</span>
              </button>
              <label className={cm(styles, "production-planning-rate-input")}>
                <span>{t("productionPlanning.perMinute")}</span>
                {supply.isInfinite === true ? (
                  <input disabled readOnly type="text" value="∞" />
                ) : (
                  <NumberInput
                    emptyFallback={0}
                    min={0}
                    onCommit={(perMinute) => state.updateSupply(supply.id, { perMinute })}
                    value={supply.perMinute}
                  />
                )}
              </label>
              <button
                aria-label={t("productionPlanning.infinite")}
                aria-pressed={supply.isInfinite === true}
                className={cm(styles, [
                  "production-planning-icon-button production-planning-infinite-toggle",
                  supply.isInfinite === true ? "is-active" : "",
                ].filter(Boolean).join(" "))}
                onClick={() => state.updateSupply(supply.id, { isInfinite: supply.isInfinite !== true })}
                title={t("productionPlanning.infinite")}
                type="button"
              >
                <LucideInfinity />
              </button>
              <button
                aria-label={t("productionPlanning.remove")}
                className={cm(styles, "production-planning-icon-button")}
                onClick={() => state.removeSupply(supply.id)}
                title={t("productionPlanning.remove")}
                type="button"
              >
                <LucideTrash2 />
              </button>
            </div>
          ))}
        </div>
      </section>
      <SourcePolicySection index={index} t={t} />
      <section className={cm(styles, "production-planning-config-section")}>
        <div className={cm(styles, "recipe-tree-plan-settings-modules")}>
          <label className={cm(styles, "production-planning-module-toggle")}>
            <input
              checked={state.useModules}
              onChange={(event) => state.setUseModules(event.currentTarget.checked)}
              role="switch"
              type="checkbox"
            />
            <span aria-hidden="true" className={cm(styles, "production-planning-switch-track")}>
              <span className={cm(styles, "production-planning-switch-thumb")} />
            </span>
            <span>{t("productionPlanning.useModules")}</span>
          </label>
          <button
            className={cm(styles, "production-planning-icon-text-button")}
            disabled={plan === null || plan.cycleIssues.length > 0}
            onClick={convertToModule}
            type="button"
          >
            <LucideBoxes />
            <span>{t("productionPlanning.convertToModule")}</span>
          </button>
        </div>
      </section>
    </div>
  );
});

const SourcePolicySection = observer(function SourcePolicySection({
  index,
  t,
}: {
  index: ProductionPlanningIndex;
  t: Translate;
}) {
  const state = recipeTreeOverlayState;
  const sourceConfig = state.sourceConfig;
  const resourceListId = useId();
  const [expandedCategories, setExpandedCategories] = useState<readonly string[]>([]);
  const byproductOptions = [
    { value: "use-byproduct", label: t("productionPlanning.byproductUse") },
    { value: "dump-byproduct", label: t("productionPlanning.byproductDump") },
  ] as const;

  return (
    <section className={cm(styles, "production-planning-config-section")}>
      <div className={cm(styles, "production-planning-section-header")}>
        <h3><LucideInfinity /><span>{t("productionPlanning.sourcePolicy")}</span></h3>
      </div>
      <div className={cm(styles, "production-planning-source-policy")}>
        {[
          { label: "productionPlanning.naturalResources", items: index.naturalResourceItemIds, icon: <LucideBoxes /> },
          { label: "productionPlanning.crops", items: index.cropItemIds, icon: <LucideSprout /> },
        ].map(({ label, items, icon }) => {
          const expanded = items.size > 0 && expandedCategories.includes(label);
          const contentId = `${resourceListId}-${label}`;
          return (
            <div aria-label={t(label)} className={cm(styles, "production-planning-source-pill")} key={label} role="group">
              <button
                aria-controls={contentId}
                aria-expanded={expanded}
                className={cm(styles, "production-planning-resource-label")}
                disabled={items.size === 0}
                onClick={() => setExpandedCategories((current) => current.includes(label)
                  ? current.filter((category) => category !== label)
                  : [...current, label])}
                type="button"
              >
                <span className={cm(styles, "production-planning-resource-category")}>
                  <span aria-hidden="true">{icon}</span>
                  <span className={cm(styles, "production-planning-resource-summary")}>
                    <span>{t(label)}</span>
                    <span className={cm(styles, "production-planning-resource-count")}>
                      {t("productionPlanning.itemCount").replace("{count}", String(items.size))}
                    </span>
                  </span>
                </span>
                <span className={cm(styles, "production-planning-resource-disclosure")}>
                  <span>{t(expanded ? "productionPlanning.collapseItems" : "productionPlanning.viewItems")}</span>
                  {expanded ? <LucideChevronDown aria-hidden="true" /> : <LucideChevronRight aria-hidden="true" />}
                </span>
              </button>
              <div className={cm(styles, "production-planning-natural-resource-icons")} hidden={!expanded} id={contentId}>
                {expanded && Array.from(items).map((itemId) => (
                  <img
                    alt={resolveProductionPlanningItemName(itemId, index, t)}
                    key={itemId}
                    src={resolveProductionPlanningItemIconSrc(itemId, index)}
                    title={resolveProductionPlanningItemName(itemId, index, t)}
                  />
                ))}
              </div>
            </div>
          );
        })}
        <PolicyRow
          iconSrc={resolveProductionPlanningItemIconSrc("item_liquid_water", index)}
          label={resolveProductionPlanningItemName("item_liquid_water", index, t)}
          onChange={(waterPolicy) => state.setSourceConfig({ waterPolicy })}
          options={byproductOptions}
          value={sourceConfig.waterPolicy}
        />
        <PolicyRow
          iconSrc={resolveProductionPlanningItemIconSrc("item_liquid_acid", index)}
          label={resolveProductionPlanningItemName("item_liquid_acid", index, t)}
          onChange={(acidPolicy) => state.setSourceConfig({ acidPolicy })}
          options={byproductOptions}
          value={sourceConfig.acidPolicy}
        />
        <PolicyRow
          iconSrc={resolveProductionPlanningItemIconSrc("item_liquid_sewage", index)}
          label={resolveProductionPlanningItemName("item_liquid_sewage", index, t)}
          onChange={(sewagePolicy) => state.setSourceConfig({ sewagePolicy })}
          options={[
            { value: "external-supply", label: t("productionPlanning.externalSupply") },
            { value: "self-produce", label: t("productionPlanning.selfProduce") },
          ]}
          value={sourceConfig.sewagePolicy}
        />
        <PolicyRow
          iconSrc={resolveProductionPlanningEntityIconSrc("water_purifier_node_1", index)}
          label={t("productionPlanning.waterPurifierNode")}
          onChange={(waterPurifierPolicy) => state.setSourceConfig({ waterPurifierPolicy })}
          options={[
            { value: "disabled", label: t("productionPlanning.waterPurifierDisabled") },
            { value: "use-when-available", label: t("productionPlanning.waterPurifierUseWhenAvailable") },
          ]}
          value={sourceConfig.waterPurifierPolicy}
        />
        <PolicyRow
          icon={<LucideFactory />}
          label={t("productionPlanning.deviceMinimumConsumption")}
          onChange={(includeDeviceMinimumConsumption) => state.setSourceConfig({ includeDeviceMinimumConsumption })}
          options={[
            { value: "none", label: t("productionPlanning.deviceMinimumConsumptionDisabled") },
            { value: "fractional", label: t("productionPlanning.deviceMinimumConsumptionEnabled") },
            { value: "ceil", label: t("productionPlanning.deviceMinimumConsumptionRoundedUp") },
          ]}
          value={sourceConfig.includeDeviceMinimumConsumption}
        />
      </div>
    </section>
  );
});

function PolicyRow<T extends string>({
  icon,
  iconSrc,
  label,
  onChange,
  options,
  value,
}: {
  icon?: ReactNode;
  iconSrc?: string;
  label: string;
  onChange: (value: T) => void;
  options: readonly { readonly value: T; readonly label: string }[];
  value: T;
}) {
  return (
    <div className={cm(styles, "production-planning-special-source")}>
      <div className={cm(styles, "production-planning-special-source-label")}>
        {iconSrc === undefined ? icon : <img alt="" src={iconSrc} />}
        <span>{label}</span>
      </div>
      <div className={cm(styles, "production-planning-two-option-toggle")}>
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={cm(styles, value === option.value ? "is-active" : "")}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
