import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import {
  PLAYER_STATS_EVENT,
  REGIE_EVENT,
  type RegieCommand
} from "../../shared/events";
import {
  escapeHtml,
  pickHeadToHeadPlayers,
  renderPlayerCard,
  statLine,
  teamForPlayer
} from "../../shared/stat-components";
import {
  CAST_TRANSITION_EXIT_MS,
  type CastTransitionPhase,
  castTransitionCss,
  mountOrUpdateCastTransition
} from "../../shared/cast-transition";
import { editorPlayerStatsState, isEditorMode } from "../editorPreviewData";
import styleCss from "./style.css?raw";

type PublicMetrics = {
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  touches: number;
  demos: number;
  demoedCount: number;
  demoDifferential: number;
  goalParticipation: number;
  goalParticipationPercent: number;
  shootingAccuracyPercent: number;
  averageSpeed: number;
};

type PlayerStats = {
  id: string;
  primaryId: string | null;
  name: string;
  teamNum: number;
  stats: PublicMetrics;
};

type TeamStats = {
  teamNum: number;
  name: string;
  colorPrimary: string | null;
};

type MatchStats = {
  matchGuid: string;
  matchIndex: number;
  teams: TeamStats[];
  players: PlayerStats[];
};

type PlayerStatsState = {
  version: 1;
  bo: {
    teams: TeamStats[];
    players: PlayerStats[];
  };
  matches: MatchStats[];
};

type HeadToHeadSettings = {
  scope: "lastMatch" | "match" | "bo";
  leftPlayerName: string;
  rightPlayerName: string;
  leftPlayerId: string;
  rightPlayerId: string;
  matchIndex: number | null;
  matchGuid: string;
  durationMs: number;
};

type Selection = {
  label: string;
  teams: TeamStats[];
  players: PlayerStats[];
};

type HeadToHeadInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

type EditorVisualContext = VisualContext & {
  editor?: {
    emit(eventName: string, payload?: unknown): void;
  };
};

const SERVICE_REF = "com.bakingrl.cast-package/playerStatsTracker";
const instances = new Map<HTMLElement, HeadToHeadInstance>();

function readSettings(settings: Record<string, unknown>): HeadToHeadSettings {
  return {
    scope: settings.scope === "match" || settings.scope === "bo" ? settings.scope : "lastMatch",
    leftPlayerName: typeof settings.leftPlayerName === "string" ? settings.leftPlayerName.trim() : "",
    rightPlayerName: typeof settings.rightPlayerName === "string" ? settings.rightPlayerName.trim() : "",
    leftPlayerId: typeof settings.leftPlayerId === "string" ? settings.leftPlayerId.trim() : "",
    rightPlayerId: typeof settings.rightPlayerId === "string" ? settings.rightPlayerId.trim() : "",
    matchIndex: typeof settings.matchIndex === "number" && Number.isFinite(settings.matchIndex) ? Math.trunc(settings.matchIndex) : null,
    matchGuid: typeof settings.matchGuid === "string" ? settings.matchGuid.trim() : "",
    durationMs: typeof settings.durationMs === "number" && Number.isFinite(settings.durationMs)
      ? Math.max(500, Math.min(60000, Math.trunc(settings.durationMs)))
      : 8000
  };
}

