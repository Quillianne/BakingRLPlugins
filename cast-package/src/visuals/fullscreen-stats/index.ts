import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import {
  CAGE_STATS_EVENT,
  CAGE_STATS_KEY,
  PLAYER_STATS_EVENT,
  REGIE_EVENT,
  type RegieCommand,
  type RegieCue
} from "../../shared/events";
import {
  escapeHtml,
  pickHeadToHeadPlayers,
  selectStats,
  statLine,
  teamForPlayer,
  renderPlayerCard,
  type PlayerStatsState,
  type StatsScope,
  type StatsView
} from "../../shared/stat-components";
import {
  CAST_TRANSITION_EXIT_MS,
  type CastTransitionPhase,
  castTransitionCss,
  mountOrUpdateCastTransition
} from "../../shared/cast-transition";
import { cageMapStyles } from "../../shared/cage-map";
import { editorCageStatsState, editorPlayerStatsState, isEditorMode } from "../editorPreviewData";
import {
  readCageStatsSettings,
  renderCageStatsContent,
  type CageStatsSettings,
  type CageStatsState
} from "../cage-stats";
import { readStatisticsSettings, renderStatisticsContent } from "../statistics";
import cageStatsCss from "../cage-stats/style.css?raw";
import headToHeadCss from "../head-to-head/style.css?raw";
import statisticsCss from "../statistics/style.css?raw";
import styleCss from "./style.css?raw";

type FullscreenStatsSettings = {
  durationMs: number;
};

type HeadToHeadSettings = {
  scope: StatsScope;
  leftPlayerName: string;
  rightPlayerName: string;
  leftPlayerId: string;
  rightPlayerId: string;
  matchIndex: number | null;
  matchGuid: string;
};

type ActiveContent =
  | {
      kind: "cageStats";
      settings: CageStatsSettings;
    }
  | {
      kind: "headToHead";
      settings: HeadToHeadSettings;
    }
  | {
      kind: "statistics";
      view: StatsView;
      settings: ReturnType<typeof readStatisticsSettings>;
    };

type FullscreenStatsInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

type EditorVisualContext = VisualContext & {
  editor?: {
    emit(eventName: string, payload?: unknown): void;
  };
};

const DEFAULT_DURATION_MS = 8000;
const STATS_SERVICE_REF = "com.bakingrl.cast-package/playerStatsTracker";
const instances = new Map<HTMLElement, FullscreenStatsInstance>();

function readSettings(settings: Record<string, unknown>): FullscreenStatsSettings {
  return {
    durationMs: typeof settings.durationMs === "number" && Number.isFinite(settings.durationMs)
      ? Math.max(500, Math.min(60000, Math.trunc(settings.durationMs)))
      : DEFAULT_DURATION_MS
  };
}

