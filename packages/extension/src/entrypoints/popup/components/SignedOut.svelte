<script lang="ts">
  import type { Message } from "../../../messages";
  import type { LoginState } from "../../../storage";
  import ServerSettings from "./ServerSettings.svelte";

  let { baseUrl, login }: { baseUrl: string; login: LoginState | null } = $props();

  const send = (msg: Message) => chrome.runtime.sendMessage(msg);
</script>

<h1>Webmarks</h1>
<p class="muted">Sign in to save pages to your bookmarks.</p>
{#if login?.status === "error"}
  <p class="error" role="alert">{login.message}</p>
{/if}
<button type="button" class="primary" onclick={() => send({ type: "login" })}>Sign in</button>
<ServerSettings {baseUrl} />
