import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        "services/bo-tracker": "src/services/bo-tracker/index.ts",
        "visuals/control-panel": "src/visuals/control-panel/index.ts",
        "visuals/goal": "src/visuals/goal/index.ts",
        "visuals/player-boost": "src/visuals/player-boost/index.ts",
        "visuals/player-stats": "src/visuals/player-stats/index.ts",
        "visuals/scoreboard": "src/visuals/scoreboard/index.ts",
        "visuals/team-events": "src/visuals/team-events/index.ts",
        "visuals/victory": "src/visuals/victory/index.ts"
      },
      output: {
        entryFileNames: "[name].js",
        format: "es"
      }
    }
  }
});
