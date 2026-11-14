import type { RegistryQuery } from "@/domain/registry/registry-query";
import {
  LOGISTICS_KIND,
  type LogisticsKind,
} from "@/domain/shared/logistics";

type LogisticsClassificationQuery = Pick<
  RegistryQuery,
  "isBeltFamily" | "isBeltLogistics" | "isPipeFamily" | "isPipeLogistics"
>;


/** 解析完整物流族；传送带族和管道设备族都包含各自的节与物流设备。 */
export function resolveLogisticsSuppressionKind(
  definitionId: string,
  queries: LogisticsClassificationQuery,
): LogisticsKind | null {
  if (queries.isBeltFamily(definitionId)) {
    return LOGISTICS_KIND.belt;
  }
  if (queries.isPipeFamily(definitionId)) {
    return LOGISTICS_KIND.pipe;
  }

  return null;
}

/**
 * 解析物流设备所属类型。
 * 传送带物流设备不包括传送带节，管道物流设备不包括管道节。
 */
export function resolveLogisticsEquipmentSuppressionKind(
  definitionId: string,
  queries: LogisticsClassificationQuery,
): LogisticsKind | null {
  if (queries.isBeltLogistics(definitionId)) {
    return LOGISTICS_KIND.belt;
  }
  if (queries.isPipeLogistics(definitionId)) {
    return LOGISTICS_KIND.pipe;
  }

  return null;
}

export function isLogisticsDefinitionSuppressed(options: {
  readonly definitionId: string;
  readonly suppressBelts: boolean;
  readonly suppressPipes: boolean;
  readonly queries: LogisticsClassificationQuery;
}): boolean {
  const family = resolveLogisticsSuppressionKind(options.definitionId, options.queries);
  return (
    (family === LOGISTICS_KIND.belt && options.suppressBelts)
    || (family === LOGISTICS_KIND.pipe && options.suppressPipes)
  );
}
