import type { ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { MouseShortcutInput } from "@/app/shell/shared";
import type { UiKey } from "@/shared/i18n";


export type CanvasRightDockToolbarShortcutPartDefinition =
  | {
    readonly kind: "shortcut-key";
    readonly shortcutKeyId: ShortcutKeyId;
  }
  | {
    readonly kind: "shortcut-key-slot";
    readonly shortcutKeyId: ShortcutKeyId;
    readonly slotIndex: 0 | 1;
  }
  | {
    readonly kind: "fixed-key";
    readonly value: string;
  }
  | {
    readonly kind: "fixed-label";
    readonly labelKey: UiKey;
  }
  | {
    readonly kind: "mouse";
    readonly input: MouseShortcutInput;
  };

export interface CanvasRightDockToolbarShortcutGroupDefinition {
  readonly parts: readonly CanvasRightDockToolbarShortcutPartDefinition[];
  readonly separator?: "alternative" | "gap" | "plus";
}

export interface CanvasRightDockToolbarShortcutRowDefinition {
  readonly groups: readonly CanvasRightDockToolbarShortcutGroupDefinition[];
  readonly separator?: "alternative" | "gap" | "plus";
}

export interface CanvasRightDockToolbarShortcutDefinition {
  readonly parts?: readonly CanvasRightDockToolbarShortcutPartDefinition[];
  readonly separator?: "alternative" | "gap" | "plus";
  readonly rows?: readonly CanvasRightDockToolbarShortcutRowDefinition[];
}

export type ResolvedCanvasRightDockToolbarShortcutPart =
  | {
    readonly kind: "keyboard";
    readonly value: string;
  }
  | {
    readonly kind: "label";
    readonly labelKey: UiKey;
  }
  | {
    readonly kind: "mouse";
    readonly input: MouseShortcutInput;
  };

export interface ResolvedCanvasRightDockToolbarShortcut {
  readonly parts: readonly ResolvedCanvasRightDockToolbarShortcutPart[];
  readonly separator: "alternative" | "gap" | "plus";
  readonly rows?: readonly ResolvedCanvasRightDockToolbarShortcutRow[];
}

export interface ResolvedCanvasRightDockToolbarShortcutRow {
  readonly groups: readonly ResolvedCanvasRightDockToolbarShortcutGroup[];
  readonly separator: "alternative" | "gap" | "plus";
}

export interface ResolvedCanvasRightDockToolbarShortcutGroup {
  readonly parts: readonly ResolvedCanvasRightDockToolbarShortcutPart[];
  readonly separator: "alternative" | "gap" | "plus";
}

export function resolveCanvasRightDockToolbarShortcut(
  definition: CanvasRightDockToolbarShortcutDefinition,
  getKeyboardShortcutFor: (shortcutKeyId: ShortcutKeyId) => string,
): ResolvedCanvasRightDockToolbarShortcut | null {
  if (definition.rows !== undefined) {
    const rows = definition.rows
      .map((row) => resolveShortcutRow(row, getKeyboardShortcutFor))
      .filter((row): row is ResolvedCanvasRightDockToolbarShortcutRow => row !== null);

    return rows.length === 0
      ? null
      : {
        parts: [],
        separator: "gap",
        rows,
      };
  }

  const group = resolveShortcutGroup({
    parts: definition.parts ?? [],
    separator: definition.separator,
  }, getKeyboardShortcutFor);

  return group;
}

function resolveShortcutRow(
  definition: CanvasRightDockToolbarShortcutRowDefinition,
  getKeyboardShortcutFor: (shortcutKeyId: ShortcutKeyId) => string,
): ResolvedCanvasRightDockToolbarShortcutRow | null {
  const separator = definition.separator ?? "plus";
  const groups: ResolvedCanvasRightDockToolbarShortcutGroup[] = [];

  for (const groupDefinition of definition.groups) {
    const group = resolveShortcutGroup(groupDefinition, getKeyboardShortcutFor);
    if (group === null) {
      if (separator === "alternative") {
        continue;
      }

      return null;
    }

    groups.push(group);
  }

  return groups.length === 0 ? null : { groups, separator };
}

function resolveShortcutGroup(
  definition: CanvasRightDockToolbarShortcutGroupDefinition,
  getKeyboardShortcutFor: (shortcutKeyId: ShortcutKeyId) => string,
): ResolvedCanvasRightDockToolbarShortcutGroup | null {
  if (definition.parts.length === 0) {
    return null;
  }

  const parts: ResolvedCanvasRightDockToolbarShortcutPart[] = [];

  for (const part of definition.parts) {
    if (part.kind === "mouse" || part.kind === "fixed-label") {
      parts.push(part.kind === "mouse"
        ? part
        : { kind: "label", labelKey: part.labelKey });
      continue;
    }

    const unresolvedValue = part.kind === "fixed-key"
      ? part.value
      : getKeyboardShortcutFor(part.shortcutKeyId);
    const value = part.kind === "shortcut-key-slot"
      ? resolveShortcutSlot(unresolvedValue, part.slotIndex)
      : unresolvedValue.trim();

    if (value === "") {
      if (part.kind === "shortcut-key-slot") {
        continue;
      }

      return null;
    }

    parts.push({ kind: "keyboard", value });
  }

  return parts.length === 0 ? null : {
    parts,
    separator: definition.separator ?? "plus",
  };
}

function resolveShortcutSlot(shortcut: string, slotIndex: 0 | 1): string {
  return shortcut.split(";", 2)[slotIndex]?.trim() ?? "";
}
