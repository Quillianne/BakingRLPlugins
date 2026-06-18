import { type BakingRLEvent } from "@bakingrl/plugin-sdk";
import {
  STATE_EVENT,
  STATE_KEY,
  isPublicState,
  type CounterBucket,
  type PublicCurrentPlayer,
  type PublicPlayerStreak,
  type PublicState,
  type RecordScope
} from "../../shared/state";
import { defineVisual, type VisualContext } from "../visualModule";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type Theme = "clean" | "broadcast" | "neon" | "ribbon" | "terminal";
type ModeScope = "all" | "separate";

type PlayerStreakSettings = {
  playerName: string | null;
  scope: RecordScope;
  modeScope: ModeScope;
  theme: Theme;
  showPlayerName: boolean;
  showContext: boolean;
};

type SelectedPlayer = {
  id: string | null;
  name: string;
  teamColor: string;
  record: PublicPlayerStreak | null;
  missing: boolean;
};

type PlayerStreakInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

type VisualContextWithMode = VisualContext & {
  mode?: "runtime" | "editor";
};

const instances = new Map<HTMLElement, PlayerStreakInstance>();

function readSettings(settings: Record<string, unknown>): PlayerStreakSettings {
  return {
    playerName: cleanString(settings.playerName) ?? cleanString(settings.defaultPlayerName),
    scope: settings.scope === "global" ? "global" : "session",
    modeScope: readModeScope(settings.modeScope ?? settings.mode),
    theme: readTheme(settings.theme),
    showPlayerName: settings.showPlayerName !== false,
    showContext: settings.showContext !== false
  };
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function readTheme(value: unknown): Theme {
  if (value === "broadcast" || value === "neon" || value === "ribbon" || value === "terminal") return value;
  return "clean";
}

function readModeScope(value: unknown): ModeScope {
  if (value === "separate" || value === "current" || value === "1v1" || value === "2v2" || value === "3v3" || value === "4v4") {
    return "separate";
  }
  return "all";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function emptyCounter(): CounterBucket {
  return {
    wins: 0,
    losses: 0,
    streak: 0
  };
}

function findRecordById(records: PublicPlayerStreak[], id: string | null) {
  if (!id) return null;
  return records.find((record) => record.id === id) ?? null;
}

function findRecordByName(records: PublicPlayerStreak[], name: string | null) {
  if (!name) return null;
  const normalized = normalizedName(name);
  return (
    records.find(
      (record) => normalizedName(record.name) === normalized || record.aliases.some((alias) => normalizedName(alias) === normalized)
    ) ?? null
  );
}

function findCurrentPlayerByName(players: PublicCurrentPlayer[], name: string | null) {
  if (!name) return null;
  const normalized = normalizedName(name);
  return players.find((player) => normalizedName(player.name) === normalized) ?? null;
}

function selectPlayer(state: PublicState | null, settings: PlayerStreakSettings): SelectedPlayer {
  const records = settings.scope === "global" ? state?.global.players ?? [] : state?.session.players ?? [];
  const currentPlayers = state?.current.players ?? [];
  const configuredName = settings.playerName;

  if (configuredName) {
    const currentPlayer = findCurrentPlayerByName(currentPlayers, configuredName);
    const record = findRecordById(records, currentPlayer?.id ?? null) ?? findRecordByName(records, configuredName);
    return {
      id: currentPlayer?.id ?? record?.id ?? null,
      name: currentPlayer?.name ?? record?.name ?? configuredName,
      teamColor: currentPlayer?.teamColor ?? record?.teamColor ?? "#d9e2ef",
      record,
      missing: !currentPlayer && !record
    };
  }

  const currentTarget = currentPlayers.find((player) => player.id === state?.current.targetPlayerId) ?? currentPlayers[0] ?? null;
  const record = findRecordById(records, currentTarget?.id ?? null) ?? records[0] ?? null;
  return {
    id: currentTarget?.id ?? record?.id ?? null,
    name: currentTarget?.name ?? record?.name ?? "PLAYER",
    teamColor: currentTarget?.teamColor ?? record?.teamColor ?? "#d9e2ef",
    record,
    missing: !currentTarget && !record
  };
}

function resolveMode(settings: PlayerStreakSettings, state: PublicState | null) {
  if (settings.modeScope === "all") return null;
  return state?.current.mode ?? "unknown";
}

function selectedCounter(record: PublicPlayerStreak | null, settings: PlayerStreakSettings, state: PublicState | null) {
  if (!record) return emptyCounter();
  const mode = resolveMode(settings, state);
  if (!mode) return record.all;
  return record.modes[mode] ?? emptyCounter();
}

function scopeLabel(scope: RecordScope) {
  return scope === "global" ? "Global" : "Session";
}

function modeLabel(settings: PlayerStreakSettings, state: PublicState | null) {
  if (settings.modeScope === "all") return "All modes";
  return state?.current.mode && state.current.mode !== "unknown" ? state.current.mode : "Separate modes";
}

function streakText(streak: number) {
  return String(streak);
}

function renderVisual(state: PublicState | null, settings: PlayerStreakSettings) {
  const player = selectPlayer(state, settings);
  const counter = selectedCounter(player.record, settings, state);
  const rootClass = [
    "record",
    `record--${settings.theme}`,
    player.missing ? "record--missing" : "",
    settings.showPlayerName ? "" : "record--hide-name",
    settings.showContext ? "" : "record--hide-context"
  ]
    .filter(Boolean)
    .join(" ");

  return `<style>${styleCss}</style>${fillTemplate(templateHtml, {
    rootClass,
    teamColor: escapeHtml(player.teamColor),
    playerName: escapeHtml(player.name),
    context: escapeHtml(`${scopeLabel(settings.scope)} / ${modeLabel(settings, state)}`),
    wins: String(counter.wins),
    losses: String(counter.losses),
    streak: escapeHtml(streakText(counter.streak))
  })}`;
}

function editorState(): PublicState {
  const sessionPlayer: PublicPlayerStreak = {
    id: "primary:editor-player",
    primaryId: "editor-player",
    name: "Zen",
    aliases: ["Zen"],
    lastTeamNum: 0,
    teamColor: "#2dd4bf",
    all: { wins: 8, losses: 3, streak: 4 },
    modes: {
      "2v2": { wins: 3, losses: 1, streak: 2 },
      "3v3": { wins: 5, losses: 2, streak: 4 }
    },
    updatedAtMs: 1_710_000_000_000
  };
  const globalPlayer: PublicPlayerStreak = {
    ...sessionPlayer,
    all: { wins: 42, losses: 21, streak: -2 },
    modes: {
      "2v2": { wins: 16, losses: 7, streak: 3 },
      "3v3": { wins: 26, losses: 14, streak: -2 }
    }
  };
  return {
    version: 1,
    current: {
      matchGuid: "editor-preview",
      mode: "3v3",
      targetPlayerId: sessionPlayer.id,
      players: [
        {
          id: sessionPlayer.id,
          name: sessionPlayer.name,
          teamNum: 0,
          teamColor: sessionPlayer.teamColor
        }
      ]
    },
    session: {
      players: [sessionPlayer]
    },
    global: {
      players: [globalPlayer]
    },
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
    let state: PublicState | null = editorMode ? editorState() : null;

    function render() {
      context.root.innerHTML = renderVisual(state, settings);
    }

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        render();
      }
    });

    const cleanup = context.bus.subscribe(STATE_EVENT, (event: BakingRLEvent<unknown>) => {
      if (isPublicState(event.Data)) {
        state = event.Data;
        render();
      }
    });

    if (!editorMode) {
      try {
        const registryState = await context.registry.get(STATE_KEY);
        if (isPublicState(registryState)) state = registryState;
      } catch (error) {
        context.diagnostics.warn("Unable to read PlayerStreak registry state.", error);
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
