import { describe, expect, it } from "vitest";
import { newTagName, suggestTags, type Tag } from "../src/tags";

const tags: Tag[] = [
  { id: "1", name: "javascript", bookmarkCount: 3 },
  { id: "2", name: "java", bookmarkCount: 1 },
  { id: "3", name: "design", bookmarkCount: 9 },
  { id: "4", name: "css", bookmarkCount: 5 },
  { id: "5", name: "ninja", bookmarkCount: 20 },
];
const names = (ts: Tag[]) => ts.map((t) => t.name);

describe("suggestTags", () => {
  it("offers the most used tags when nothing is typed", () => {
    expect(names(suggestTags(tags, "", [], 2))).toEqual(["ninja", "design"]);
  });

  it("ranks prefix matches above substring matches", () => {
    // "ninja" is used most but only contains "ja", so it comes last.
    expect(names(suggestTags(tags, "ja", []))).toEqual(["javascript", "java", "ninja"]);
  });

  it("matches case-insensitively and hides already chosen tags", () => {
    expect(names(suggestTags(tags, "JAV", ["javascript"]))).toEqual(["java"]);
  });
});

describe("newTagName", () => {
  it("offers creating a tag only for genuinely new names", () => {
    expect(newTagName(tags, "  rust ", [])).toBe("rust");
    expect(newTagName(tags, "", [])).toBeNull();
  });

  it("does not create a case variant of an existing or chosen tag", () => {
    expect(newTagName(tags, "CSS", [])).toBeNull();
    expect(newTagName(tags, "Rust", ["rust"])).toBeNull();
  });
});
