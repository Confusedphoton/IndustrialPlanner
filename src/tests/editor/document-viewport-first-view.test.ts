import { describe, expect, it } from "vitest";

import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import {
  applyWorldDocumentViewportSettings,
  createDefaultWorldDocumentViewportSettings,
  resolveWorldDocumentContentBounds,
} from "@/editor/document-viewport";
import { ensureProtocolCoreEntity } from "@/editor/ensure-protocol-core";
import { createSceneSessionFactories } from "@/editor/scene-session";
import { createRegistryContract } from "@/registry";

function createViewFor(document: WorldDocument) {
  const registry = createRegistryContract();
  const space = { areas: registry.baseDefinitions.find(base => base.id === document.baseId)?.areas ?? [] };
  const view = createSceneSessionFactories(registry).createView({ id: "first-view",
    initialViewport: createDefaultWorldDocumentViewportSettings(),
    bounds: { kind: "space", bounds: { minX: null, maxX: null, minY: null, maxY: null }, padding: 2 },
    getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
  });
  return { registry, space, view };
}

describe("first view of a document", () => {
  it("centres a new document on its protocol core rather than the empty middle of the base", () => {
    const registry = createRegistryContract();
    const document = ensureProtocolCoreEntity({ document: createWorldDocument(), queries: registry.queries,
      baseDefinitions: registry.baseDefinitions, isNewDocument: true });
    const { space, view } = createViewFor(document);
    const content = resolveWorldDocumentContentBounds(document, registry);

    applyWorldDocumentViewportSettings({ document, view, space, contentBounds: content });

    expect(content).not.toBeNull();
    expect(view.state.center.x).toBeCloseTo(content!.x + content!.width / 2);
    expect(view.state.center.y).toBeCloseTo(content!.y + content!.height / 2);
    view.dispose();
  });

  it("restores a saved viewport instead of centring on content", () => {
    const base = createWorldDocument();
    const document: WorldDocument = { ...base, documentSettings: { ...base.documentSettings,
      viewport: { center: { x: 5, y: 7 }, gridSize: 1, displayRotation: 0 } } };
    const { registry, space, view } = createViewFor(document);

    applyWorldDocumentViewportSettings({ document, view, space,
      contentBounds: resolveWorldDocumentContentBounds(document, registry) });

    expect(view.state.center).toEqual({ x: 5, y: 7 });
    view.dispose();
  });
});
