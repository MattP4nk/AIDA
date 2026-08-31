import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Vite's default order resolves .js before .ts. A stale compiled
    // shared/types.js used to shadow shared/types.ts, so tsc and Vite silently
    // disagreed on what `../../../shared/types` meant. The artifact is gone and
    // gitignored, but pinning the order keeps it from ever recurring.
    extensions: [".ts", ".js", ".mjs", ".mts", ".jsx", ".tsx", ".json", ".svelte"],
  },
  server: {
    port: 8080,
    host: true,
  },
});
