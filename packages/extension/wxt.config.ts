import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-svelte", "@wxt-dev/auto-icons"],
  autoIcons: { baseIconPath: "assets/icon.svg" },
  manifest: {
    name: "Webmarks",
    description: "Save the current tab to webmarks.",
    action: { default_title: "Save to webmarks" },
    permissions: ["activeTab", "storage"],
    host_permissions: ["https://backend.quickread.workers.dev/*"],
    optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  },
});
