import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import { CAGE_STATS_EVENT, CAGE_STATS_KEY } from "../../shared/events";
import { cageMapStyles, renderCageMap } from "../../shared/cage-map";
import { editorCageStatsState, isEditorMode } from "../editorPreviewData";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type Axis = "X" | "Y" | "Z";
type CageSide = "negative" | "positive";
type Metric = "goal" | "crossbar" | "save";
type Scope = "bothCages" | "teamDefense" | "playerSaves" | "playerOffense";

type TeamInfo = {
  name: string;
  teamNum: number;
};

type CageRecord = {
  id: string;
  metric: Metric;
  matchGuid: string | null;
  cageSide: CageSide;
  defendingTeamNum: number;
  attackingTeamNum: number;
  player: {
    Name: string;
    Shortcut?: number;
    TeamNum: number;
  };
  assister: {
    Name: string;
    Shortcut?: number;
    TeamNum: number;
  } | null;
  location: {
    X: number;
    Y: number;
    Z: number;
  };
  projection: {
    horizontal: number;
    vertical: number;
  };
  speed: number | null;
  impactForce: number | null;
  goalTime: number | null;
  ownGoal: boolean;
  confidence: "exact" | "playerBallHit" | "latestBallHit" | "teamFallback";
  createdAtMs: number;
};

export type CageStatsState = {
  version: 1;
  config: {
    goalAxis: Axis;
    horizontalAxis: Axis;
    verticalAxis: Axis;
    negativeSideTeamNum: number;
    positiveSideTeamNum: number;
    resetOnMatch: boolean;
  };
  currentMatchGuid: string | null;
  teams: Record<string, TeamInfo>;
  records: CageRecord[];
  totals: Record<CageSide, Record<Metric, number>>;
  updatedAtMs: number;
};

export type CageStatsSettings = {
  scope: Scope;
  teamNum: number;
  playerName: string;
  title: string;
  metrics: Metric[];
};

type CageStatsInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

const METRICS: Metric[] = ["goal", "crossbar", "save"];
const instances = new Map<HTMLElement, CageStatsInstance>();

