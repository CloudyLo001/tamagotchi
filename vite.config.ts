import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/tamagotchi/" : "/",
  server: {
    // Respect a harness-assigned port when present (PORT env), else default.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
});
