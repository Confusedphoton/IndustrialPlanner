import { makeAutoObservable } from "mobx";
import {
  readRegionalMultiBaseExperimentalEnabled,
} from "@/shared/storage/regional-simulation-settings";

/**
 * 区域多基地仿真的 App 层 UI 状态。
 * 实验性总开关由设置对话框控制器写入；基地面板开关只在 stop 状态可写。
 */
class RegionalSimulationUiState {
  /** “允许多个基地同时运行”实验性设置；持久化到本地设置。 */
  public experimentalEnabled = false;

  public constructor() {
    makeAutoObservable(this);
  }

  public loadPersisted(): void {
    this.experimentalEnabled = readRegionalMultiBaseExperimentalEnabled();
  }

  public reset(): void {
    this.experimentalEnabled = false;
  }
}

export const regionalSimulationUiState = new RegionalSimulationUiState();
