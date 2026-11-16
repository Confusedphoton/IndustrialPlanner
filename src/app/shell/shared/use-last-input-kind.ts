import { useSyncExternalStore } from "react";

export type InputKind = "pointer" | "touch-or-pen";
/** 最近一次按下的指针类型；键盘输入记为鼠标。 */
export type LastPointerType = "mouse" | "pen" | "touch";

let lastPointerType: LastPointerType = "mouse";
const listeners = new Set<() => void>();
let listening = false;

function setLastPointerType(type: LastPointerType): void {
  if (type === lastPointerType) return;
  lastPointerType = type;
  for (const listener of listeners) listener();
}

/**
 * 全局只记录一份：按需挂载的提示条（例如用笔长按进入移动后才出现的快捷键条）挂载时就能拿到
 * 打开它的那次笔/触控输入，而不是从默认的鼠标开始。
 */
function startListening(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pointerdown", (event) => {
    setLastPointerType(event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse");
  }, true);
  window.addEventListener("keydown", () => setLastPointerType("mouse"), true);
}

startListening();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 最近一次按下的是鼠标、笔还是手指。 */
export function useLastPointerType(): LastPointerType {
  return useSyncExternalStore(subscribe, () => lastPointerType, () => "mouse");
}

/**
 * 最近一次输入是笔/触控还是鼠标/键盘。键盘快捷键提示只对后者有意义；
 * 笔用户看到的提示条只会盖住正在作业的画布。
 */
export function useLastInputKind(): InputKind {
  return useLastPointerType() === "mouse" ? "pointer" : "touch-or-pen";
}
