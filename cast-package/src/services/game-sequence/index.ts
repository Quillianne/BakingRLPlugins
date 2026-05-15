import {
  defineService,
  type BakingRLEvent,
  type CleanupFn,
  type RlClockUpdatedSecondsPayload,
  type RlMatchEndedPayload,
  type RlSimpleMatchPayload,
  type RlUpdateStatePayload,
  type ServiceContext
} from "@bakingrl/plugin-sdk";

type SequenceSource = "menu" | "training" | "match" | "replay";
type SequencePhase =
  | "idle"
  | "pre_match"
  | "countdown"
  | "live"
  | "paused"
  | "goal_replay"
  | "post_goal"
  | "ended"
  | "podium";
type ReplayKind = "none" | "goal" | "game";

type InternalState = {
  version: 1;
  source: SequenceSource;
  matchGuid: string | null;
  countdownStarted: boolean;
  roundStarted: boolean;
  replayActive: boolean;
  replayKind: ReplayKind;
  paused: boolean;
  podiumActive: boolean;
  hasWinner: boolean;
  postGoal: boolean;
  currentBluePlayers: number;
  currentOrangePlayers: number;
  currentTotalPlayers: number;
  maxBluePlayers: number;
  maxOrangePlayers: number;
  overtime: boolean;
  updatedAtMs: number;
};

