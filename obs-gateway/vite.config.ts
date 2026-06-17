import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    ssr: true,
    rollupOptions: {
      external: [/^node:/],
      preserveEntrySignatures: "strict",
      input: {
        "extension/index": "src/extension/index.ts",
        "services/obs-gateway": "src/services/obs-gateway/index.ts"
      },
      output: {
        entryFileNames: "[name].js",
        format: "es"
      }
    }
  }
});
