import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type CurrentPlayer = {
  id: string;
  primaryId: string | null;
  name: string;
  teamNum: number;
  teamName: string;
  teamColor: string;
  matchGuid: string | null;
  previousMatchCount: number;
  totalMatchCount: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
};

type DejaVuState = {
  version: 1;
  currentMatchGuid: string | null;
  currentPlayers: CurrentPlayer[];
  totalKnownPlayers: number;
  updatedAtMs: number;
};

type DejaVuSettings = {
  maxPlayers: number;
  textSize: number;
};

const STATE_EVENT = "plugin.com.bakingrl.deja-vu.state";
const STATE_KEY = "plugin.com.bakingrl.deja-vu.state";

function readSettings(settings: Record<string, unknown>): DejaVuSettings {
  return {
    maxPlayers: clampInt(settings.maxPlayers, 4, 1, 16),
    textSize: clampInt(settings.textSize, 16, 10, 36)
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isCurrentPlayer(value: unknown): value is CurrentPlayer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const player = value as Partial<CurrentPlayer>;
  return (
    typeof player.id === "string" &&
    typeof player.name === "string" &&
    typeof player.teamNum === "number" &&
    typeof player.previousMatchCount === "number"
  );
}

function isState(value: unknown): value is DejaVuState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<DejaVuState>;
  return state.version === 1 && Array.isArray(state.currentPlayers) && state.currentPlayers.every(isCurrentPlayer);
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeColor(value: unknown, fallback: string) {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color}`;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(color)) {
    return color;
  }
  return fallback;
}

function fallbackColor(teamNum: number) {
  if (teamNum === 0) return "#3b82f6";
  if (teamNum === 1) return "#f97316";
  return "#94a3b8";
}

function renderPlayerTemplate(player: CurrentPlayer) {
  const color = safeColor(player.teamColor, fallbackColor(player.teamNum));
  const count = Math.max(0, Math.trunc(player.previousMatchCount));
  return `
    <li class="player-row" style="--team-color:${escapeHtml(color)}">
      <span class="player-name">${escapeHtml(player.name)}</span>
      <span class="seen-count">${count}</span>
    </li>
  `;
}

function renderDejaVuTemplate(state: DejaVuState | null, settings: DejaVuSettings) {
  const players = (state?.currentPlayers ?? []).slice(0, settings.maxPlayers);
  return templateHtml
    .replace("{{textSize}}", String(settings.textSize))
    .replace("{{players}}", players.map((player) => renderPlayerTemplate(player)).join(""));
}

function renderDejaVuShellTemplate() {
  return `<style>${styleCss}</style>${renderDejaVuTemplate(null, { maxPlayers: 0, textSize: 16 })}`;
}

export default defineVisual({
  async mount(context: VisualContext) {
    const settings = readSettings(context.settings);
    let state: DejaVuState | null = null;

    context.root.innerHTML = renderDejaVuShellTemplate();

    function render() {
      const style = context.root.querySelector("style")?.outerHTML ?? "";
      context.root.innerHTML = `${style}${renderDejaVuTemplate(state, settings)}`;
    }

    const cleanup = context.bus.subscribe(STATE_EVENT, (event: BakingRLEvent<unknown>) => {
      if (isState(event.Data)) {
        state = event.Data;
        render();
      }
    });

    try {
      const registryState = await context.registry.get(STATE_KEY);
      if (isState(registryState)) {
        state = registryState;
      }
    } catch (error) {
      context.diagnostics.warn("Unable to read Deja Vu registry state.", error);
    }

    render();

    return () => {
      cleanup();
    };
  }
});
