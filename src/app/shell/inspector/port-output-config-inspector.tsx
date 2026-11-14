import { useState } from "react";

import LucideCircleDashed from "~icons/lucide/circle-dashed";
import LucidePencil from "~icons/lucide/pencil";
import LucideTrash2 from "~icons/lucide/trash-2";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { PortOutputConfigInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { rotateGridRotation } from "@/shared/geometry/grid";
import {
  resolveOutputGroupRows,
  resolveOutputPortSideLabels,
  type OutputGroupRow,
} from "@/app/shell/inspector/port-output-config-model";
import { PortOutputLocatorBadge } from "@/app/shell/inspector/port-output-locator-badge";
import {
  useInspectorRenderMode,
} from "@/app/shell/inspector/selection-inspector-model";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { matchesItemAcceptRule } from "./item-domain";


function resolveItemIconSrc(item: ItemDefinition | null): string | null {
  return item === null ? null : createItemIconAssetUrl(item.iconId);
}

export function PortOutputConfigInspector({
  appHost,
  declaration,
  entity,
  definition,
  translate,
}: {
  appHost: AppHost;
  declaration: PortOutputConfigInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const rows = resolveOutputGroupRows(
    definition,
    declaration.portGroupIds,
    entity,
  );
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";
  const displayRotation = appHost.mainCanvas.view.state.displayRotation;
  const locatorRotation = rotateGridRotation(entity.rotation, displayRotation);
  // 输出端口按屏幕方位命名（取代 P# 序号）。
  const sideLabels = resolveOutputPortSideLabels({ definition, rows, rotation: locatorRotation, translate });

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const requestItemSelection = async (row: OutputGroupRow) => {
    setPendingGroupId(row.portGroup.id);

    try {
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item: ItemDefinition) =>
          matchesOutputPortGroupAcceptRule(
            item,
            row,
            appHost.workspace.registry.queries.resolveItemDomain,
          ),
      });

      if (itemId === null) {
        return;
      }

      // 为端口组内所有端口写入 acceptRule
      const patch: Record<string, unknown> = {};
      for (let portIndex = 0; portIndex < row.portGroup.ports.length; portIndex += 1) {
        const configPath = `portGroups[${row.groupIndex}].ports[${portIndex}].acceptRule`;
        patch[configPath] = {
          base: { kind: "item", itemId },
          exclude: [],
        };
      }
      patchEntityConfig(patch);
    } finally {
      setPendingGroupId((current) =>
        current === row.portGroup.id ? null : current,
      );
    }
  };

  const clearSelection = (row: OutputGroupRow) => {
    // 清除端口组内所有端口的 acceptRule 覆盖
    const keys: string[] = [];
    for (let portIndex = 0; portIndex < row.portGroup.ports.length; portIndex += 1) {
      keys.push(`portGroups[${row.groupIndex}].ports[${portIndex}].acceptRule`);
    }
    appHost.workspace.editor?.actions.deleteEntityConfigKeys(entity.id, keys);
  };

  if (rows.length === 0) {
    return (
      <InspectorCollapsiblePanel
        dataInspectorKey="port-output-config"
        title={translate("inspectorText.outputPorts")}
      >
        <p>{translate("inspectorText.thisDeviceHasNoConfigurableOutput")}</p>
      </InspectorCollapsiblePanel>
    );
  }

  return (
    <InspectorCollapsiblePanel
      bodyClassName="port-output-panel-body"
      className="port-output-config-inspector"
      data-inspector-key="port-output-config"
      dataInspectorKey="port-output-config"
      data-device-class={deviceClass}
      data-render-mode={mode}
      title={translate("inspectorText.outputPorts")}
    >
      <div className={cm(styles, "port-output-list")}>
        {rows.map((row) => {
          const itemDefinition =
            row.currentItemId === null
              ? null
              : itemById.get(row.currentItemId) ?? null;
          const itemIconSrc = resolveItemIconSrc(itemDefinition);
          const itemLabel =
            itemDefinition === null
              ? translate("inspectorText.notSet")
              : translate(itemDefinition.nameKey);
          const configured = row.currentItemId !== null;


          return (
            <div
              className={cm(styles, "port-output-row")}
              data-port-group-id={row.portGroup.id}
              data-is-pipe={row.portGroup.isPipe ? "true" : "false"}
              key={row.portGroup.id}
            >
              {/* 定位标识可点击，与物品区一致地打开物品选择。 */}
              <button
                className={cm(styles, "port-output-locator-button")}
                onClick={() => {
                  void requestItemSelection(row);
                }}
                type="button"
              >
                <PortOutputLocatorBadge
                  definition={definition}
                  portLabel={sideLabels.get(row.portGroup.id) ?? row.portLabel}
                  rows={rows}
                  rotation={locatorRotation}
                  targetPortGroupId={row.portGroup.id}
                  title={`${sideLabels.get(row.portGroup.id) ?? row.portLabel} · ${translate(row.label)}`}
                />
              </button>
              <button
                className={cm(styles, "port-output-item-button")}
                data-slot-action="pick-item"
                disabled={pendingGroupId === row.portGroup.id}
                onClick={() => {
                  void requestItemSelection(row);
                }}
                title={itemLabel}
                type="button"
              >
                <span className={cm(styles, "port-output-item-icon")}>
                  {itemIconSrc === null ? (
                    <LucideCircleDashed aria-hidden="true" />
                  ) : (
                    <img alt="" src={itemIconSrc} />
                  )}
                </span>
                <span className={cm(styles, "port-output-item-name")}>{itemLabel}</span>
              </button>
              <button
                className={cm(styles, "port-output-action-button port-output-change-button")}
                aria-label={translate("inspectorText.change")}
                data-slot-action="pick-item"
                disabled={pendingGroupId === row.portGroup.id}
                onClick={() => {
                  void requestItemSelection(row);
                }}
                title={translate("inspectorText.change")}
                type="button"
              >
                <LucidePencil aria-hidden="true" />
                <span className={cm(styles, "port-output-action-label")}>{translate("inspectorText.change")}</span>
              </button>
              <button
                className={cm(styles, "port-output-action-button port-output-clear-button")}
                aria-label={translate("inspectorText.clear")}
                data-slot-action="clear-item"
                disabled={!configured}
                onClick={() => {
                  clearSelection(row);
                }}
                title={translate("inspectorText.clear")}
                type="button"
              >
                <LucideTrash2 aria-hidden="true" />
                <span className={cm(styles, "port-output-action-label")}>{translate("inspectorText.clear")}</span>
              </button>
            </div>
          );
        })}
      </div>
    </InspectorCollapsiblePanel>
  );
}

function matchesOutputPortGroupAcceptRule(
  item: ItemDefinition,
  row: OutputGroupRow,
  resolveItemDomain: Parameters<typeof matchesItemAcceptRule>[2],
): boolean {
  const firstPort = row.portGroup.ports[0];
  if (firstPort === undefined) {
    return true;
  }

  if (firstPort.acceptRule.base.kind === "none") {
    const itemDomain = resolveItemDomain(item.id);
    const fallbackFlags = row.portGroup.isPipe
      ? ItemDomainFlag.Liquid
      : row.portGroup.kind;
    return itemDomain !== null && (fallbackFlags & itemDomain) !== 0;
  }

  return matchesItemAcceptRule(item, firstPort.acceptRule, resolveItemDomain);
}
