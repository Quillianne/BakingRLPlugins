import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import {
  PLAYER_STATS_EVENT,
  REGIE_EVENT,
  type RegieCommand,
  type RegieCue
} from "../../shared/events";
import {
  escapeHtml as renderEscapeHtml,
  readVisibleMetrics as readComponentVisibleMetrics,
  renderPlayerDetail as renderPlayerStatsComponent,
  renderTeamDetail as renderTeamDetailComponent,
  renderTeamSummary as renderTeamSummaryComponent,
  selectStats as selectStatsComponent,
  type StatsSelection as SharedStatsSelection,
  visibleMetricDefinitions as visibleMetricDefinitionsComponent
} from "../../shared/stat-components";
import {
  CAST_TRANSITION_EXIT_MS,
  type CastTransitionPhase,
  castTransitionCss,
  mountOrUpdateCastTransition
} from "../../shared/cast-transition";
import { editorPlayerStatsState, isEditorMode } from "../editorPreviewData";
import styleCss from "./style.css?raw";

type StatsScope = "lastMatch" | "match" | "bo";
type StatsView = "teamDetail" | "teamSummary" | "player";
type ActivationMode = "always" | "regie";
type StatisticMetric =
  | "score"
  | "goals"
  | "assists"
  | "shots"
  | "saves"
  | "touches"
  | "demos"
  | "demoedCount"
  | "demoDifferential"
  | "goalParticipation"
  | "goalParticipationPercent"
  | "shootingAccuracyPercent"
  | "averageSpeed"
  | "boostConsumed"
  | "zeroBoostSeconds"
  | "supersonicTimePercent"
  | "airTimePercent";

type PublicMetrics = {
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  touches: number;
  demos: number;
  boostConsumed: number;
  demoedCount: number;
  demoDifferential: number;
  goalParticipation: number;
  observedSeconds: number;
  averageSpeed: number;
  zeroBoostSeconds: number;
  goalParticipationPercent: number;
  shootingAccuracyPercent: number;
  supersonicTimePercent: number;
  airTimePercent: number;
};

type PlayerStats = {
  id: string;
  primaryId: string | null;
  name: string;
  teamNum: number;
  matches: number;
  stats: PublicMetrics;
};

type TeamStats = {
  teamNum: number;
  name: string;
  colorPrimary: string | null;
  colorSecondary: string | null;
  players: number;
  matches: number;
  stats: PublicMetrics;
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
    matchCount: number;
    teams: TeamStats[];
    players: PlayerStats[];
  };
  matches: MatchStats[];
  updatedAtMs: number;
};

type StatisticsSettings = {
  scope: StatsScope;
  view: StatsView;
  activationMode: ActivationMode;
  visibleMetrics: StatisticMetric[];
  teamNum: number;
  playerId: string;
  playerName: string;
  matchIndex: number | null;
  matchGuid: string;
  durationMs: number;
};

type Selection = {
  label: string;
  teams: TeamStats[];
  players: PlayerStats[];
};

type StatisticsInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

type StatisticsVisualOptions = {
  defaultActivationMode?: ActivationMode;
  editorVisibleByDefault?: boolean;
};

type EditorVisualContext = VisualContext & {
  editor?: {
    emit(eventName: string, payload?: unknown): void;
  };
};

type MetricDefinition = {
  id: StatisticMetric;
  tableLabel: string;
  cardLabel: string;
  value(stats: PublicMetrics): string | number;
};

