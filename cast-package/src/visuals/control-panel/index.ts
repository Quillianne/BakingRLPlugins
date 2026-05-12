import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";
import { fitVisualScale } from "../fitVisualScale";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type BestOf = 1 | 3 | 5 | 7;
type Side = "left" | "right";
type Phase = "idle" | "waiting_for_start" | "tracking" | "complete";

type TeamConfig = {
  name: string;
  teamNum: number;
};

type BoTrackerState = {
  bestOf: BestOf;
  teams: {
    left: TeamConfig;
    right: TeamConfig;
  };
  leftWins: number;
  rightWins: number;
  phase: Phase;
  tracking: boolean;
  currentMatchGuid: string | null;
  history: Array<{
    matchGuid: string;
    winnerSide: Side;
    winnerTeamNum: number;
    source: "auto" | "manual";
    countedAtMs: number;
  }>;
  winner: Side | null;
  updatedAtMs: number;
  winsRequired: number;
  completed: boolean;
  leader: Side | "tied";
};

type ControlPanelSettings = {
  title: string;
  subtitle: string;
  defaultBestOf: BestOf;
  showHistory: boolean;
  historyLimit: number;
};

type ControlPanelInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

const SERVICE_REF = "com.bakingrl.cast-package/boTracker";
const STATE_EVENT = "plugin.com.bakingrl.cast-package.state";
const BEST_OF_VALUES: BestOf[] = [1, 3, 5, 7];
const instances = new Map<HTMLElement, ControlPanelInstance>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBestOf(value: unknown): value is BestOf {
  return value === 1 || value === 3 || value === 5 || value === 7;
}

function readSettings(settings: Record<string, unknown>): ControlPanelSettings {
  return {
    title: typeof settings.title === "string" && settings.title.trim() ? settings.title.trim() : "BO Tracker",
    subtitle: typeof settings.subtitle === "string" ? settings.subtitle.trim() : "Configuration et score de serie",
    defaultBestOf: isBestOf(settings.defaultBestOf) ? settings.defaultBestOf : 5,
    showHistory: settings.showHistory !== false,
    historyLimit: typeof settings.historyLimit === "number" && Number.isFinite(settings.historyLimit)
      ? Math.max(0, Math.min(12, Math.trunc(settings.historyLimit)))
      : 6
  };
}

function isSide(value: unknown): value is Side {
  return value === "left" || value === "right";
}

function isPhase(value: unknown): value is Phase {
  return value === "idle" || value === "waiting_for_start" || value === "tracking" || value === "complete";
}

function isTeamConfig(value: unknown): value is TeamConfig {
  return isRecord(value) && typeof value.name === "string" && typeof value.teamNum === "number";
}

function isBoTrackerState(value: unknown): value is BoTrackerState {
  if (!isRecord(value) || !isBestOf(value.bestOf) || !isPhase(value.phase)) return false;
  const teams = value.teams;
  return (
    isRecord(teams) &&
    isTeamConfig(teams.left) &&
    isTeamConfig(teams.right) &&
    typeof value.leftWins === "number" &&
    typeof value.rightWins === "number" &&
    typeof value.tracking === "boolean" &&
    typeof value.winsRequired === "number"
  );
}

function sideForTeamNum(state: BoTrackerState, teamNum: number): Side {
  if (state.teams.left.teamNum === teamNum) return "left";
  if (state.teams.right.teamNum === teamNum) return "right";
  return teamNum === 0 ? "left" : "right";
}

function teamNameForTeamNum(state: BoTrackerState, teamNum: number) {
  return state.teams[sideForTeamNum(state, teamNum)].name;
}

function winsForTeamNum(state: BoTrackerState, teamNum: number) {
  return sideForTeamNum(state, teamNum) === "left" ? state.leftWins : state.rightWins;
}

function sideLabel(state: BoTrackerState | null, side: Side) {
  if (!state) return side === "left" ? "Side 0" : "Side 1";
  const teamNum = state.teams[side].teamNum;
  return `Side ${teamNum}`;
}

