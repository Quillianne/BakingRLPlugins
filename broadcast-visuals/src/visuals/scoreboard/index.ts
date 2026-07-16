import {
  type BakingRLEvent,
  type RlClockUpdatedSecondsPayload,
  type RlTeam,
  type RlUpdateStatePayload
} from "@bakingrl/plugin-sdk";
import { editorUpdateState as editorPreviewUpdateState } from "../editorPreviewData";
import { fitVisualScale } from "../fitVisualScale";
import { defineVisual, type VisualContext } from "../visualModule";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type ThemeId =
  | "app"
  | "modern-dark"
  | "neon-cyber"
  | "industrial-bakery"
  | "pro-streamer"
  | "hacker-terminal"
  | "broadcast-clean";

type Side = "left" | "right";

type BoTrackerState = {
  bestOf: 1 | 3 | 5 | 7;
  leftWins: number;
  rightWins: number;
  tracking: boolean;
  phase: "idle" | "waiting_for_start" | "tracking" | "complete";
  teams: {
    left: {
      name: string;
      teamNum: number;
    };
    right: {
      name: string;
      teamNum: number;
    };
  };
  winsRequired: number;
  winner: Side | null;
};

type ScoreboardSettings = {
  theme: ThemeId;
  showClock: boolean;
  showBoWhenTracking: boolean;
  uppercaseNames: boolean;
};

type ScoreboardInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

type EditorVisualContext = VisualContext & {
  editor?: {
    emit(eventName: string, payload?: unknown): void;
  };
};

const BO_STATE_EVENT = "plugin.bakingrl.stats-extended.series";
const BO_STATE_KEY = "plugin.bakingrl.stats-extended.series";
const instances = new Map<HTMLElement, ScoreboardInstance>();

const THEME_CLASS_BY_APP_THEME: Record<string, ThemeId> = {
  "modern-dark": "modern-dark",
  "neon-cyber": "neon-cyber",
  "industrial-bakery": "industrial-bakery",
  "pro-streamer": "pro-streamer",
  "hacker-terminal": "hacker-terminal"
};

function readSettings(settings: Record<string, unknown>): ScoreboardSettings {
  const theme = typeof settings.theme === "string" ? settings.theme : "app";
  return {
    theme: isTheme(theme) ? theme : "app",
    showClock: settings.showClock !== false,
    showBoWhenTracking: settings.showBoWhenTracking !== false,
    uppercaseNames: settings.uppercaseNames === true
  };
}

function isTheme(value: string): value is ThemeId {
  return (
    value === "app" ||
    value === "modern-dark" ||
    value === "neon-cyber" ||
    value === "industrial-bakery" ||
    value === "pro-streamer" ||
    value === "hacker-terminal" ||
    value === "broadcast-clean"
  );
}

function appTheme(): ThemeId {
  const theme = document.documentElement.dataset.theme ?? "modern-dark";
  return THEME_CLASS_BY_APP_THEME[theme] ?? "modern-dark";
}

function displayTheme(theme: ThemeId) {
  return theme === "app" ? appTheme() : theme;
}

function formatTeamName(name: string, uppercase: boolean) {
  const trimmed = name.trim() || "Team";
  return uppercase ? trimmed.toUpperCase() : trimmed;
}

