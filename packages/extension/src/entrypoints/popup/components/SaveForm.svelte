<script lang="ts">
  import { ApiError, createApi, type User, type Visibility } from "../../../api";
  import { clearSession, type Session } from "../../../storage";
  import TagPicker from "./TagPicker.svelte";
  import type { Tag } from "../../../tags";

  let {
    session,
    user,
    tab,
  }: { session: Session; user: User; tab: chrome.tabs.Tab } = $props();

  const api = $derived(createApi(session.baseUrl, session.token));
  const url = $derived(tab.url);
  const savable = $derived(!!url && /^https?:\/\//.test(url));

  let tags = $state<Tag[]>([]);
  let selected = $state<string[]>([]);
  let visibility = $state<Visibility>("public");
  let saving = $state(false);
  let savedId = $state<string | null>(null);
  let status = $state<{ kind: "muted" | "success" | "error"; text: string } | null>(null);

  $effect(() => {
    if (!savable) return;
    api.listTags().then(
      (t) => (tags = t),
      (err) => (status = { kind: "error", text: (err as Error).message }),
    );
  });

  async function signOut() {
    // Revoke on the server too; clear locally even if that fails.
    await api.signOut().catch(() => {});
    await clearSession();
  }

  async function save() {
    saving = true;
    status = { kind: "muted", text: "Saving…" };
    try {
      // Remember the bookmark before tagging so Undo still works if tagging
      // fails, and so a retry only repeats the tagging.
      savedId ??= (await api.createBookmark(url!, visibility)).id;
      if (selected.length) await api.setTags(savedId, selected);
      status = { kind: "success", text: "Saved." };
    } catch (err) {
      saving = false;
      status = {
        kind: "error",
        text:
          err instanceof ApiError && err.status === 409
            ? "Already in your bookmarks."
            : (err as Error).message,
      };
    }
  }

  // Undo only ever deletes the bookmark this popup just created, never one
  // that already existed (a 409 leaves savedId unset).
  async function undo() {
    if (!savedId) return;
    try {
      await api.deleteBookmark(savedId);
      savedId = null;
      saving = false;
      status = { kind: "muted", text: "Removed." };
    } catch (err) {
      status = { kind: "error", text: `Undo failed: ${(err as Error).message}` };
    }
  }
</script>

<header>
  <span class="muted">{user.email}</span>
  <button type="button" class="link" onclick={signOut}>Sign out</button>
</header>
<p class="url" title={tab.url ?? ""}>{tab.title || tab.url || ""}</p>
{#if !savable}
  <p class="muted">Only http(s) pages can be saved.</p>
{:else}
  <TagPicker all={tags} bind:selected />
  <select bind:value={visibility} disabled={saving} aria-label="Visibility">
    <option value="public">Public</option>
    <option value="private">Private</option>
  </select>
  <div class="row">
    <button type="button" class="primary" disabled={saving} onclick={save}>Save</button>
    {#if savedId}
      <button type="button" onclick={undo}>Undo</button>
    {/if}
  </div>
  <p role="status" class={status?.kind}>{status?.text ?? ""}</p>
{/if}
