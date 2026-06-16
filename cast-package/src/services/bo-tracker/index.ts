import {
  type BakingRLEvent,
  type RlMatchEndedPayload,
  type RlSimpleMatchPayload
} from "@bakingrl/plugin-sdk";
import type { PluginRuntimeContext, RuntimeService } from "../../extension/runtimeService";
import {
  BO_STATE_EVENT,
  BO_STATE_KEY
} from "../../shared/events";

type BestOf = 1 | 3 | 5 | 7;
type Side = "left" | "right";
type Phase = "idle" | "waiting_for_start" | "tracking" | "complete";
type StartMode = "idle" | "now" | "nextMatch";

type TeamConfig = {
  name: string;
  teamNum: number;
};

type MatchRecord = {
  matchGuid: string;
  winnerSide: Side;
  winnerTeamNum: number;
  source: "auto" | "manual";
  countedAtMs: number;
};

type InternalState = {
  version: 1;
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
  history: MatchRecord[];
  winner: Side | null;
  updatedAtMs: number;
};

type PublicState = InternalState & {
  winsRequired: number;
  completed: boolean;
  leader: Side | "tied";
};

type ConfigureInput = {
  bestOf?: unknown;
  leftTeamName?: unknown;
  rightTeamName?: unknown;
  leftTeamNum?: unknown;
  rightTeamNum?: unknown;
  start?: unknown;
  resetScore?: unknown;
};

type StartInput = {
  mode?: unknown;
};

type AdjustScoreInput = {
  leftWins?: unknown;
  rightWins?: unknown;
};

type AwardInput = {
  side?: unknown;
};

type ResetInput = {
  keepConfig?: unknown;
};

const STORAGE_URI = "plugin://self/series-state.json";

let serviceContext: PluginRuntimeContext | null = null;
let state: InternalState = createDefaultState();
let saveChain: Promise<void> = Promise.resolve();

function createDefaultState(): InternalState {
  return {
    version: 1,
    bestOf: 5,
    teams: {
      left: { name: "Blue", teamNum: 0 },
      right: { name: "Orange", teamNum: 1 }
    },
    leftWins: 0,
    rightWins: 0,
    phase: "idle",
    tracking: false,
    currentMatchGuid: null,
    history: [],
    winner: null,
    updatedAtMs: Date.now()
  };
}

function winsRequired(bestOf = state.bestOf) {
  return Math.floor(bestOf / 2) + 1;
}

function normalizeBestOf(value: unknown, fallback: BestOf): BestOf {
  return value === 1 || value === 3 || value === 5 || value === 7 ? value : fallback;
}

