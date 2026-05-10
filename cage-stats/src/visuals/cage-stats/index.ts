import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import { cageMapStyles, renderCageMap } from "../../shared/cage-map";
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

type CageStatsState = {
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

type VisualSettings = {
  scope: Scope;
  teamNum: number;
  playerName: string;
  title: string;
  metrics: Metric[];
  showControls: boolean;
};

const PACKAGE_ID = "com.bakingrl.cage-stats";
const STATE_EVENT = `plugin.${PACKAGE_ID}.state`;
const STATE_KEY = `plugin.${PACKAGE_ID}.state`;
const METRICS: Metric[] = ["goal", "crossbar", "save"];

function readSettings(settings: Record<string, unknown>): VisualSettings {
  const scope = typeof settings.scope === "string" ? settings.scope : "bothCages";
  const metrics = Array.isArray(settings.metrics)
    ? settings.metrics.filter((metric): metric is Metric => metric === "goal" || metric === "crossbar" || metric === "save")
    : METRICS;
  return {
    scope: scope === "teamDefense" || scope === "playerSaves" || scope === "playerOffense" ? scope : "bothCages",
    teamNum: typeof settings.teamNum === "number" && Number.isFinite(settings.teamNum) ? Math.trunc(settings.teamNum) : 0,
    playerName: typeof settings.playerName === "string" ? settings.playerName.trim() : "",
    title: typeof settings.title === "string" ? settings.title.trim() : "",
    metrics: metrics.length ? metrics : METRICS,
    showControls: settings.showControls === true
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

function selected(value: string, expected: string) {
  return value === expected ? " selected" : "";
}

function teamName(state: CageStatsState, teamNum: number) {
  return state.teams[String(teamNum)]?.name || `Side ${teamNum}`;
}

function sideForTeamNum(state: CageStatsState, teamNum: number): CageSide {
  return teamNum === state.config.positiveSideTeamNum ? "positive" : "negative";
}

function teamNumForSide(state: CageStatsState, side: CageSide) {
  return side === "positive" ? state.config.positiveSideTeamNum : state.config.negativeSideTeamNum;
}

function sideLabel(state: CageStatsState, side: CageSide) {
  const teamNum = teamNumForSide(state, side);
  return `${teamName(state, teamNum)} cage`;
}

function playerMatches(record: CageRecord, playerName: string) {
  if (!playerName) return false;
  return record.player.Name.trim().toLowerCase() === playerName.trim().toLowerCase();
}

function metricAllowed(record: CageRecord, settings: VisualSettings) {
  return settings.metrics.includes(record.metric);
}

function recordsForScope(state: CageStatsState, settings: VisualSettings) {
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

function titleForScope(state: CageStatsState, settings: VisualSettings) {
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

function renderCageTemplate(records: CageRecord[], side?: CageSide) {
  return `
    <section class="cage-panel${side ? ` ${side}` : ""}">
      ${renderCageMap(records, { label: renderCountLabel(records) })}
    </section>
  `;
}

function renderControls(settings: VisualSettings) {
  if (!settings.showControls) return "";
  return `
    <form class="demo-controls">
      <label>
        <span>Scope</span>
        <select data-setting="scope">
          <option value="bothCages"${selected(settings.scope, "bothCages")}>Both cages</option>
          <option value="teamDefense"${selected(settings.scope, "teamDefense")}>Team defense</option>
          <option value="playerSaves"${selected(settings.scope, "playerSaves")}>Player saves</option>
          <option value="playerOffense"${selected(settings.scope, "playerOffense")}>Player offense</option>
        </select>
      </label>
      <label>
        <span>Team</span>
        <input data-setting="teamNum" type="number" min="0" max="1" step="1" value="${settings.teamNum}" />
      </label>
      <label>
        <span>Player</span>
        <input data-setting="playerName" type="text" value="${escapeHtml(settings.playerName)}" placeholder="Player name" />
      </label>
    </form>
  `;
}

function sideForSinglePanel(state: CageStatsState, settings: VisualSettings, records: CageRecord[]): CageSide | undefined {
  if (settings.scope === "teamDefense") return sideForTeamNum(state, settings.teamNum);
  const firstSide = records[0]?.cageSide;
  if (firstSide && records.every((record) => record.cageSide === firstSide)) return firstSide;
  return undefined;
}

function renderCageStatsTemplate(state: CageStatsState, settings: VisualSettings) {
  const scopedRecords = recordsForScope(state, settings);
  const rootClass = settings.showControls ? " with-controls" : "";
  if (settings.scope === "bothCages") {
    const negativeRecords = scopedRecords.filter((record) => record.cageSide === "negative");
    const positiveRecords = scopedRecords.filter((record) => record.cageSide === "positive");
    return fillTemplate(templateHtml, {
      rootClass,
      controls: renderControls(settings),
      gridClass: "",
      panels: `${renderCageTemplate(negativeRecords, "negative")}${renderCageTemplate(positiveRecords, "positive")}`
    });
  }
  return fillTemplate(templateHtml, {
    rootClass,
    controls: renderControls(settings),
    gridClass: " single",
    panels: renderCageTemplate(scopedRecords, sideForSinglePanel(state, settings, scopedRecords))
  });
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function renderCageStatsShellTemplate() {
  return `<style>${styleCss.replace("{{cageMapStyles}}", cageMapStyles)}</style><div class="waiting">Waiting for Cage Stats service</div>`;
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    let state: CageStatsState | null = null;

    context.root.innerHTML = renderCageStatsShellTemplate();

    function render() {
      const style = context.root.querySelector("style")?.outerHTML ?? "";
      context.root.innerHTML = `${style}${state ? renderCageStatsTemplate(state, settings) : `<div class="cage-stats"><div class="waiting">Waiting for Cage Stats service</div></div>`}`;
    }

    function updateDemoSetting(target: HTMLInputElement | HTMLSelectElement) {
      const key = target.dataset.setting;
      if (!key) return;
      if (key === "scope") {
        settings = readSettings({ ...settings, scope: target.value });
      } else if (key === "teamNum") {
        settings = readSettings({ ...settings, teamNum: Number(target.value) });
      } else if (key === "playerName") {
        settings = readSettings({ ...settings, playerName: target.value });
      }
      render();
    }

    function handleSettingChange(event: Event) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
        updateDemoSetting(target);
      }
    }

    function handleSettingKeydown(event: KeyboardEvent) {
      const target = event.target;
      if (event.key === "Enter" && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        event.preventDefault();
        updateDemoSetting(target);
      }
    }

    context.root.addEventListener("change", handleSettingChange);
    context.root.addEventListener("keydown", handleSettingKeydown);

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
      context.diagnostics.warn("Unable to read Cage Stats registry state.", error);
    }

    render();

    return () => {
      cleanup();
      context.root.removeEventListener("change", handleSettingChange);
      context.root.removeEventListener("keydown", handleSettingKeydown);
    };
  }
});