export function readCageStatsSettings(settings: Record<string, unknown>): CageStatsSettings {
  const scope = typeof settings.scope === "string" ? settings.scope : "bothCages";
  const metrics = Array.isArray(settings.metrics)
    ? settings.metrics.filter((metric): metric is Metric => metric === "goal" || metric === "crossbar" || metric === "save")
    : METRICS;
  return {
    scope: scope === "teamDefense" || scope === "playerSaves" || scope === "playerOffense" ? scope : "bothCages",
    teamNum: typeof settings.teamNum === "number" && Number.isFinite(settings.teamNum) ? Math.trunc(settings.teamNum) : 0,
    playerName: typeof settings.playerName === "string" ? settings.playerName.trim() : "",
    title: typeof settings.title === "string" ? settings.title.trim() : "",
    metrics: metrics.length ? metrics : METRICS
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isState(value: unknown): value is CageStatsState {
  if (!isRecord(value) || !isRecord(value.config) || !Array.isArray(value.records)) return false;
  return (
    value.version === 1 &&
    typeof value.config.negativeSideTeamNum === "number" &&
    typeof value.config.positiveSideTeamNum === "number"
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function teamName(state: CageStatsState, teamNum: number) {
  return state.teams[String(teamNum)]?.name || `Side ${teamNum}`;
}

function sideForTeamNum(state: CageStatsState, teamNum: number): CageSide {
  return teamNum === state.config.positiveSideTeamNum ? "positive" : "negative";
}

function metricAllowed(record: CageRecord, settings: CageStatsSettings) {
  return settings.metrics.includes(record.metric);
}

function playerMatches(record: CageRecord, playerName: string) {
  if (!playerName) return false;
  return record.player.Name.trim().toLowerCase() === playerName.trim().toLowerCase();
}

function recordsForScope(state: CageStatsState, settings: CageStatsSettings) {
  const records = state.records.filter((record) => metricAllowed(record, settings));
  if (settings.scope === "teamDefense") {
    const side = sideForTeamNum(state, settings.teamNum);
    return records.filter((record) => record.cageSide === side);
  }
  if (settings.scope === "playerSaves") {
    return records.filter((record) => record.metric === "save" && playerMatches(record, settings.playerName));
  }
  if (settings.scope === "playerOffense") {
    return records.filter(
      (record) =>
        (record.metric === "goal" || record.metric === "crossbar") &&
        playerMatches(record, settings.playerName)
    );
  }
  return records;
}

function titleForScope(state: CageStatsState, settings: CageStatsSettings) {
  if (settings.title) return settings.title;
  if (settings.scope === "teamDefense") return `${teamName(state, settings.teamNum)} defense`;
  if (settings.scope === "playerSaves") return settings.playerName ? `${settings.playerName} saves` : "Player saves";
  if (settings.scope === "playerOffense") return settings.playerName ? `${settings.playerName} offense` : "Player offense";
  return "Cage Stats";
}

function count(records: CageRecord[], metric: Metric) {
  return records.filter((record) => record.metric === metric).length;
}

function metricShortLabel(metric: Metric) {
  switch (metric) {
    case "goal":
      return "Goal";
    case "crossbar":
      return "Cross";
    case "save":
      return "Save";
  }
}

function renderCountLabel(records: CageRecord[]) {
  return (["goal", "save", "crossbar"] as Metric[])
    .map((metric) => `${metricShortLabel(metric)} ${count(records, metric)}`)
    .join("   ");
}

function renderSummary(records: CageRecord[]) {
  return (["goal", "save", "crossbar"] as Metric[])
    .map((metric) => `<span><strong>${count(records, metric)}</strong>${metricShortLabel(metric)}</span>`)
    .join("");
}

function renderCageTemplate(records: CageRecord[], side?: CageSide) {
  return `
    <section class="cage-panel${side ? ` ${side}` : ""}">
      ${renderCageMap(records, { label: renderCountLabel(records) })}
    </section>
  `;
}

function sideForSinglePanel(state: CageStatsState, settings: CageStatsSettings, records: CageRecord[]): CageSide | undefined {
  if (settings.scope === "teamDefense") return sideForTeamNum(state, settings.teamNum);
  const firstSide = records[0]?.cageSide;
  if (firstSide && records.every((record) => record.cageSide === firstSide)) return firstSide;
  return undefined;
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

export function renderCageStatsContent(state: CageStatsState | null, settings: CageStatsSettings) {
  if (!state) return `<div class="cage-stats"><div class="waiting">Waiting for Cage Stats service</div></div>`;

  const scopedRecords = recordsForScope(state, settings);
  if (settings.scope === "bothCages") {
    const negativeRecords = scopedRecords.filter((record) => record.cageSide === "negative");
    const positiveRecords = scopedRecords.filter((record) => record.cageSide === "positive");
    return fillTemplate(templateHtml, {
      rootClass: "",
      title: escapeHtml(titleForScope(state, settings)),
      summary: renderSummary(scopedRecords),
      controls: "",
      gridClass: "",
      panels: `${renderCageTemplate(negativeRecords, "negative")}${renderCageTemplate(positiveRecords, "positive")}`
    });
  }
  return fillTemplate(templateHtml, {
    rootClass: "",
    title: escapeHtml(titleForScope(state, settings)),
    summary: renderSummary(scopedRecords),
    controls: "",
    gridClass: " single",
    panels: renderCageTemplate(scopedRecords, sideForSinglePanel(state, settings, scopedRecords))
  });
}

export function renderCageStatsDocument(state: CageStatsState | null, settings: CageStatsSettings) {
  return `<style>${styleCss.replace("{{cageMapStyles}}", cageMapStyles)}</style>${renderCageStatsContent(state, settings)}`;
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readCageStatsSettings(context.settings);
    const editorMode = isEditorMode(context);
    let state: CageStatsState | null = editorMode ? editorCageStatsState() : null;

    function render() {
      context.root.innerHTML = renderCageStatsDocument(state, settings);
    }

    render();

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readCageStatsSettings(nextSettings);
        render();
      }
    });

    const cleanup = context.bus.subscribe(CAGE_STATS_EVENT, (event: BakingRLEvent<unknown>) => {
      if (isState(event.Data)) {
        state = event.Data;
        render();
      }
    });

    if (!editorMode) {
      try {
        const registryState = await context.registry.get(CAGE_STATS_KEY);
        if (isState(registryState)) state = registryState;
      } catch (error) {
        context.diagnostics.warn("Unable to read Cage Stats registry state.", error);
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