function normalizeTeamNum(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizeName(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeSide(value: unknown): Side | null {
  return value === "left" || value === "right" ? value : null;
}

function normalizeStartMode(value: unknown, fallback: StartMode): StartMode {
  return value === "idle" || value === "now" || value === "nextMatch" ? value : fallback;
}

function clampWins(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(99, Math.trunc(value)));
}

function leader(): Side | "tied" {
  if (state.leftWins > state.rightWins) return "left";
  if (state.rightWins > state.leftWins) return "right";
  return "tied";
}

function publicState(): PublicState {
  return {
    ...state,
    teams: {
      left: { ...state.teams.left },
      right: { ...state.teams.right }
    },
    history: state.history.map((record) => ({ ...record })),
    winsRequired: winsRequired(),
    completed: state.phase === "complete",
    leader: leader()
  };
}

function restoreState(value: unknown): InternalState {
  const fallback = createDefaultState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Partial<InternalState>;
  const bestOf = normalizeBestOf(raw.bestOf, fallback.bestOf);
  const phase: Phase =
    raw.phase === "waiting_for_start" || raw.phase === "tracking" || raw.phase === "complete" || raw.phase === "idle"
      ? raw.phase
      : fallback.phase;

  return {
    version: 1,
    bestOf,
    teams: {
      left: {
        name: normalizeName(raw.teams?.left?.name, fallback.teams.left.name),
        teamNum: normalizeTeamNum(raw.teams?.left?.teamNum, fallback.teams.left.teamNum)
      },
      right: {
        name: normalizeName(raw.teams?.right?.name, fallback.teams.right.name),
        teamNum: normalizeTeamNum(raw.teams?.right?.teamNum, fallback.teams.right.teamNum)
      }
    },
    leftWins: clampWins(raw.leftWins),
    rightWins: clampWins(raw.rightWins),
    phase,
    tracking: Boolean(raw.tracking) && phase !== "complete",
    currentMatchGuid: typeof raw.currentMatchGuid === "string" ? raw.currentMatchGuid : null,
    history: Array.isArray(raw.history)
      ? raw.history
          .map((record): MatchRecord | null => {
            if (!record || typeof record !== "object") return null;
            const candidate = record as Partial<MatchRecord>;
            const winnerSide = normalizeSide(candidate.winnerSide);
            if (!winnerSide) return null;
            return {
              matchGuid: typeof candidate.matchGuid === "string" ? candidate.matchGuid : `restored-${Date.now()}`,
              winnerSide,
              winnerTeamNum: normalizeTeamNum(candidate.winnerTeamNum, winnerSide === "left" ? 0 : 1),
              source: candidate.source === "manual" ? "manual" : "auto",
              countedAtMs: normalizeTeamNum(candidate.countedAtMs, Date.now())
            };
          })
          .filter((record): record is MatchRecord => record !== null)
      : [],
    winner: normalizeSide(raw.winner),
    updatedAtMs: normalizeTeamNum(raw.updatedAtMs, Date.now())
  };
}

function resetScore() {
  state.leftWins = 0;
  state.rightWins = 0;
  state.history = [];
  state.winner = null;
  state.currentMatchGuid = null;
}

function markUpdated() {
  state.updatedAtMs = Date.now();
}

function setStartMode(mode: StartMode) {
  state.winner = null;
  if (mode === "idle") {
    state.phase = "idle";
    state.tracking = false;
    state.currentMatchGuid = null;
    return;
  }
  if (mode === "nextMatch") {
    state.phase = "waiting_for_start";
    state.tracking = true;
    state.currentMatchGuid = null;
    return;
  }
  state.phase = "tracking";
  state.tracking = true;
}

function sideForTeamNum(teamNum: number): Side | null {
  if (teamNum === state.teams.left.teamNum) return "left";
  if (teamNum === state.teams.right.teamNum) return "right";
  return null;
}

function matchGuidFromEvent(event: BakingRLEvent<RlSimpleMatchPayload | RlMatchEndedPayload, string>) {
  const guid = event.Data?.MatchGuid;
  return typeof guid === "string" && guid.trim() ? guid.trim() : null;
}

function isAlreadyCounted(matchGuid: string | null) {
  return Boolean(matchGuid && state.history.some((record) => record.matchGuid === matchGuid));
}

function applyWinnerIfComplete() {
  const required = winsRequired();
  if (state.leftWins >= required || state.rightWins >= required) {
    state.winner = state.leftWins > state.rightWins ? "left" : "right";
    state.phase = "complete";
    state.tracking = false;
    state.currentMatchGuid = null;
    return;
  }
  state.winner = null;
  if (state.phase === "complete") {
    state.phase = "tracking";
    state.tracking = true;
  }
}

function recordWin(side: Side, matchGuid: string | null, winnerTeamNum: number, source: "auto" | "manual") {
  const record: MatchRecord = {
    matchGuid: matchGuid ?? `${source}-${Date.now()}-${state.history.length}`,
    winnerSide: side,
    winnerTeamNum,
    source,
    countedAtMs: Date.now()
  };
  if (isAlreadyCounted(matchGuid)) return false;

  if (side === "left") {
    state.leftWins += 1;
  } else {
    state.rightWins += 1;
  }

  state.history = [...state.history, record];
  state.currentMatchGuid = null;
  applyWinnerIfComplete();
  markUpdated();
  return true;
}

async function publishState() {
  const context = serviceContext;
  if (!context) return publicState();
  const snapshot = publicState();
  context.registry.set(BO_STATE_KEY, snapshot);
  context.bus.emit(BO_STATE_EVENT, snapshot);
  saveChain = saveChain
    .catch(() => undefined)
    .then(() => context.storage.writeText(STORAGE_URI, JSON.stringify(state, null, 2)));
  return snapshot;
}

async function loadState(context: PluginRuntimeContext) {
  try {
    const raw = await context.storage.readText(STORAGE_URI);
    state = restoreState(JSON.parse(raw));
  } catch {
    state = createDefaultState();
  }
}

async function handleMatchStart(event: BakingRLEvent<RlSimpleMatchPayload, string>) {
  if (!state.tracking || state.phase === "complete") return;
  const matchGuid = matchGuidFromEvent(event);
  if (state.phase === "waiting_for_start") {
    state.phase = "tracking";
    state.currentMatchGuid = matchGuid;
    markUpdated();
    await publishState();
    return;
  }
  if (matchGuid && matchGuid !== state.currentMatchGuid && !isAlreadyCounted(matchGuid)) {
    state.currentMatchGuid = matchGuid;
    markUpdated();
    await publishState();
  }
}

async function handleMatchEnded(event: BakingRLEvent<RlMatchEndedPayload, "MatchEnded">) {
  if (!state.tracking || state.phase === "complete") return;
  const winnerTeamNum = normalizeTeamNum(event.Data?.WinnerTeamNum, -1);
  const side = sideForTeamNum(winnerTeamNum);
  if (!side) return;

  const matchGuid = matchGuidFromEvent(event) ?? state.currentMatchGuid;
  if (recordWin(side, matchGuid, winnerTeamNum, "auto")) {
    await publishState();
  }
}

async function configure(input: ConfigureInput = {}) {
  state.bestOf = normalizeBestOf(input.bestOf, state.bestOf);
  state.teams.left.name = normalizeName(input.leftTeamName, state.teams.left.name);
  state.teams.right.name = normalizeName(input.rightTeamName, state.teams.right.name);
  state.teams.left.teamNum = normalizeTeamNum(input.leftTeamNum, state.teams.left.teamNum);
  state.teams.right.teamNum = normalizeTeamNum(input.rightTeamNum, state.teams.right.teamNum);

  if (input.resetScore === true) {
    resetScore();
  }

  const start = normalizeStartMode(input.start, "idle");
  if (start !== "idle") {
    setStartMode(start);
  } else {
    applyWinnerIfComplete();
  }

  markUpdated();
  return publishState();
}

async function start(input: StartInput = {}) {
  const mode = normalizeStartMode(input.mode, "now");
  setStartMode(mode === "idle" ? "now" : mode);
  markUpdated();
  return publishState();
}

async function stop() {
  state.phase = state.winner ? "complete" : "idle";
  state.tracking = false;
  state.currentMatchGuid = null;
  markUpdated();
  return publishState();
}

async function adjustScore(input: AdjustScoreInput = {}) {
  state.leftWins = input.leftWins === undefined ? state.leftWins : clampWins(input.leftWins);
  state.rightWins = input.rightWins === undefined ? state.rightWins : clampWins(input.rightWins);
  state.history = [];
  state.currentMatchGuid = null;
  applyWinnerIfComplete();
  markUpdated();
  return publishState();
}

async function award(input: AwardInput = {}) {
  const side = normalizeSide(input.side);
  if (!side) throw new Error("award.side must be 'left' or 'right'.");
  recordWin(side, null, state.teams[side].teamNum, "manual");
  return publishState();
}

async function undo() {
  const last = state.history.at(-1);
  if (!last) return publicState();
  state.history = state.history.slice(0, -1);
  if (last.winnerSide === "left") {
    state.leftWins = Math.max(0, state.leftWins - 1);
  } else {
    state.rightWins = Math.max(0, state.rightWins - 1);
  }
  state.winner = null;
  if (state.phase === "complete") {
    state.phase = "tracking";
    state.tracking = true;
  }
  markUpdated();
  return publishState();
}

async function reset(input: ResetInput = {}) {
  const previousConfig = {
    bestOf: state.bestOf,
    teams: {
      left: { ...state.teams.left },
      right: { ...state.teams.right }
    }
  };
  state = createDefaultState();
  if (input.keepConfig !== false) {
    state.bestOf = previousConfig.bestOf;
    state.teams = previousConfig.teams;
  }
  markUpdated();
  return publishState();
}

export default {
  async mount(context: PluginRuntimeContext) {
    serviceContext = context;
    await loadState(context);
    context.bus.subscribe("MatchCreated", handleMatchStart);
    context.bus.subscribe("MatchInitialized", handleMatchStart);
    context.bus.subscribe("RoundStarted", handleMatchStart);
    context.bus.subscribe("MatchEnded", handleMatchEnded);
    await publishState();
  },
  methods: {
    async snapshot() {
      return publicState();
    },
    async configure(input) {
      return configure((input ?? {}) as ConfigureInput);
    },
    async start(input) {
      return start((input ?? {}) as StartInput);
    },
    async stop() {
      return stop();
    },
    async adjustScore(input) {
      return adjustScore((input ?? {}) as AdjustScoreInput);
    },
    async award(input) {
      return award((input ?? {}) as AwardInput);
    },
    async undo() {
      return undo();
    },
    async reset(input) {
      return reset((input ?? {}) as ResetInput);
    }
  }
} satisfies RuntimeService;
