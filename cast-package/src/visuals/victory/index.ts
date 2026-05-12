import {
  defineVisual,
  type BakingRLEvent,
  type RlMatchEndedPayload,
  type RlUpdateStatePayload,
  type VisualContext
} from "@bakingrl/plugin-sdk";
import {
  BO_STATE_EVENT,
  BO_STATE_KEY,
  boCompleted,
  displayTeamForBoSide,
  displayTeamForTeamNum,
  isBoState,
  safeUppercase,
  scoreLine,
  seriesScore,
  type BoTrackerState
} from "../../shared/events";
import { fitVisualScale } from "../fitVisualScale";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type VictorySettings = {
  showMatchWins: boolean;
  showBoWins: boolean;
  matchDurationMs: number;
  seriesDurationMs: number;
  uppercaseNames: boolean;
};

type VictoryPayload = {
  kind: "match" | "series";
  teamName: string;
  teamColor: string;
  teamContrast: string;
  side: "left" | "right";
  scoreline: string;
  detail: string;
  durationMs: number;
};

type VictoryInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

const instances = new Map<HTMLElement, VictoryInstance>();

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = settings[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function readSettings(settings: Record<string, unknown>): VictorySettings {
  return {
    showMatchWins: settings.showMatchWins !== false,
    showBoWins: settings.showBoWins !== false,
    matchDurationMs: numberSetting(settings, "matchDurationMs", 3600, 1200, 12000),
    seriesDurationMs: numberSetting(settings, "seriesDurationMs", 5600, 1800, 15000),
    uppercaseNames: settings.uppercaseNames !== false
  };
}

function renderTemplate() {
  return `<style>${styleCss}</style>${templateHtml}`;
}

function completedKey(state: BoTrackerState) {
  return [
    state.winner ?? "none",
    state.leftWins,
    state.rightWins,
    state.bestOf,
    state.updatedAtMs ?? 0
  ].join(":");
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    const cleanupScale = fitVisualScale(context.root, 1920, 1080);
    let latestUpdate: RlUpdateStatePayload | null = null;
    let latestBoState: BoTrackerState | null = null;
    let lastBoCompletionKey = "";
    let activePayload: VictoryPayload | null = null;
    let hideTimer: number | null = null;

    context.root.innerHTML = renderTemplate();
    context.setActive(false);

    const root = context.root.querySelector<HTMLElement>("[data-event-root]");
    const kicker = context.root.querySelector<HTMLElement>("[data-kicker]");
    const title = context.root.querySelector<HTMLElement>("[data-title]");
    const team = context.root.querySelector<HTMLElement>("[data-team]");
    const scoreline = context.root.querySelector<HTMLElement>("[data-scoreline]");
    const detail = context.root.querySelector<HTMLElement>("[data-detail]");

    function hide() {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      root?.classList.remove("is-active");
      root?.classList.add("is-hidden");
      activePayload = null;
      context.setActive(false);
    }

    function showVictory(payload: VictoryPayload) {
      if (!root || !kicker || !title || !team || !scoreline || !detail) return;
      activePayload = payload;

      root.style.setProperty("--event-team", payload.teamColor);
      root.style.setProperty("--event-contrast", payload.teamContrast);
      root.classList.toggle("series-win", payload.kind === "series");
      root.classList.toggle("match-win", payload.kind === "match");
      root.classList.toggle("team-right", payload.side === "right");
      root.classList.toggle("team-left", payload.side === "left");

      kicker.textContent = payload.kind === "series" ? "Series won" : "Match won";
      title.textContent = "Victory";
      team.textContent = safeUppercase(payload.teamName, settings.uppercaseNames);
      scoreline.textContent = payload.scoreline;
      detail.textContent = payload.detail;

      root.classList.remove("is-hidden");
      root.classList.remove("is-active");
      void root.offsetWidth;
      root.classList.add("is-active");
      context.setActive(true);

      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, payload.durationMs);
    }

    function showMatchWin(event: BakingRLEvent<RlMatchEndedPayload, "MatchEnded">) {
      if (!settings.showMatchWins) return;
      const winnerTeamNum = event.Data.WinnerTeamNum;
      const winnerTeam = displayTeamForTeamNum(latestUpdate, winnerTeamNum, latestBoState);
      showVictory({
        kind: "match",
        teamName: winnerTeam.name,
        teamColor: winnerTeam.color,
        teamContrast: winnerTeam.contrast,
        side: winnerTeam.side,
        scoreline: scoreLine(latestUpdate, latestBoState),
        detail: "Game winner",
        durationMs: settings.matchDurationMs
      });
    }

    function showSeriesWin(state: BoTrackerState) {
      if (!settings.showBoWins || !state.winner) return;
      const winnerTeam = displayTeamForBoSide(latestUpdate, state, state.winner);
      showVictory({
        kind: "series",
        teamName: winnerTeam.name,
        teamColor: winnerTeam.color,
        teamContrast: winnerTeam.contrast,
        side: winnerTeam.side,
        scoreline: `BO${state.bestOf}  ${seriesScore(state)}`,
        detail: `First to ${state.winsRequired || Math.floor(state.bestOf / 2) + 1}`,
        durationMs: settings.seriesDurationMs
      });
    }

    try {
      const registryState = await context.registry.get(BO_STATE_KEY);
      if (isBoState(registryState)) {
        latestBoState = registryState;
        if (boCompleted(registryState)) {
          lastBoCompletionKey = completedKey(registryState);
        }
      }
    } catch (error) {
      context.diagnostics.warn("Unable to read BO Tracker registry state.", error);
    }

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        if (activePayload && root?.classList.contains("is-active")) showVictory(activePayload);
      }
    });

    const cleanups = [
      context.bus.subscribe("UpdateState", (event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) => {
        latestUpdate = event.Data;
      }),
      context.bus.subscribe("MatchEnded", showMatchWin),
      context.bus.subscribe(BO_STATE_EVENT, (event) => {
        if (!isBoState(event.Data)) return;
        latestBoState = event.Data;
        if (!boCompleted(event.Data) || !event.Data.winner) return;
        const key = completedKey(event.Data);
        if (key === lastBoCompletionKey) return;
        lastBoCompletionKey = key;
        showSeriesWin(event.Data);
      })
    ];

    return () => {
      instances.delete(context.root);
      hide();
      cleanupScale();
      for (const cleanup of cleanups) cleanup();
    };
  },
  update(context: VisualContext) {
    instances.get(context.root)?.updateSettings(context.settings);
  }
});
