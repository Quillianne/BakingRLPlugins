import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        "components/cage-map": "src/components/cage-map/index.ts",
        "services/cage-stats": "src/services/cage-stats/index.ts",
        "visuals/cage-stats": "src/visuals/cage-stats/index.ts"
      },
      output: {
        entryFileNames: "[name].js",
        format: "es"
      }
    }
  }
});
