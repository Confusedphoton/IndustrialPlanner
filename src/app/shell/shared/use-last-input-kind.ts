import { useEffect, useState } from "react";

export type InputKind = "pointer" | "touch-or-pen";

/**
 * 最近一次输入是笔/触控还是鼠标/键盘。键盘快捷键提示只对后者有意义；
 * 笔用户看到的提示条只会盖住正在作业的画布。
 */
export function useLastInputKind(): InputKind {
  const [kind, setKind] = useState<InputKind>("pointer");
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      setKind(event.pointerType === "mouse" ? "pointer" : "touch-or-pen");
    };
    const handleKeyDown = () => setKind("pointer");
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);
  return kind;
}