const SERVICE_REF = "com.bakingrl.cast-package/playerStatsTracker";
const DEFAULT_VISIBLE_METRICS: StatisticMetric[] = [
  "score",
  "goals",
  "assists",
  "shots",
  "saves",
  "touches",
  "demos",
  "demoDifferential",
  "goalParticipation",
  "shootingAccuracyPercent",
  "averageSpeed"
];
const DEFAULT_DURATION_MS = 8000;
const METRIC_DEFINITIONS: MetricDefinition[] = [
  { id: "score", tableLabel: "Score", cardLabel: "Score", value: (stats) => stats.score },
  { id: "goals", tableLabel: "G", cardLabel: "Goals", value: (stats) => stats.goals },
  { id: "assists", tableLabel: "A", cardLabel: "Assists", value: (stats) => stats.assists },
  { id: "shots", tableLabel: "Sh", cardLabel: "Shots", value: (stats) => stats.shots },
  { id: "saves", tableLabel: "Sv", cardLabel: "Saves", value: (stats) => stats.saves },
  { id: "touches", tableLabel: "Tch", cardLabel: "Touches", value: (stats) => stats.touches },
  { id: "demos", tableLabel: "Dem", cardLabel: "Demos", value: (stats) => stats.demos },
  { id: "demoedCount", tableLabel: "Demoed", cardLabel: "Demoed", value: (stats) => stats.demoedCount },
  {
    id: "demoDifferential",
    tableLabel: "+/-",
    cardLabel: "Demo +/-",
    value: (stats) => `${stats.demoDifferential >= 0 ? "+" : ""}${stats.demoDifferential}`
  },
  { id: "goalParticipation", tableLabel: "GPAR", cardLabel: "GPAR", value: (stats) => stats.goalParticipation },
  {
    id: "goalParticipationPercent",
    tableLabel: "GPAR %",
    cardLabel: "GPAR %",
    value: (stats) => metric(stats.goalParticipationPercent, "%")
  },
  {
    id: "shootingAccuracyPercent",
    tableLabel: "Acc",
    cardLabel: "Accuracy",
    value: (stats) => metric(stats.shootingAccuracyPercent, "%")
  },
  { id: "averageSpeed", tableLabel: "Spd", cardLabel: "Avg speed", value: (stats) => stats.averageSpeed },
  { id: "boostConsumed", tableLabel: "Boost", cardLabel: "Boost used", value: (stats) => stats.boostConsumed },
  { id: "zeroBoostSeconds", tableLabel: "0 boost", cardLabel: "0 boost", value: (stats) => metric(stats.zeroBoostSeconds, "s") },
  {
    id: "supersonicTimePercent",
    tableLabel: "SS %",
    cardLabel: "Supersonic",
    value: (stats) => metric(stats.supersonicTimePercent, "%")
  },
  { id: "airTimePercent", tableLabel: "Air %", cardLabel: "Air", value: (stats) => metric(stats.airTimePercent, "%") }
];
const METRIC_BY_ID = new Map(METRIC_DEFINITIONS.map((definition) => [definition.id, definition]));
const instances = new Map<HTMLElement, StatisticsInstance>();

function readSettings(
  settings: Record<string, unknown>,
  defaultView: StatsView = "teamDetail",
  defaultActivationMode: ActivationMode = "always"
): StatisticsSettings {
  return {
    scope: settings.scope === "match" || settings.scope === "bo" ? settings.scope : "lastMatch",
    view: settings.view === "teamDetail" || settings.view === "teamSummary" || settings.view === "player" ? settings.view : defaultView,
    activationMode: settings.activationMode === "always" || settings.activationMode === "regie"
      ? settings.activationMode
      : defaultActivationMode,
    visibleMetrics: readVisibleMetrics(settings.visibleMetrics),
    teamNum: typeof settings.teamNum === "number" && Number.isFinite(settings.teamNum) ? Math.trunc(settings.teamNum) : -1,
    playerId: typeof settings.playerId === "string" ? settings.playerId.trim() : "",
    playerName: typeof settings.playerName === "string" ? settings.playerName.trim() : "",
    matchIndex: typeof settings.matchIndex === "number" && Number.isFinite(settings.matchIndex) ? Math.trunc(settings.matchIndex) : null,
    matchGuid: typeof settings.matchGuid === "string" ? settings.matchGuid.trim() : "",
    durationMs: typeof settings.durationMs === "number" && Number.isFinite(settings.durationMs)
      ? Math.max(500, Math.min(60000, Math.trunc(settings.durationMs)))
      : 8000
  };
}

function readVisibleMetrics(value: unknown): StatisticMetric[] {
  return readComponentVisibleMetrics(value);
}

function isStatisticMetric(value: unknown): value is StatisticMetric {
  return typeof value === "string" && METRIC_BY_ID.has(value as StatisticMetric);
}

