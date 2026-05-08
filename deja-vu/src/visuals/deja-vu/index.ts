import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";

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
};

const STATE_EVENT = "plugin.com.bakingrl.deja-vu.state";
const STATE_KEY = "plugin.com.bakingrl.deja-vu.state";

function readSettings(settings: Record<string, unknown>): DejaVuSettings {
  return {
    maxPlayers: clampInt(settings.maxPlayers, 8, 1, 16)
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
    typeof player.teamNum === "number"
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

function renderPlayer(player: CurrentPlayer) {
  const color = safeColor(player.teamColor, fallbackColor(player.teamNum));
  return `<li class="player-name" style="--team-color:${escapeHtml(color)}">${escapeHtml(player.name)}</li>`;
}

function renderState(state: DejaVuState | null, settings: DejaVuSettings) {
  const players = (state?.currentPlayers ?? []).slice(0, settings.maxPlayers);
  return `
    <ul class="deja-vu">
      ${players.map((player) => renderPlayer(player)).join("")}
    </ul>
  `;
}

export default defineVisual({
  async mount(context: VisualContext) {
    const settings = readSettings(context.settings);
    let state: DejaVuState | null = null;

    context.root.innerHTML = `
      <style>
        :root,
        body {
          margin: 0;
          background: transparent;
        }
        .deja-vu {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 6px;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          overflow: hidden;
          list-style: none;
          background: transparent;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0;
        }
        .player-name {
          max-width: 100%;
          overflow: hidden;
          color: var(--team-color);
          font-size: 28px;
          font-weight: 800;
          line-height: 1.08;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-shadow: 0 2px 7px rgba(0, 0, 0, 0.72);
        }
      </style>
      <ul class="deja-vu"></ul>
    `;

    function render() {
      const style = context.root.querySelector("style")?.outerHTML ?? "";
      context.root.innerHTML = `${style}${renderState(state, settings)}`;
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
