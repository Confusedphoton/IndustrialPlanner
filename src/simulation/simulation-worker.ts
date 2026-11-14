import { executeBlueprint } from "./blueprint/execute";
import { createLegacyBlueprintEngine } from "./legacy/blueprint-engine";
import type { BlueprintWorkerRequest, BlueprintWorkerResponse } from "./blueprint";
import { createRegistryContract } from "@/registry";
import { SimulationWorkerRuntime } from "./legacy/worker-runtime";
import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";
import type {
  SimulationWorkerErrorNotification,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./legacy/worker-protocol";

const registry = createRegistryContract();
const runtime = new SimulationWorkerRuntime(registry);
let blueprintAbortController: AbortController | null = null;
const workerScope = globalThis as unknown as {
  postMessage(response: SimulationWorkerResponse | SimulationWorkerErrorNotification | BlueprintWorkerResponse): void;
};

// 异步路径（setTimeout 回调中的 fillOneTick/advanceToTick）错误时主动推送到主线程
runtime.setOnError((error, tickNumber) => {
  workerScope.postMessage({
    type: "worker-error",
    error,
    tickNumber,
  });
});

installWorkerEndpoint({
  workerKind: "simulation",
  handleMessage: async (event) => {
    const message = event.data as BlueprintWorkerRequest | SimulationWorkerRequest;
    if (message.type === "cancel-blueprint") {
      blueprintAbortController?.abort();
      return;
    }
    if (message.type === "run-blueprint") {
      if (blueprintAbortController !== null) throw new Error("Blueprint worker is already running.");
      blueprintAbortController = new AbortController();
      try {
        const report = await executeBlueprint(registry, message.engineKind, message.request,
          (options) => createLegacyBlueprintEngine(registry, options),
          blueprintAbortController.signal);
        workerScope.postMessage({ type: "blueprint-completed", report });
      } finally {
        blueprintAbortController = null;
      }
      return;
    }
    const response = runtime.handleRequest(event.data as SimulationWorkerRequest);
    workerScope.postMessage(response);
  },
});
