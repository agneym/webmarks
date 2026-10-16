// Bundles the popup and service worker with esbuild and copies the static
// files (manifest, popup HTML/CSS, icons) into dist/, which Chrome loads
// unpacked.
import { build } from "esbuild";
import { cp, rm } from "node:fs/promises";

const outdir = new URL("./dist/", import.meta.url).pathname;

await rm(outdir, { recursive: true, force: true });
await cp(new URL("./static/", import.meta.url).pathname, outdir, { recursive: true });
await build({
  entryPoints: ["src/popup.ts", "src/background.ts"],
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir,
  minify: process.argv.includes("--minify"),
  sourcemap: process.argv.includes("--minify") ? false : "linked",
  logLevel: "info",
});
