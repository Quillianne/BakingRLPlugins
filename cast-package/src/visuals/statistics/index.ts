import { type BakingRLEvent } from "@bakingrl/plugin-sdk";
import { PLAYER_STATS_EVENT } from "../../shared/events";
import { defineVisual, type VisualContext } from "../visualModule";
import {
  escapeHtml,
  renderPlayerDetail,
  renderTeamDetail,
  renderTeamSummary,
  readVisibleMetrics,
  selectStats,
  visibleMetricDefinitions,
  type PlayerStatsState,
  type StatisticMetric,
  type StatsScope,
  type StatsSelection,
  type StatsView
} from "../../shared/stat-components";
import { editorPlayerStatsState, isEditorMode } from "../editorPreviewData";
import styleCss from "./style.css?raw";

type StatisticsSettings = {
  scope: StatsScope;
  view: StatsView;
  visibleMetrics: StatisticMetric[];
  teamNum: number;
  playerId: string;
  playerName: string;
  matchIndex: number | null;
  matchGuid: string;
};

type StatisticsInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

const SERVICE_REF = "com.bakingrl.cast-package/playerStatsTracker";
const instances = new Map<HTMLElement, StatisticsInstance>();

export function readStatisticsSettings(
  settings: Record<string, unknown>,
  defaultView: StatsView = "teamDetail"
): StatisticsSettings {
  return {
    scope: settings.scope === "match" || settings.scope === "bo" ? settings.scope : "lastMatch",
    view: settings.view === "teamDetail" || settings.view === "teamSummary" || settings.view === "player" ? settings.view : defaultView,
    visibleMetrics: readVisibleMetrics(settings.visibleMetrics),
    teamNum: typeof settings.teamNum === "number" && Number.isFinite(settings.teamNum) ? Math.trunc(settings.teamNum) : -1,
    playerId: typeof settings.playerId === "string" ? settings.playerId.trim() : "",
    playerName: typeof settings.playerName === "string" ? settings.playerName.trim() : "",
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

function renderBody(selection: StatsSelection, settings: StatisticsSettings) {
  const metrics = visibleMetricDefinitions(settings.visibleMetrics);
  if (!selection.teams.length && !selection.players.length) return `<div class="empty">No statistics available</div>`;
  if (settings.view === "teamSummary") return selection.teams.map((team) => renderTeamSummary(team, metrics)).join("");
  if (settings.view === "player") return renderPlayerDetail(selection.players, metrics);
  return selection.teams.map((team) => renderTeamDetail(team, selection.players, metrics)).join("");
}

export function renderStatisticsContent(state: PlayerStatsState | null, settings: StatisticsSettings) {
  const selection = selectStats(state, settings);
  return `
    <section class="statistics">
      <header class="title-row">
        <span>${escapeHtml(selection.label)}</span>
        <strong>${settings.view === "teamSummary" ? "Team summary" : settings.view === "player" ? "Player stats" : "Team details"}</strong>
      </header>
      <div class="content">${renderBody(selection, settings)}</div>
    </section>
  `;
}

export function renderStatisticsDocument(state: PlayerStatsState | null, settings: StatisticsSettings) {
  return `<style>${styleCss}</style>${renderStatisticsContent(state, settings)}`;
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readStatisticsSettings(context.settings);
    const editorMode = isEditorMode(context);
    let state: PlayerStatsState | null = editorMode ? editorPlayerStatsState() : null;

    function render() {
      context.root.innerHTML = renderStatisticsDocument(state, settings);
    }

    render();

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readStatisticsSettings(nextSettings);
        render();
      }
    });

    const cleanup = context.bus.subscribe(PLAYER_STATS_EVENT, (event: BakingRLEvent<unknown>) => {
      if (isStatsState(event.Data)) {
        state = event.Data;
        render();
      }
    });

    if (!editorMode) {
      try {
        const snapshot = await context.services.call(SERVICE_REF, "snapshot");
        if (isStatsState(snapshot)) state = snapshot;
      } catch (error) {
        context.diagnostics.warn("Unable to read player stats snapshot.", error);
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
