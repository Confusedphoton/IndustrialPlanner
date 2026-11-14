import { describe, expect, it } from "vitest";

import { createWorldDocument } from "@/domain/document/world-document";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";

describe("stored world document viewport", () => {
  it("reads back a new document that has never saved a viewport", () => {
    const document = createWorldDocument();
    const stored = JSON.parse(JSON.stringify(document)) as unknown;

    expect(document.documentSettings.viewport).toBeUndefined();
    expect(normalizeWorldDocument(stored)).not.toBeNull();
  });

  it("still rejects a malformed saved viewport", () => {
    const document = createWorldDocument();
    const stored = JSON.parse(JSON.stringify({
      ...document,
      documentSettings: { ...document.documentSettings, viewport: { center: "middle" } },
    })) as unknown;

    expect(normalizeWorldDocument(stored)).toBeNull();
  });
});
