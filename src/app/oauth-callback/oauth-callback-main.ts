import {
  CLOUDFLARE_OAUTH_CALLBACK_ACK_TIMEOUT_MS,
  CLOUDFLARE_OAUTH_CALLBACK_RETRY_INTERVAL_MS,
  createCloudflareOAuthBroadcastChannelName,
  isCloudflareOAuthAckMessage,
  parseCloudflareOAuthCallbackFragment,
} from "@/shared/storage/cloudflare-oauth-browser-flow";


import "./oauth-callback.scss";

type CallbackPageState = "working" | "success" | "error";

const root = document.querySelector<HTMLElement>("#oauth-callback-root");

if (root === null) {
  throw new Error("OAuth callback root is missing.");
}

renderCallbackPage(root, "working", "正在完成 Cloudflare 登录…");
void handleOAuthCallback(root);

function handleOAuthCallback(container: HTMLElement): void {
  const callbackUrl = new URL(globalThis.location.href);
  const result = parseCloudflareOAuthCallbackFragment(callbackUrl.hash);
  clearCallbackLocation(callbackUrl);
  if (result === null) {
    renderCallbackPage(container, "error", "登录回调无效，请关闭此页面后重试。");
    return;
  }
  if (typeof globalThis.BroadcastChannel !== "function") {
    renderCallbackPage(
      container,
      "error",
      "浏览器无法将登录结果返回原页面，请关闭本页面后重试。",
    );
    return;
  }

  const broadcastChannel = new BroadcastChannel(
    createCloudflareOAuthBroadcastChannelName(result.oauthChannel),
  );
  let settled = false;
  const stopRelay = () => {
    if (settled) {
      return false;
    }
    settled = true;
    globalThis.clearInterval(retryTimer);
    globalThis.clearTimeout(timeoutTimer);
    broadcastChannel.close();
    return true;
  };
  const postResult = () => broadcastChannel.postMessage(result);
  broadcastChannel.addEventListener("message", (event) => {
    if (!isCloudflareOAuthAckMessage(event.data, result.oauthChannel)) {
      return;
    }
    if (!stopRelay()) {
      return;
    }
    renderCallbackPage(
      container,
      result.error === undefined ? "success" : "error",
      result.error === undefined
        ? "登录成功，本页面将自动关闭。"
        : "登录失败，本页面将自动关闭。",
    );
    globalThis.close();
  });
  const retryTimer = globalThis.setInterval(
    postResult,
    CLOUDFLARE_OAUTH_CALLBACK_RETRY_INTERVAL_MS,
  );
  const timeoutTimer = globalThis.setTimeout(() => {
    if (!stopRelay()) {
      return;
    }
    renderCallbackPage(
      container,
      result.error === undefined ? "success" : "error",
      result.error === undefined
        ? "登录已完成，请返回原页面或关闭本页面。"
        : "登录失败，请返回原页面或关闭本页面。",
    );
  }, CLOUDFLARE_OAUTH_CALLBACK_ACK_TIMEOUT_MS);
  postResult();
}

function clearCallbackLocation(url: URL): void {
  globalThis.history.replaceState(null, "", url.pathname);
}


function renderCallbackPage(
  container: HTMLElement,
  state: CallbackPageState,
  message: string,
): void {
  container.replaceChildren();
  const card = document.createElement("section");
  card.className = `oauth-callback-card is-${state}`;
  card.dataset.oauthCallbackState = state;

  const mark = document.createElement("span");
  mark.className = "oauth-callback-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = state === "success" ? "✓" : state === "error" ? "!" : "…";

  const title = document.createElement("h1");
  title.textContent = "Cloudflare 同步";

  const description = document.createElement("p");
  description.setAttribute("role", state === "error" ? "alert" : "status");
  description.textContent = message;

  card.append(mark, title, description);
  if (state !== "working") {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "关闭页面";
    closeButton.addEventListener("click", () => globalThis.close());
    card.append(closeButton);
  }
  container.append(card);
}
