import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        "extension/index": "src/extension/index.ts",
        "services/bo-tracker": "src/services/bo-tracker/index.ts",
        "services/cage-stats": "src/services/cage-stats/index.ts",
        "services/game-sequence": "src/services/game-sequence/index.ts",
        "services/player-stats": "src/services/player-stats/index.ts",
        "webviews/dashboard": "src/webviews/dashboard/index.ts"
      },
      output: {
        entryFileNames: "[name].js",
        format: "es"
      }
    }
  }
});
