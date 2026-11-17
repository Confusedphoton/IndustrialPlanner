import { afterEach, describe, expect, it, vi } from "vitest";

import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createWorldDocument } from "@/domain/document/world-document";
import { deleteRegionalSettingsAsset } from "@/app/regional-settings/storage";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
import { recordWorldDocumentProjectionChange } from "@/sync/sync-host";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync change origin", () => {
  it("preserves snapshot origins from the write boundary", () => {
    const store = createSnapshotStore({ value: 0 });
    const origins: string[] = [];
    const unsubscribe = store.subscribe((_snapshot, context) => {
      origins.push(context.origin);
    });

    store.setSnapshot({ value: 1 });
    store.setSnapshot({ value: 2 }, { origin: "remote-sync" });
    unsubscribe();

    expect(origins).toEqual(["initial", "local", "remote-sync"]);
  });

  it("preserves local and remote-sync origins for persisted assets", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const origins: string[] = [];
    const unsubscribe = subscribeToStorageChanges((event) => {
      if (event.assetType === "regional-settings") {
        origins.push(event.origin);
      }
    });
    try {
      await deleteRegionalSettingsAsset();
      await deleteRegionalSettingsAsset({ origin: "remote-sync" });
    } finally {
      unsubscribe();
    }

    expect(origins).toEqual(["local", "remote-sync"]);
  });

  it("distinguishes base navigation from document content changes", () => {
    const hashesByBaseId = new Map<string, string>();
    const firstBase = createWorldDocument({ baseId: "base-a" });
    const secondBase = createWorldDocument({ baseId: "base-b" });

    expect(recordWorldDocumentProjectionChange(hashesByBaseId, firstBase)).toBe(true);
    expect(recordWorldDocumentProjectionChange(hashesByBaseId, secondBase)).toBe(true);
    expect(recordWorldDocumentProjectionChange(hashesByBaseId, firstBase)).toBe(false);
    expect(recordWorldDocumentProjectionChange(hashesByBaseId, secondBase)).toBe(false);

    const editedSecondBase = {
      ...secondBase,
      meta: {
        ...secondBase.meta,
        name: "Edited base",
      },
    };
    expect(recordWorldDocumentProjectionChange(
      hashesByBaseId,
      editedSecondBase,
    )).toBe(true);
  });
});