function formatClockSeconds(secondsValue: number | undefined) {
  const seconds = Math.max(0, Math.ceil(secondsValue ?? 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function clockFromUpdate(data: RlUpdateStatePayload | null): RlClockUpdatedSecondsPayload | null {
  const game = data?.Game;
  if (!game) return null;
  return {
    MatchGuid: data.MatchGuid,
    TimeSeconds: game.TimeSeconds,
    bOvertime: game.bOvertime
  };
}

function teamByNum(data: RlUpdateStatePayload | null, teamNum: number): RlTeam | null {
  return data?.Game?.Teams?.find((team) => team.TeamNum === teamNum) ?? null;
}

function defaultTeam(data: RlUpdateStatePayload | null, teamNum: number, fallbackName: string): RlTeam {
  return (
    teamByNum(data, teamNum) ?? {
      TeamNum: teamNum,
      Name: fallbackName,
      Score: 0,
      ColorPrimary: "",
      ColorSecondary: ""
    }
  );
}

function isBoState(value: unknown): value is BoTrackerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<BoTrackerState>;
  return (
    typeof candidate.tracking === "boolean" &&
    typeof candidate.bestOf === "number" &&
    typeof candidate.leftWins === "number" &&
    typeof candidate.rightWins === "number" &&
    typeof candidate.teams?.left?.teamNum === "number" &&
    typeof candidate.teams?.right?.teamNum === "number"
  );
}

function pipClass(index: number, state: BoTrackerState) {
  const required = Math.max(1, state.winsRequired || Math.floor(state.bestOf / 2) + 1);
  const classes = ["bo-pip"];
  if (index === required - 1) classes.push("win-marker");
  if (index < Math.min(required, state.leftWins)) {
    classes.push("filled", "left");
  } else if (index >= state.bestOf - Math.min(required, state.rightWins)) {
    classes.push("filled", "right");
  }
  return classes.join(" ");
}

function renderBoPipsTemplate(state: BoTrackerState) {
  return Array.from(
    { length: state.bestOf },
    (_, index) => `<span class="${pipClass(index, state)}"></span>`
  ).join("");
}

function renderScoreboardTemplate() {
  return `<style>${styleCss}</style>${templateHtml}`;
}

function editorUpdateState(leftScore: number, rightScore: number): RlUpdateStatePayload {
  return editorPreviewUpdateState({ leftScore, rightScore, timeSeconds: 213 });
}

function editorBoState(leftWins: number, rightWins: number): BoTrackerState {
  return {
    bestOf: 5,
    leftWins,
    rightWins,
    tracking: true,
    phase: "tracking",
    teams: {
      left: { name: "Blue", teamNum: 0 },
      right: { name: "Orange", teamNum: 1 }
    },
    winsRequired: 3,
    winner: null
  };
}

function emitEditorScoreboardState(context: VisualContext, leftScore = 2, rightScore = 1, leftWins = 1, rightWins = 0) {
  const editor = (context as EditorVisualContext).editor;
  editor?.emit("UpdateState", editorUpdateState(leftScore, rightScore));
  editor?.emit(BO_STATE_EVENT, editorBoState(leftWins, rightWins));
  editor?.emit("ClockUpdatedSeconds", {
    MatchGuid: "editor-preview",
    TimeSeconds: 213,
    bOvertime: false
  } satisfies RlClockUpdatedSecondsPayload);
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    const cleanupScale = fitVisualScale(context.root, 760, 128);
    let latestUpdate: RlUpdateStatePayload | null = null;
    let latestClock: RlClockUpdatedSecondsPayload | null = null;
    let hasDedicatedClock = false;
    let boState: BoTrackerState | null = null;

    context.root.innerHTML = renderScoreboardTemplate();

    const root = context.root.querySelector<HTMLElement>(".brl-scoreboard");
    const leftName = context.root.querySelector<HTMLElement>(".left-name");
    const rightName = context.root.querySelector<HTMLElement>(".right-name");
    const leftScore = context.root.querySelector<HTMLElement>(".left-score");
    const rightScore = context.root.querySelector<HTMLElement>(".right-score");
    const clockWrap = context.root.querySelector<HTMLElement>(".clock-wrap");
    const clock = context.root.querySelector<HTMLElement>(".clock");
    const bo = context.root.querySelector<HTMLElement>(".bo");
    const boLabel = context.root.querySelector<HTMLElement>(".bo-label");
    const boPips = context.root.querySelector<HTMLElement>(".bo-pips");
    const placeholder = context.root.querySelector<HTMLElement>(".placeholder");

    function render() {
      if (!root || !leftName || !rightName || !leftScore || !rightScore || !clockWrap || !clock || !bo || !boLabel || !boPips || !placeholder) {
        return;
      }

      root.className = `brl-scoreboard theme-${displayTheme(settings.theme)}`;
      const activeBoState = settings.showBoWhenTracking && boState?.tracking === true ? boState : null;
      const leftTeam = activeBoState
        ? defaultTeam(latestUpdate, activeBoState.teams.left.teamNum, activeBoState.teams.left.name)
        : defaultTeam(latestUpdate, 0, "Blue");
      const rightTeam = activeBoState
        ? defaultTeam(latestUpdate, activeBoState.teams.right.teamNum, activeBoState.teams.right.name)
        : defaultTeam(latestUpdate, 1, "Orange");

      leftName.textContent = formatTeamName(activeBoState ? activeBoState.teams.left.name : leftTeam.Name, settings.uppercaseNames);
      rightName.textContent = formatTeamName(activeBoState ? activeBoState.teams.right.name : rightTeam.Name, settings.uppercaseNames);
      leftScore.textContent = String(leftTeam.Score ?? 0);
      rightScore.textContent = String(rightTeam.Score ?? 0);
      clock.textContent = settings.showClock && latestClock ? formatClockSeconds(latestClock.TimeSeconds) : "--:--";
      clockWrap.classList.toggle("overtime", Boolean(settings.showClock && latestClock?.bOvertime));
      clockWrap.style.display = settings.showClock ? "grid" : "none";
      placeholder.style.display = latestUpdate ? "none" : "block";

      bo.classList.toggle("active", activeBoState !== null);
      if (activeBoState) {
        boLabel.textContent = `BO${activeBoState.bestOf}`;
        boPips.innerHTML = renderBoPipsTemplate(activeBoState);
      }
    }

    const cleanups = [
      context.bus.subscribe("UpdateState", (event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) => {
        latestUpdate = event.Data;
        if (!hasDedicatedClock) {
          latestClock = clockFromUpdate(latestUpdate);
        }
        render();
      }),
      context.bus.subscribe(BO_STATE_EVENT, (event) => {
        if (isBoState(event.Data)) {
          boState = event.Data;
          render();
        }
      })
    ];

    try {
      cleanups.push(
        context.bus.subscribe("ClockUpdatedSeconds", (event: BakingRLEvent<RlClockUpdatedSecondsPayload, "ClockUpdatedSeconds">) => {
          hasDedicatedClock = true;
          latestClock = event.Data;
          render();
        })
      );
    } catch (error) {
      context.diagnostics.warn("Unable to subscribe to ClockUpdatedSeconds. Falling back to UpdateState clock.", error);
    }

    try {
      const registryState = await context.registry.get(BO_STATE_KEY);
      if (isBoState(registryState)) {
        boState = registryState;
      }
    } catch (error) {
      context.diagnostics.warn("Unable to read BO Tracker registry state.", error);
    }

    render();
    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        render();
      }
    });

    return () => {
      instances.delete(context.root);
      cleanupScale();
      for (const cleanup of cleanups) cleanup();
    };
  },
  update(context: VisualContext) {
    instances.get(context.root)?.updateSettings(context.settings);
  },
  editor: {
    mount(context: VisualContext) {
      emitEditorScoreboardState(context);
    },
    actions() {
      return [
        {
          id: "default-score",
          label: "Default Score",
          run(context: VisualContext) {
            emitEditorScoreboardState(context);
          }
        },
        {
          id: "overtime",
          label: "Overtime",
          run(context: VisualContext) {
            emitEditorScoreboardState(context, 3, 3, 2, 2);
            (context as EditorVisualContext).editor?.emit("ClockUpdatedSeconds", {
              MatchGuid: "editor-preview",
              TimeSeconds: 0,
              bOvertime: true
            } satisfies RlClockUpdatedSecondsPayload);
          }
        }
      ];
    }
  }
});
