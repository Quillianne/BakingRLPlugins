import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";

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
  showMap: boolean;
  showEvents: boolean;
  maxEvents: number;
};

const PACKAGE_ID = "com.bakingrl.cage-stats";
const STATE_EVENT = `plugin.${PACKAGE_ID}.state`;
const STATE_KEY = `plugin.${PACKAGE_ID}.state`;
const METRICS: Metric[] = ["goal", "crossbar", "save"];
const GOAL_HALF_WIDTH = 900;
const GOAL_HEIGHT = 650;

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
    showControls: settings.showControls === true,
    showMap: settings.showMap !== false,
    showEvents: settings.showEvents !== false,
    maxEvents: typeof settings.maxEvents === "number" && Number.isFinite(settings.maxEvents) ? Math.max(0, Math.min(20, Math.trunc(settings.maxEvents))) : 8
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

function checked(value: boolean) {
  return value ? " checked" : "";
}

function metricLabel(metric: Metric) {
  switch (metric) {
    case "goal":
      return "Goals";
    case "crossbar":
      return "Crossbars";
    case "save":
      return "Saves";
  }
}

function confidenceLabel(record: CageRecord) {
  if (record.confidence === "playerBallHit") return "last hit";
  if (record.confidence === "latestBallHit") return "latest hit";
  if (record.confidence === "teamFallback") return "team side";
  return "exact";
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
        playerMatches(record, settings.playerName) &&
        record.defendingTeamNum !== record.player.TeamNum
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pointX(record: CageRecord) {
  return clamp(50 + (record.projection.horizontal / GOAL_HALF_WIDTH) * 50, 3, 97);
}

function pointY(record: CageRecord) {
  return clamp(100 - (record.projection.vertical / GOAL_HEIGHT) * 100, 4, 96);
}

function renderPoint(record: CageRecord) {
  const label = `${metricLabel(record.metric)} - ${record.player.Name}`;
  return `<circle class="point ${record.metric}" cx="${pointX(record).toFixed(2)}" cy="${pointY(record).toFixed(2)}" r="${record.metric === "save" ? 4.2 : 4.8}">
    <title>${escapeHtml(label)}</title>
  </circle>`;
}

function renderMap(records: CageRecord[]) {
  return `
    <svg class="cage-map" viewBox="0 0 100 100" role="img" aria-label="Cage projection">
      <rect class="goal-frame" x="8" y="8" width="84" height="84" rx="2"></rect>
      <line class="goal-line" x1="8" y1="50" x2="92" y2="50"></line>
      <line class="goal-line muted" x1="50" y1="8" x2="50" y2="92"></line>
      ${records.map(renderPoint).join("")}
    </svg>
  `;
}

function renderMetricBar(records: CageRecord[]) {
  return `
    <div class="metrics">
      ${METRICS.map((metric) => `<div class="metric ${metric}"><span>${metricLabel(metric)}</span><strong>${count(records, metric)}</strong></div>`).join("")}
    </div>
  `;
}

function renderEventList(records: CageRecord[], maxEvents: number) {
  const recent = [...records].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, maxEvents);
  if (!recent.length || maxEvents === 0) {
    return `<div class="empty">No cage events yet</div>`;
  }
  return `
    <div class="events">
      ${recent
        .map((record) => {
          const ownGoal = record.ownGoal ? " own goal" : "";
          return `
            <div class="event-row">
              <span class="event-kind ${record.metric}">${metricLabel(record.metric).slice(0, -1)}</span>
              <strong>${escapeHtml(record.player.Name)}</strong>
              <span>${escapeHtml(confidenceLabel(record))}${ownGoal}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPanel(state: CageStatsState, title: string, records: CageRecord[], settings: VisualSettings) {
  return `
    <section class="cage-panel">
      <div class="panel-head">
        <h2>${escapeHtml(title)}</h2>
        <span>${records.length} events</span>
      </div>
      ${renderMetricBar(records)}
      ${settings.showMap ? renderMap(records) : ""}
      ${settings.showEvents ? renderEventList(records, settings.maxEvents) : ""}
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
      <label>
        <span>Events</span>
        <input data-setting="maxEvents" type="number" min="0" max="20" step="1" value="${settings.maxEvents}" />
      </label>
      <label class="toggle">
        <input data-setting="showMap" type="checkbox"${checked(settings.showMap)} />
        <span>Map</span>
      </label>
      <label class="toggle">
        <input data-setting="showEvents" type="checkbox"${checked(settings.showEvents)} />
        <span>List</span>
      </label>
    </form>
  `;
}

function renderState(state: CageStatsState, settings: VisualSettings) {
  const scopedRecords = recordsForScope(state, settings);
  if (settings.scope === "bothCages") {
    const negativeRecords = scopedRecords.filter((record) => record.cageSide === "negative");
    const positiveRecords = scopedRecords.filter((record) => record.cageSide === "positive");
    return `
      <div class="cage-stats${settings.showControls ? " with-controls" : ""}">
        <header>
          <div>
            <h1>${escapeHtml(titleForScope(state, settings))}</h1>
            <span>Projection ${state.config.horizontalAxis}/${state.config.verticalAxis}, depth ${state.config.goalAxis}</span>
          </div>
          <div class="legend">
            <span class="goal">Goal</span>
            <span class="crossbar">Crossbar</span>
            <span class="save">Save</span>
          </div>
        </header>
        ${renderControls(settings)}
        <div class="panel-grid">
          ${renderPanel(state, sideLabel(state, "negative"), negativeRecords, settings)}
          ${renderPanel(state, sideLabel(state, "positive"), positiveRecords, settings)}
        </div>
      </div>
    `;
  }
  return `
    <div class="cage-stats single${settings.showControls ? " with-controls" : ""}">
      <header>
        <div>
          <h1>${escapeHtml(titleForScope(state, settings))}</h1>
          <span>${settings.scope === "teamDefense" ? "Team defense" : "Player scope"}</span>
        </div>
        <div class="legend">
          <span class="goal">Goal</span>
          <span class="crossbar">Crossbar</span>
          <span class="save">Save</span>
        </div>
      </header>
      ${renderControls(settings)}
      <div class="panel-grid single">
        ${renderPanel(state, titleForScope(state, settings), scopedRecords, settings)}
      </div>
    </div>
  `;
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    let state: CageStatsState | null = null;

    context.root.innerHTML = `
      <style>
        .cage-stats {
          --bg: rgba(7, 12, 20, 0.9);
          --panel: rgba(255, 255, 255, 0.075);
          --border: rgba(255, 255, 255, 0.16);
          --text: #f8fafc;
          --muted: rgba(226, 232, 240, 0.66);
          --goal: #ef4444;
          --crossbar: #f59e0b;
          --save: #22c55e;
          width: 100%;
          height: 100%;
          min-width: 0;
          min-height: 0;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 12px;
          padding: 14px;
          overflow: hidden;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.12), transparent 36%), var(--bg);
          color: var(--text);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .cage-stats.with-controls {
          grid-template-rows: auto auto minmax(0, 1fr);
        }
        .cage-stats * {
          box-sizing: border-box;
        }
        header {
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
        }
        h1,
        h2 {
          margin: 0;
          letter-spacing: 0;
          line-height: 1.15;
        }
        h1 {
          font-size: 22px;
        }
        h2 {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 15px;
        }
        header span,
        .panel-head span,
        .event-row span {
          color: var(--muted);
          font-size: 12px;
          font-weight: 750;
        }
        .legend {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 7px;
        }
        .legend span,
        .event-kind {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 4px 8px;
          border: 1px solid var(--border);
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          color: var(--text);
        }
        .legend .goal,
        .event-kind.goal {
          border-color: rgba(239, 68, 68, 0.5);
          background: rgba(239, 68, 68, 0.15);
        }
        .legend .crossbar,
        .event-kind.crossbar {
          border-color: rgba(245, 158, 11, 0.5);
          background: rgba(245, 158, 11, 0.15);
        }
        .legend .save,
        .event-kind.save {
          border-color: rgba(34, 197, 94, 0.5);
          background: rgba(34, 197, 94, 0.15);
        }
        .demo-controls {
          display: grid;
          grid-template-columns: minmax(140px, 1.1fr) minmax(82px, 0.55fr) minmax(160px, 1fr) minmax(82px, 0.55fr) auto auto;
          gap: 8px;
          align-items: end;
          min-width: 0;
          padding: 10px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.06);
        }
        .demo-controls label {
          min-width: 0;
          display: grid;
          gap: 5px;
          color: var(--muted);
          font-size: 11px;
          font-weight: 850;
        }
        .demo-controls select,
        .demo-controls input[type="number"],
        .demo-controls input[type="text"] {
          width: 100%;
          min-height: 34px;
          padding: 7px 9px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.18);
          color: var(--text);
          font: inherit;
          font-size: 12px;
          outline: none;
        }
        .demo-controls select:focus,
        .demo-controls input:focus {
          border-color: rgba(34, 197, 94, 0.66);
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);
        }
        .demo-controls .toggle {
          min-height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 7px 9px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.18);
          color: var(--text);
        }
        .demo-controls .toggle input {
          margin: 0;
        }
        .panel-grid {
          min-height: 0;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          overflow: hidden;
        }
        .panel-grid.single {
          grid-template-columns: minmax(0, 1fr);
        }
        .cage-panel {
          min-width: 0;
          min-height: 0;
          display: grid;
          grid-template-rows: auto auto minmax(150px, 1fr) auto;
          gap: 10px;
          padding: 12px;
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--panel);
        }
        .panel-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }
        .metrics {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
        }
        .metric {
          display: grid;
          gap: 2px;
          padding: 8px;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.06);
        }
        .metric span {
          color: var(--muted);
          font-size: 11px;
          font-weight: 800;
        }
        .metric strong {
          font-size: 22px;
          line-height: 1;
        }
        .metric.goal strong {
          color: #fecaca;
        }
        .metric.crossbar strong {
          color: #fde68a;
        }
        .metric.save strong {
          color: #bbf7d0;
        }
        .cage-map {
          width: 100%;
          height: 100%;
          min-height: 150px;
          display: block;
          border-radius: 7px;
          background: radial-gradient(circle at 50% 100%, rgba(255, 255, 255, 0.1), transparent 42%), rgba(0, 0, 0, 0.22);
        }
        .goal-frame,
        .goal-line {
          fill: none;
          stroke: rgba(255, 255, 255, 0.38);
          stroke-width: 1.2;
        }
        .goal-line.muted {
          stroke: rgba(255, 255, 255, 0.16);
        }
        .point {
          stroke: rgba(255, 255, 255, 0.82);
          stroke-width: 0.85;
        }
        .point.goal {
          fill: var(--goal);
        }
        .point.crossbar {
          fill: var(--crossbar);
        }
        .point.save {
          fill: var(--save);
        }
        .events {
          min-height: 0;
          display: grid;
          gap: 6px;
          overflow: auto;
        }
        .event-row {
          min-width: 0;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          padding: 6px 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.16);
        }
        .event-row strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
        }
        .empty,
        .waiting {
          display: grid;
          place-items: center;
          min-height: 100%;
          color: var(--muted);
          font-size: 13px;
          font-weight: 800;
          text-align: center;
        }
        @media (max-width: 780px) {
          .cage-stats {
            overflow: auto;
          }
          header,
          .panel-grid,
          .demo-controls {
            grid-template-columns: 1fr;
          }
          .legend {
            justify-content: flex-start;
          }
        }
      </style>
      <div class="waiting">Waiting for Cage Stats service</div>
    `;

    function render() {
      const style = context.root.querySelector("style")?.outerHTML ?? "";
      context.root.innerHTML = `${style}${state ? renderState(state, settings) : `<div class="cage-stats"><div class="waiting">Waiting for Cage Stats service</div></div>`}`;
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
      } else if (key === "maxEvents") {
        settings = readSettings({ ...settings, maxEvents: Number(target.value) });
      } else if (key === "showMap" && target instanceof HTMLInputElement) {
        settings = readSettings({ ...settings, showMap: target.checked });
      } else if (key === "showEvents" && target instanceof HTMLInputElement) {
        settings = readSettings({ ...settings, showEvents: target.checked });
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
