import { useEffect, useState } from "react";
import { marked, Renderer } from "marked";
import LucideChevronUp from "~icons/lucide/chevron-up";

import styles from "@/app/shell/dialogs/dialogs.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import {
  type ChangelogKind,
  type ChangelogIndexEntry,
  type ChangelogVersion,
  loadChangelogIndexEntries,
  parseChangelogVersion,
} from "@/app/shell/dialogs/changelog-data";


function createChangelogRenderer(changelogFile: string): Renderer {
  const renderer = new Renderer();
  renderer.image = function ({ href, title, text }: { href: string; title: string | null; text: string }) {
    const resolvedUrl = resolveChangelogImageUrl(changelogFile, href);
    const titleAttr = title !== null ? ` title="${escapeAttr(title)}"` : "";
    return `<img src="${escapeAttr(resolvedUrl)}" alt="${escapeAttr(text)}"${titleAttr} loading="lazy">`;
  };
  return renderer;
}


function resolveChangelogImageUrl(changelogFile: string, url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("/")) {
    return createPublicAssetUrl(url);
  }

  const markdownUrl = new URL(`changelog/${changelogFile}`, "https://placeholder.local/");
  const resolvedUrl = new URL(url, markdownUrl);
  return createPublicAssetUrl(`${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface ChangelogEntry extends ChangelogIndexEntry {
  loaded: boolean;
  html: string | null;
  error: string | null;
}

interface DisplayEntry {
  key: string;
  label: string;
  date: string | null;
  loaded: boolean;
  html: string | null;
  error: string | null;
  version: ChangelogVersion;
  kind: ChangelogKind;
}

function getBaseVersion(version: string): string {
  return version.split(".").slice(0, 3).join(".");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function groupEntries(entries: ChangelogEntry[]): DisplayEntry[] {
  const result: DisplayEntry[] = [];
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i]!;

    if (entry.kind === "main") {
      result.push({
        key: entry.file,
        label: entry.title,
        date: entry.date,
        loaded: entry.loaded,
        html: entry.html,
        error: entry.error,
        version: entry.version,
        kind: entry.kind,
      });
      i += 1;
      continue;
    }

    // 增量版本：收集连续的同基础版本号增量条目
    const baseVersion = getBaseVersion(entry.version.canonical);
    const group: ChangelogEntry[] = [];

    while (i < entries.length) {
      const e = entries[i]!;
      if (e.kind === "incremental" && getBaseVersion(e.version.canonical) === baseVersion) {
        group.push(e);
        i += 1;
      } else {
        break;
      }
    }

    const allLoaded = group.every((e) => e.loaded);
    let mergedHtml: string | null = null;

    if (allLoaded) {
      const errors = group.filter((e) => e.error !== null);

      if (errors.length === 0) {
        mergedHtml = group
          .map((e) => {
            const subLabel = escapeHtml(e.title);
            const dateHtml = e.date === null
              ? ""
              : `<time class="${escapeAttr(cm(styles, "changelog-accordion-date"))}" datetime="${escapeAttr(e.date)}">${escapeHtml(e.date)}</time>`;
            return `<p class="${escapeAttr(cm(styles, "changelog-sub-heading"))}"><span class="${escapeAttr(cm(styles, "changelog-accordion-title"))}">${subLabel}</span>${dateHtml}</p>${e.html ?? ""}`;
          })
          .join("\n");
      }
    }

    const groupErrors = group.filter((e) => e.error !== null).map((e) => e.error);

    result.push({
      key: `group-${baseVersion}`,
      label: `v${baseVersion} 增量更新`,
      date: null,
      loaded: allLoaded,
      html: mergedHtml,
      error: groupErrors.length > 0 ? groupErrors.join("; ") : null,
      version: { canonical: baseVersion, isMain: false },
      kind: "incremental",
    });
  }

  return result;
}

function getCurrentAppVersionText(): string | undefined {
  return typeof window === "undefined" ? undefined : window.__APP_VERSION__;
}

function resolveCurrentEntryIndex(displayEntries: DisplayEntry[], currentVersionText: string | undefined): number {
  const currentVersion = currentVersionText === undefined ? null : parseChangelogVersion(currentVersionText);

  if (currentVersion !== null) {
    // 精确匹配：主版本优先匹配独立条目，避免与同 canonical 的增量组混淆
    if (currentVersion.isMain) {
      const mainIndex = displayEntries.findIndex(
        (de) => de.version.canonical === currentVersion.canonical && de.kind === "main",
      );

      if (mainIndex >= 0) {
        return mainIndex;
      }
    } else {
      const exactIndex = displayEntries.findIndex(
        (de) => de.version.canonical === currentVersion.canonical && de.kind === "incremental",
      );

      if (exactIndex >= 0) {
        return exactIndex;
      }

      // 增量版本按基础版本号匹配合并后的分组
      const baseVersion = getBaseVersion(currentVersion.canonical);
      const groupIndex = displayEntries.findIndex(
        (de) =>
          de.kind === "incremental"
          && getBaseVersion(de.version.canonical) === baseVersion,
      );

      if (groupIndex >= 0) {
        return groupIndex;
      }
    }
  }

  return 0;
}

function createDefaultExpandedSet(displayEntries: DisplayEntry[]): Set<number> {
  const expanded = new Set<number>();

  if (displayEntries.length === 0) {
    return expanded;
  }

  const currentIndex = resolveCurrentEntryIndex(displayEntries, getCurrentAppVersionText());
  const currentEntry = displayEntries[currentIndex]!;
  expanded.add(currentIndex);

  // 当前条目为增量组或增量条目时，同时展开下一条（通常是其父主版本）
  if (currentEntry.kind === "incremental") {
    if (currentIndex + 1 < displayEntries.length) {
      expanded.add(currentIndex + 1);
    }
  }

  return expanded;
}

/**
 * 从索引加载所有 changelog 条目。
 * index.json 中条目按发布顺序排列（旧→新），读取后反转为新→旧。
 */
async function loadChangelogEntries(): Promise<ChangelogEntry[]> {
  const indexEntries = await loadChangelogIndexEntries();
  return indexEntries.map((entry) => {
    return {
      ...entry,
      loaded: false,
      html: null,
      error: null,
    };
  });
}

async function loadSingleEntry(entry: ChangelogEntry): Promise<ChangelogEntry> {
  try {
    const resp = await fetch(createPublicAssetUrl(`changelog/${entry.file}`));

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const md = await resp.text();
    const html = await marked.parse(md, { renderer: createChangelogRenderer(entry.file) });

    return { ...entry, loaded: true, html: html as string };
  } catch (err) {
    return {
      ...entry,
      loaded: true,
      error: err instanceof Error ? err.message : "加载失败",
    };
  }
}

export function ChangelogSection() {
  const [displayEntries, setDisplayEntries] = useState<DisplayEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await loadChangelogEntries();

        if (cancelled) {
          return;
        }

        const initialGrouped = groupEntries(list);
        setDisplayEntries(initialGrouped);
        setExpandedSet(createDefaultExpandedSet(initialGrouped));

        const updated = await Promise.all(list.map((entry) => loadSingleEntry(entry)));

        if (!cancelled) {
          const finalGrouped = groupEntries(updated);
          setDisplayEntries(finalGrouped);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "加载失败");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (index: number) => {
    setExpandedSet((prev) => {
      const next = new Set<number>(prev);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  };

  const collapse = (index: number) => {
    setExpandedSet((prev) => {
      if (!prev.has(index)) {
        return prev;
      }

      const next = new Set<number>(prev);
      next.delete(index);
      return next;
    });
  };

  if (loadError !== null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <h3>版本更新</h3>
        <p>加载失败：{loadError}</p>
      </div>
    );
  }

  if (displayEntries === null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <h3>版本更新</h3>
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <div className={cm(styles, "changelog-section")}>
      {displayEntries.map((entry, index) => {
        const expanded = expandedSet.has(index);

        return (
          <div
            className={cm(styles, "changelog-accordion")}
            data-expanded={expanded ? "true" : "false"}
            key={entry.key}
          >
            <button
              aria-expanded={expanded}
              className={cm(styles, "changelog-accordion-header")}
              onClick={() => toggle(index)}
              type="button"
            >
              <span className={cm(styles, "changelog-accordion-chevron")} />
              <span className={cm(styles, "changelog-accordion-title")}>{entry.label}</span>
              {entry.date !== null ? (
                <time className={cm(styles, "changelog-accordion-date")} dateTime={entry.date}>
                  {entry.date}
                </time>
              ) : null}
            </button>
            <div className={cm(styles, "changelog-accordion-body")}>
              <div className={cm(styles, "changelog-accordion-content")}>
                {entry.error !== null ? (
                  <p className={cm(styles, "changelog-error")}>加载失败：{entry.error}</p>
                ) : entry.html !== null ? (
                  <div
                    className={cm(styles, "changelog-markdown")}
                    dangerouslySetInnerHTML={{ __html: entry.html }}
                  />
                ) : (
                  <p className={cm(styles, "changelog-loading")}>加载中…</p>
                )}
                {expanded ? (
                  <div className={cm(styles, "changelog-collapse-row")}>
                    <button
                      aria-label={`收起 ${entry.label}`}
                      className={cm(styles, "changelog-collapse-button")}
                      onClick={() => collapse(index)}
                      type="button"
                    >
                      <LucideChevronUp
                        aria-hidden="true"
                        className={cm(styles, "changelog-collapse-icon")}
                      />
                      <span>收起</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
