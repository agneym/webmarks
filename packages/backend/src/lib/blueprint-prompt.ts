/**
 * Prompt building for generated "blueprint" bookmark images.
 *
 * The image prompt is a fixed style prefix plus one subject sentence. The
 * subject is written by a small text model from the bookmark's title,
 * description and tags; its output is sanitized here, and a deterministic
 * tag-based subject is used whenever the model fails or says something we
 * can't use.
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

// Anything that asks the image model to draw writing. FLUX renders such
// requests as garbled lettering, so a subject containing them is discarded.
const TEXT_REQUEST =
  /\b(text|texts|words?|letters?|lettering|labels?|labell?ed|logos?|captions?|captioned|titled|typography|fonts?|writing|written|inscriptions?|inscribed|signs?|signage|numbers?|numbered|numerals?|digits?|alphabet|spelling|spelled|says|saying|banner)\b/i;

const TRAILING_FILLER = /[\s,;:-]+(and|or|with|of|a|an|the|to|in|on|at|by|for)?$/i;

/**
 * Turn raw model output into a single safe "Subject: ..." sentence, or null
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

  if (TEXT_REQUEST.test(text)) return null;

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

// Motifs for common tags. Raw tag names are never put in the image prompt:
// a bare word like "javascript" invites the model to draw a logo.
const TAG_MOTIFS: Record<string, string> = {
  javascript:
    "a mechanical event loop, a circular conveyor carrying small task boxes past a row of meshing gears",
  typescript: "a set of precision-machined blocks with keyed edges that only fit together one way",
  async: "parallel conveyor belts carrying capsules that merge through a single timed sorting gate",
  react: "a central component housing with smaller identical modules orbiting it on linked rings",
  css: "a drafting table with nested rectangular frames aligned on an adjustable layout grid",
  html: "a nested set of open boxes, each one fitted precisely inside the next",
  performance: "an exposed stopwatch mechanism with a centrifugal speed governor and gear train",
  databases: "a cutaway of stacked database cylinders with drawers pulled out to reveal page slots",
  database: "a cutaway of stacked database cylinders with drawers pulled out to reveal page slots",
  sql: "a cutaway of stacked database cylinders with drawers pulled out to reveal page slots",
  "system-design":
    "an exploded isometric diagram of modular server racks linked by connector pipes",
  "distributed-systems":
    "identical machines on separate pedestals connected by synchronized cables and pulleys",
  networking: "a switchboard junction with cables fanning out to small relay stations",
  security: "a cutaway of a heavy vault lock showing its tumblers, bolts and cam",
  rust: "a heavy-duty sealed gearbox with an interlocking safety latch",
  ai: "a mechanical loom weaving many input threads into a single patterned cloth",
  learning: "an open hardbound book whose pages unfold into interlocking puzzle blocks",
  design: "a drafting compass and set squares arranged over a precisely ruled construction",
  tools: "a neatly arranged toolbox opened in tiers, each tool seated in its own slot",
  testing: "a calibration rig holding a small part between gauges and a micrometer",
};

const GENERIC_MOTIFS = [
  "an exploded isometric view of a precision instrument assembled from modular parts",
  "a cutaway of a clockwork mechanism with gears, springs and an escapement",
  "a modular machine on a workbench, its panels lifted to show the parts inside",
  "an isometric assembly of connected chambers and pipes with valves between them",
];

/** Deterministic subject from tags, for when the text model can't be used. */
export function fallbackSubject(source: SubjectSource): string {
  for (const name of source.tags) {
    const motif = TAG_MOTIFS[name.trim().toLowerCase()];
    if (motif) return `Subject: ${motif}.`;
  }
  const seed = `${source.url}|${source.tags.join(",")}`;
  return `Subject: ${GENERIC_MOTIFS[hash(seed) % GENERIC_MOTIFS.length]}.`;
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (Math.imul(h, 31) + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** The full image prompt: the fixed style, then the subject sentence. */
export function buildImagePrompt(subject: string): string {
  return `${BLUEPRINT_STYLE} ${subject}`;
}
