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

export const BO_STATE_EVENT = "plugin.com.bakingrl.cast-package.state";
export const BO_STATE_KEY = "plugin.com.bakingrl.cast-package.state";

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