type GameSequenceState = {
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

const PACKAGE_ID = "com.bakingrl.cast-package";
const STATE_EVENT = `plugin.${PACKAGE_ID}.sequence`;
const REGISTRY_KEY = `plugin.${PACKAGE_ID}.sequence`;

let serviceContext: ServiceContext | null = null;
let state: InternalState = createDefaultState();
let cleanups: CleanupFn[] = [];
let lastPublishedSignature = "";

function createDefaultState(): InternalState {
  return {
    version: 1,
    source: "menu",
    matchGuid: null,
    countdownStarted: false,
    roundStarted: false,
    replayActive: false,
    replayKind: "none",
    paused: false,
    podiumActive: false,
    hasWinner: false,
    postGoal: false,
    currentBluePlayers: 0,
    currentOrangePlayers: 0,
    currentTotalPlayers: 0,
    maxBluePlayers: 0,
    maxOrangePlayers: 0,
    overtime: false,
    updatedAtMs: Date.now()
  };
}

function resetMatchScopedState(matchGuid: string | null) {
  state = {
    ...createDefaultState(),
    source: matchGuid ? "match" : "menu",
    matchGuid,
    updatedAtMs: state.updatedAtMs
  };
}

function resetToSource(source: SequenceSource) {
  state = {
    ...createDefaultState(),
    source,
    updatedAtMs: state.updatedAtMs
  };
}

function cleanGuid(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ensureMatch(matchGuid: string | null) {
  if (!matchGuid) return;
  if (state.matchGuid !== matchGuid) {
    resetMatchScopedState(matchGuid);
    return;
  }
  state.source = "match";
}

function guidFromSimpleEvent(event: BakingRLEvent<RlSimpleMatchPayload, string>) {
  return cleanGuid(event.Data?.MatchGuid);
}

function updatePlayerCounts(data: RlUpdateStatePayload) {
  const players = data.Players ?? [];
  const bluePlayers = players.filter((player) => player.TeamNum === 0).length;
  const orangePlayers = players.filter((player) => player.TeamNum === 1).length;
  state.currentBluePlayers = bluePlayers;
  state.currentOrangePlayers = orangePlayers;
  state.currentTotalPlayers = bluePlayers + orangePlayers;

  if (state.source === "match" || state.matchGuid) {
    state.maxBluePlayers = Math.max(state.maxBluePlayers, bluePlayers);
    state.maxOrangePlayers = Math.max(state.maxOrangePlayers, orangePlayers);
  }
}

function modeCounts() {
  return {
    bluePlayers: Math.max(state.maxBluePlayers, state.currentBluePlayers),
    orangePlayers: Math.max(state.maxOrangePlayers, state.currentOrangePlayers)
  };
}

function modeLabel(bluePlayers: number, orangePlayers: number) {
  if (bluePlayers !== orangePlayers) return "unknown";
  if (bluePlayers < 1 || bluePlayers > 4) return "unknown";
  return `${bluePlayers}v${bluePlayers}`;
}

function derivedSource(): SequenceSource {
  if (state.replayActive && state.replayKind === "game") return "replay";
  if (state.matchGuid) return "match";
  return state.source;
}

function isReplayActive() {
  return state.replayActive;
}

function replayKind() {
  return state.replayActive ? state.replayKind : "none";
}

function derivedPhase(source = derivedSource()): SequencePhase {
  if (state.podiumActive) return "podium";
  if (state.paused && state.countdownStarted && !state.hasWinner) return "paused";
  if (isReplayActive() && replayKind() === "goal") return "goal_replay";
  if (state.hasWinner) return "ended";
  if (state.postGoal) return "post_goal";
  if (state.countdownStarted && !state.roundStarted) return "countdown";
  if (source === "training" || source === "replay") return "live";
  if (state.countdownStarted || state.roundStarted) return "live";
  if (state.matchGuid || source === "match") return "pre_match";
  return "idle";
}

function publicState(): GameSequenceState {
  const source = derivedSource();
  const phase = derivedPhase(source);
  const counts = modeCounts();
  const replayActive = isReplayActive();
  const matchActive =
    source === "match" &&
    Boolean(state.matchGuid) &&
    state.countdownStarted &&
    !state.paused &&
    !replayActive &&
    !state.postGoal &&
    !state.podiumActive &&
    !state.hasWinner;

  return {
    version: 1,
    source,
    phase,
    mode: state.countdownStarted ? modeLabel(counts.bluePlayers, counts.orangePlayers) : "unknown",
    flags: {
      isMatchActive: matchActive,
      isOvertime: state.overtime
    },
    updatedAtMs: state.updatedAtMs
  };
}

function signatureFor(snapshot: GameSequenceState) {
  const { updatedAtMs: _updatedAtMs, ...stableSnapshot } = snapshot;
  return JSON.stringify(stableSnapshot);
}

function publishState(force = false) {
  const context = serviceContext;
  const snapshot = publicState();
  const signature = signatureFor(snapshot);
  if (!force && signature === lastPublishedSignature) return snapshot;

  state.updatedAtMs = Date.now();
  const nextSnapshot = publicState();
  lastPublishedSignature = signatureFor(nextSnapshot);

  if (context) {
    context.registry.set(REGISTRY_KEY, nextSnapshot);
    context.bus.emit(STATE_EVENT, nextSnapshot);
  }

  return nextSnapshot;
}

function handleUpdateState(event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) {
  const data = event.Data;
  if (!data) return;

  const matchGuid = cleanGuid(data.MatchGuid);
  if (matchGuid) {
    ensureMatch(matchGuid);
  }

  state.overtime = data.Game?.bOvertime === true;
  state.hasWinner = state.hasWinner || data.Game?.bHasWinner === true;

  if (data.Game?.bReplay === true) {
    state.replayActive = true;
    if (state.replayKind === "none") {
      state.replayKind = state.postGoal || state.countdownStarted ? "goal" : "game";
    }
    if (state.replayKind === "game") {
      state.source = "replay";
    }
    state.postGoal = false;
  } else if (data.Game?.bReplay === false) {
    state.replayActive = false;
    state.replayKind = "none";
    if (state.source === "replay") {
      state.source = state.matchGuid ? "match" : "menu";
    }
  }

  updatePlayerCounts(data);
  publishState();
}

function handleClockUpdated(event: BakingRLEvent<RlClockUpdatedSecondsPayload, "ClockUpdatedSeconds">) {
  ensureMatch(cleanGuid(event.Data?.MatchGuid));
  state.overtime = event.Data?.bOvertime === true;
  publishState();
}

function handleMatchCreated(event: BakingRLEvent<RlSimpleMatchPayload, string>) {
  const matchGuid = guidFromSimpleEvent(event);
  if (matchGuid) {
    ensureMatch(matchGuid);
  } else {
    resetToSource("training");
  }
  state.paused = false;
  state.podiumActive = false;
  state.hasWinner = false;
  state.postGoal = false;
  state.replayActive = false;
  state.replayKind = "none";
  publishState();
}

function handleCountdownBegin(event: BakingRLEvent<RlSimpleMatchPayload, "CountdownBegin">) {
  ensureMatch(guidFromSimpleEvent(event));
  state.paused = false;
  state.countdownStarted = true;
  state.roundStarted = false;
  state.replayActive = false;
  state.replayKind = "none";
  state.podiumActive = false;
  state.hasWinner = false;
  state.postGoal = false;
  publishState();
}

function handleRoundStarted(event: BakingRLEvent<RlSimpleMatchPayload, "RoundStarted">) {
  ensureMatch(guidFromSimpleEvent(event));
  state.paused = false;
  state.countdownStarted = true;
  state.roundStarted = true;
  state.replayActive = false;
  state.replayKind = "none";
  state.podiumActive = false;
  state.postGoal = false;
  publishState();
}

function handleGoalScored(event: BakingRLEvent<unknown, "GoalScored">) {
  const data = event.Data as Partial<RlSimpleMatchPayload> | null | undefined;
  ensureMatch(cleanGuid(data?.MatchGuid));
  state.postGoal = true;
  publishState();
}

function handleGoalReplayStart(event: BakingRLEvent<RlSimpleMatchPayload, "GoalReplayStart">) {
  ensureMatch(guidFromSimpleEvent(event));
  state.paused = false;
  state.replayActive = true;
  state.replayKind = "goal";
  state.postGoal = false;
  publishState();
}

function handleReplayEnd(event: BakingRLEvent<RlSimpleMatchPayload, "GoalReplayEnd">) {
  ensureMatch(guidFromSimpleEvent(event));
  state.paused = false;
  state.replayActive = false;
  state.replayKind = "none";
  state.postGoal = !state.hasWinner;
  publishState();
}

function handleGameReplayStart(event: BakingRLEvent<RlSimpleMatchPayload, "ReplayCreated">) {
  ensureMatch(guidFromSimpleEvent(event));
  state.source = "replay";
  state.paused = false;
  state.replayActive = true;
  state.replayKind = "game";
  state.postGoal = false;
  publishState();
}

function handleMatchPaused(event: BakingRLEvent<RlSimpleMatchPayload, "MatchPaused">) {
  ensureMatch(guidFromSimpleEvent(event));
  state.paused = true;
  publishState();
}

function handleMatchUnpaused(event: BakingRLEvent<RlSimpleMatchPayload, "MatchUnpaused">) {
  ensureMatch(guidFromSimpleEvent(event));
  state.paused = false;
  publishState();
}

function handleMatchEnded(event: BakingRLEvent<RlMatchEndedPayload, "MatchEnded">) {
  ensureMatch(cleanGuid(event.Data?.MatchGuid));
  state.hasWinner = true;
  state.paused = false;
  state.replayActive = false;
  state.replayKind = "none";
  state.postGoal = false;
  publishState();
}

function handlePodiumStart(event: BakingRLEvent<RlSimpleMatchPayload, "PodiumStart">) {
  ensureMatch(guidFromSimpleEvent(event));
  state.podiumActive = true;
  state.hasWinner = true;
  state.paused = false;
  state.replayActive = false;
  state.replayKind = "none";
  state.postGoal = false;
  publishState();
}

function handleMatchDestroyed() {
  state = createDefaultState();
  lastPublishedSignature = "";
  publishState(true);
}

function reset() {
  state = createDefaultState();
  lastPublishedSignature = "";
  return publishState(true);
}

function subscribe(context: ServiceContext) {
  cleanups = [
    context.bus.subscribe("UpdateState", handleUpdateState),
    context.bus.subscribe("ClockUpdatedSeconds", handleClockUpdated),
    context.bus.subscribe("MatchCreated", handleMatchCreated),
    context.bus.subscribe("MatchInitialized", handleMatchCreated),
    context.bus.subscribe("CountdownBegin", handleCountdownBegin),
    context.bus.subscribe("RoundStarted", handleRoundStarted),
    context.bus.subscribe("GoalScored", handleGoalScored),
    context.bus.subscribe("ReplayCreated", handleGameReplayStart),
    context.bus.subscribe("GoalReplayStart", handleGoalReplayStart),
    context.bus.subscribe("GoalReplayEnd", handleReplayEnd),
    context.bus.subscribe("MatchPaused", handleMatchPaused),
    context.bus.subscribe("MatchUnpaused", handleMatchUnpaused),
    context.bus.subscribe("MatchEnded", handleMatchEnded),
    context.bus.subscribe("PodiumStart", handlePodiumStart),
    context.bus.subscribe("MatchDestroyed", handleMatchDestroyed)
  ];
}

export default defineService({
  mount(context: ServiceContext) {
    serviceContext = context;
    subscribe(context);
    publishState(true);
  },
  unmount() {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    serviceContext = null;
  },
  methods: {
    async snapshot() {
      return publicState();
    },
    async reset() {
      return reset();
    }
  }
});
