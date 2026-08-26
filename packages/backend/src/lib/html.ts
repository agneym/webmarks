/**
 * Minimal HTML response helpers shared by the browser-facing routes
 * (CLI login, device verification). Kept dependency-free on purpose.
 */

/** Wrap a body fragment in the shared dark-themed page shell. */
export function html(body: string, status = 200) {
  return new Response(
    `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Webmarks</title>
<style>
  body { font-family: system-ui, sans-serif; background: #111; color: #eee;
         display: flex; justify-content: center; padding-top: 4rem; }
  .card { background: #1c1c1c; border-radius: 8px; padding: 2rem;
          max-width: 24rem; width: 100%; }
  input, button { width: 100%; box-sizing: border-box; margin-top: .75rem;
                  padding: .6rem; border-radius: 6px; border: 1px solid #444;
                  font-size: 1rem; }
  button { background: #3b82f6; color: white; border: none; cursor: pointer; }
  button.secondary { background: #444; }
  .err { color: #f87171; min-height: 1.2rem; margin-top: .75rem; font-size: .9rem; }
</style>
</head>
<body>
${body}
</body>
</html>`,
    { status, headers: { "content-type": "text/html;charset=utf-8" } },
  );
}

/** Escape untrusted text before interpolating into HTML/JS payloads. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
