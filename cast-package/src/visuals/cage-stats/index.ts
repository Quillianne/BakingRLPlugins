import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import { CAGE_STATS_EVENT, CAGE_STATS_KEY, REGIE_EVENT, type RegieCommand } from "../../shared/events";
import {
  CAST_TRANSITION_EXIT_MS,
  type CastTransitionPhase,
  castTransitionCss,
  mountOrUpdateCastTransition,
  renderCastTransitionShell
} from "../../shared/cast-transition";
import { cageMapStyles, renderCageMap } from "../../shared/cage-map";
import { editorCageStatsState, isEditorMode } from "../editorPreviewData";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type Axis = "X" | "Y" | "Z";
type CageSide = "negative" | "positive";
type Metric = "goal" | "crossbar" | "save";
type Scope = "bothCages" | "teamDefense" | "playerSaves" | "playerOffense";
type ActivationMode = "always" | "regie";

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
  activationMode: ActivationMode;
  durationMs: number;
  metrics: Metric[];
  showControls: boolean;
};

type CageStatsInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

type EditorVisualContext = VisualContext & {
  editor?: {
    emit(eventName: string, payload?: unknown): void;
  };
};

const METRICS: Metric[] = ["goal", "crossbar", "save"];
const instances = new Map<HTMLElement, CageStatsInstance>();

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
    activationMode: settings.activationMode === "always" ? "always" : "regie",
    durationMs: typeof settings.durationMs === "number" && Number.isFinite(settings.durationMs)
      ? Math.max(500, Math.min(60000, Math.trunc(settings.durationMs)))
      : 8000,
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

function isRegieCommand(value: unknown): value is RegieCommand {
  return isRecord(value) && value.version === 1 && (value.action === "trigger" || value.action === "clear");
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
      title: escapeHtml(titleForScope(state, settings)),
      summary: renderSummary(scopedRecords),
      controls: renderControls(settings),
      gridClass: "",
      panels: `${renderCageTemplate(negativeRecords, "negative")}${renderCageTemplate(positiveRecords, "positive")}`
    });
  }
  return fillTemplate(templateHtml, {
    rootClass,
    title: escapeHtml(titleForScope(state, settings)),
    summary: renderSummary(scopedRecords),
    controls: renderControls(settings),
    gridClass: " single",
    panels: renderCageTemplate(scopedRecords, sideForSinglePanel(state, settings, scopedRecords))
  });
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function renderCageStatsShellTemplate(phase: CastTransitionPhase) {
  return `<style>${castTransitionCss}${styleCss.replace("{{cageMapStyles}}", cageMapStyles)}</style>${renderCastTransitionShell(
    `<div class="cage-stats"><div class="waiting">Waiting for Cage Stats service</div></div>`,
    { className: "cage-stats-event", phase, contentClass: "ge-data-card" }
  )}`;
}

function regiePayload(settings: VisualSettings) {
  return {
    scope: settings.scope,
    teamNum: settings.teamNum,
    playerName: settings.playerName,
    title: settings.title,
    activationMode: "regie",
    metrics: settings.metrics
  };
}

function emitEditorRegie(context: VisualContext, command: Omit<RegieCommand, "version" | "id" | "updatedAtMs">) {
  const now = Date.now();
  (context as EditorVisualContext).editor?.emit(REGIE_EVENT, {
    version: 1,
    id: `editor-cageStats-${now}`,
    updatedAtMs: now,
    ...command
  } satisfies RegieCommand);
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    const editorMode = isEditorMode(context);
    let state: CageStatsState | null = editorMode ? editorCageStatsState() : null;
    let activeSettings: VisualSettings | null = null;
    let clearTimer: number | null = null;
    let exitTimer: number | null = null;
    let phase: CastTransitionPhase = isDefaultVisible() ? "active" : "hidden";

    function isDefaultVisible(nextSettings = settings) {
      return !editorMode && nextSettings.activationMode === "always";
    }

    context.root.innerHTML = renderCageStatsShellTemplate(phase);

    function render() {
      const contentSettings = activeSettings ?? settings;
      const content = state ? renderCageStatsTemplate(state, contentSettings) : `<div class="cage-stats"><div class="waiting">Waiting for Cage Stats service</div></div>`;
      mountOrUpdateCastTransition(context.root, `${castTransitionCss}${styleCss.replace("{{cageMapStyles}}", cageMapStyles)}`, content, {
        className: "cage-stats-event",
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
      if (isDefaultVisible() && !activeSettings) return;
      clearExitTimer();
      if (isDefaultVisible()) {
        activeSettings = null;
        phase = "active";
        context.setActive(false);
        render();
        return;
      }
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

    function updateDemoSetting(target: HTMLInputElement | HTMLSelectElement) {
      const key = target.dataset.setting;
      if (!key) return;
      const nextBaseSettings = activeSettings ?? settings;
      let nextSettings = nextBaseSettings;
      if (key === "scope") {
        nextSettings = readSettings({ ...nextBaseSettings, scope: target.value });
      } else if (key === "teamNum") {
        nextSettings = readSettings({ ...nextBaseSettings, teamNum: Number(target.value) });
      } else if (key === "playerName") {
        nextSettings = readSettings({ ...nextBaseSettings, playerName: target.value });
      }
      if (activeSettings) {
        activeSettings = nextSettings;
      } else {
        settings = nextSettings;
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

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        if (isDefaultVisible()) {
          activeSettings = null;
          phase = "active";
          context.setActive(false);
        } else if (!activeSettings && phase !== "exiting") {
          phase = "hidden";
          context.setActive(false);
        }
        render();
      }
    });

    context.root.addEventListener("change", handleSettingChange);
    context.root.addEventListener("keydown", handleSettingKeydown);

    const cleanup = context.bus.subscribe(CAGE_STATS_EVENT, (event: BakingRLEvent<unknown>) => {
      if (isState(event.Data)) {
        state = event.Data;
        render();
      }
    });

    const cleanupRegie = context.bus.subscribe(REGIE_EVENT, (event: BakingRLEvent<unknown>) => {
      if (!isRegieCommand(event.Data)) return;
      const command = event.Data;
      if (command.cue !== "cageStats") return;
      if (command.action === "clear") {
        hide();
        return;
      }
      activeSettings = readSettings({ ...settings, ...command.payload });
      show();
      scheduleClear(command.durationMs || activeSettings.durationMs);
    });

    if (!editorMode) {
      try {
        const registryState = await context.registry.get(CAGE_STATS_KEY);
        if (isState(registryState)) {
          state = registryState;
        }
      } catch (error) {
        context.diagnostics.warn("Unable to read Cage Stats registry state.", error);
      }
    }

    render();
    context.setActive(false);

    return () => {
      instances.delete(context.root);
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      clearExitTimer();
      context.setActive(false);
      cleanup();
      cleanupRegie();
      context.root.removeEventListener("change", handleSettingChange);
      context.root.removeEventListener("keydown", handleSettingKeydown);
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
          label: "Trigger Cage Stats",
          run(context: VisualContext) {
            const settings = readSettings(context.settings);
            emitEditorRegie(context, {
              action: "trigger",
              cue: "cageStats",
              payload: regiePayload(settings),
              durationMs: settings.durationMs
            });
          }
        },
        {
          id: "clear",
          label: "Clear Cage Stats",
          run(context: VisualContext) {
            emitEditorRegie(context, {
              action: "clear",
              cue: "cageStats",
              payload: {},
              durationMs: 0
            });
          }
        }
      ];
    }
  }
});
