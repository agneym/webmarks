import { ApiError, createApi, type Api, type User } from "./api";
import type { Message } from "./background";
import { normalizeBaseUrl, originPattern } from "./config";
import { h } from "./dom";
import { tagPicker } from "./tag-picker";
import {
  clearSession,
  getBaseUrl,
  getLogin,
  getSession,
  setBaseUrl,
  setLogin,
  type LoginState,
  type Session,
} from "./storage";

const root = document.getElementById("app")!;

function send(msg: Message) {
  return chrome.runtime.sendMessage(msg);
}

function mount(...children: Node[]) {
  root.replaceChildren(...children);
}

function errorText(message: string | undefined) {
  return message ? h("p", { class: "error", role: "alert" }, message) : null;
}

/** Server address editor; asks for host access before switching servers. */
function serverSettings(baseUrl: string): HTMLElement {
  const input = h("input", { type: "url", value: baseUrl, "aria-label": "Server URL" });
  const status = h("p", { class: "muted" });
  const save = async () => {
    try {
      const next = normalizeBaseUrl(input.value);
      const granted = await chrome.permissions.request({ origins: [originPattern(next)] });
      if (!granted) throw new Error("Chrome did not grant access to that server");
      await setBaseUrl(next);
      await setLogin(null);
    } catch (err) {
      status.textContent = (err as Error).message;
    }
  };
  return h(
    "details",
    { class: "settings" },
    h("summary", {}, "Server"),
    h("div", { class: "row" }, input, h("button", { type: "button", onclick: save }, "Use")),
    status,
  );
}

function loggedOutView(baseUrl: string, login: LoginState | null): Node[] {
  if (login?.status === "pending") {
    return [
      h("h1", {}, "Approve sign-in"),
      h("p", {}, "Approve the request in the tab that just opened. The code should match:"),
      h("p", { class: "code" }, login.userCode),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          { type: "button", onclick: () => chrome.tabs.create({ url: login.verificationUri }) },
          "Open approval page",
        ),
        h(
          "button",
          { type: "button", class: "secondary", onclick: () => send({ type: "cancel-login" }) },
          "Cancel",
        ),
      ),
    ];
  }
  return [
    h("h1", {}, "Webmarks"),
    h("p", { class: "muted" }, "Sign in to save pages to your bookmarks."),
    errorText(login?.status === "error" ? login.message : undefined) ?? h("span"),
    h(
      "button",
      { type: "button", class: "primary", onclick: () => send({ type: "login" }) },
      "Sign in",
    ),
    serverSettings(baseUrl),
  ];
}

export type LoggedInContext = { session: Session; user: User; tab: chrome.tabs.Tab };

const savable = (url: string | undefined): url is string => !!url && /^https?:\/\//.test(url);

/** Tag picker + Save for the current tab. */
async function saveForm(api: Api, tab: chrome.tabs.Tab): Promise<Node[]> {
  if (!savable(tab.url)) {
    return [h("p", { class: "muted" }, "Only http(s) pages can be saved.")];
  }
  const url = tab.url;
  const picker = tagPicker(await api.listTags());
  const status = h("p", { role: "status" });
  const button = h("button", { type: "button", class: "primary" }, "Save");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.className = "muted";
    status.textContent = "Saving…";
    try {
      const bookmark = await api.createBookmark(url);
      const tags = picker.selected();
      if (tags.length) await api.setTags(bookmark.id, tags);
      status.className = "success";
      status.textContent = "Saved.";
    } catch (err) {
      button.disabled = false;
      status.className = "error";
      status.textContent =
        err instanceof ApiError && err.status === 409
          ? "Already in your bookmarks."
          : (err as Error).message;
    }
  });
  return [picker.el, button, status];
}

async function loggedInView(ctx: LoggedInContext): Promise<Node[]> {
  const api = createApi(ctx.session.baseUrl, ctx.session.token);
  const signOut = async () => {
    // Revoke on the server too; clear locally even if that fails.
    await api.signOut().catch(() => {});
    await clearSession();
  };
  return [
    h(
      "header",
      {},
      h("span", { class: "muted" }, ctx.user.email),
      h("button", { type: "button", class: "link", onclick: signOut }, "Sign out"),
    ),
    h("p", { class: "url", title: ctx.tab.url ?? "" }, ctx.tab.title || ctx.tab.url || ""),
    ...(await saveForm(api, ctx.tab)),
  ];
}

async function render(): Promise<void> {
  const baseUrl = await getBaseUrl();
  const session = await getSession(baseUrl);
  if (!session) {
    mount(...loggedOutView(baseUrl, await getLogin()));
    return;
  }
  try {
    const [user, [tab]] = await Promise.all([
      createApi(session.baseUrl, session.token).me(),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);
    if (!tab) throw new Error("No active tab");
    mount(...(await loggedInView({ session, user, tab })));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSession(); // Expired or revoked: storage change re-renders.
      return;
    }
    mount(h("h1", {}, "Webmarks"), errorText((err as Error).message)!);
  }
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") void render();
});
void render();
