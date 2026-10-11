import { describe, it, expect } from "vitest";
import {
  MAX_SUBJECT_LENGTH,
  buildImagePrompt,
  buildSubjectMessages,
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

  it("doesn't filter subjects that mention writing; the prompt alone discourages it", () => {
    expect(sanitizeSubject("Subject: a calendar grid labeled with weekdays.")).toBe(
      "Subject: a calendar grid labeled with weekdays.",
    );
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

  it("returns the sanitized model subject", async () => {
    const { ai, run } = createFakeAi({ subject: 'Subject: "a card catalogue drawer on rails".' });
    expect(await writeSubject(ai, source)).toBe("Subject: a card catalogue drawer on rails.");
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("throws when the model output is unusable", async () => {
    const { ai } = createFakeAi({ subject: "" });
    await expect(writeSubject(ai, source)).rejects.toThrow(/unusable subject/);
  });

  it("throws when the model call fails", async () => {
    const { ai } = createFakeAi({ failText: true });
    await expect(writeSubject(ai, source)).rejects.toThrow("text model unavailable");
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
