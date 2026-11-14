/** 浮层可用区域的下边界：底部状态栏（data-workbench-status-bar）的实际顶端；状态栏隐藏（如触控横屏收起顶栏时）则为视口底边。 */
export function resolveOverlayBottomLimit(): number {
  const top = document.querySelector<HTMLElement>("[data-workbench-status-bar]")?.getBoundingClientRect().top;
  return top === undefined || top <= 0 ? window.innerHeight : Math.min(window.innerHeight, top);
}