function phaseLabel(phase: Phase) {
  switch (phase) {
    case "waiting_for_start":
      return "En attente";
    case "tracking":
      return "Suivi actif";
    case "complete":
      return "Termine";
    default:
      return "Inactif";
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function inputValue(root: HTMLElement, selector: string, fallback: string) {
  return root.querySelector<HTMLInputElement>(selector)?.value.trim() || fallback;
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input || document.activeElement === input) return;
  input.value = value;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBestOfButtonsTemplate() {
  return BEST_OF_VALUES.map((value) => `<button type="button" data-best-of="${value}">BO${value}</button>`).join("");
}

function renderHistoryTemplate(rows: BoTrackerState["history"], state: BoTrackerState | null, side0Text: string, side1Text: string) {
  if (!rows.length) {
    return `<div class="history-row"><span>-</span><strong>Aucun match compte</strong><span>-</span></div>`;
  }
  return rows
    .map((record) => {
      const label = record.winnerTeamNum === 0 ? side0Text : record.winnerTeamNum === 1 ? side1Text : state?.teams[record.winnerSide].name ?? record.winnerSide;
      return `<div class="history-row"><span>${escapeHtml(record.source)}</span><strong>${escapeHtml(label)}</strong><span>${new Date(record.countedAtMs).toLocaleTimeString()}</span></div>`;
    })
    .join("");
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function renderControlPanelTemplate(settings: ControlPanelSettings) {
  return `<style>${styleCss}</style>${fillTemplate(templateHtml, {
    title: escapeHtml(settings.title),
    subtitle: escapeHtml(settings.subtitle),
    bestOfButtons: renderBestOfButtonsTemplate(),
    history: settings.showHistory ? `<div class="history"></div>` : ""
  })}`;
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    const cleanupScale = fitVisualScale(context.root, 1200, 740);
    let state: BoTrackerState | null = null;
    let selectedBestOf: BestOf = settings.defaultBestOf;
    let configDirty = false;
    let busy = false;
    let message = "";

    context.root.innerHTML = renderControlPanelTemplate(settings);

    const root = context.root.querySelector<HTMLElement>(".bo-control");
    const side0Name = context.root.querySelector<HTMLInputElement>("#side0-name");
    const side1Name = context.root.querySelector<HTMLInputElement>("#side1-name");
    const side0Wins = context.root.querySelector<HTMLElement>(".side0-wins");
    const side1Wins = context.root.querySelector<HTMLElement>(".side1-wins");
    const messageNode = context.root.querySelector<HTMLElement>(".message");
    const titleNode = context.root.querySelector<HTMLElement>("h1");
    const subtitleNode = context.root.querySelector<HTMLElement>(".subtitle");
    let historyNode = context.root.querySelector<HTMLElement>(".history");
    const phaseChip = context.root.querySelector<HTMLElement>(".phase-chip");
    const boChip = context.root.querySelector<HTMLElement>(".bo-chip");
    const leaderChip = context.root.querySelector<HTMLElement>(".leader-chip");
    const matchupBo = context.root.querySelector<HTMLElement>(".matchup-bo");
    const required = context.root.querySelector<HTMLElement>(".required");
    const side0Label = context.root.querySelector<HTMLElement>(".side0-label");
    const side1Label = context.root.querySelector<HTMLElement>(".side1-label");
    const side0Display = context.root.querySelector<HTMLElement>(".side0-display");
    const side1Display = context.root.querySelector<HTMLElement>(".side1-display");
    const trackingToggle = context.root.querySelector<HTMLButtonElement>(".tracking-toggle");

    if (!root) {
      throw new Error("BO Tracker control panel root was not rendered.");
    }
    const panel = root;

    function syncSettingsChrome() {
      if (titleNode) titleNode.textContent = settings.title;
      if (subtitleNode) subtitleNode.textContent = settings.subtitle;
      if (settings.showHistory && !historyNode) {
        context.root.querySelector<HTMLElement>(".score-actions")?.insertAdjacentHTML("afterend", `<div class="history"></div>`);
        historyNode = context.root.querySelector<HTMLElement>(".history");
      } else if (!settings.showHistory && historyNode) {
        historyNode.remove();
        historyNode = null;
      }
    }

    function render() {
      syncSettingsChrome();
      const disabled = busy || !state;
      const bestOf = configDirty ? selectedBestOf : state?.bestOf ?? selectedBestOf;
      const side0 = state ? sideForTeamNum(state, 0) : "left";
      const side1 = state ? sideForTeamNum(state, 1) : "right";
      const side0Text = state ? teamNameForTeamNum(state, 0) : "Blue";
      const side1Text = state ? teamNameForTeamNum(state, 1) : "Orange";
      const side0Score = state ? winsForTeamNum(state, 0) : 0;
      const side1Score = state ? winsForTeamNum(state, 1) : 0;

      if (!configDirty) {
        setInputValue(side0Name, side0Text);
        setInputValue(side1Name, side1Text);
        selectedBestOf = bestOf;
      }
      if (side0Wins) side0Wins.textContent = String(side0Score);
      if (side1Wins) side1Wins.textContent = String(side1Score);

      for (const button of context.root.querySelectorAll<HTMLButtonElement>("[data-best-of]")) {
        button.classList.toggle("active", Number(button.dataset.bestOf) === bestOf);
      }
      for (const button of context.root.querySelectorAll<HTMLButtonElement>("button")) {
        button.disabled = busy || !state;
      }

      const phase = state?.phase ?? "idle";
      const tracking = phase === "tracking" || phase === "waiting_for_start";
      if (trackingToggle) {
        trackingToggle.textContent = tracking ? "Stop" : phase === "complete" ? "Reset + Start" : "Start";
        trackingToggle.classList.toggle("green", !tracking);
        trackingToggle.classList.toggle("orange", tracking);
      }
      if (phaseChip) {
        phaseChip.textContent = busy ? "Chargement" : phaseLabel(phase);
        phaseChip.classList.toggle("active", phase === "tracking" || phase === "waiting_for_start");
        phaseChip.classList.toggle("done", phase === "complete");
      }
      if (boChip) boChip.textContent = `BO${bestOf}`;
      if (matchupBo) matchupBo.textContent = `BO${bestOf}`;
      if (required) required.textContent = `First to ${Math.floor(bestOf / 2) + 1}`;
      if (leaderChip) {
        const winner = state?.winner ? state.teams[state.winner].name : null;
        leaderChip.textContent = winner ? `Winner: ${winner}` : `${side0Score} - ${side1Score}`;
        leaderChip.classList.toggle("done", Boolean(winner));
      }
      if (side0Label) side0Label.textContent = state ? sideLabel(state, side0) : "Side 0";
      if (side1Label) side1Label.textContent = state ? sideLabel(state, side1) : "Side 1";
      if (side0Display) side0Display.textContent = side0Text;
      if (side1Display) side1Display.textContent = side1Text;
      if (messageNode) messageNode.textContent = message;

      if (historyNode) {
        const rows = state?.history.slice(-settings.historyLimit).reverse() ?? [];
        historyNode.innerHTML = renderHistoryTemplate(rows, state, side0Text, side1Text);
      }

      panel.toggleAttribute("aria-busy", busy);
      panel.toggleAttribute("data-disabled", disabled);
    }

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        if (!state && !configDirty) selectedBestOf = settings.defaultBestOf;
        render();
      }
    });

    async function callService(method: string, input: unknown = {}) {
      busy = true;
      message = "";
      render();
      try {
        const output = await context.services.call(SERVICE_REF, method, input);
        if (isBoTrackerState(output)) {
          state = output;
          selectedBestOf = output.bestOf;
          configDirty = false;
        }
      } catch (error) {
        message = errorMessage(error);
        context.diagnostics.error("BO Tracker control panel service call failed.", { method, error });
      } finally {
        busy = false;
        render();
      }
    }

    function configInput(resetScore = false) {
      return {
        bestOf: selectedBestOf,
        leftTeamName: inputValue(context.root, "#side0-name", "Blue"),
        rightTeamName: inputValue(context.root, "#side1-name", "Orange"),
        leftTeamNum: 0,
        rightTeamNum: 1,
        resetScore
      };
    }

    async function adjustScore(teamNum: number, delta: number) {
      if (!state) return;
      const side = sideForTeamNum(state, teamNum);
      const current = winsForTeamNum(state, teamNum);
      await callService("adjustScore", {
        leftWins: side === "left" ? Math.max(0, current + delta) : state.leftWins,
        rightWins: side === "right" ? Math.max(0, current + delta) : state.rightWins
      });
    }

    function markConfigDirty() {
      configDirty = true;
      message = "";
      render();
    }

    side0Name?.addEventListener("input", markConfigDirty);
    side1Name?.addEventListener("input", markConfigDirty);

    for (const button of context.root.querySelectorAll<HTMLButtonElement>("[data-best-of]")) {
      button.addEventListener("click", () => {
        const nextBestOf = Number(button.dataset.bestOf);
        if (isBestOf(nextBestOf)) {
          selectedBestOf = nextBestOf;
          markConfigDirty();
        }
      });
    }

    for (const button of context.root.querySelectorAll<HTMLButtonElement>("[data-adjust]")) {
      button.addEventListener("click", () => {
        const [teamNum, delta] = (button.dataset.adjust ?? "").split(":").map(Number);
        if (Number.isFinite(teamNum) && Number.isFinite(delta)) void adjustScore(teamNum, delta);
      });
    }

    context.root.querySelector<HTMLButtonElement>(".apply-config")?.addEventListener("click", () => {
      void callService("configure", configInput(false));
    });
    context.root.querySelector<HTMLButtonElement>(".reset-series")?.addEventListener("click", () => {
      void callService("configure", configInput(true));
    });
    trackingToggle?.addEventListener("click", () => {
      if (!state) return;
      if (state.tracking) {
        void callService("stop");
        return;
      }
      void callService("configure", { ...configInput(state.phase === "complete"), start: "now" });
    });
    context.root.querySelector<HTMLButtonElement>(".undo")?.addEventListener("click", () => {
      void callService("undo");
    });

    const cleanup = context.bus.subscribe(STATE_EVENT, (event: BakingRLEvent<unknown>) => {
      if (isBoTrackerState(event.Data)) {
        state = event.Data;
        if (!configDirty) selectedBestOf = state.bestOf;
        render();
      }
    });

    await callService("snapshot");

    return () => {
      instances.delete(context.root);
      cleanupScale();
      cleanup();
    };
  },
  update(context: VisualContext) {
    instances.get(context.root)?.updateSettings(context.settings);
  }
});
