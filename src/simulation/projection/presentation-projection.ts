import type {
  RuntimeDeviceSnapshot,
  RuntimeSlotSnapshot,
  RuntimeNodeSnapshot,
  RuntimeTransferSnapshot,
  RuntimeDiagnosticSnapshot,
  RuntimeEnvironmentSnapshot,
  WarehouseStats,
} from "@/simulation/contracts";

export interface SimulationPresentationProjection {
  readonly tickNumber: number | null;
  readonly standardTickRate: number | null;
  readonly tickRate: number | null;
  readonly status: "initial" | "running" | null;
  readonly debugData: string | undefined;
  readonly totalPowerDemand: number | null;
  readonly currentPowerGeneration: number | null;
  readonly isPowerOutage: boolean;
  readonly baseBatteryJoules: number;
  readonly baseBatteryCapacity: number;
  getSlot(slotId: string): RuntimeSlotSnapshot | null;
  getDevice(deviceId: string): RuntimeDeviceSnapshot | null;
  /** 读取展示设备及其显式携带的远端状态源；不扩张普通展示投影。 */
  getOperatingStatusDevice(deviceId: string): RuntimeDeviceSnapshot | null;
  getNode(nodeId: string): RuntimeNodeSnapshot | null;
  getTransportComponentItemType(componentId: string): string | null;
  getTransfers(): readonly RuntimeTransferSnapshot[];
  getDiagnostics(): readonly RuntimeDiagnosticSnapshot[];
  getGasDiffusions(): readonly RuntimeEnvironmentSnapshot[];
  getWarehouseStats(): WarehouseStats | null;
}

