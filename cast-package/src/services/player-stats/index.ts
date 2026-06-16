import {
  type BakingRLEvent,
  type RlMatchEndedPayload,
  type RlPlayer,
  type RlPlayerRef,
  type RlSimpleMatchPayload,
  type RlTeam,
  type RlUpdateStatePayload
} from "@bakingrl/plugin-sdk";
import type { PluginRuntimeContext, RuntimeService } from "../../extension/runtimeService";
import {
  BO_STATE_EVENT,
  BO_STATE_KEY,
  GAME_SEQUENCE_EVENT,
  GAME_SEQUENCE_KEY,
  PLAYER_STATS_EVENT,
  PLAYER_STATS_KEY,
  isBoState,
  isGameSequenceState,
  type BoTrackerState,
  type GameSequenceState,
  type Side
} from "../../shared/events";

type TeamSnapshot = {
  teamNum: number;
  name: string;
  colorPrimary: string | null;
  colorSecondary: string | null;
};

type MetricTotals = {
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  touches: number;
  demos: number;
  boostConsumed: number;
  demoedCount: number;
  observedSeconds: number;
  zeroBoostSeconds: number;
  supersonicSeconds: number;
  airSeconds: number;
  speedWeightedSum: number;
  speedSeconds: number;
};

type PublicMetrics = {
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  touches: number;
  demos: number;
  boostConsumed: number;
  demoedCount: number;
  demoDifferential: number;
  goalParticipation: number;
  observedSeconds: number;
  averageSpeed: number;
  zeroBoostSeconds: number;
  goalParticipationPercent: number;
  shootingAccuracyPercent: number;
  supersonicTimePercent: number;
  airTimePercent: number;
};

type PlayerFlags = {
  boost: number | null;
  demoed: boolean | null;
  supersonic: boolean | null;
  onGround: boolean | null;
  speed: number | null;
};

type PlayerRuntime = {
  id: string;
  primaryId: string | null;
  shortcut: number | null;
  name: string;
  teamNum: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  metrics: MetricTotals;
  lastFlags: PlayerFlags;
};

type MatchRuntime = {
  matchGuid: string;
  matchIndex: number;
  startedAtMs: number;
  endedAtMs: number | null;
  winnerSide: Side | null;
  winnerTeamNum: number | null;
  teams: Record<string, TeamSnapshot>;
  players: Record<string, PlayerRuntime>;
  lastUpdateAtMs: number | null;
  lastElapsedSeconds: number | null;
  updatedAtMs: number;
};

type BoRuntime = {
  bestOf: BoTrackerState["bestOf"];
  leftWins: number;
  rightWins: number;
  teams: BoTrackerState["teams"];
  phase: BoTrackerState["phase"];
  currentMatchGuid: string | null;
  winner: Side | null;
  updatedAtMs: number | null;
};

type InternalState = {
  version: 1;
  currentMatchGuid: string | null;
  bo: BoRuntime | null;
  matches: MatchRuntime[];
  updatedAtMs: number;
};

type PublicPlayerStats = {
  id: string;
  primaryId: string | null;
  shortcut: number | null;
  name: string;
  teamNum: number;
  matches: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  stats: PublicMetrics;
};

type PublicTeamStats = {
  teamNum: number;
  name: string;
  colorPrimary: string | null;
  colorSecondary: string | null;
  players: number;
  matches: number;
  stats: PublicMetrics;
};

type PublicMatchStats = {
  matchGuid: string;
  matchIndex: number;
  startedAtMs: number;
  endedAtMs: number | null;
  winnerSide: Side | null;
  winnerTeamNum: number | null;
  teams: PublicTeamStats[];
  players: PublicPlayerStats[];
  updatedAtMs: number;
};

type PublicBoStats = {
  bestOf: BoTrackerState["bestOf"] | null;
  leftWins: number;
  rightWins: number;
  phase: BoTrackerState["phase"] | "unknown";
  currentMatchGuid: string | null;
  winner: Side | null;
  matchCount: number;
  teams: PublicTeamStats[];
  players: PublicPlayerStats[];
};

type PublicState = {
  version: 1;
  currentMatchGuid: string | null;
  bo: PublicBoStats;
  matches: PublicMatchStats[];
  updatedAtMs: number;
};

type QueryResult = {
  version: 1;
  scope: "bo" | "match";
  matchGuid: string | null;
  matchIndex: number | null;
  teams: PublicTeamStats[];
  players: PublicPlayerStats[];
  updatedAtMs: number;
};

type SnapshotInput = {
  scope?: unknown;
  matchGuid?: unknown;
  matchIndex?: unknown;
  playerId?: unknown;
  playerName?: unknown;
  teamNum?: unknown;
};

const STORAGE_URI = "plugin://self/player-stats-state.json";
const MAX_MATCHES = 12;
const MAX_DELTA_SECONDS = 5;

let serviceContext: PluginRuntimeContext | null = null;
let state: InternalState = createDefaultState();
let sequenceState: GameSequenceState | null = null;
let saveChain: Promise<void> = Promise.resolve();

function nowMs() {
  return Date.now();
}

function createDefaultState(): InternalState {
  return {
    version: 1,
    currentMatchGuid: null,
    bo: null,
    matches: [],
    updatedAtMs: nowMs()
  };
}

