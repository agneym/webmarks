/**
 * Prompt building for generated "blueprint" bookmark images.
 *
 * The image prompt is a fixed style prefix plus one subject sentence. The
 * subject is written by a text model from the bookmark's title,
 * description and tags, and its output is cleaned up here. When the model
 * fails or says nothing usable, no image is generated: the bookmark gets the
 * generic image instead (see generic-image.ts).
 */

/** Fixed style prefix. Kept verbatim: it is what produced the reference samples. */
export const BLUEPRINT_STYLE =
  "Technical blueprint illustration, white and light-cyan fine line drawing on deep cobalt blue (#1f5fbf) blueprint paper, faint square grid, precise engineering draft style, isometric view, dimension lines and small construction marks, centered single subject, generous negative space, flat, no shading, no photorealism. Absolutely no text, no letters, no numbers, no labels, no logos.";

/** Upper bound on the subject body (excluding the "Subject: " prefix). */
export const MAX_SUBJECT_LENGTH = 240;
const MIN_SUBJECT_LENGTH = 12;
const MAX_DESCRIPTION_LENGTH = 400;

export interface SubjectSource {
  url: string;
  title?: string | null;
  description?: string | null;
  tags: string[];
}

export const SUBJECT_SYSTEM_PROMPT = [
  "You write the subject of a technical blueprint illustration that stands for a bookmarked web page.",
  'Reply with exactly one sentence that starts with "Subject:" and describes one concrete physical object, machine or mechanism that is a visual metaphor for the page\'s topic.',
  "Describe only things that can be drawn as lines: objects, parts, arrangement, motion.",
  "Never mention text, words, letters, numbers, labels, logos, brand names, screens showing code, or people.",
  "No quotes, no preamble, no explanation, at most 35 words.",
  "",
  "Examples:",
  "Subject: an open hardbound book whose pages unfold into interlocking puzzle blocks.",
  "Subject: a cutaway of a database cylinder like a filing cabinet, drawers pulled out revealing stacked fixed-size pages and row slots.",
].join("\n");

/** Chat messages asking the text model for a subject. Page fields are data, capped in size. */
export function buildSubjectMessages(source: SubjectSource) {
  const lines: string[] = [];
  const title = source.title?.trim();
  if (title) lines.push(`Title: ${title}`);
  const description = source.description?.replace(/\s+/g, " ").trim();
  if (description) lines.push(`Description: ${description.slice(0, MAX_DESCRIPTION_LENGTH)}`);
  if (source.tags.length > 0) lines.push(`Tags: ${source.tags.join(", ")}`);
  lines.push(`URL: ${pageLocation(source.url)}`);

  return [
    { role: "system" as const, content: SUBJECT_SYSTEM_PROMPT },
    { role: "user" as const, content: lines.join("\n") },
  ];
}

/** host + path without query or fragment: the slug often names the topic. */
function pageLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

const TRAILING_FILLER = /[\s,;:-]+(and|or|with|of|a|an|the|to|in|on|at|by|for)?$/i;

/**
 * Turn raw model output into a single clean "Subject: ..." sentence, or null
 * when nothing usable is left.
 */
export function sanitizeSubject(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  let text = raw;
  // Drop any preamble ("Sure! Here is the subject:") before the subject marker.
  const marker = text.search(/subject\s*:/i);
  if (marker >= 0) text = text.slice(marker).replace(/^subject\s*:\s*/i, "");

  text =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";

  text = text
    .replace(/["“”`*_#]/g, "")
    // Single quotes only when they quote something, not in "book's".
    .replace(/(?<![A-Za-z])['‘’]|['‘’](?![A-Za-z])/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // First sentence only.
  text = text.split(/(?<=[.!?])\s/)[0] ?? "";
  text = text.replace(/[.!?\s]+$/, "");

  if (text.length > MAX_SUBJECT_LENGTH) {
    const cut = text.slice(0, MAX_SUBJECT_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");
    text = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  }
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(TRAILING_FILLER, "");
  }

  if (text.length < MIN_SUBJECT_LENGTH) return null;
  return `Subject: ${text}.`;
}

/** The full image prompt: the fixed style, then the subject sentence. */
export function buildImagePrompt(subject: string): string {
  return `${BLUEPRINT_STYLE} ${subject}`;
}
