import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Workers AI only exists remotely. Tests must never call it (or need
      // Cloudflare credentials), so they inject a fake `AI` instead.
      remoteBindings: false,
    }),
  ],
  test: {
    passWithNoTests: true,
  },
});
