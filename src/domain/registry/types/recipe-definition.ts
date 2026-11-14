export type RecipeType = "immediate-consume" | "reserved-item";

export interface RecipeDefinition {
  id: string;
  nameKey: string;
  durationSeconds: number;
  inputs: Array<{ itemId: string; amount: number }>;
  outputs: Array<{ itemId: string; amount: number }>;
  machineId: string;
  recipeType: RecipeType;
  tags: string[];
  /** 启动选择概率，1 表示 100%；省略为普通配方，允许任意有限正数。 */
  probability?: number;
  /** 配方运行时发电量（kW），默认 0。仅供发电设备配方使用。 */
  powerOutput?: number;
  /** 配方运行/启动所需气体扩散范围。值为气体物品 ID。 */
  requiredEnvironmentAnyOf?: readonly string[];
  /** 配方运行期间提供的气体扩散范围。仅供气体扩散设备配方使用。 */
  environmentOutput?: {
    readonly itemId: string;
    readonly rangeId: string;
  };
  /** 产物提交目标；省略时写入设备的产物缓存。 */
  outputTarget?: "device" | "warehouse";
  /** 主要产物物品 ID 列表。与 outputs 可以不同，用于仿真运行时的设备图标替换。 */
  primaryOutputs?: string[];
}
