<script lang="ts">
  import { ApiError, createApi, type User } from "../../api";
  import { getBaseUrl, getLogin, getSession, clearSession, type LoginState, type Session } from "../../storage";
  import PendingLogin from "./components/PendingLogin.svelte";
  import SaveForm from "./components/SaveForm.svelte";
  import SignedOut from "./components/SignedOut.svelte";

  type View =
    | { kind: "loading" }
    | { kind: "signedOut"; baseUrl: string; login: LoginState | null }
    | { kind: "ready"; session: Session; user: User; tab: chrome.tabs.Tab }
    | { kind: "error"; message: string };

  let view = $state<View>({ kind: "loading" });

  async function load(): Promise<void> {
    const baseUrl = await getBaseUrl();
    const session = await getSession(baseUrl);
    if (!session) {
      view = { kind: "signedOut", baseUrl, login: await getLogin() };
      return;
    }
    try {
      const [user, [tab]] = await Promise.all([
        createApi(session.baseUrl, session.token).me(),
        chrome.tabs.query({ active: true, currentWindow: true }),
      ]);
      if (!tab) throw new Error("No active tab");
      view = { kind: "ready", session, user, tab };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearSession(); // Expired or revoked: the storage change reloads.
        return;
      }
      view = { kind: "error", message: (err as Error).message };
    }
  }

  $effect(() => {
    const onChange = (_changes: unknown, area: string) => {
      if (area === "local") void load();
    };
    chrome.storage.onChanged.addListener(onChange);
    void load();
    return () => chrome.storage.onChanged.removeListener(onChange);
  });
</script>

<main>
  {#if view.kind === "loading"}
    <p class="muted">Loading…</p>
  {:else if view.kind === "signedOut"}
    {#if view.login?.status === "pending"}
      <PendingLogin login={view.login} />
    {:else}
      <SignedOut baseUrl={view.baseUrl} login={view.login} />
    {/if}
  {:else if view.kind === "ready"}
    <SaveForm session={view.session} user={view.user} tab={view.tab} />
  {:else}
    <h1>Webmarks</h1>
    <p class="error" role="alert">{view.message}</p>
  {/if}
</main>
