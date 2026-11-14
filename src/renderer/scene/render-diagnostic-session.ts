import type { Container } from "pixi.js";
import type { SceneViewInput } from "@/domain/document/scene-view-input";
import { getRenderDiagnosticChannel, type RenderDiagnosticCondition } from "@/shared/render-diagnostics";

export function createRenderDiagnosticSession(options: {
  host: { input: SceneViewInput };
  beginProfile: () => { restore(): void; environment: Record<string, unknown> };
  layers: Record<Exclude<RenderDiagnosticCondition, "full">, Container>;
  documentVersion(): number;
}) {
  const channel = getRenderDiagnosticChannel(options.host.input.camera);
  const disconnect = channel.attachSurface({
    beginProfile: options.beginProfile, documentVersion: options.documentVersion,
    setCondition(condition) {
      if (condition === "full") return () => {};
      const target = options.layers[condition];
      const previous = target.renderable;
      target.renderable = false;
      let restored = false;
      return () => { if (!restored) { restored = true; target.renderable = previous; } };
    },
  });
  return { beforeFrame: channel.beforeFrame, record: channel.record,
    get collecting() { return channel.collecting; }, destroy: disconnect };
}

