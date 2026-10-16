import { h } from "./dom";
import { newTagName, suggestTags, type Tag } from "./tags";

/**
 * Chips for the chosen tags plus an autocomplete over existing ones.
 * Enter / click picks an existing tag; creating a tag needs its own button.
 */
export function tagPicker(all: Tag[]) {
  const selected: string[] = [];
  let active = 0;

  const chips = h("div", { class: "chips" });
  const input = h("input", {
    type: "text",
    placeholder: all.length ? "Add tags…" : "No tags yet",
    "aria-label": "Tags",
    autocomplete: "off",
  });
  const list = h("div", { class: "suggestions", role: "listbox" });

  function add(name: string) {
    selected.push(name);
    input.value = "";
    active = 0;
    update();
    input.focus();
  }

  function remove(name: string) {
    selected.splice(selected.indexOf(name), 1);
    update();
  }

  function update() {
    chips.replaceChildren(
      ...selected.map((name) =>
        h(
          "span",
          { class: "chip" },
          name,
          h(
            "button",
            { type: "button", "aria-label": `Remove ${name}`, onclick: () => remove(name) },
            "×",
          ),
        ),
      ),
    );
    const options = suggestTags(all, input.value, selected);
    active = Math.min(active, Math.max(options.length - 1, 0));
    const create = newTagName(all, input.value, selected);
    list.replaceChildren(
      ...options.map((t, i) =>
        h(
          "button",
          {
            type: "button",
            role: "option",
            class: i === active ? "option active" : "option",
            "aria-selected": i === active ? "true" : "false",
            onclick: () => add(t.name),
          },
          t.name,
          h("span", { class: "muted" }, String(t.bookmarkCount)),
        ),
      ),
      create
        ? h(
            "button",
            { type: "button", class: "option create", onclick: () => add(create) },
            `+ Create new tag “${create}”`,
          )
        : "",
    );
  }

  input.addEventListener("input", () => {
    active = 0;
    update();
  });
  input.addEventListener("keydown", (e) => {
    const options = suggestTags(all, input.value, selected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + options.length) % Math.max(options.length, 1);
      update();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = options[active];
      if (pick) add(pick.name); // Never creates: that stays an explicit click.
    } else if (e.key === "Backspace" && !input.value && selected.length) {
      remove(selected.at(-1)!);
    }
  });

  update();
  return {
    el: h("div", { class: "tag-picker" }, chips, input, list),
    selected: () => [...selected],
  };
}
