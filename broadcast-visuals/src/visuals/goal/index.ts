import {
  type BakingRLEvent,
  type RlGoalScoredPayload,
  type RlSimpleMatchPayload,
  type RlUpdateStatePayload
} from "@bakingrl/plugin-sdk";
import {
  displayTeamForTeamNum,
  GAME_SEQUENCE_EVENT,
  GAME_SEQUENCE_KEY,
  isGameSequenceState,
  type GameSequenceState,
  type SequencePhase,
  safeUppercase
} from "../../shared/events";
import { CAST_TRANSITION_EXIT_MS, castTransitionCss, renderCastTransitionJaws } from "../../shared/cast-transition";
import { editorUpdateState } from "../editorPreviewData";
import { fitVisualScale } from "../fitVisualScale";
import { defineVisual, type VisualContext } from "../visualModule";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type GoalSettings = {
  durationMs: number;
  showAssist: boolean;
  showSpeed: boolean;
  showTeam: boolean;
  uppercaseNames: boolean;
};

type GoalInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

type EditorVisualContext = VisualContext & {
  editor?: {
    emit(eventName: string, payload?: unknown): void;
  };
};

const instances = new Map<HTMLElement, GoalInstance>();
const EXIT_ANIMATION_MS = CAST_TRANSITION_EXIT_MS;

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = settings[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function readSettings(settings: Record<string, unknown>): GoalSettings {
  return {
    durationMs: numberSetting(settings, "durationMs", 3200, 1200, 10000),
    showAssist: settings.showAssist !== false,
    showSpeed: settings.showSpeed === true,
    showTeam: settings.showTeam === true,
    uppercaseNames: settings.uppercaseNames !== false
  };
}

function renderTemplate() {
  return `<style>${castTransitionCss}${styleCss}</style>${templateHtml.replace("{{transitionJaws}}", renderCastTransitionJaws())}`;
}

function formatSpeed(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${Math.round(value)} speed`;
}

function editorGoal(teamNum: 0 | 1): RlGoalScoredPayload {
  const name = teamNum === 0 ? "Vatira" : "Zen";
  return {
    MatchGuid: "editor-preview",
    GoalSpeed: teamNum === 0 ? 112 : 97,
    GoalTime: 213,
    ImpactLocation: { X: 0, Y: 0, Z: 0 },
    Scorer: { Name: name, TeamNum: teamNum },
    Assister: teamNum === 0 ? { Name: "Atow", TeamNum: teamNum } : null,
    BallLastTouch: {
      Player: { Name: name, TeamNum: teamNum },
      Speed: teamNum === 0 ? 112 : 97
    }
  };
}

function emitEditorGoal(context: VisualContext, teamNum: 0 | 1) {
  const editor = (context as EditorVisualContext).editor;
  editor?.emit("UpdateState", editorUpdateState({ leftScore: teamNum === 0 ? 1 : 0, rightScore: teamNum === 1 ? 1 : 0 }));
  editor?.emit(GAME_SEQUENCE_EVENT, {
    version: 1,
    source: "match",
    phase: "live",
    mode: "3v3",
    flags: { isMatchActive: true, isOvertime: false },
    updatedAtMs: Date.now()
  } satisfies GameSequenceState);
  editor?.emit("CountdownBegin", { MatchGuid: "editor-preview" } satisfies RlSimpleMatchPayload);
  editor?.emit("GoalScored", editorGoal(teamNum));
}

function phaseFromValue(value: unknown): SequencePhase | null {
  if (isGameSequenceState(value)) return value.phase;
  return null;
}

function sequenceStateFromValue(value: unknown): GameSequenceState | null {
  return isGameSequenceState(value) ? value : null;
}

function isReplaySequence(state: GameSequenceState | null) {
  return state?.source === "replay" || state?.phase === "goal_replay";
}

function canShowGoalForPhase(phase: SequencePhase | null) {
  return phase === "live";
}

export default defineVisual({
  async mount(context: VisualContext) {
    let settings = readSettings(context.settings);
    const cleanupScale = fitVisualScale(context.root, 1920, 1080);
    let latestUpdate: RlUpdateStatePayload | null = null;
    let activeGoal: RlGoalScoredPayload | null = null;
    let hideTimer: number | null = null;
    let exitTimer: number | null = null;
    let goalArmed = false;
    let sequencePhase: SequencePhase | null = null;
    let latestSequenceState: GameSequenceState | null = null;

    context.root.innerHTML = renderTemplate();
    context.setActive(false);

    const root = context.root.querySelector<HTMLElement>("[data-event-root]");
    const player = context.root.querySelector<HTMLElement>("[data-player]");
    const team = context.root.querySelector<HTMLElement>("[data-team]");
    const assist = context.root.querySelector<HTMLElement>("[data-assist]");
    const speed = context.root.querySelector<HTMLElement>("[data-speed]");

    function clearTimers() {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (exitTimer !== null) {
        window.clearTimeout(exitTimer);
        exitTimer = null;
      }
    }

    function hide(immediate = false) {
      clearTimers();
      if (immediate) {
        root?.classList.remove("is-active", "is-exiting");
        root?.classList.add("is-hidden");
        activeGoal = null;
        context.setActive(false);
        return;
      }
      root?.classList.remove("is-active");
      root?.classList.add("is-exiting");
      exitTimer = window.setTimeout(() => {
        root?.classList.remove("is-exiting");
        root?.classList.add("is-hidden");
        activeGoal = null;
        context.setActive(false);
        exitTimer = null;
      }, EXIT_ANIMATION_MS);
    }

    function cancelExit() {
      if (exitTimer !== null) {
        window.clearTimeout(exitTimer);
        exitTimer = null;
      }
      root?.classList.remove("is-exiting");
    }

    function scheduleHide(durationMs: number) {
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => hide(), durationMs);
    }

    function showGoal(goal: RlGoalScoredPayload) {
      if (!root || !player || !team || !assist || !speed) return;
      cancelExit();
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      activeGoal = goal;

      const displayTeam = displayTeamForTeamNum(latestUpdate, goal.Scorer.TeamNum);
      root.style.setProperty("--event-team", displayTeam.color);
      root.style.setProperty("--event-contrast", displayTeam.contrast);
      root.classList.toggle("team-right", displayTeam.side === "right");
      root.classList.toggle("team-left", displayTeam.side === "left");

      player.textContent = safeUppercase(goal.Scorer.Name, settings.uppercaseNames);
      team.textContent = settings.showTeam ? safeUppercase(displayTeam.name, settings.uppercaseNames) : "";
      team.style.display = settings.showTeam ? "" : "none";
      assist.textContent = settings.showAssist && goal.Assister?.Name
        ? `Assist ${safeUppercase(goal.Assister.Name, settings.uppercaseNames)}`
        : "";
      speed.textContent = settings.showSpeed ? formatSpeed(goal.GoalSpeed) : "";

      root.classList.remove("is-hidden");
      root.classList.remove("is-exiting");
      root.classList.remove("is-active");
      void root.offsetWidth;
      root.classList.add("is-active");
      context.setActive(true);

      scheduleHide(settings.durationMs);
    }

    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        if (activeGoal && root?.classList.contains("is-active")) showGoal(activeGoal);
      }
    });

    const cleanups = [
      context.bus.subscribe("UpdateState", (event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) => {
        latestUpdate = event.Data;
      }),
      context.bus.subscribe("CountdownBegin", (_event: BakingRLEvent<RlSimpleMatchPayload, "CountdownBegin">) => {
        goalArmed = true;
        sequencePhase = "countdown";
      }),
      context.bus.subscribe(GAME_SEQUENCE_EVENT, (event) => {
        latestSequenceState = sequenceStateFromValue(event.Data) ?? latestSequenceState;
        sequencePhase = latestSequenceState?.phase ?? phaseFromValue(event.Data) ?? sequencePhase;
      }),
      context.bus.subscribe("GoalScored", (event: BakingRLEvent<RlGoalScoredPayload, "GoalScored">) => {
        if (isReplaySequence(latestSequenceState)) return;
        if (!goalArmed && !canShowGoalForPhase(sequencePhase)) return;
        goalArmed = false;
        sequencePhase = "post_goal";
        showGoal(event.Data);
      })
    ];

    try {
      latestSequenceState = sequenceStateFromValue(await context.registry.get(GAME_SEQUENCE_KEY)) ?? latestSequenceState;
      sequencePhase = latestSequenceState?.phase ?? sequencePhase;
    } catch (error) {
      context.diagnostics.warn("Unable to read game sequence phase.", error);
    }

    return () => {
      instances.delete(context.root);
      hide(true);
      cleanupScale();
      for (const cleanup of cleanups) cleanup();
    };
  },
  update(context: VisualContext) {
    instances.get(context.root)?.updateSettings(context.settings);
  },
  editor: {
    actions() {
      return [
        {
          id: "blue-goal",
          label: "Blue Goal",
          run(context: VisualContext) {
            emitEditorGoal(context, 0);
          }
        },
        {
          id: "orange-goal",
          label: "Orange Goal",
          run(context: VisualContext) {
            emitEditorGoal(context, 1);
          }
        }
      ];
    }
  }
});
