import { useMemo, useState } from "react";
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
 * 2026-11-13：设备配方单击选择网格。
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
              <span className={cm(styles, "recipe-tile-outputs")}>
                {outputs.slice(0, 2).map((flow) => (
                  <span className={cm(styles, "recipe-tile-output")} key={flow.itemId}>
                    <img alt="" src={resolveProductionPlanningItemIconSrc(flow.itemId, index)} />
                    {flow.amount > 1 ? <small>{flow.amount}</small> : null}
                  </span>
                ))}
              </span>
              <span className={cm(styles, "recipe-tile-name")}>
                {outputs[0] === undefined ? name : resolveProductionPlanningItemName(outputs[0].itemId, index, t)}
              </span>
              <span className={cm(styles, "recipe-tile-inputs")}>
                {recipe.inputs.slice(0, 4).map((flow) => (
                  <span className={cm(styles, "recipe-tile-input")} key={flow.itemId}>
                    <img alt="" src={resolveProductionPlanningItemIconSrc(flow.itemId, index)} />
                    {flow.amount}
                  </span>
                ))}
                <span className={cm(styles, "recipe-tile-duration")}>{recipe.durationSeconds}s</span>
              </span>
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