function overrideSettings(settings: HeadToHeadSettings, payload: Record<string, unknown>): HeadToHeadSettings {
  return readSettings({ ...settings, ...payload });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStatsState(value: unknown): value is PlayerStatsState {
  return isRecord(value) && value.version === 1 && isRecord(value.bo) && Array.isArray(value.matches);
}

function isRegieCommand(value: unknown): value is RegieCommand {
  return isRecord(value) && value.version === 1 && (value.action === "trigger" || value.action === "clear");
}

function latestMatch(state: PlayerStatsState) {
  return [...state.matches].sort((left, right) => left.matchIndex - right.matchIndex).at(-1) ?? null;
}

function matchForSettings(state: PlayerStatsState, settings: HeadToHeadSettings) {
  if (settings.matchGuid) return state.matches.find((match) => match.matchGuid === settings.matchGuid) ?? null;
  if (settings.matchIndex !== null) return state.matches.find((match) => match.matchIndex === settings.matchIndex) ?? null;
  return latestMatch(state);
}

function selectHeadToHeadStats(state: PlayerStatsState | null, settings: HeadToHeadSettings): Selection {
  if (!state) return { label: "No stats", teams: [], players: [] };
  if (settings.scope === "bo") return { label: "BO", teams: state.bo.teams, players: state.bo.players };
  const match = settings.scope === "match" ? matchForSettings(state, settings) : latestMatch(state);
  return {
    label: match ? `Match ${match.matchIndex}` : "Match",
    teams: match?.teams ?? [],
    players: match?.players ?? []
  };
}

function findPlayer(players: PlayerStats[], id: string, name: string) {
  const lowerName = name.toLowerCase();
  if (id) return players.find((player) => player.id === id || player.primaryId === id) ?? null;
  if (name) return players.find((player) => player.name.trim().toLowerCase() === lowerName) ?? null;
  return null;
}

function renderContent(state: PlayerStatsState | null, settings: HeadToHeadSettings) {
  const selection = selectHeadToHeadStats(state, settings);
  const [left, right] = pickHeadToHeadPlayers(selection, {
    id: settings.leftPlayerId,
    name: settings.leftPlayerName
  }, {
    id: settings.rightPlayerId,
    name: settings.rightPlayerName
  });
  const leftTeam = teamForPlayer(selection.teams, left);
  const rightTeam = teamForPlayer(selection.teams, right);

  return `
    <section class="head-to-head">
      <header>
        <span>${escapeHtml(selection.label)}</span>
        <strong>Head to Head</strong>
      </header>
      <div class="players">
        ${renderPlayerCard(left, leftTeam, "left")}
        <div class="versus">VS</div>
        ${renderPlayerCard(right, rightTeam, "right")}
      </div>
      <div class="comparison">
        ${statLine("Goals", left?.stats.goals ?? 0, right?.stats.goals ?? 0)}
        ${statLine("Assists", left?.stats.assists ?? 0, right?.stats.assists ?? 0)}
        ${statLine("Shots", left?.stats.shots ?? 0, right?.stats.shots ?? 0)}
        ${statLine("Accuracy", left?.stats.shootingAccuracyPercent ?? 0, right?.stats.shootingAccuracyPercent ?? 0, "%")}
        ${statLine("GPAR", left?.stats.goalParticipation ?? 0, right?.stats.goalParticipation ?? 0)}
        ${statLine("Demos +/-", left?.stats.demoDifferential ?? 0, right?.stats.demoDifferential ?? 0)}
        ${statLine("Avg speed", left?.stats.averageSpeed ?? 0, right?.stats.averageSpeed ?? 0)}
      </div>
    </section>
  `;
}

function regiePayload(settings: HeadToHeadSettings) {
  return {
    scope: settings.scope,
    leftPlayerName: settings.leftPlayerName,
    rightPlayerName: settings.rightPlayerName,
    leftPlayerId: settings.leftPlayerId,
    rightPlayerId: settings.rightPlayerId,
    matchIndex: settings.matchIndex,
    matchGuid: settings.matchGuid
  };
}

function emitEditorRegie(context: VisualContext, command: Omit<RegieCommand, "version" | "id" | "updatedAtMs">) {
  const now = Date.now();
  (context as EditorVisualContext).editor?.emit(REGIE_EVENT, {
    version: 1,
    id: `editor-headToHead-${now}`,
    updatedAtMs: now,
    ...command
  } satisfies RegieCommand);
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    const editorMode = isEditorMode(context);
    let activeSettings: HeadToHeadSettings | null = null;
    let state: PlayerStatsState | null = editorMode ? editorPlayerStatsState() : null;
    let clearTimer: number | null = null;
    let exitTimer: number | null = null;
    let phase: CastTransitionPhase = "hidden";

    function render() {
      mountOrUpdateCastTransition(context.root, `${castTransitionCss}${styleCss}`, renderContent(state, activeSettings ?? settings), {
        className: "head-to-head-event",
        phase,
        contentClass: "ge-data-card"
      });
    }

    function clearExitTimer() {
      if (exitTimer !== null) {
        window.clearTimeout(exitTimer);
        exitTimer = null;
      }
    }

    function show() {
      clearExitTimer();
      phase = "active";
      context.setActive(true);
      render();
    }

    function hide() {
      if (phase !== "active" || !activeSettings) return;
      clearExitTimer();
      phase = "exiting";
      render();
      exitTimer = window.setTimeout(() => {
        activeSettings = null;
        phase = "hidden";
        context.setActive(false);
        render();
        exitTimer = null;
      }, CAST_TRANSITION_EXIT_MS);
    }

    function scheduleClear(durationMs: number) {
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => {
        hide();
        clearTimer = null;
      }, durationMs);
    }

    async function loadSnapshot() {
      if (editorMode) {
        render();
        return;
      }
      try {
        const snapshot = await context.services.call(SERVICE_REF, "snapshot");
        if (isStatsState(snapshot)) state = snapshot;
      } catch (error) {
        context.diagnostics.warn("Unable to read player stats snapshot for head-to-head.", error);
      }
      render();
    }

    render();
    context.setActive(false);
    await loadSnapshot();

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        render();
      }
    });

    const cleanups = [
      context.bus.subscribe(PLAYER_STATS_EVENT, (event: BakingRLEvent<unknown>) => {
        if (isStatsState(event.Data)) {
          state = event.Data;
          render();
        }
      }),
      context.bus.subscribe(REGIE_EVENT, (event: BakingRLEvent<unknown>) => {
        if (!isRegieCommand(event.Data)) return;
        const command = event.Data;
        if (command.cue !== undefined && command.cue !== "headToHead") return;
        if (command.action === "clear") {
          hide();
          return;
        }
        activeSettings = overrideSettings(settings, command.payload);
        show();
        scheduleClear(command.durationMs || settings.durationMs);
      })
    ];

    return () => {
      instances.delete(context.root);
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      clearExitTimer();
      context.setActive(false);
      for (const cleanup of cleanups) cleanup();
    };
  },
  update(context: VisualContext) {
    instances.get(context.root)?.updateSettings(context.settings);
  },
  editor: {
    actions() {
      return [
        {
          id: "trigger",
          label: "Trigger Head to Head",
          run(context: VisualContext) {
            const settings = readSettings(context.settings);
            emitEditorRegie(context, {
              action: "trigger",
              cue: "headToHead",
              payload: regiePayload(settings),
              durationMs: settings.durationMs
            });
          }
        },
        {
          id: "clear",
          label: "Clear Head to Head",
          run(context: VisualContext) {
            emitEditorRegie(context, {
              action: "clear",
              cue: "headToHead",
              payload: {},
              durationMs: 0
            });
          }
        }
      ];
    }
  }
});
