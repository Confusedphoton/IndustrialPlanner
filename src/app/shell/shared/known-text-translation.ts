import type { BaseDefinition } from "@/domain/registry/types/base-definition";

type Translate = (key: string) => string;

/**
 * 编辑器与基地注册表以中文写入、并会随文档/历史持久化的固定文案。
 * 这些文本属于数据而非界面代码，显示时按原文映射到 i18n 键；未登记的文本原样显示。
 */
const KNOWN_TEXT_KEYS: Readonly<Record<string, string>> = {
  // 历史记录标签（src/editor/actions）
  "修改设备配置": "historyLabel.editConfig",
  "切换设备模式": "historyLabel.switchMode",
  "创建仓库物品链接": "historyLabel.createDepotLink",
  "创建暗管链接": "historyLabel.createConduitLink",
  "删除区域": "historyLabel.deleteRegion",
  "创建区域": "historyLabel.createRegion",
  "编辑区域": "historyLabel.editRegion",
  "删除设备": "historyLabel.deleteDevice",
  "删除整段": "historyLabel.deleteLine",
  "删除设备配置键": "historyLabel.clearConfig",
  "放置蓝图": "historyLabel.placeBlueprint",
  "放置设备": "historyLabel.placeDevice",
  "断开暗管链接": "historyLabel.unlinkConduit",
  "旋转设备": "historyLabel.rotateDevice",
  "移动设备": "historyLabel.moveDevice",
  "移除仓库物品链接": "historyLabel.removeDepotLink",
  "铺设物流": "historyLabel.layLogistics",
  "清理已重新配置的暗管链接": "historyLabel.cleanConduitLinks",
  // 放置校验原因（src/editor/placement-validation.ts）
  "必须靠近地图边缘放置": "placementReason.edgeSnap",
  "必须放置在基地内": "placementReason.outsideBase",
  "不能与其他设备重叠": "placementReason.overlap",
  "未有效连接到源桩": "placementReason.busDisconnected",
  "附近有同类设备": "placementReason.nearSameEntity",
};

/** 基地 ID → 名称键；与 src/registry/base-definition.ts 保持一致。 */
const BASE_NAME_KEYS: Readonly<Record<string, string>> = {
  wuling_protocol_core: "workbench.base.protocolCore",
  wuling_tianwangping_aid: "workbench.base.tianwangpingAid",
  wuling_heart_repair_station: "workbench.base.heartRepairStation",
  stm_hongs_3: "workbench.base.xiranflowCloudseeder",
  wuling_agricultural_land: "workbench.base.agriculturalLand",
  valley4_protocol_core: "workbench.base.protocolCore",
  valley4_refugee_shelter: "workbench.base.refugeeOutpost",
  valley4_infra_outpost: "workbench.base.infraForward",
  valley4_rebuilt_command: "workbench.base.rebuildHQ",
  draft_box: "workbench.base.draftBox",
};

/** 基地分组标签（地区）→ 名称键。 */
const BASE_TAG_KEYS: Readonly<Record<string, string>> = {
  "四号谷地": "workbench.base.valley4",
  "武陵": "workbench.base.wuling",
  "草稿箱": "workbench.base.draftBox",
};

export function translateKnownText(text: string, translate: Translate): string {
  const key = KNOWN_TEXT_KEYS[text];
  return key === undefined ? text : translate(key);
}

export function resolveBaseDisplayName(
  base: Pick<BaseDefinition, "id" | "name">,
  translate: Translate,
): string {
  const key = BASE_NAME_KEYS[base.id];
  return key === undefined ? base.name : translate(key);
}

export function resolveBaseTagLabel(tag: string, translate: Translate): string {
  const key = BASE_TAG_KEYS[tag];
  return key === undefined ? tag : translate(key);
}
