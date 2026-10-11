import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MAX_SUBJECT_LENGTH,
  buildImagePrompt,
  buildSubjectMessages,
  fallbackSubject,
  sanitizeSubject,
} from "../../src/lib/blueprint-prompt";
import { completionText, writeSubject } from "../../src/lib/blueprint-image";
import { createFakeAi } from "../helpers/fake-ai";

describe("sanitizeSubject", () => {
  it("keeps a well-formed subject as is", () => {
    expect(
      sanitizeSubject("Subject: an open hardbound book whose pages unfold into puzzle blocks."),
    ).toBe("Subject: an open hardbound book whose pages unfold into puzzle blocks.");
  });

  it("drops preamble, quotes, markdown and every sentence after the first", () => {
    expect(
      sanitizeSubject(
        'Sure! Here you go:\n**Subject:** "a cutaway of a filing cabinet\'s drawers full of pages." This represents storage.',
      ),
    ).toBe("Subject: a cutaway of a filing cabinet's drawers full of pages.");
  });

  it("adds the Subject: prefix when the model leaves it out", () => {
    expect(sanitizeSubject("a clockwork loop of task boxes on a conveyor")).toBe(
      "Subject: a clockwork loop of task boxes on a conveyor.",
    );
  });

  it("rejects subjects that ask for writing in the image", () => {
    const raws = [
      "Subject: a book with the word TypeScript written on its cover.",
      "Subject: a calendar grid labeled with weekdays.",
      "Subject: a server rack with a logo on the front.",
      "Subject: a scroll covered in numbers.",
    ];
    expect(raws.map(sanitizeSubject)).toEqual([null, null, null, null]);
  });

  it("rejects empty, too short and non-string output", () => {
    expect(sanitizeSubject("")).toBeNull();
    expect(sanitizeSubject("Subject: a box.")).toBeNull();
    expect(sanitizeSubject(undefined)).toBeNull();
    expect(sanitizeSubject({ response: "Subject: a gear train." })).toBeNull();
  });

  it("caps long subjects at a word boundary without a dangling connector", () => {
    const long = `Subject: a machine ${"with many small gears and ".repeat(20)}springs.`;
    const result = sanitizeSubject(long)!;
    const body = result.replace(/^Subject: /, "").replace(/\.$/, "");

    expect(body.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH);
    expect(result).toMatch(/ (gears|small|many)\.$/);
  });
});

describe("fallbackSubject", () => {
  it("uses the motif of the first tag that has one", () => {
    expect(fallbackSubject({ url: "https://x.dev/a", tags: ["obscure", "Databases"] })).toBe(
      "Subject: a cutaway of stacked database cylinders with drawers pulled out to reveal page slots.",
    );
  });

  it("never puts raw tag names in the prompt and is stable for the same bookmark", () => {
    const source = { url: "https://ziglang.org/learn", tags: ["zig", "comptime"] };
    const subject = fallbackSubject(source);

    expect(subject).not.toMatch(/zig|comptime/i);
    expect(fallbackSubject(source)).toBe(subject);
  });

  it("produces subjects that pass the same sanitization as model output", () => {
    const tags = ["javascript", "typescript", "async", "react", "css", "performance", "rust", "ai"];
    const subjects = [...tags, "unknown"].map((t) =>
      fallbackSubject({ url: `https://example.com/${t}`, tags: [t] }),
    );
    expect(subjects.map(sanitizeSubject)).toEqual(subjects);
  });
});

describe("buildSubjectMessages", () => {
  it("gives the model title, description, tags and URL slug, with the description capped", () => {
    const [system, user] = buildSubjectMessages({
      url: "https://www.lydiahallie.com/blog/promise-execution?ref=x#top",
      title: "Promise execution",
      description: `Line one\n\n${"x".repeat(1000)}`,
      tags: ["javascript", "async"],
    });

    expect(system?.role).toBe("system");
    expect(user?.content).toContain("Title: Promise execution\nDescription: Line one x");
    expect(user?.content).toContain("Tags: javascript, async");
    expect(user?.content).toContain("URL: www.lydiahallie.com/blog/promise-execution");
    expect(user?.content).not.toContain("ref=x");
    expect(user!.content.length).toBeLessThan(600);
  });

  it("omits fields the bookmark doesn't have", () => {
    const [, user] = buildSubjectMessages({ url: "https://example.com/post", tags: [] });
    expect(user?.content).toBe("URL: example.com/post");
  });
});

describe("buildImagePrompt", () => {
  it("is the fixed style prefix, verbatim, followed by the subject", () => {
    expect(buildImagePrompt("Subject: a gear train.")).toBe(
      "Technical blueprint illustration, white and light-cyan fine line drawing on deep cobalt blue (#1f5fbf) blueprint paper, faint square grid, precise engineering draft style, isometric view, dimension lines and small construction marks, centered single subject, generous negative space, flat, no shading, no photorealism. Absolutely no text, no letters, no numbers, no labels, no logos. Subject: a gear train.",
    );
  });
});

describe("writeSubject", () => {
  const source = { url: "https://example.com/db", title: "Indexes", tags: ["databases"] };
  const tagFallback = fallbackSubject(source);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the sanitized model subject", async () => {
    const { ai } = createFakeAi({ subject: 'Subject: "a card catalogue drawer on rails".' });
    expect(await writeSubject(ai, source)).toBe("Subject: a card catalogue drawer on rails.");
  });

  it("falls back to the tag subject when the model output is unusable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ai } = createFakeAi({ subject: "Subject: a sign that says INDEX." });
    expect(await writeSubject(ai, source)).toBe(tagFallback);
  });

  it("falls back to the tag subject when the model call fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("rate limited"));
    const ai = { run } as unknown as Ai;
    expect(await writeSubject(ai, source)).toBe(tagFallback);
  });
});

describe("completionText", () => {
  it("reads the OpenAI-style chat completion Gemma 4 returns", () => {
    expect(
      completionText({
        choices: [{ index: 0, message: { role: "assistant", content: "Subject: a gear." } }],
      }),
    ).toBe("Subject: a gear.");
  });

  it("still reads the legacy { response } shape and ignores anything else", () => {
    expect(completionText({ response: "Subject: a gear." })).toBe("Subject: a gear.");
    expect(completionText({ choices: [] })).toBeUndefined();
    expect(completionText(null)).toBeUndefined();
  });
});
