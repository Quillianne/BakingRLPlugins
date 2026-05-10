import {
  defineVisual,
  type BakingRLEvent,
  type RlGoalScoredPayload,
  type RlSimpleMatchPayload,
  type RlUpdateStatePayload,
  type VisualContext
} from "@bakingrl/plugin-sdk";
import {
  displayTeamForTeamNum,
  safeUppercase
} from "../../shared/events";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type GoalSettings = {
  durationMs: number;
  showAssist: boolean;
  showSpeed: boolean;
  uppercaseNames: boolean;
};

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = settings[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function readSettings(settings: Record<string, unknown>): GoalSettings {
  return {
    durationMs: numberSetting(settings, "durationMs", 3200, 1200, 10000),
    showAssist: settings.showAssist !== false,
    showSpeed: settings.showSpeed !== false,
    uppercaseNames: settings.uppercaseNames !== false
  };
}

function renderTemplate() {
  return `<style>${styleCss}</style>${templateHtml}`;
}

function formatSpeed(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${Math.round(value)} speed`;
}

export default defineVisual({
  mount(context: VisualContext) {
    const settings = readSettings(context.settings);
    let latestUpdate: RlUpdateStatePayload | null = null;
    let hideTimer: number | null = null;
    let goalArmed = false;

    context.root.innerHTML = renderTemplate();
    context.setActive(false);

    const root = context.root.querySelector<HTMLElement>("[data-event-root]");
    const player = context.root.querySelector<HTMLElement>("[data-player]");
    const team = context.root.querySelector<HTMLElement>("[data-team]");
    const assist = context.root.querySelector<HTMLElement>("[data-assist]");
    const speed = context.root.querySelector<HTMLElement>("[data-speed]");

    function hide() {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      root?.classList.remove("is-active");
      root?.classList.add("is-hidden");
      context.setActive(false);
    }

    function showGoal(goal: RlGoalScoredPayload) {
      if (!root || !player || !team || !assist || !speed) return;

      const displayTeam = displayTeamForTeamNum(latestUpdate, goal.Scorer.TeamNum);
      root.style.setProperty("--event-team", displayTeam.color);
      root.style.setProperty("--event-contrast", displayTeam.contrast);
      root.classList.toggle("team-right", displayTeam.side === "right");
      root.classList.toggle("team-left", displayTeam.side === "left");

      player.textContent = safeUppercase(goal.Scorer.Name, settings.uppercaseNames);
      team.textContent = safeUppercase(displayTeam.name, settings.uppercaseNames);
      assist.textContent = settings.showAssist && goal.Assister?.Name
        ? `Assist ${safeUppercase(goal.Assister.Name, settings.uppercaseNames)}`
        : "";
      speed.textContent = settings.showSpeed ? formatSpeed(goal.GoalSpeed) : "";

      root.classList.remove("is-hidden");
      root.classList.remove("is-active");
      void root.offsetWidth;
      root.classList.add("is-active");
      context.setActive(true);

      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, settings.durationMs);
    }

    const cleanups = [
      context.bus.subscribe("UpdateState", (event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) => {
        latestUpdate = event.Data;
      }),
      context.bus.subscribe("CountdownBegin", (_event: BakingRLEvent<RlSimpleMatchPayload, "CountdownBegin">) => {
        goalArmed = true;
      }),
      context.bus.subscribe("GoalScored", (event: BakingRLEvent<RlGoalScoredPayload, "GoalScored">) => {
        if (!goalArmed) return;
        goalArmed = false;
        showGoal(event.Data);
      })
    ];

    return () => {
      hide();
      for (const cleanup of cleanups) cleanup();
    };
  }
});
