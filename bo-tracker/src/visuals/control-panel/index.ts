import { defineVisual, type BakingRLEvent, type VisualContext } from "@bakingrl/plugin-sdk";

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

const PACKAGE_ID = "com.bakingrl.bo-tracker";
const SERVICE_REF = `${PACKAGE_ID}/boTracker`;
const STATE_EVENT = `plugin.${PACKAGE_ID}.state`;
const BEST_OF_VALUES: BestOf[] = [1, 3, 5, 7];

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

export default defineVisual({
  async mount(context: VisualContext) {
    const settings = readSettings(context.settings);
    let state: BoTrackerState | null = null;
    let selectedBestOf: BestOf = settings.defaultBestOf;
    let configDirty = false;
    let busy = false;
    let message = "";

    context.root.innerHTML = `
      <style>
        .bo-control {
          --bg: #101827;
          --panel: rgba(255, 255, 255, 0.075);
          --panel-strong: rgba(255, 255, 255, 0.12);
          --border: rgba(255, 255, 255, 0.16);
          --text: #f8fafc;
          --muted: rgba(226, 232, 240, 0.68);
          --blue: #3b82f6;
          --orange: #f97316;
          --green: #22c55e;
          --red: #ef4444;
          width: 100%;
          height: 100%;
          min-width: 0;
          min-height: 0;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 16px;
          padding: 18px;
          overflow: hidden;
          box-sizing: border-box;
          background:
            linear-gradient(135deg, rgba(59, 130, 246, 0.18), transparent 34%),
            linear-gradient(315deg, rgba(249, 115, 22, 0.16), transparent 36%),
            var(--bg);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .bo-control * {
          box-sizing: border-box;
        }
        .topbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          align-items: center;
        }
        .title-block {
          min-width: 0;
        }
        .title-block h1 {
          margin: 0;
          font-size: 24px;
          line-height: 1.1;
          letter-spacing: 0;
        }
        .title-block span {
          display: block;
          margin-top: 5px;
          color: var(--muted);
          font-size: 13px;
          font-weight: 700;
        }
        .status {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
        }
        .chip {
          min-height: 28px;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 5px 10px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          color: var(--text);
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }
        .chip.active {
          border-color: rgba(34, 197, 94, 0.5);
          color: #dcfce7;
          background: rgba(34, 197, 94, 0.14);
        }
        .chip.done {
          border-color: rgba(249, 115, 22, 0.55);
          color: #ffedd5;
          background: rgba(249, 115, 22, 0.16);
        }
        .grid {
          min-height: 0;
          display: grid;
          grid-template-columns: minmax(300px, 0.82fr) minmax(360px, 1.18fr);
          gap: 16px;
          overflow: hidden;
        }
        .panel {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: rgba(8, 13, 23, 0.74);
          overflow: hidden;
        }
        .panel h2 {
          margin: 0;
          font-size: 15px;
          line-height: 1.25;
          letter-spacing: 0;
        }
        .field {
          display: grid;
          gap: 6px;
        }
        label,
        .field-label {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
        }
        input {
          width: 100%;
          min-height: 38px;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.08);
          color: var(--text);
          font: inherit;
          font-size: 14px;
          outline: none;
        }
        input:focus {
          border-color: rgba(59, 130, 246, 0.82);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
        }
        input[type="number"] {
          text-align: center;
          font-weight: 900;
        }
        .team-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .segmented {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 7px;
        }
        button {
          min-height: 38px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.08);
          color: var(--text);
          font: inherit;
          font-size: 13px;
          font-weight: 850;
          letter-spacing: 0;
          cursor: pointer;
        }
        button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.14);
          border-color: rgba(255, 255, 255, 0.26);
        }
        button:disabled {
          cursor: not-allowed;
          opacity: 0.54;
        }
        button.primary {
          border-color: rgba(59, 130, 246, 0.68);
          background: rgba(59, 130, 246, 0.22);
        }
        button.green {
          border-color: rgba(34, 197, 94, 0.62);
          background: rgba(34, 197, 94, 0.18);
        }
        button.orange {
          border-color: rgba(249, 115, 22, 0.62);
          background: rgba(249, 115, 22, 0.18);
        }
        button.red {
          border-color: rgba(239, 68, 68, 0.62);
          background: rgba(239, 68, 68, 0.16);
        }
        button.active {
          border-color: rgba(59, 130, 246, 0.9);
          background: rgba(59, 130, 246, 0.34);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
        }
        .actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .actions.single {
          grid-template-columns: 1fr;
        }
        .matchup {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          gap: 12px;
          align-items: stretch;
        }
        .side-score {
          min-width: 0;
          display: grid;
          gap: 10px;
          padding: 14px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--panel);
        }
        .side-score.left {
          border-left: 4px solid var(--blue);
        }
        .side-score.right {
          border-right: 4px solid var(--orange);
          text-align: right;
        }
        .side-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 17px;
          font-weight: 900;
        }
        .score-row {
          display: grid;
          grid-template-columns: 38px minmax(64px, 1fr) 38px;
          gap: 8px;
          align-items: center;
        }
        .score-row button {
          min-width: 38px;
          padding: 0;
          font-size: 18px;
        }
        .score-value {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 50px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.08);
          color: var(--text);
          font-size: 28px;
          font-weight: 900;
        }
        .versus {
          align-self: center;
          display: grid;
          gap: 8px;
          justify-items: center;
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
        }
        .bo-badge {
          min-width: 62px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--panel-strong);
          color: var(--text);
          text-align: center;
        }
        .score-actions {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 8px;
        }
        .history {
          min-height: 0;
          display: grid;
          gap: 8px;
          overflow: auto;
          padding-right: 3px;
        }
        .history-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          padding: 9px 10px;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.06);
          color: var(--muted);
          font-size: 12px;
          font-weight: 750;
        }
        .history-row strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text);
        }
        .message {
          min-height: 22px;
          color: #fecaca;
          font-size: 12px;
          font-weight: 800;
        }
        .message:empty {
          display: none;
        }
        @media (max-width: 860px) {
          .bo-control {
            overflow: auto;
          }
          .topbar,
          .grid,
          .matchup {
            grid-template-columns: 1fr;
          }
          .status {
            justify-content: flex-start;
          }
        }
      </style>
      <div class="bo-control">
        <div class="topbar">
          <div class="title-block">
            <h1>${escapeHtml(settings.title)}</h1>
            <span class="subtitle">${escapeHtml(settings.subtitle)}</span>
          </div>
          <div class="status">
            <span class="chip phase-chip">Inactif</span>
            <span class="chip bo-chip">BO5</span>
            <span class="chip leader-chip">0 - 0</span>
          </div>
        </div>
        <div class="grid">
          <section class="panel">
            <h2>Configuration</h2>
            <div class="team-fields">
              <div class="field">
                <label for="side0-name">Equipe Side 0</label>
                <input id="side0-name" autocomplete="off" />
              </div>
              <div class="field">
                <label for="side1-name">Equipe Side 1</label>
                <input id="side1-name" autocomplete="off" />
              </div>
            </div>
            <div class="field">
              <span class="field-label">Format BO</span>
              <div class="segmented bo-buttons">
                ${BEST_OF_VALUES.map((value) => `<button type="button" data-best-of="${value}">BO${value}</button>`).join("")}
              </div>
            </div>
            <div class="actions">
              <button type="button" class="primary apply-config">Appliquer</button>
              <button type="button" class="new-series">Nouveau BO</button>
              <button type="button" class="green tracking-toggle">Start</button>
            </div>
            <div class="message"></div>
          </section>

          <section class="panel">
            <h2>Score</h2>
            <div class="matchup">
              <div class="side-score left">
                <span class="field-label side0-label">Side 0</span>
                <span class="side-name side0-display">Blue</span>
                <div class="score-row">
                  <button type="button" data-adjust="0:-1">-</button>
                  <span class="score-value side0-wins">0</span>
                  <button type="button" data-adjust="0:1">+</button>
                </div>
                <button type="button" class="primary" data-award="0">Award side 0</button>
              </div>
              <div class="versus">
                <span class="bo-badge matchup-bo">BO5</span>
                <span class="required">First to 3</span>
              </div>
              <div class="side-score right">
                <span class="field-label side1-label">Side 1</span>
                <span class="side-name side1-display">Orange</span>
                <div class="score-row">
                  <button type="button" data-adjust="1:-1">-</button>
                  <span class="score-value side1-wins">0</span>
                  <button type="button" data-adjust="1:1">+</button>
                </div>
                <button type="button" class="primary" data-award="1">Award side 1</button>
              </div>
            </div>
            <div class="score-actions">
              <button type="button" class="undo">Undo</button>
            </div>
            ${settings.showHistory ? `<div class="history"></div>` : ""}
          </section>
        </div>
      </div>
    `;

    const root = context.root.querySelector<HTMLElement>(".bo-control");
    const side0Name = context.root.querySelector<HTMLInputElement>("#side0-name");
    const side1Name = context.root.querySelector<HTMLInputElement>("#side1-name");
    const side0Wins = context.root.querySelector<HTMLElement>(".side0-wins");
    const side1Wins = context.root.querySelector<HTMLElement>(".side1-wins");
    const messageNode = context.root.querySelector<HTMLElement>(".message");
    const historyNode = context.root.querySelector<HTMLElement>(".history");
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

    function render() {
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
        trackingToggle.textContent = tracking ? "Stop" : phase === "complete" ? "Start new BO" : "Start";
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
        historyNode.innerHTML = rows.length
          ? rows
              .map((record) => {
                const label = record.winnerTeamNum === 0 ? side0Text : record.winnerTeamNum === 1 ? side1Text : state?.teams[record.winnerSide].name ?? record.winnerSide;
                return `<div class="history-row"><span>${escapeHtml(record.source)}</span><strong>${escapeHtml(label)}</strong><span>${new Date(record.countedAtMs).toLocaleTimeString()}</span></div>`;
              })
              .join("")
          : `<div class="history-row"><span>-</span><strong>Aucun match compte</strong><span>-</span></div>`;
      }

      panel.toggleAttribute("aria-busy", busy);
      panel.toggleAttribute("data-disabled", disabled);
    }

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

    for (const button of context.root.querySelectorAll<HTMLButtonElement>("[data-award]")) {
      button.addEventListener("click", () => {
        if (!state) return;
        const teamNum = Number(button.dataset.award);
        void callService("award", { side: sideForTeamNum(state, teamNum) });
      });
    }

    context.root.querySelector<HTMLButtonElement>(".apply-config")?.addEventListener("click", () => {
      void callService("configure", configInput(false));
    });
    context.root.querySelector<HTMLButtonElement>(".new-series")?.addEventListener("click", () => {
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
      cleanup();
    };
  }
});
