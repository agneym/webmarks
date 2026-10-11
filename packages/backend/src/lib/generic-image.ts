/**
 * The generic blueprint shown when a bookmark's own image can't be generated
 * (the text model fails or says nothing usable, or the image model errors).
 *
 * A hand-drawn SVG in the same style as the generated images: an isometric
 * modular block with dimension lines on cobalt blueprint paper. No text.
 */

export const GENERIC_IMAGE_PATH = "/images/generic.svg";

/** Can change between deploys, so it's cached for a day rather than forever. */
export const GENERIC_IMAGE_CACHE_CONTROL = "public, max-age=86400";

/** Absolute URL of the generic image, stored in `bookmark.image`. */
export function genericImageUrl(baseUrl: string): string {
  return new URL(GENERIC_IMAGE_PATH, baseUrl).toString();
}

export function isGenericImageUrl(image: string | null | undefined, baseUrl: string): boolean {
  return !!image && image === genericImageUrl(baseUrl);
}

export const GENERIC_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 432" width="768" height="432">
  <defs>
    <pattern id="minor" width="16" height="16" patternUnits="userSpaceOnUse">
      <path d="M16 0H0V16" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
    <pattern id="major" width="80" height="80" patternUnits="userSpaceOnUse">
      <rect width="80" height="80" fill="url(#minor)"/>
      <path d="M80 0H0V80" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="768" height="432" fill="#1f5fbf"/>
  <rect width="768" height="432" fill="url(#major)"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="#f4fbff" stroke-width="2">
      <path d="M384 120 L480 175 L384 230 L288 175 Z"/>
      <path d="M288 175 V285 L384 340 V230"/>
      <path d="M480 175 V285 L384 340"/>
    </g>
    <g stroke="#a8e6ff" stroke-width="1.25">
      <path d="M336 147.5 L432 202.5 M432 147.5 L336 202.5"/>
      <path d="M288 230 L384 285 L480 230"/>
      <path d="M384 285 V340"/>
      <path d="M336 202.5 V312.5 M432 202.5 V312.5"/>
      <ellipse cx="384" cy="175" rx="38" ry="22"/>
      <ellipse cx="384" cy="175" rx="14" ry="8"/>
      <path d="M384 175 V96"/>
      <circle cx="384" cy="92" r="4"/>
    </g>
    <g stroke="#a8e6ff" stroke-width="1" stroke-opacity="0.85">
      <path d="M268 186 V296 M262 186 H274 M262 296 H274"/>
      <path d="M262 186 L268 192 L274 186 M262 296 L268 290 L274 296"/>
      <path d="M296 352 L384 402 L472 352"/>
      <path d="M290 348 L302 356 M466 356 L478 348 M378 398 L390 406"/>
      <path d="M500 175 H560 M500 285 H560 M548 175 V285"/>
      <path d="M542 181 L548 175 L554 181 M542 279 L548 285 L554 279"/>
    </g>
    <g stroke="#ffffff" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4 6">
      <path d="M384 60 V96 M384 340 V380"/>
      <path d="M220 175 H288 M480 175 H500"/>
    </g>
    <g stroke="#a8e6ff" stroke-width="1" stroke-opacity="0.6">
      <circle cx="160" cy="100" r="18"/>
      <path d="M142 100 H178 M160 82 V118"/>
      <circle cx="616" cy="336" r="12"/>
      <path d="M604 336 H628 M616 324 V348"/>
    </g>
  </g>
</svg>
`;
