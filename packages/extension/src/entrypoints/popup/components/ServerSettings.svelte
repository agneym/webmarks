<script lang="ts">
  import { normalizeBaseUrl, originPattern } from "../../../config";
  import { setBaseUrl, setLogin } from "../../../storage";

  let { baseUrl }: { baseUrl: string } = $props();

  // svelte-ignore state_referenced_locally -- seed only; the field is user-edited.
  let value = $state(baseUrl);
  let status = $state("");

  /** Asks for host access before switching servers. */
  async function save() {
    try {
      const next = normalizeBaseUrl(value);
      const granted = await chrome.permissions.request({ origins: [originPattern(next)] });
      if (!granted) throw new Error("Chrome did not grant access to that server");
      await setBaseUrl(next);
      await setLogin(null);
    } catch (err) {
      status = (err as Error).message;
    }
  }
</script>

<details class="settings">
  <summary>Server</summary>
  <div class="row">
    <input type="url" bind:value aria-label="Server URL" />
    <button type="button" onclick={save}>Use</button>
  </div>
  <p class="muted">{status}</p>
</details>