function overrideSettings(
  settings: StatisticsSettings,
  payload: Record<string, unknown>,
  defaultView: StatsView,
  defaultActivationMode: ActivationMode
): StatisticsSettings {
  return readSettings({ ...settings, ...payload }, defaultView, defaultActivationMode);
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeColor(value: string | null | undefined, teamNum: number) {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color}`;
  return teamNum === 1 ? "#ff7700" : "#0055ff";
}

function metric(value: number, suffix = "") {
  return `${Number.isFinite(value) ? value : 0}${suffix}`;
}

function latestMatch(state: PlayerStatsState) {
  return [...state.matches].sort((left, right) => left.matchIndex - right.matchIndex).at(-1) ?? null;
}

function matchForSettings(state: PlayerStatsState, settings: StatisticsSettings) {
  if (settings.matchGuid) return state.matches.find((match) => match.matchGuid === settings.matchGuid) ?? null;
  if (settings.matchIndex !== null) return state.matches.find((match) => match.matchIndex === settings.matchIndex) ?? null;
  return latestMatch(state);
}

function playerMatches(player: PlayerStats, settings: StatisticsSettings) {
  if (settings.playerId && player.id !== settings.playerId && player.primaryId !== settings.playerId) return false;
  if (settings.playerName && player.name.trim().toLowerCase() !== settings.playerName.toLowerCase()) return false;
  return true;
}

function selectStats(state: PlayerStatsState | null, settings: StatisticsSettings): Selection {
  if (!state) return { label: "No stats", teams: [], players: [] };

  let label = "BO";
  let teams = state.bo.teams;
  let players = state.bo.players;

  if (settings.scope === "lastMatch") {
    const match = latestMatch(state);
    label = match ? `Match ${match.matchIndex}` : "Last match";
    teams = match?.teams ?? [];
    players = match?.players ?? [];
  } else if (settings.scope === "match") {
    const match = matchForSettings(state, settings);
    label = match ? `Match ${match.matchIndex}` : "Match";
    teams = match?.teams ?? [];
    players = match?.players ?? [];
  }

  if (settings.teamNum >= 0) {
    teams = teams.filter((team) => team.teamNum === settings.teamNum);
    players = players.filter((player) => player.teamNum === settings.teamNum);
  }

  if (settings.playerId || settings.playerName) {
    players = players.filter((player) => playerMatches(player, settings));
    const teamNums = new Set(players.map((player) => player.teamNum));
    teams = teams.filter((team) => teamNums.has(team.teamNum));
  }

  return { label, teams, players };
}

function statCell(label: string, value: string | number) {
  return `<div class="stat-cell"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function visibleMetricDefinitions(settings: StatisticsSettings) {
  return settings.visibleMetrics.flatMap((metricId) => {
    const definition = METRIC_BY_ID.get(metricId);
    return definition ? [definition] : [];
  });
}

function renderTeamSummary(team: TeamStats, metrics: MetricDefinition[]) {
  const color = safeColor(team.colorPrimary, team.teamNum);
  return `
    <article class="team-card" style="--team-color:${escapeHtml(color)}">
      <header>
        <span>${escapeHtml(team.name)}</span>
        <strong>${metric(team.stats.goals)}</strong>
      </header>
      <div class="stats-row">
        ${metrics.map((definition) => statCell(definition.cardLabel, definition.value(team.stats))).join("")}
      </div>
    </article>
  `;
}

function renderPlayerRow(player: PlayerStats, metrics: MetricDefinition[]) {
  return `
    <tr>
      <th>${escapeHtml(player.name)}</th>
      ${metrics.map((definition) => `<td>${escapeHtml(definition.value(player.stats))}</td>`).join("")}
    </tr>
  `;
}

function renderTeamDetail(team: TeamStats, players: PlayerStats[], metrics: MetricDefinition[]) {
  const color = safeColor(team.colorPrimary, team.teamNum);
  const rows = players
    .filter((player) => player.teamNum === team.teamNum)
    .map((player) => renderPlayerRow(player, metrics))
    .join("");
  return `
    <article class="team-detail" style="--team-color:${escapeHtml(color)}">
      <header>
        <span>${escapeHtml(team.name)}</span>
        <strong>${team.stats.goals} goals</strong>
      </header>
      <table>
        <thead>
          <tr>
            <th>Player</th>${metrics.map((definition) => `<td>${escapeHtml(definition.tableLabel)}</td>`).join("")}
          </tr>
        </thead>
        <tbody>${rows || `<tr><th>No players</th><td colspan="${Math.max(1, metrics.length)}"></td></tr>`}</tbody>
      </table>
    </article>
  `;
}

function renderPlayerDetail(players: PlayerStats[], metrics: MetricDefinition[]) {
  const player = players[0] ?? null;
  if (!player) return `<div class="empty">No player selected</div>`;
  return `
    <article class="player-detail">
      <header>
        <span>${escapeHtml(player.name)}</span>
        <strong>${player.stats.score}</strong>
      </header>
      <div class="stats-row wide">
        ${metrics.map((definition) => statCell(definition.cardLabel, definition.value(player.stats))).join("") || `<div class="empty">No metrics selected</div>`}
      </div>
    </article>
  `;
}

function renderBody(selection: SharedStatsSelection, settings: StatisticsSettings) {
  const metrics = visibleMetricDefinitionsComponent(settings.visibleMetrics);
  if (!selection.teams.length && !selection.players.length) return `<div class="empty">No statistics available</div>`;
  if (settings.view === "teamSummary") return selection.teams.map((team) => renderTeamSummaryComponent(team, metrics)).join("");
  if (settings.view === "player") return renderPlayerStatsComponent(selection.players, metrics);
  return selection.teams.map((team) => renderTeamDetailComponent(team, selection.players, metrics)).join("");
}

function renderContent(state: PlayerStatsState | null, settings: StatisticsSettings) {
  const selection = selectStatsComponent(state, settings);
  return `
    <section class="statistics">
      <header class="title-row">
        <span>${renderEscapeHtml(selection.label)}</span>
        <strong>${settings.view === "teamSummary" ? "Team summary" : settings.view === "player" ? "Player stats" : "Team details"}</strong>
      </header>
      <div class="content">${renderBody(selection, settings)}</div>
    </section>
  `;
}

function viewLabel(view: StatsView) {
  if (view === "teamSummary") return "Team Summary";
  if (view === "player") return "Player Stats";
  return "Team Detail";
}

function regiePayload(settings: StatisticsSettings) {
  return {
    scope: settings.scope,
    view: settings.view,
    activationMode: "regie",
    visibleMetrics: settings.visibleMetrics,
    teamNum: settings.teamNum,
    playerId: settings.playerId,
    playerName: settings.playerName,
    matchIndex: settings.matchIndex,
    matchGuid: settings.matchGuid
  };
}

function emitEditorRegie(context: VisualContext, command: Omit<RegieCommand, "version" | "id" | "updatedAtMs">) {
  const now = Date.now();
  (context as EditorVisualContext).editor?.emit(REGIE_EVENT, {
    version: 1,
    id: `editor-${command.cue ?? "regie"}-${now}`,
    updatedAtMs: now,
    ...command
  } satisfies RegieCommand);
}

export function createStatisticsVisual(
  defaultView: StatsView = "teamDetail",
  cue: RegieCue = "statistics",
  options: StatisticsVisualOptions = {}
) {
  const defaultActivationMode = options.defaultActivationMode ?? "always";
  const editorVisibleByDefault = options.editorVisibleByDefault ?? true;
  const label = viewLabel(defaultView);

  return defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings, defaultView, defaultActivationMode);
    const editorMode = isEditorMode(context);
    let state: PlayerStatsState | null = editorMode ? editorPlayerStatsState() : null;
    let regieSettings: StatisticsSettings | null = null;
    let clearTimer: number | null = null;
    let exitTimer: number | null = null;
    let phase: CastTransitionPhase = isDefaultVisible() ? "active" : "hidden";

    function isDefaultVisible(nextSettings = settings) {
      return editorMode ? editorVisibleByDefault : nextSettings.activationMode === "always";
    }

    function effectiveSettings() {
      return regieSettings ?? settings;
    }

    function render() {
      mountOrUpdateCastTransition(context.root, `${castTransitionCss}${styleCss}`, renderContent(state, effectiveSettings()), {
        className: "statistics-event",
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
      if (phase !== "active") return;
      if (isDefaultVisible() && !regieSettings) return;
      clearExitTimer();
      if (isDefaultVisible()) {
        regieSettings = null;
        phase = "active";
        context.setActive(false);
        render();
        return;
      }
      phase = "exiting";
      render();
      exitTimer = window.setTimeout(() => {
        regieSettings = null;
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
        context.diagnostics.warn("Unable to read player stats snapshot.", error);
      }
      render();
    }

    render();
    context.setActive(false);
    await loadSnapshot();

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings, defaultView, defaultActivationMode);
        if (isDefaultVisible()) {
          regieSettings = null;
          phase = "active";
          context.setActive(false);
        } else if (!regieSettings && phase !== "exiting") {
          phase = "hidden";
          context.setActive(false);
        }
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
        if (command.cue !== undefined && command.cue !== cue) return;
        if (command.action === "clear") {
          hide();
          return;
        }
        regieSettings = overrideSettings(settings, command.payload, defaultView, defaultActivationMode);
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
          label: `Trigger ${label}`,
          run(runContext: VisualContext) {
            const settings = readSettings(runContext.settings, defaultView, defaultActivationMode);
            emitEditorRegie(runContext, {
              action: "trigger",
              cue,
              payload: regiePayload(settings),
              durationMs: settings.durationMs || DEFAULT_DURATION_MS
            });
          }
        },
        {
          id: "clear",
          label: `Clear ${label}`,
          run(runContext: VisualContext) {
            emitEditorRegie(runContext, {
              action: "clear",
              cue,
              payload: {},
              durationMs: 0
            });
          }
        }
      ];
    }
  }
  });
}

export default createStatisticsVisual();
