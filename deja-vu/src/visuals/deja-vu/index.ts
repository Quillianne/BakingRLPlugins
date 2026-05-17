import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type DejaVuPlayer = {
  id: string;
  name: string;
  encounterCount: number;
};

type DejaVuTeam = {
  teamNum: number;
  name: string;
  color: string;
  players: DejaVuPlayer[];
};

type DejaVuState = {
  version: 1;
  currentMatchGuid: string | null;
  teams: DejaVuTeam[];
  updatedAtMs: number;
};

type DejaVuSettings = {
  maxPlayers: number;
  localPlayerName: string | null;
};

type DejaVuInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

type VisualContextWithMode = VisualContext & {
  mode?: "runtime" | "editor";
};

const STATE_EVENT = "plugin.com.bakingrl.deja-vu.state";
const STATE_KEY = "plugin.com.bakingrl.deja-vu.state";
const instances = new Map<HTMLElement, DejaVuInstance>();

function readSettings(settings: Record<string, unknown>): DejaVuSettings {
  return {
    maxPlayers: clampInt(settings.maxPlayers, 4, 1, 16),
    localPlayerName: cleanString(settings.localPlayerName)
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedPlayerName(value: unknown) {
  return cleanString(value)?.toLowerCase() ?? "";
}

function isPlayer(value: unknown): value is DejaVuPlayer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const player = value as Partial<DejaVuPlayer>;
  return typeof player.id === "string" && typeof player.name === "string" && typeof player.encounterCount === "number";
}

function isTeam(value: unknown): value is DejaVuTeam {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const team = value as Partial<DejaVuTeam>;
  return (
    typeof team.teamNum === "number" &&
    typeof team.name === "string" &&
    typeof team.color === "string" &&
    Array.isArray(team.players) &&
    team.players.every(isPlayer)
  );
}

function isState(value: unknown): value is DejaVuState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<DejaVuState>;
  return state.version === 1 && Array.isArray(state.teams) && state.teams.every(isTeam);
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

function renderPlayerTemplate(team: DejaVuTeam, player: DejaVuPlayer) {
  const color = safeColor(team.color, fallbackColor(team.teamNum));
  const count = Math.max(0, Math.trunc(player.encounterCount));
  return `
    <li class="player-row" style="--team-color:${escapeHtml(color)}">
      <span class="player-name">${escapeHtml(player.name)}</span>
      <span class="seen-count">${count}</span>
    </li>
  `;
}

function renderDejaVuTemplate(state: DejaVuState | null, settings: DejaVuSettings) {
  const localPlayerName = normalizedPlayerName(settings.localPlayerName);
  const players = (state?.teams ?? [])
    .flatMap((team) => team.players.map((player) => ({ team, player })))
    .filter(({ player }) => !localPlayerName || normalizedPlayerName(player.name) !== localPlayerName)
    .slice(0, settings.maxPlayers);
  return templateHtml
    .replace("{{rowCount}}", String(Math.max(1, players.length || settings.maxPlayers)))
    .replace("{{players}}", players.map(({ team, player }) => renderPlayerTemplate(team, player)).join(""));
}

function renderDejaVuShellTemplate() {
  return `<style>${styleCss}</style>${renderDejaVuTemplate(null, { maxPlayers: 4, localPlayerName: null })}`;
}

function editorDejaVuState(): DejaVuState {
  return {
    version: 1,
    currentMatchGuid: "editor-preview",
    teams: [
      {
        teamNum: 0,
        name: "Blue",
        color: "#3b82f6",
        players: [
          { id: "editor-blue-1", name: "M0nkey M00n", encounterCount: 7 },
          { id: "editor-blue-2", name: "ExoTiiK", encounterCount: 4 },
          { id: "editor-blue-3", name: "Seikoo", encounterCount: 3 }
        ]
      },
      {
        teamNum: 1,
        name: "Orange",
        color: "#f97316",
        players: [
          { id: "editor-orange-1", name: "Vatira", encounterCount: 8 },
          { id: "editor-orange-2", name: "Atow", encounterCount: 5 },
          { id: "editor-orange-3", name: "Rise", encounterCount: 2 }
        ]
      }
    ],
    updatedAtMs: 1_710_000_000_000
  };
}

function isEditorMode(context: VisualContext) {
  return (context as VisualContextWithMode).mode === "editor";
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    const editorMode = isEditorMode(context);
    let state: DejaVuState | null = editorMode ? editorDejaVuState() : null;

    context.root.innerHTML = renderDejaVuShellTemplate();

    function render() {
      const style = context.root.querySelector("style")?.outerHTML ?? "";
      context.root.innerHTML = `${style}${renderDejaVuTemplate(state, settings)}`;
    }

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        render();
      }
    });

    const cleanup = context.bus.subscribe(STATE_EVENT, (event: BakingRLEvent<unknown>) => {
      if (isState(event.Data)) {
        state = event.Data;
        render();
      }
    });

    if (!editorMode) {
      try {
        const registryState = await context.registry.get(STATE_KEY);
        if (isState(registryState)) {
          state = registryState;
        }
      } catch (error) {
        context.diagnostics.warn("Unable to read Deja Vu registry state.", error);
      }
    }

    render();

    return () => {
      instances.delete(context.root);
      cleanup();
    };
  },
  update(context: VisualContext) {
    instances.get(context.root)?.updateSettings(context.settings);
  }
});
