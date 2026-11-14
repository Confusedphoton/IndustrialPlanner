export { buildRegionalWarehouseOutletTable } from "./warehouse-outlet-table";
export type {
  RegionalAdmissionDiagnostic,
  RegionalAdmissionResult,
} from "./warehouse-outlet-table";
export {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
} from "./warehouse-arbiter";

export { aggregateRegionalWarehouseStats } from "./warehouse-stats";



export type {
  RegionWarehouseAckBatch,
  RegionWarehouseArbitrationResult,
  RegionWarehouseAuthorityState,
  RegionWarehouseCommitProposal,
  RegionWarehouseDemandBatch,
  RegionWarehouseDeposit,
  RegionWarehouseGrantBatch,
  RegionalSimulationTopologyInput,
  RegionalWarehouseOutlet,
  RegionalWarehouseOutletIdentity,
  RegionalWarehouseOutletTable,
} from "./types";
export { normalizeRegionNumber } from "./types";