function readHeadToHeadSettings(settings: Record<string, unknown>): HeadToHeadSettings {
  return {
    scope: settings.scope === "match" || settings.scope === "bo" ? settings.scope : "lastMatch",
    leftPlayerName: typeof settings.leftPlayerName === "string" ? settings.leftPlayerName.trim() : "",
    rightPlayerName: typeof settings.rightPlayerName === "string" ? settings.rightPlayerName.trim() : "",
    leftPlayerId: typeof settings.leftPlayerId === "string" ? settings.leftPlayerId.trim() : "",
    rightPlayerId: typeof settings.rightPlayerId === "string" ? settings.rightPlayerId.trim() : "",
    matchIndex: typeof settings.matchIndex === "number" && Number.isFinite(settings.matchIndex) ? Math.trunc(settings.matchIndex) : null,
    matchGuid: typeof settings.matchGuid === "string" ? settings.matchGuid.trim() : ""
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStatsState(value: unknown): value is PlayerStatsState {
  return isRecord(value) && value.version === 1 && isRecord(value.bo) && Array.isArray(value.matches);
}

function isCageStatsState(value: unknown): value is CageStatsState {
  return isRecord(value) && value.version === 1 && isRecord(value.config) && Array.isArray(value.records);
}

function isRegieCommand(value: unknown): value is RegieCommand {
  return isRecord(value) && value.version === 1 && (value.action === "trigger" || value.action === "clear");
}

function viewFromCue(cue: RegieCue | undefined, payload: Record<string, unknown>): StatsView {
  if (cue === "teamSummary") return "teamSummary";
  if (cue === "teamDetail") return "teamDetail";
  return payload.view === "teamSummary" || payload.view === "player" ? payload.view : "teamDetail";
}

function activeContentFromCommand(command: RegieCommand): ActiveContent {
  const payload = command.payload;
  if (command.cue === "cageStats") {
    return {
      kind: "cageStats",
      settings: readCageStatsSettings(payload)
    };
  }
  if (command.cue === "headToHead") {
    return {
      kind: "headToHead",
      settings: readHeadToHeadSettings(payload)
    };
  }

  const view = viewFromCue(command.cue, payload);
  return {
    kind: "statistics",
    view,
    settings: readStatisticsSettings({ ...payload, view }, view)
  };
}

function renderHeadToHeadContent(state: PlayerStatsState | null, settings: HeadToHeadSettings) {
  const selection = selectStats(state, settings);
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

function renderActiveContent(active: ActiveContent | null, statsState: PlayerStatsState | null, cageState: CageStatsState | null) {
  if (!active) return `<div class="fullscreen-stats-empty"></div>`;
  if (active.kind === "cageStats") return renderCageStatsContent(cageState, active.settings);
  if (active.kind === "headToHead") return renderHeadToHeadContent(statsState, active.settings);
  return renderStatisticsContent(statsState, active.settings);
}

function emitEditorRegie(context: VisualContext, command: Omit<RegieCommand, "version" | "id" | "updatedAtMs">) {
  const now = Date.now();
  (context as EditorVisualContext).editor?.emit(REGIE_EVENT, {
    version: 1,
    id: `editor-fullscreenStats-${command.cue ?? "regie"}-${now}`,
    updatedAtMs: now,
    ...command
  } satisfies RegieCommand);
}

function combinedStyles() {
  return [
    castTransitionCss,
    styleCss,
    statisticsCss,
    headToHeadCss,
    cageStatsCss.replace("{{cageMapStyles}}", cageMapStyles)
  ].join("\n");
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    const editorMode = isEditorMode(context);
    let statsState: PlayerStatsState | null = editorMode ? editorPlayerStatsState() : null;
    let cageState: CageStatsState | null = editorMode ? editorCageStatsState() : null;
    let active: ActiveContent | null = null;
    let clearTimer: number | null = null;
    let exitTimer: number | null = null;
    let phase: CastTransitionPhase = "hidden";

    function render() {
      mountOrUpdateCastTransition(context.root, combinedStyles(), renderActiveContent(active, statsState, cageState), {
        className: "fullscreen-stats-event",
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

    function show(command: RegieCommand) {
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      clearExitTimer();
      active = activeContentFromCommand(command);
      phase = "active";
      context.setActive(true);
      render();
      clearTimer = window.setTimeout(() => {
        hide();
        clearTimer = null;
      }, command.durationMs || settings.durationMs);
    }

    function hide() {
      if (phase !== "active" || !active) return;
      clearExitTimer();
      phase = "exiting";
      render();
      exitTimer = window.setTimeout(() => {
        active = null;
        phase = "hidden";
        context.setActive(false);
        render();
        exitTimer = null;
      }, CAST_TRANSITION_EXIT_MS);
    }

    render();
    context.setActive(false);

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
      }
    });

    const cleanups = [
      context.bus.subscribe(PLAYER_STATS_EVENT, (event: BakingRLEvent<unknown>) => {
        if (isStatsState(event.Data)) {
          statsState = event.Data;
          if (active?.kind === "statistics" || active?.kind === "headToHead") render();
        }
      }),
      context.bus.subscribe(CAGE_STATS_EVENT, (event: BakingRLEvent<unknown>) => {
        if (isCageStatsState(event.Data)) {
          cageState = event.Data;
          if (active?.kind === "cageStats") render();
        }
      }),
      context.bus.subscribe(REGIE_EVENT, (event: BakingRLEvent<unknown>) => {
        if (!isRegieCommand(event.Data)) return;
        const command = event.Data;
        if (command.action === "clear") {
          hide();
          return;
        }
        show(command);
      })
    ];

    if (!editorMode) {
      try {
        const snapshot = await context.services.call(STATS_SERVICE_REF, "snapshot");
        if (isStatsState(snapshot)) statsState = snapshot;
      } catch (error) {
        context.diagnostics.warn("Unable to read player stats snapshot for fullscreen stats.", error);
      }
      try {
        const registryState = await context.registry.get(CAGE_STATS_KEY);
        if (isCageStatsState(registryState)) cageState = registryState;
      } catch (error) {
        context.diagnostics.warn("Unable to read Cage Stats registry state for fullscreen stats.", error);
      }
    }

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
          id: "trigger-team-detail",
          label: "Trigger Team Detail",
          run(context: VisualContext) {
            const settings = readSettings(context.settings);
            emitEditorRegie(context, {
              action: "trigger",
              cue: "teamDetail",
              payload: { scope: "bo", view: "teamDetail" },
              durationMs: settings.durationMs
            });
          }
        },
        {
          id: "trigger-team-summary",
          label: "Trigger Team Summary",
          run(context: VisualContext) {
            const settings = readSettings(context.settings);
            emitEditorRegie(context, {
              action: "trigger",
              cue: "teamSummary",
              payload: { scope: "bo", view: "teamSummary" },
              durationMs: settings.durationMs
            });
          }
        },
        {
          id: "trigger-head-to-head",
          label: "Trigger Head to Head",
          run(context: VisualContext) {
            const settings = readSettings(context.settings);
            emitEditorRegie(context, {
              action: "trigger",
              cue: "headToHead",
              payload: { scope: "bo" },
              durationMs: settings.durationMs
            });
          }
        },
        {
          id: "trigger-cage-stats",
          label: "Trigger Cage Stats",
          run(context: VisualContext) {
            const settings = readSettings(context.settings);
            emitEditorRegie(context, {
              action: "trigger",
              cue: "cageStats",
              payload: { scope: "bothCages" },
              durationMs: settings.durationMs
            });
          }
        },
        {
          id: "clear",
          label: "Clear Fullscreen Stats",
          run(context: VisualContext) {
            emitEditorRegie(context, {
              action: "clear",
              payload: {},
              durationMs: 0
            });
          }
        }
      ];
    }
  }
});
