import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        "services/bo-tracker": "src/services/bo-tracker/index.ts",
        "visuals/control-panel": "src/visuals/control-panel/index.ts"
      },
      output: {
        entryFileNames: "[name].js",
        format: "es"
      }
    }
  }
});
