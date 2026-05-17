import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        "services/bo-tracker": "src/services/bo-tracker/index.ts",
        "services/cage-stats": "src/services/cage-stats/index.ts",
        "services/game-sequence": "src/services/game-sequence/index.ts",
        "services/player-stats": "src/services/player-stats/index.ts",
        "services/regie-controller": "src/services/regie-controller/index.ts",
        "visuals/bo-control": "src/visuals/control-panel/index.ts",
        "visuals/cage-stats": "src/visuals/cage-stats/index.ts",
        "visuals/fullscreen-stats": "src/visuals/fullscreen-stats/index.ts",
        "visuals/goal-animation": "src/visuals/goal/index.ts",
        "visuals/player-boost": "src/visuals/player-boost/index.ts",
        "visuals/player-stat-live": "src/visuals/player-stats/index.ts",
        "visuals/scoreboard": "src/visuals/scoreboard/index.ts",
        "visuals/statistics": "src/visuals/statistics/index.ts",
        "visuals/team-preview-live": "src/visuals/team-events/index.ts",
        "visuals/victory-animation": "src/visuals/victory/index.ts"
      },
      output: {
        entryFileNames: "[name].js",
        format: "es"
      }
    }
  }
});
