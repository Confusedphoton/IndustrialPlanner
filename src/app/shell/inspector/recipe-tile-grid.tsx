import { useMemo, useState } from "react";
import LucideArrowRight from "~icons/lucide/arrow-right";
import LucideX from "~icons/lucide/x";

import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import {
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  resolveProductionPlanningRecipeName,
  type ProductionPlanningIndex,
} from "@/app/shell/production-planning/production-planning-model";
import { sortRecipesByDefaultPriority } from "@/shared/registry/recipe-visibility";
import styles from "@/app/shell/inspector/inspector.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

/** 配方数量超过该值时显示筛选框。 */
const RECIPE_TILE_FILTER_THRESHOLD = 9;

/**
 * 设备配方单击选择网格。
 *
 * 取代“添加配方 → 配方选择对话框 → 搜索 → 选择”的多步流程：设备可执行的配方直接平铺为图标磁贴，
 * 单击即选中；再次单击已选磁贴取消选择。磁贴尺寸按笔/触控命中区域设计，鼠标与键盘同样可用。
 */
export function RecipeTileGrid({
  recipes,
  selectedRecipeId,
  onSelect,
  index,
  t,
}: {
  recipes: readonly RecipeDefinition[];
  selectedRecipeId: string | null;
  onSelect: (recipeId: string | null) => void;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  const [query, setQuery] = useState("");
  const sortedRecipes = useMemo(() => sortRecipesByDefaultPriority(recipes), [recipes]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRecipes = normalizedQuery.length === 0
    ? sortedRecipes
    : sortedRecipes.filter((recipe) => (
      resolveProductionPlanningRecipeName(recipe, index, t).toLowerCase().includes(normalizedQuery)
      || [...recipe.inputs, ...recipe.outputs].some((flow) => (
        resolveProductionPlanningItemName(flow.itemId, index, t).toLowerCase().includes(normalizedQuery)
      ))
    ));

  // 同一产物有多条配方时，用主要原料区分，避免只能靠小图标辨认。
  const outputNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const recipe of sortedRecipes) {
      const outputId = recipe.outputs.find((flow) => index.itemById.has(flow.itemId))?.itemId;
      if (outputId !== undefined) {
        counts.set(outputId, (counts.get(outputId) ?? 0) + 1);
      }
    }
    return counts;
  }, [index, sortedRecipes]);

  if (recipes.length === 0) {
    return null;
  }

  return (
    <div className={cm(styles, "recipe-tile-grid-shell")}>
      {recipes.length > RECIPE_TILE_FILTER_THRESHOLD ? (
        <input
          aria-label={t("inspector.recipeTiles.filter")}
          className={cm(styles, "recipe-tile-filter")}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            const first = visibleRecipes[0];
            if (event.key === "Enter" && first !== undefined) {
              onSelect(first.id);
            }
          }}
          placeholder={t("inspector.recipeTiles.filter")}
          type="search"
          value={query}
        />
      ) : null}
      <div className={cm(styles, "recipe-tile-grid")} role="listbox" aria-label={t("inspector.recipeTiles.label")}>
        {visibleRecipes.map((recipe) => {
          const selected = recipe.id === selectedRecipeId;
          const outputs = recipe.outputs.filter((flow) => index.itemById.has(flow.itemId));
          const name = resolveProductionPlanningRecipeName(recipe, index, t);
          const primaryOutput = outputs[0];
          const primaryInput = recipe.inputs.find((flow) => index.itemById.has(flow.itemId));
          const variantLabel = primaryOutput !== undefined
            && primaryInput !== undefined
            && (outputNameCounts.get(primaryOutput.itemId) ?? 0) > 1
            ? t("inspector.recipeTiles.fromInput").replace("{item}", resolveProductionPlanningItemName(primaryInput.itemId, index, t))
            : null;
          return (
            <button
              aria-selected={selected}
              className={cm(styles, `recipe-tile${selected ? " is-selected" : ""}`)}
              data-recipe-id={recipe.id}
              key={recipe.id}
              onClick={() => onSelect(selected ? null : recipe.id)}
              role="option"
              title={`${name} · ${recipe.durationSeconds}s`}
              type="button"
            >
              <span className={cm(styles, "recipe-tile-formula")}>
                <span className={cm(styles, "recipe-tile-inputs")}>
                  {recipe.inputs.slice(0, 3).map((flow) => (
                    <span className={cm(styles, "recipe-tile-input")} key={flow.itemId}>
                      <img alt="" src={resolveProductionPlanningItemIconSrc(flow.itemId, index)} />
                      {flow.amount > 1 ? <small>{flow.amount}</small> : null}
                    </span>
                  ))}
                </span>
                {recipe.inputs.length > 0 ? <LucideArrowRight aria-hidden="true" className={cm(styles, "recipe-tile-arrow")} /> : null}
                <span className={cm(styles, "recipe-tile-outputs")}>
                  {outputs.slice(0, 2).map((flow) => (
                    <span className={cm(styles, "recipe-tile-output")} key={flow.itemId}>
                      <img alt="" src={resolveProductionPlanningItemIconSrc(flow.itemId, index)} />
                      {flow.amount > 1 ? <small>{flow.amount}</small> : null}
                    </span>
                  ))}
                </span>
              </span>
              <span className={cm(styles, "recipe-tile-name")}>
                {primaryOutput === undefined ? name : resolveProductionPlanningItemName(primaryOutput.itemId, index, t)}
              </span>
              {variantLabel === null ? null : <span className={cm(styles, "recipe-tile-variant")}>{variantLabel}</span>}
              <span className={cm(styles, "recipe-tile-duration")}>{recipe.durationSeconds}s</span>
            </button>
          );
        })}
      </div>
      {selectedRecipeId !== null ? (
        <button
          className={cm(styles, "recipe-tile-clear")}
          onClick={() => onSelect(null)}
          type="button"
        >
          <LucideX aria-hidden="true" />
          <span>{t("inspector.recipeTiles.clear")}</span>
        </button>
      ) : null}
    </div>
  );
}