function emptyMetrics(): MetricTotals {
  return {
    score: 0,
    goals: 0,
    shots: 0,
    assists: 0,
    saves: 0,
    touches: 0,
    demos: 0,
    boostConsumed: 0,
    demoedCount: 0,
    observedSeconds: 0,
    zeroBoostSeconds: 0,
    supersonicSeconds: 0,
    airSeconds: 0,
    speedWeightedSum: 0,
    speedSeconds: 0
  };
}

function emptyFlags(): PlayerFlags {
  return {
    boost: null,
    demoed: null,
    supersonic: null,
    onGround: null,
    speed: null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readInt(value: unknown, fallback = 0) {
  return Math.trunc(readNumber(value, fallback));
}

function nonNegativeInt(value: unknown) {
  return Math.max(0, readInt(value, 0));
}

function readBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readTeamNum(value: unknown, fallback = -1) {
  return readInt(value, fallback);
}

function normalizeColor(value: unknown) {
  const color = cleanString(value);
  if (!color) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color}`;
  return null;
}

function fallbackTeamName(teamNum: number) {
  if (teamNum === 0) return "Blue";
  if (teamNum === 1) return "Orange";
  return `Team ${teamNum}`;
}

function metricFromPlayer(player: RlPlayer): MetricTotals {
  return {
    ...emptyMetrics(),
    score: nonNegativeInt(player.Score),
    goals: nonNegativeInt(player.Goals),
    shots: nonNegativeInt(player.Shots),
    assists: nonNegativeInt(player.Assists),
    saves: nonNegativeInt(player.Saves),
    touches: nonNegativeInt(player.Touches ?? player.CarTouches),
    demos: nonNegativeInt(player.Demos)
  };
}

function addMetrics(target: MetricTotals, source: MetricTotals) {
  target.score += source.score;
  target.goals += source.goals;
  target.shots += source.shots;
  target.assists += source.assists;
  target.saves += source.saves;
  target.touches += source.touches;
  target.demos += source.demos;
  target.boostConsumed += source.boostConsumed;
  target.demoedCount += source.demoedCount;
  target.observedSeconds += source.observedSeconds;
  target.zeroBoostSeconds += source.zeroBoostSeconds;
  target.supersonicSeconds += source.supersonicSeconds;
  target.airSeconds += source.airSeconds;
  target.speedWeightedSum += source.speedWeightedSum;
  target.speedSeconds += source.speedSeconds;
}

function mergeCounterMetrics(target: MetricTotals, source: MetricTotals) {
  target.score = Math.max(target.score, source.score);
  target.goals = Math.max(target.goals, source.goals);
  target.shots = Math.max(target.shots, source.shots);
  target.assists = Math.max(target.assists, source.assists);
  target.saves = Math.max(target.saves, source.saves);
  target.touches = Math.max(target.touches, source.touches);
  target.demos = Math.max(target.demos, source.demos);
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

function rounded(value: number, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function publicMetrics(
  metrics: MetricTotals,
  options: { goalParticipationBase?: number; goalParticipationNumerator?: number } = {}
): PublicMetrics {
  const goalParticipationBase = options.goalParticipationBase ?? 0;
  const goalParticipationNumerator = options.goalParticipationNumerator ?? metrics.goals + metrics.assists;
  return {
    score: Math.round(metrics.score),
    goals: Math.round(metrics.goals),
    shots: Math.round(metrics.shots),
    assists: Math.round(metrics.assists),
    saves: Math.round(metrics.saves),
    touches: Math.round(metrics.touches),
    demos: Math.round(metrics.demos),
    boostConsumed: rounded(metrics.boostConsumed),
    demoedCount: Math.round(metrics.demoedCount),
    demoDifferential: Math.round(metrics.demos - metrics.demoedCount),
    goalParticipation: Math.round(metrics.goals + metrics.assists),
    observedSeconds: rounded(metrics.observedSeconds),
    averageSpeed: metrics.speedSeconds > 0 ? rounded(metrics.speedWeightedSum / metrics.speedSeconds, 0) : 0,
    zeroBoostSeconds: rounded(metrics.zeroBoostSeconds),
    goalParticipationPercent: percent(goalParticipationNumerator, goalParticipationBase),
    shootingAccuracyPercent: percent(metrics.goals, metrics.shots),
    supersonicTimePercent: percent(metrics.supersonicSeconds, metrics.observedSeconds),
    airTimePercent: percent(metrics.airSeconds, metrics.observedSeconds)
  };
}

function playerIdentity(player: RlPlayer | RlPlayerRef) {
  const primaryId = cleanString((player as RlPlayer).PrimaryId);
  if (primaryId) return `primary:${primaryId}`;
  if (typeof player.Shortcut === "number" && Number.isFinite(player.Shortcut)) {
    return `shortcut:${player.TeamNum}:${Math.trunc(player.Shortcut)}`;
  }
  return `name:${player.TeamNum}:${(player.Name || "unknown").trim().toLowerCase()}`;
}

function playerNameMatches(player: PublicPlayerStats, name: string) {
  return player.name.trim().toLowerCase() === name.trim().toLowerCase();
}

function finiteInt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function boostValue(player: RlPlayer) {
  if (typeof player.Boost !== "number" || !Number.isFinite(player.Boost)) return null;
  return Math.max(0, Math.min(100, player.Boost));
}

function speedValue(player: RlPlayer) {
  if (typeof player.Speed !== "number" || !Number.isFinite(player.Speed)) return null;
  return Math.max(0, player.Speed);
}

function elapsedSeconds(payload: RlUpdateStatePayload) {
  const elapsed = payload.Game?.Elapsed;
  return typeof elapsed === "number" && Number.isFinite(elapsed) ? elapsed : null;
}

function matchGuidFromValue(value: unknown) {
  return cleanString(value);
}

function matchGuidFromEvent(event: BakingRLEvent<RlSimpleMatchPayload | RlMatchEndedPayload, string>) {
  return matchGuidFromValue(event.Data?.MatchGuid);
}

function teamFromTelemetry(team: RlTeam): TeamSnapshot {
  const teamNum = readTeamNum(team.TeamNum);
  return {
    teamNum,
    name: cleanString(team.Name) ?? fallbackTeamName(teamNum),
    colorPrimary: normalizeColor(team.ColorPrimary),
    colorSecondary: normalizeColor(team.ColorSecondary)
  };
}

function readPlayerFlags(player: RlPlayer): PlayerFlags {
  return {
    boost: boostValue(player),
    demoed: readBool(player.bDemolished),
    supersonic: readBool(player.bSupersonic),
    onGround: readBool(player.bOnGround),
    speed: speedValue(player)
  };
}

function createPlayer(player: RlPlayer, seenAtMs: number, countInitialMetrics = true): PlayerRuntime {
  return {
    id: playerIdentity(player),
    primaryId: cleanString(player.PrimaryId),
    shortcut: typeof player.Shortcut === "number" && Number.isFinite(player.Shortcut) ? Math.trunc(player.Shortcut) : null,
    name: cleanString(player.Name) ?? "Unknown",
    teamNum: readTeamNum(player.TeamNum),
    firstSeenAtMs: seenAtMs,
    lastSeenAtMs: seenAtMs,
    metrics: countInitialMetrics ? metricFromPlayer(player) : emptyMetrics(),
    lastFlags: readPlayerFlags(player)
  };
}

function updatePlayerIdentity(runtime: PlayerRuntime, player: RlPlayer, seenAtMs: number) {
  runtime.primaryId = cleanString(player.PrimaryId) ?? runtime.primaryId;
  runtime.shortcut = typeof player.Shortcut === "number" && Number.isFinite(player.Shortcut) ? Math.trunc(player.Shortcut) : runtime.shortcut;
  runtime.name = cleanString(player.Name) ?? runtime.name;
  runtime.teamNum = readTeamNum(player.TeamNum, runtime.teamNum);
  runtime.lastSeenAtMs = seenAtMs;
}

function applyObservedDuration(runtime: PlayerRuntime, deltaSeconds: number) {
  if (deltaSeconds <= 0) return;
  runtime.metrics.observedSeconds += deltaSeconds;
  if (runtime.lastFlags.boost !== null && runtime.lastFlags.boost <= 0) runtime.metrics.zeroBoostSeconds += deltaSeconds;
  if (runtime.lastFlags.supersonic === true) runtime.metrics.supersonicSeconds += deltaSeconds;
  if (runtime.lastFlags.onGround === false) runtime.metrics.airSeconds += deltaSeconds;
  if (runtime.lastFlags.speed !== null) {
    runtime.metrics.speedWeightedSum += runtime.lastFlags.speed * deltaSeconds;
    runtime.metrics.speedSeconds += deltaSeconds;
  }
}

function updatePlayerMetrics(runtime: PlayerRuntime, player: RlPlayer) {
  mergeCounterMetrics(runtime.metrics, metricFromPlayer(player));

  const flags = readPlayerFlags(player);
  const boost = flags.boost;
  if (boost !== null && runtime.lastFlags.boost !== null && boost < runtime.lastFlags.boost) {
    runtime.metrics.boostConsumed += runtime.lastFlags.boost - boost;
  }

  const demoed = flags.demoed;
  if (demoed === true && runtime.lastFlags.demoed === false) {
    runtime.metrics.demoedCount += 1;
  }

  runtime.lastFlags = flags;
}

function syncPlayerFlags(runtime: PlayerRuntime, player: RlPlayer) {
  runtime.lastFlags = readPlayerFlags(player);
}

function createMatch(matchGuid: string): MatchRuntime {
  const nextIndex = state.matches.length + 1;
  return {
    matchGuid,
    matchIndex: nextIndex,
    startedAtMs: nowMs(),
    endedAtMs: null,
    winnerSide: null,
    winnerTeamNum: null,
    teams: {},
    players: {},
    lastUpdateAtMs: null,
    lastElapsedSeconds: null,
    updatedAtMs: nowMs()
  };
}

function ensureMatch(matchGuid: string) {
  let match = state.matches.find((candidate) => candidate.matchGuid === matchGuid);
  if (!match) {
    match = createMatch(matchGuid);
    state.matches = [...state.matches, match].slice(-MAX_MATCHES);
    reindexUnmappedMatches();
  }
  state.currentMatchGuid = matchGuid;
  return match;
}

function latestMatch() {
  return state.matches.at(-1) ?? null;
}

function currentMatch() {
  if (!state.currentMatchGuid) return null;
  return state.matches.find((match) => match.matchGuid === state.currentMatchGuid) ?? null;
}

function reindexUnmappedMatches() {
  const mapped = new Set<number>();
  for (const match of state.matches) {
    if (match.matchIndex > 0) mapped.add(match.matchIndex);
  }
  for (const match of state.matches) {
    if (match.matchIndex > 0) continue;
    let index = 1;
    while (mapped.has(index)) index += 1;
    match.matchIndex = index;
    mapped.add(index);
  }
}

function deltaSecondsFor(match: MatchRuntime, payload: RlUpdateStatePayload, seenAtMs: number) {
  const elapsed = elapsedSeconds(payload);
  if (elapsed !== null && match.lastElapsedSeconds !== null) {
    const delta = elapsed - match.lastElapsedSeconds;
    if (delta > 0 && delta <= MAX_DELTA_SECONDS) return delta;
  }
  if (match.lastUpdateAtMs !== null) {
    const delta = (seenAtMs - match.lastUpdateAtMs) / 1000;
    if (delta > 0 && delta <= MAX_DELTA_SECONDS) return delta;
  }
  return 0;
}

function isGameplayUpdate(payload: RlUpdateStatePayload) {
  if (payload.Game?.bReplay === true || payload.Game?.bHasWinner === true) return false;
  if (sequenceState) {
    return sequenceState.source === "match" && sequenceState.phase === "live" && sequenceState.flags.isMatchActive;
  }
  return true;
}

function updateTeams(match: MatchRuntime, teams: RlTeam[]) {
  for (const team of teams) {
    const snapshot = teamFromTelemetry(team);
    match.teams[String(snapshot.teamNum)] = snapshot;
  }
}

function updateMatchFromPayload(match: MatchRuntime, payload: RlUpdateStatePayload) {
  const seenAtMs = nowMs();
  const shouldCount = isGameplayUpdate(payload);
  const deltaSeconds = shouldCount ? deltaSecondsFor(match, payload, seenAtMs) : 0;

  updateTeams(match, payload.Game?.Teams ?? []);

  for (const player of payload.Players ?? []) {
    const key = playerIdentity(player);
    const runtime = match.players[key] ?? createPlayer(player, seenAtMs, shouldCount);
    updatePlayerIdentity(runtime, player, seenAtMs);
    if (shouldCount) {
      applyObservedDuration(runtime, deltaSeconds);
      updatePlayerMetrics(runtime, player);
    } else {
      syncPlayerFlags(runtime, player);
    }
    match.players[key] = runtime;
  }

  match.lastUpdateAtMs = seenAtMs;
  match.lastElapsedSeconds = elapsedSeconds(payload);
  match.updatedAtMs = seenAtMs;
  state.updatedAtMs = seenAtMs;
}

function sideForWinnerTeam(boState: BoTrackerState, winnerTeamNum: number) {
  if (boState.teams.left.teamNum === winnerTeamNum) return "left";
  if (boState.teams.right.teamNum === winnerTeamNum) return "right";
  return null;
}

function boRuntimeFromState(boState: BoTrackerState): BoRuntime {
  return {
    bestOf: boState.bestOf,
    leftWins: boState.leftWins,
    rightWins: boState.rightWins,
    teams: {
      left: { ...boState.teams.left },
      right: { ...boState.teams.right }
    },
    phase: boState.phase,
    currentMatchGuid: boState.currentMatchGuid ?? null,
    winner: boState.winner,
    updatedAtMs: typeof boState.updatedAtMs === "number" ? boState.updatedAtMs : null
  };
}

function isEmptyBoState(boState: BoTrackerState) {
  return (
    boState.leftWins === 0 &&
    boState.rightWins === 0 &&
    (boState.history ?? []).length === 0 &&
    !boState.currentMatchGuid &&
    boState.winner === null
  );
}

function syncBoState(boState: BoTrackerState) {
  const shouldClearBoStats = isEmptyBoState(boState) && state.matches.length > 0 && !state.currentMatchGuid;
  state.bo = boRuntimeFromState(boState);
  if (shouldClearBoStats) {
    state.matches = [];
  }
  if (boState.currentMatchGuid) {
    state.currentMatchGuid = boState.currentMatchGuid;
  }

  const history = boState.history ?? [];
  for (const [index, record] of history.entries()) {
    const match = state.matches.find((candidate) => candidate.matchGuid === record.matchGuid);
    if (!match) continue;
    match.matchIndex = index + 1;
    match.winnerSide = record.winnerSide;
    match.winnerTeamNum = record.winnerTeamNum;
    match.endedAtMs = match.endedAtMs ?? record.countedAtMs;
  }

  reindexUnmappedMatches();
  state.updatedAtMs = nowMs();
}

function finishMatch(matchGuid: string | null, winnerTeamNum: number | null = null) {
  const match = matchGuid
    ? state.matches.find((candidate) => candidate.matchGuid === matchGuid)
    : currentMatch() ?? latestMatch();
  if (!match) return false;
  match.endedAtMs = match.endedAtMs ?? nowMs();
  match.winnerTeamNum = winnerTeamNum;
  if (winnerTeamNum !== null && state.bo) {
    match.winnerSide =
      winnerTeamNum === state.bo.teams.left.teamNum ? "left" : winnerTeamNum === state.bo.teams.right.teamNum ? "right" : null;
  }
  if (state.currentMatchGuid === match.matchGuid) state.currentMatchGuid = null;
  state.updatedAtMs = nowMs();
  return true;
}

function resetState() {
  state = createDefaultState();
  state.updatedAtMs = nowMs();
}

function goalsByTeam(players: Array<Pick<PlayerRuntime, "teamNum" | "metrics">>) {
  const goals = new Map<number, number>();
  for (const player of players) {
    goals.set(player.teamNum, (goals.get(player.teamNum) ?? 0) + player.metrics.goals);
  }
  return goals;
}

function publicPlayer(player: PlayerRuntime, matches = 1, goalParticipationBase = 0): PublicPlayerStats {
  return {
    id: player.id,
    primaryId: player.primaryId,
    shortcut: player.shortcut,
    name: player.name,
    teamNum: player.teamNum,
    matches,
    firstSeenAtMs: player.firstSeenAtMs,
    lastSeenAtMs: player.lastSeenAtMs,
    stats: publicMetrics(player.metrics, { goalParticipationBase })
  };
}

function teamSnapshotFor(match: MatchRuntime, teamNum: number): TeamSnapshot {
  return (
    match.teams[String(teamNum)] ?? {
      teamNum,
      name: fallbackTeamName(teamNum),
      colorPrimary: null,
      colorSecondary: null
    }
  );
}

function publicTeamsForMatch(match: MatchRuntime, players: PlayerRuntime[]): PublicTeamStats[] {
  const teams = new Map<number, { snapshot: TeamSnapshot; metrics: MetricTotals; players: Set<string> }>();
  for (const player of players) {
    const line =
      teams.get(player.teamNum) ?? {
        snapshot: teamSnapshotFor(match, player.teamNum),
        metrics: emptyMetrics(),
        players: new Set<string>()
      };
    addMetrics(line.metrics, player.metrics);
    line.players.add(player.id);
    teams.set(player.teamNum, line);
  }

  const lines = [...teams.values()];
  const totalGoals = lines.reduce((sum, line) => sum + line.metrics.goals, 0);
  return lines
    .map((line) => ({
      teamNum: line.snapshot.teamNum,
      name: line.snapshot.name,
      colorPrimary: line.snapshot.colorPrimary,
      colorSecondary: line.snapshot.colorSecondary,
      players: line.players.size,
      matches: 1,
      stats: publicMetrics(line.metrics, {
        goalParticipationBase: totalGoals,
        goalParticipationNumerator: line.metrics.goals
      })
    }))
    .sort((left, right) => left.teamNum - right.teamNum);
}

function publicMatch(match: MatchRuntime): PublicMatchStats {
  const players = Object.values(match.players);
  const teamGoals = goalsByTeam(players);
  return {
    matchGuid: match.matchGuid,
    matchIndex: match.matchIndex,
    startedAtMs: match.startedAtMs,
    endedAtMs: match.endedAtMs,
    winnerSide: match.winnerSide,
    winnerTeamNum: match.winnerTeamNum,
    teams: publicTeamsForMatch(match, players),
    players: players.map((player) => publicPlayer(player, 1, teamGoals.get(player.teamNum) ?? 0)).sort(sortPlayers),
    updatedAtMs: match.updatedAtMs
  };
}

function aggregatePlayers(matches: MatchRuntime[]) {
  const players = new Map<string, PlayerRuntime & { matches: number }>();
  for (const match of matches) {
    for (const player of Object.values(match.players)) {
      const aggregate = players.get(player.id);
      if (!aggregate) {
        players.set(player.id, {
          ...player,
          metrics: { ...player.metrics },
          lastFlags: { ...player.lastFlags },
          matches: 1
        });
        continue;
      }
      aggregate.name = player.name || aggregate.name;
      aggregate.primaryId = player.primaryId ?? aggregate.primaryId;
      aggregate.shortcut = player.shortcut ?? aggregate.shortcut;
      aggregate.teamNum = player.teamNum;
      aggregate.firstSeenAtMs = Math.min(aggregate.firstSeenAtMs, player.firstSeenAtMs);
      aggregate.lastSeenAtMs = Math.max(aggregate.lastSeenAtMs, player.lastSeenAtMs);
      aggregate.matches += 1;
      addMetrics(aggregate.metrics, player.metrics);
    }
  }
  const aggregatedPlayers = [...players.values()];
  const teamGoals = goalsByTeam(aggregatedPlayers);
  return aggregatedPlayers.map((player) => publicPlayer(player, player.matches, teamGoals.get(player.teamNum) ?? 0)).sort(sortPlayers);
}

function aggregateTeams(matches: MatchRuntime[], players = aggregatePlayers(matches)) {
  const teams = new Map<number, { snapshot: TeamSnapshot; metrics: MetricTotals; players: Set<string>; matches: Set<string> }>();

  for (const match of matches) {
    for (const player of Object.values(match.players)) {
      const snapshot = teamSnapshotFor(match, player.teamNum);
      const line =
        teams.get(player.teamNum) ?? {
          snapshot,
          metrics: emptyMetrics(),
          players: new Set<string>(),
          matches: new Set<string>()
        };
      line.snapshot = snapshot;
      line.players.add(player.id);
      line.matches.add(match.matchGuid);
      addMetrics(line.metrics, player.metrics);
      teams.set(player.teamNum, line);
    }
  }

  for (const player of players) {
    if (teams.has(player.teamNum)) continue;
    const line = {
      snapshot: {
        teamNum: player.teamNum,
        name: fallbackTeamName(player.teamNum),
        colorPrimary: null,
        colorSecondary: null
      },
      metrics: emptyMetrics(),
      players: new Set<string>([player.id]),
      matches: new Set<string>()
    };
    teams.set(player.teamNum, line);
  }

  const lines = [...teams.values()];
  const totalGoals = lines.reduce((sum, line) => sum + line.metrics.goals, 0);
  return lines
    .map((line) => ({
      teamNum: line.snapshot.teamNum,
      name: line.snapshot.name,
      colorPrimary: line.snapshot.colorPrimary,
      colorSecondary: line.snapshot.colorSecondary,
      players: line.players.size,
      matches: line.matches.size,
      stats: publicMetrics(line.metrics, {
        goalParticipationBase: totalGoals,
        goalParticipationNumerator: line.metrics.goals
      })
    }))
    .sort((left, right) => left.teamNum - right.teamNum);
}

function publicBo(matches: MatchRuntime[]): PublicBoStats {
  const players = aggregatePlayers(matches);
  return {
    bestOf: state.bo?.bestOf ?? null,
    leftWins: state.bo?.leftWins ?? 0,
    rightWins: state.bo?.rightWins ?? 0,
    phase: state.bo?.phase ?? "unknown",
    currentMatchGuid: state.bo?.currentMatchGuid ?? state.currentMatchGuid,
    winner: state.bo?.winner ?? null,
    matchCount: matches.length,
    teams: aggregateTeams(matches, players),
    players
  };
}

function publicState(matches = state.matches): PublicState {
  return {
    version: 1,
    currentMatchGuid: state.currentMatchGuid,
    bo: publicBo(matches),
    matches: matches.map(publicMatch).sort((left, right) => left.matchIndex - right.matchIndex),
    updatedAtMs: state.updatedAtMs
  };
}

function sortPlayers(left: PublicPlayerStats, right: PublicPlayerStats) {
  return left.teamNum - right.teamNum || right.stats.score - left.stats.score || left.name.localeCompare(right.name);
}

function filterPlayers(players: PublicPlayerStats[], input: SnapshotInput) {
  let result = players;
  const teamNum = finiteInt(input.teamNum);
  const playerId = cleanString(input.playerId);
  const playerName = cleanString(input.playerName);

  if (teamNum !== null) result = result.filter((player) => player.teamNum === teamNum);
  if (playerId) result = result.filter((player) => player.id === playerId || player.primaryId === playerId);
  if (playerName) result = result.filter((player) => playerNameMatches(player, playerName));
  return result;
}

function filterTeams(teams: PublicTeamStats[], players: PublicPlayerStats[], input: SnapshotInput) {
  const playerTeamNums = new Set(players.map((player) => player.teamNum));
  const teamNum = finiteInt(input.teamNum);
  if (teamNum !== null) return teams.filter((team) => team.teamNum === teamNum);
  if (cleanString(input.playerId) || cleanString(input.playerName)) {
    return teams.filter((team) => playerTeamNums.has(team.teamNum));
  }
  return teams;
}

function matchForQuery(input: SnapshotInput) {
  const matchGuid = cleanString(input.matchGuid);
  if (matchGuid) return state.matches.find((match) => match.matchGuid === matchGuid) ?? null;
  const matchIndex = finiteInt(input.matchIndex);
  if (matchIndex !== null) return state.matches.find((match) => match.matchIndex === matchIndex) ?? null;
  return currentMatch() ?? latestMatch();
}

function querySnapshot(input: SnapshotInput): QueryResult {
  const scope = input.scope === "match" || cleanString(input.matchGuid) || typeof input.matchIndex === "number" ? "match" : "bo";

  if (scope === "match") {
    const match = matchForQuery(input);
    if (!match) {
      return {
        version: 1,
        scope,
        matchGuid: cleanString(input.matchGuid),
        matchIndex: finiteInt(input.matchIndex),
        teams: [],
        players: [],
        updatedAtMs: state.updatedAtMs
      };
    }
    const snapshot = publicMatch(match);
    const players = filterPlayers(snapshot.players, input);
    return {
      version: 1,
      scope,
      matchGuid: snapshot.matchGuid,
      matchIndex: snapshot.matchIndex,
      teams: filterTeams(snapshot.teams, players, input),
      players,
      updatedAtMs: snapshot.updatedAtMs
    };
  }

  const snapshot = publicBo(state.matches);
  const players = filterPlayers(snapshot.players, input);
  return {
    version: 1,
    scope,
    matchGuid: null,
    matchIndex: null,
    teams: filterTeams(snapshot.teams, players, input),
    players,
    updatedAtMs: state.updatedAtMs
  };
}

function normalizeSnapshotInput(value: unknown): SnapshotInput | null {
  if (!isRecord(value)) return null;
  return value as SnapshotInput;
}

function storedState(): InternalState {
  return {
    ...state,
    bo: state.bo
      ? {
          ...state.bo,
          teams: {
            left: { ...state.bo.teams.left },
            right: { ...state.bo.teams.right }
          }
        }
      : null,
    matches: state.matches.map((match) => ({
      ...match,
      teams: Object.fromEntries(Object.entries(match.teams).map(([key, team]) => [key, { ...team }])),
      players: Object.fromEntries(
        Object.entries(match.players).map(([key, player]) => [
          key,
          {
            ...player,
            metrics: { ...player.metrics },
            lastFlags: { ...player.lastFlags }
          }
        ])
      )
    }))
  };
}

function restoreMetrics(value: unknown): MetricTotals {
  const fallback = emptyMetrics();
  if (!isRecord(value)) return fallback;
  return {
    score: nonNegativeInt(value.score),
    goals: nonNegativeInt(value.goals),
    shots: nonNegativeInt(value.shots),
    assists: nonNegativeInt(value.assists),
    saves: nonNegativeInt(value.saves),
    touches: nonNegativeInt(value.touches),
    demos: nonNegativeInt(value.demos),
    boostConsumed: Math.max(0, readNumber(value.boostConsumed)),
    demoedCount: nonNegativeInt(value.demoedCount),
    observedSeconds: Math.max(0, readNumber(value.observedSeconds)),
    zeroBoostSeconds: Math.max(0, readNumber(value.zeroBoostSeconds)),
    supersonicSeconds: Math.max(0, readNumber(value.supersonicSeconds)),
    airSeconds: Math.max(0, readNumber(value.airSeconds)),
    speedWeightedSum: Math.max(0, readNumber(value.speedWeightedSum)),
    speedSeconds: Math.max(0, readNumber(value.speedSeconds))
  };
}

function restorePlayer(value: unknown): PlayerRuntime | null {
  if (!isRecord(value)) return null;
  const id = cleanString(value.id);
  const name = cleanString(value.name);
  if (!id || !name) return null;
  return {
    id,
    primaryId: cleanString(value.primaryId),
    shortcut: typeof value.shortcut === "number" ? Math.trunc(value.shortcut) : null,
    name,
    teamNum: readTeamNum(value.teamNum),
    firstSeenAtMs: readInt(value.firstSeenAtMs, nowMs()),
    lastSeenAtMs: readInt(value.lastSeenAtMs, nowMs()),
    metrics: restoreMetrics(value.metrics),
    lastFlags: isRecord(value.lastFlags)
      ? {
          boost: typeof value.lastFlags.boost === "number" ? value.lastFlags.boost : null,
          demoed: readBool(value.lastFlags.demoed),
          supersonic: readBool(value.lastFlags.supersonic),
          onGround: readBool(value.lastFlags.onGround),
          speed: typeof value.lastFlags.speed === "number" ? value.lastFlags.speed : null
        }
      : emptyFlags()
  };
}

function restoreTeam(value: unknown, fallbackTeamNum: number): TeamSnapshot | null {
  if (!isRecord(value)) return null;
  const teamNum = readTeamNum(value.teamNum, fallbackTeamNum);
  return {
    teamNum,
    name: cleanString(value.name) ?? fallbackTeamName(teamNum),
    colorPrimary: normalizeColor(value.colorPrimary),
    colorSecondary: normalizeColor(value.colorSecondary)
  };
}

function restoreMatch(value: unknown): MatchRuntime | null {
  if (!isRecord(value)) return null;
  const matchGuid = cleanString(value.matchGuid);
  if (!matchGuid) return null;
  const teams: Record<string, TeamSnapshot> = {};
  if (isRecord(value.teams)) {
    for (const [key, team] of Object.entries(value.teams)) {
      const restored = restoreTeam(team, readTeamNum(Number(key)));
      if (restored) teams[String(restored.teamNum)] = restored;
    }
  }

  const players: Record<string, PlayerRuntime> = {};
  if (isRecord(value.players)) {
    for (const player of Object.values(value.players)) {
      const restored = restorePlayer(player);
      if (restored) players[restored.id] = restored;
    }
  }

  return {
    matchGuid,
    matchIndex: Math.max(1, readInt(value.matchIndex, 1)),
    startedAtMs: readInt(value.startedAtMs, nowMs()),
    endedAtMs: typeof value.endedAtMs === "number" ? value.endedAtMs : null,
    winnerSide: value.winnerSide === "left" || value.winnerSide === "right" ? value.winnerSide : null,
    winnerTeamNum: typeof value.winnerTeamNum === "number" ? Math.trunc(value.winnerTeamNum) : null,
    teams,
    players,
    lastUpdateAtMs: typeof value.lastUpdateAtMs === "number" ? value.lastUpdateAtMs : null,
    lastElapsedSeconds: typeof value.lastElapsedSeconds === "number" ? value.lastElapsedSeconds : null,
    updatedAtMs: readInt(value.updatedAtMs, nowMs())
  };
}

function restoreState(value: unknown): InternalState {
  const fallback = createDefaultState();
  if (!isRecord(value)) return fallback;

  return {
    version: 1,
    currentMatchGuid: cleanString(value.currentMatchGuid),
    bo: null,
    matches: Array.isArray(value.matches)
      ? value.matches.map(restoreMatch).filter((match): match is MatchRuntime => match !== null).slice(-MAX_MATCHES)
      : [],
    updatedAtMs: readInt(value.updatedAtMs, nowMs())
  };
}

function persistState(context: PluginRuntimeContext) {
  const snapshot = storedState();
  saveChain = saveChain
    .catch(() => undefined)
    .then(() => context.storage.writeText(STORAGE_URI, JSON.stringify(snapshot, null, 2)));
}

async function loadState(context: PluginRuntimeContext) {
  try {
    state = restoreState(JSON.parse(await context.storage.readText(STORAGE_URI)));
  } catch {
    state = createDefaultState();
  }
}

async function publishState(options: { persist?: boolean } = {}) {
  const context = serviceContext;
  const snapshot = publicState();
  if (!context) return snapshot;
  context.registry.set(PLAYER_STATS_KEY, snapshot);
  context.bus.emit(PLAYER_STATS_EVENT, snapshot);
  if (options.persist) persistState(context);
  return snapshot;
}

async function handleBoStateEvent(event: BakingRLEvent<unknown, string>) {
  if (!isBoState(event.Data)) return;
  syncBoState(event.Data);
  await publishState({ persist: true });
}

function handleSequenceEvent(event: BakingRLEvent<unknown, string>) {
  if (isGameSequenceState(event.Data)) {
    sequenceState = event.Data;
  }
}

async function handleMatchStart(event: BakingRLEvent<RlSimpleMatchPayload, string>) {
  const matchGuid = matchGuidFromEvent(event);
  if (!matchGuid) return;
  ensureMatch(matchGuid);
  state.updatedAtMs = nowMs();
  await publishState({ persist: true });
}

async function handleUpdateState(event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) {
  const payload = event.Data;
  if (!payload?.Game) return;
  const matchGuid = matchGuidFromValue(payload.MatchGuid) ?? state.currentMatchGuid;
  if (!matchGuid) return;
  const match = ensureMatch(matchGuid);
  updateMatchFromPayload(match, payload);
  await publishState();
}

async function handleMatchEnded(event: BakingRLEvent<RlMatchEndedPayload, "MatchEnded">) {
  const matchGuid = matchGuidFromEvent(event) ?? state.currentMatchGuid;
  const winnerTeamNum = typeof event.Data?.WinnerTeamNum === "number" ? Math.trunc(event.Data.WinnerTeamNum) : null;
  if (finishMatch(matchGuid, winnerTeamNum)) {
    await publishState({ persist: true });
  }
}

async function handleMatchDestroyed(event: BakingRLEvent<RlSimpleMatchPayload, "MatchDestroyed">) {
  const matchGuid = matchGuidFromEvent(event);
  if (matchGuid && state.currentMatchGuid !== matchGuid) return;
  state.currentMatchGuid = null;
  state.updatedAtMs = nowMs();
  await publishState({ persist: true });
}

async function reset() {
  resetState();
  return publishState({ persist: true });
}

async function syncBoRegistry(context: PluginRuntimeContext) {
  try {
    const boState = await context.registry.get(BO_STATE_KEY);
    if (isBoState(boState)) syncBoState(boState);
  } catch (error) {
    context.diagnostics.warn("Unable to read BO tracker state for player stats.", error);
  }
}

async function syncSequenceRegistry(context: PluginRuntimeContext) {
  try {
    const value = await context.registry.get(GAME_SEQUENCE_KEY);
    if (isGameSequenceState(value)) sequenceState = value;
  } catch (error) {
    context.diagnostics.warn("Unable to read sequence state for player stats.", error);
  }
}

export default {
  async mount(context: PluginRuntimeContext) {
    serviceContext = context;
    await loadState(context);
    await syncBoRegistry(context);
    await syncSequenceRegistry(context);
    context.bus.subscribe(BO_STATE_EVENT, handleBoStateEvent);
    context.bus.subscribe(GAME_SEQUENCE_EVENT, handleSequenceEvent);
    context.bus.subscribe("MatchCreated", handleMatchStart);
    context.bus.subscribe("MatchInitialized", handleMatchStart);
    context.bus.subscribe("RoundStarted", handleMatchStart);
    context.bus.subscribe("UpdateState", handleUpdateState);
    context.bus.subscribe("MatchEnded", handleMatchEnded);
    context.bus.subscribe("MatchDestroyed", handleMatchDestroyed);
    await publishState();
  },
  unmount() {
    serviceContext = null;
    sequenceState = null;
  },
  methods: {
    async snapshot(input) {
      const normalized = normalizeSnapshotInput(input);
      return normalized ? querySnapshot(normalized) : publicState();
    },
    async reset() {
      return reset();
    }
  }
} satisfies RuntimeService;
