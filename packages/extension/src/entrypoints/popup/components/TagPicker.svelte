<script lang="ts">
  import { newTagName, suggestTags, type Tag } from "../../../tags";

  /**
   * A select over existing tags, with the chosen ones shown as chips.
   * Creating a tag is a separate, explicit "New tag…" choice that reveals a
   * text field.
   */
  let { all, selected = $bindable() }: { all: Tag[]; selected: string[] } = $props();

  const NEW = "\0new";

  let creating = $state(false);
  let query = $state("");
  let input = $state<HTMLInputElement>();

  const options = $derived(suggestTags(all, "", selected, Infinity));
  const fresh = $derived(newTagName(all, query, selected));

  function add(name: string) {
    selected = [...selected, name];
    query = "";
    creating = false;
  }

  function remove(name: string) {
    selected = selected.filter((s) => s !== name);
  }

  function onchange(e: Event & { currentTarget: HTMLSelectElement }) {
    const { value } = e.currentTarget;
    e.currentTarget.value = ""; // Back to the placeholder after every pick.
    if (value === NEW) {
      creating = true;
      queueMicrotask(() => input?.focus());
    } else if (value) {
      add(value);
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (fresh) add(fresh);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      query = "";
      creating = false;
    }
  }
</script>

<div class="tag-picker">
  <div class="chips">
    {#each selected as name (name)}
      <span class="chip">
        {name}
        <button type="button" aria-label="Remove {name}" onclick={() => remove(name)}>×</button>
      </span>
    {/each}
  </div>
  <select aria-label="Tags" value="" {onchange}>
    <option value="" disabled>Add a tag…</option>
    {#each options as t (t.id)}
      <option value={t.name}>{t.name} ({t.bookmarkCount})</option>
    {/each}
    <option value={NEW}>+ New tag…</option>
  </select>
  {#if creating}
    <div class="row">
      <input
        type="text"
        bind:this={input}
        bind:value={query}
        {onkeydown}
        placeholder="New tag name"
        aria-label="New tag name"
        autocomplete="off"
      />
      <button type="button" disabled={!fresh} onclick={() => fresh && add(fresh)}>Add</button>
    </div>
  {/if}
</div>
