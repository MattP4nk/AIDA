import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Fail the PRODUCTION build loudly when the API URL is unset.
  //
  // `api.ts` falls back to `http://localhost:3001/api`, which is correct for dev
  // and silently wrong in a deployed bundle: the value is baked in at BUILD time,
  // so a missing var ships an app that points every request at the user's own
  // machine and fails with opaque connection errors at runtime. Cheaper to stop
  // the build than to debug the artifact.
  if (mode === "production" && !process.env.VITE_API_URL) {
    throw new Error(
      "VITE_API_URL is not set.\n" +
        "It is baked into the bundle at build time, so a production build without it " +
        "ships a client pointing at http://localhost:3001.\n" +
        "Set it in the environment or in client/.env — see client/.env.example.",
    );
  }

  return {
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
  };
});
