import type { RlTeam, RlUpdateStatePayload } from "@bakingrl/plugin-sdk";

export type Side = "left" | "right";

export type DisplayTeam = {
  name: string;
  teamNum: number;
  color: string;
  contrast: string;
  side: Side;
};

export type BoTrackerState = {
  bestOf: 1 | 3 | 5 | 7;
  leftWins: number;
  rightWins: number;
  tracking: boolean;
  phase: "idle" | "waiting_for_start" | "tracking" | "complete";
  currentMatchGuid?: string | null;
  history?: Array<{
    matchGuid: string;
    winnerSide: Side;
    winnerTeamNum: number;
    source: "auto" | "manual";
    countedAtMs: number;
  }>;
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
  completed?: boolean;
  updatedAtMs?: number;
};

export type SequenceSource = "menu" | "training" | "match" | "replay";
export type SequencePhase =
  | "idle"
  | "pre_match"
  | "countdown"
  | "live"
  | "paused"
  | "goal_replay"
  | "post_goal"
  | "ended"
  | "podium";

export type GameSequenceState = {
  version: 1;
  source: SequenceSource;
  phase: SequencePhase;
  mode: string;
  flags: {
    isMatchActive: boolean;
    isOvertime: boolean;
  };
  updatedAtMs: number;
};

export type RegieCue = "statistics" | "teamDetail" | "teamSummary" | "headToHead" | "cageStats";

export type RegieCommand = {
  version: 1;
  id: string;
  action: "trigger" | "clear";
  cue?: RegieCue;
  payload: Record<string, unknown>;
  durationMs: number;
  updatedAtMs: number;
};

export type RegieState = {
  version: 1;
  active: RegieCommand[];
  updatedAtMs: number;
};

export const BO_STATE_EVENT = "plugin.com.bakingrl.cast-package.state";
export const BO_STATE_KEY = "plugin.com.bakingrl.cast-package.state";
export const GAME_SEQUENCE_EVENT = "plugin.com.bakingrl.cast-package.sequence";
export const GAME_SEQUENCE_KEY = "plugin.com.bakingrl.cast-package.sequence";
export const PLAYER_STATS_EVENT = "plugin.com.bakingrl.cast-package.player-stats";
export const PLAYER_STATS_KEY = "plugin.com.bakingrl.cast-package.player-stats";
export const CAGE_STATS_EVENT = "plugin.com.bakingrl.cast-package.cage-stats";
export const CAGE_STATS_KEY = "plugin.com.bakingrl.cast-package.cage-stats";
export const REGIE_EVENT = "plugin.com.bakingrl.cast-package.regie";
export const REGIE_KEY = "plugin.com.bakingrl.cast-package.regie";

const FALLBACK_BLUE = "#0055ff";
const FALLBACK_ORANGE = "#ff7700";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isBoState(value: unknown): value is BoTrackerState {
  if (!isRecord(value) || !isRecord(value.teams)) return false;
  const teams = value.teams;
  return (
    (value.bestOf === 1 || value.bestOf === 3 || value.bestOf === 5 || value.bestOf === 7) &&
    typeof value.leftWins === "number" &&
    typeof value.rightWins === "number" &&
    typeof value.tracking === "boolean" &&
    typeof value.phase === "string" &&
    (value.winner === null || value.winner === "left" || value.winner === "right") &&
    isRecord(teams.left) &&
    isRecord(teams.right) &&
    typeof teams.left.name === "string" &&
    typeof teams.right.name === "string" &&
    typeof teams.left.teamNum === "number" &&
    typeof teams.right.teamNum === "number"
  );
}

export function isSequencePhase(value: unknown): value is SequencePhase {
  return (
    value === "idle" ||
    value === "pre_match" ||
    value === "countdown" ||
    value === "live" ||
    value === "paused" ||
    value === "goal_replay" ||
    value === "post_goal" ||
    value === "ended" ||
    value === "podium"
  );
}

export function isGameSequenceState(value: unknown): value is GameSequenceState {
  if (!isRecord(value) || !isRecord(value.flags)) return false;
  return (
    value.version === 1 &&
    (value.source === "menu" || value.source === "training" || value.source === "match" || value.source === "replay") &&
    isSequencePhase(value.phase) &&
    typeof value.mode === "string" &&
    typeof value.flags.isMatchActive === "boolean" &&
    typeof value.flags.isOvertime === "boolean" &&
    typeof value.updatedAtMs === "number"
  );
}

export function boCompleted(state: BoTrackerState) {
  return state.phase === "complete" || state.completed === true;
}

export function sideForTeamNum(state: BoTrackerState | null, teamNum: number): Side {
  if (state?.teams.left.teamNum === teamNum) return "left";
  if (state?.teams.right.teamNum === teamNum) return "right";
  return teamNum === 1 ? "right" : "left";
}

export function teamByNum(update: RlUpdateStatePayload | null, teamNum: number): RlTeam | null {
  return update?.Game?.Teams?.find((team) => team.TeamNum === teamNum) ?? null;
}

export function displayTeamForTeamNum(
  update: RlUpdateStatePayload | null,
  teamNum: number,
  boState: BoTrackerState | null = null
): DisplayTeam {
  const side = sideForTeamNum(boState, teamNum);
  const boTeam = boState ? boState.teams[side] : null;
  const telemetryTeam = teamByNum(update, teamNum);
  const fallbackName = side === "left" ? "Blue" : "Orange";
  const fallbackColor = side === "left" ? FALLBACK_BLUE : FALLBACK_ORANGE;
  const color = normalizeColor(telemetryTeam?.ColorPrimary, fallbackColor);

  return {
    name: boTeam?.name || telemetryTeam?.Name || fallbackName,
    teamNum,
    color,
    contrast: contrastColor(color),
    side
  };
}

export function displayTeamForBoSide(
  update: RlUpdateStatePayload | null,
  boState: BoTrackerState,
  side: Side
): DisplayTeam {
  const teamNum = boState.teams[side].teamNum;
  const telemetryTeam = teamByNum(update, teamNum);
  const fallbackColor = side === "left" ? FALLBACK_BLUE : FALLBACK_ORANGE;
  const color = normalizeColor(telemetryTeam?.ColorPrimary, fallbackColor);
  return {
    name: boState.teams[side].name || telemetryTeam?.Name || (side === "left" ? "Blue" : "Orange"),
    teamNum,
    color,
    contrast: contrastColor(color),
    side
  };
}

export function scoreLine(update: RlUpdateStatePayload | null, boState: BoTrackerState | null = null) {
  const leftTeamNum = boState?.teams.left.teamNum ?? 0;
  const rightTeamNum = boState?.teams.right.teamNum ?? 1;
  const left = teamByNum(update, leftTeamNum)?.Score ?? 0;
  const right = teamByNum(update, rightTeamNum)?.Score ?? 0;
  return `${left} - ${right}`;
}

export function seriesScore(state: BoTrackerState) {
  return `${state.leftWins} - ${state.rightWins}`;
}

function normalizeColor(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed)) return trimmed;
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed}`;
  return fallback;
}

function contrastColor(hex: string) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return "#ffffff";
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.58 ? "#101827" : "#ffffff";
}

export function safeUppercase(value: string, uppercase: boolean) {
  const normalized = value.trim() || "Unknown";
  return uppercase ? normalized.toUpperCase() : normalized;
}
