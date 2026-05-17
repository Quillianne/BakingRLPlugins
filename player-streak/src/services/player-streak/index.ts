import {
  defineService,
  type BakingRLEvent,
  type CleanupFn,
  type RlMatchEndedPayload,
  type RlSimpleMatchPayload,
  type ServiceContext
} from "@bakingrl/plugin-sdk";
import {
  STATE_EVENT,
  STATE_KEY,
  type CounterBucket,
  type GameMode,
  type PublicCurrentPlayer,
  type PublicPlayerStreak,
  type PublicState,
  type RecordScope
} from "../../shared/state";

type MatchPlayer = {
  id: string;
  primaryId: string | null;
  name: string;
  teamNum: number;
  teamColor: string;
  shortcut: number | null;
};

type MatchRuntime = {
  matchGuid: string | null;
  startedAtMs: number;
  endedAtMs: number | null;
  mode: GameMode;
  targetPlayerId: string | null;
  players: Record<string, MatchPlayer>;
  updatedAtMs: number;
};

type CastPlayerStatsPlayer = {
  id: string;
  primaryId: string | null;
  shortcut: number | null;
  name: string;
  teamNum: number;
};

type CastTeamStats = {
  teamNum: number;
  colorPrimary: string | null;
};

type CastMatchStats = {
  matchGuid: string;
  teams: CastTeamStats[];
  players: CastPlayerStatsPlayer[];
};

type CastPlayerStatsState = {
  currentMatchGuid: string | null;
  matches: CastMatchStats[];
};

type InternalState = {
  version: 1;
  currentMatch: MatchRuntime | null;
  sessionPlayers: Record<string, PublicPlayerStreak>;
  globalPlayers: Record<string, PublicPlayerStreak>;
  countedMatches: string[];
  updatedAtMs: number;
};

type StoredState = {
  version: 1;
  globalPlayers: Record<string, PublicPlayerStreak>;
  countedMatches: string[];
  updatedAtMs: number;
};

type SnapshotInput = {
  scope?: unknown;
  playerId?: unknown;
  playerName?: unknown;
};

type ResetInput = {
  scope?: unknown;
};

const CAST_SEQUENCE_EVENT = "plugin.com.bakingrl.cast-package.sequence";
const CAST_SEQUENCE_KEY = "plugin.com.bakingrl.cast-package.sequence";
const CAST_PLAYER_STATS_EVENT = "plugin.com.bakingrl.cast-package.player-stats";
const CAST_PLAYER_STATS_KEY = "plugin.com.bakingrl.cast-package.player-stats";

const STORAGE_URI = "plugin://self/player-streak-state.json";
const MAX_ALIASES = 12;
const MAX_COUNTED_MATCHES = 1000;
const FALLBACK_BLUE = "#3b82f6";
const FALLBACK_ORANGE = "#f97316";
const FALLBACK_NEUTRAL = "#94a3b8";

let serviceContext: ServiceContext | null = null;
let state: InternalState = createDefaultState();
let saveChain: Promise<void> = Promise.resolve();
let cleanups: CleanupFn[] = [];
let latestMode: GameMode = "unknown";

function nowMs() {
  return Date.now();
}

function createDefaultState(): InternalState {
  return {
    version: 1,
    currentMatch: null,
    sessionPlayers: {},
    globalPlayers: {},
    countedMatches: [],
    updatedAtMs: nowMs()
  };
}

function createMatch(matchGuid: string | null): MatchRuntime {
  const startedAtMs = nowMs();
  return {
    matchGuid,
    startedAtMs,
    endedAtMs: null,
    mode: latestMode,
    targetPlayerId: null,
    players: {},
    updatedAtMs: startedAtMs
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeName(value: unknown, fallback = "Unknown") {
  return cleanString(value) ?? fallback;
}

function normalizedName(value: unknown) {
  return normalizeName(value).trim().toLowerCase();
}

function readInt(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function readTeamNum(value: unknown, fallback = -1) {
  return readInt(value, fallback);
}

function emptyCounter(): CounterBucket {
  return {
    wins: 0,
    losses: 0,
    streak: 0
  };
}

function cloneCounter(counter: CounterBucket): CounterBucket {
  return {
    wins: counter.wins,
    losses: counter.losses,
    streak: counter.streak
  };
}

function restoreCounter(value: unknown): CounterBucket {
  if (!isRecord(value)) return emptyCounter();
  return {
    wins: Math.max(0, readInt(value.wins)),
    losses: Math.max(0, readInt(value.losses)),
    streak: readInt(value.streak)
  };
}

function normalizeColor(value: unknown, fallback: string) {
  const color = cleanString(value);
  if (!color) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color}`;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(color)) {
    return color;
  }
  return fallback;
}

function fallbackTeamColor(teamNum: number) {
  if (teamNum === 0) return FALLBACK_BLUE;
  if (teamNum === 1) return FALLBACK_ORANGE;
  return FALLBACK_NEUTRAL;
}

function gameModeFromValue(value: unknown): GameMode {
  return value === "1v1" || value === "2v2" || value === "3v3" || value === "4v4" ? value : "unknown";
}

function matchGuidFromValue(value: unknown) {
  return cleanString(value);
}

function matchGuidFromEvent(event: BakingRLEvent<RlSimpleMatchPayload | RlMatchEndedPayload, string>) {
  return matchGuidFromValue(event.Data?.MatchGuid);
}

function ensureMatch(matchGuid: string | null) {
  if (state.currentMatch) {
    if (!state.currentMatch.matchGuid && matchGuid) {
      state.currentMatch.matchGuid = matchGuid;
      return state.currentMatch;
    }
    if (!matchGuid || state.currentMatch.matchGuid === matchGuid) return state.currentMatch;
  }

  state.currentMatch = createMatch(matchGuid);
  return state.currentMatch;
}

function publicCurrentPlayer(player: MatchPlayer): PublicCurrentPlayer {
  return {
    id: player.id,
    name: player.name,
    teamNum: player.teamNum,
    teamColor: player.teamColor
  };
}

function clonePlayerStreak(record: PublicPlayerStreak): PublicPlayerStreak {
  return {
    id: record.id,
    primaryId: record.primaryId,
    name: record.name,
    aliases: [...record.aliases],
    lastTeamNum: record.lastTeamNum,
    teamColor: record.teamColor,
    all: cloneCounter(record.all),
    modes: Object.fromEntries(Object.entries(record.modes).map(([mode, counter]) => [mode, cloneCounter(counter)])),
    updatedAtMs: record.updatedAtMs
  };
}

function publicRecords(records: Record<string, PublicPlayerStreak>) {
  return Object.values(records)
    .map(clonePlayerStreak)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function publicState(): PublicState {
  const currentMatch = state.currentMatch;
  return {
    version: 1,
    current: {
      matchGuid: currentMatch?.matchGuid ?? null,
      mode: currentMatch?.mode ?? latestMode,
      targetPlayerId: currentMatch?.targetPlayerId ?? null,
      players: Object.values(currentMatch?.players ?? {})
        .map(publicCurrentPlayer)
        .sort((a, b) => a.teamNum - b.teamNum || a.name.localeCompare(b.name))
    },
    session: {
      players: publicRecords(state.sessionPlayers)
    },
    global: {
      players: publicRecords(state.globalPlayers)
    },
    updatedAtMs: state.updatedAtMs
  };
}

function storedState(): StoredState {
  return {
    version: 1,
    globalPlayers: Object.fromEntries(Object.entries(state.globalPlayers).map(([id, record]) => [id, clonePlayerStreak(record)])),
    countedMatches: state.countedMatches.slice(-MAX_COUNTED_MATCHES),
    updatedAtMs: state.updatedAtMs
  };
}

function uniqueStrings(values: unknown) {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = cleanString(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

function restorePlayerStreak(value: unknown): PublicPlayerStreak | null {
  if (!isRecord(value)) return null;
  const id = cleanString(value.id);
  const name = normalizeName(value.name);
  if (!id) return null;

  const modes: Record<string, CounterBucket> = {};
  if (isRecord(value.modes)) {
    for (const [mode, counter] of Object.entries(value.modes)) {
      const cleanMode = cleanString(mode);
      if (cleanMode) modes[cleanMode] = restoreCounter(counter);
    }
  }

  return {
    id,
    primaryId: cleanString(value.primaryId),
    name,
    aliases: uniqueStrings(value.aliases).slice(-MAX_ALIASES),
    lastTeamNum: readTeamNum(value.lastTeamNum),
    teamColor: normalizeColor(value.teamColor, fallbackTeamColor(readTeamNum(value.lastTeamNum))),
    all: restoreCounter(value.all),
    modes,
    updatedAtMs: readInt(value.updatedAtMs, nowMs())
  };
}

function restoreState(value: unknown): InternalState {
  const restored = createDefaultState();
  if (!isRecord(value)) return restored;

  if (isRecord(value.globalPlayers)) {
    for (const record of Object.values(value.globalPlayers)) {
      const restoredRecord = restorePlayerStreak(record);
      if (restoredRecord) restored.globalPlayers[restoredRecord.id] = restoredRecord;
    }
  }

  restored.countedMatches = uniqueStrings(value.countedMatches).slice(-MAX_COUNTED_MATCHES);
  restored.updatedAtMs = readInt(value.updatedAtMs, nowMs());
  return restored;
}

function markUpdated() {
  state.updatedAtMs = nowMs();
}

function persistState(context: ServiceContext) {
  const snapshot = storedState();
  saveChain = saveChain
    .catch(() => undefined)
    .then(() => context.storage.writeText(STORAGE_URI, JSON.stringify(snapshot, null, 2)));
}

async function loadState(context: ServiceContext) {
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
  context.registry.set(STATE_KEY, snapshot);
  context.bus.emit(STATE_EVENT, snapshot);
  if (options.persist) persistState(context);
  return snapshot;
}

function castPlayerFromValue(value: unknown): CastPlayerStatsPlayer | null {
  if (!isRecord(value)) return null;
  const id = cleanString(value.id);
  const name = cleanString(value.name);
  if (!id || !name) return null;
  return {
    id,
    primaryId: cleanString(value.primaryId),
    shortcut: typeof value.shortcut === "number" && Number.isFinite(value.shortcut) ? Math.trunc(value.shortcut) : null,
    name,
    teamNum: readTeamNum(value.teamNum)
  };
}

function castTeamFromValue(value: unknown): CastTeamStats | null {
  if (!isRecord(value)) return null;
  const teamNum = readTeamNum(value.teamNum);
  if (teamNum < 0) return null;
  return {
    teamNum,
    colorPrimary: cleanString(value.colorPrimary)
  };
}

function castMatchFromValue(value: unknown): CastMatchStats | null {
  if (!isRecord(value)) return null;
  const matchGuid = matchGuidFromValue(value.matchGuid);
  if (!matchGuid) return null;
  return {
    matchGuid,
    teams: Array.isArray(value.teams) ? value.teams.map(castTeamFromValue).filter((team): team is CastTeamStats => team !== null) : [],
    players: Array.isArray(value.players)
      ? value.players.map(castPlayerFromValue).filter((player): player is CastPlayerStatsPlayer => player !== null)
      : []
  };
}

function castPlayerStatsStateFromValue(value: unknown): CastPlayerStatsState | null {
  if (!isRecord(value) || !Array.isArray(value.matches)) return null;
  return {
    currentMatchGuid: matchGuidFromValue(value.currentMatchGuid),
    matches: value.matches.map(castMatchFromValue).filter((match): match is CastMatchStats => match !== null)
  };
}

function selectCastMatch(castState: CastPlayerStatsState, preferredMatchGuid: string | null = null) {
  if (preferredMatchGuid) {
    const preferred = castState.matches.find((match) => match.matchGuid === preferredMatchGuid);
    if (preferred) return preferred;
  }
  if (castState.currentMatchGuid) {
    const current = castState.matches.find((match) => match.matchGuid === castState.currentMatchGuid);
    if (current) return current;
  }
  return castState.matches.at(-1) ?? null;
}

function colorForCastTeam(teams: CastTeamStats[], teamNum: number) {
  const team = teams.find((candidate) => candidate.teamNum === teamNum);
  return normalizeColor(team?.colorPrimary, fallbackTeamColor(teamNum));
}

function syncCurrentMatchFromCastStats(castState: CastPlayerStatsState, preferredMatchGuid: string | null = null) {
  const castMatch = selectCastMatch(castState, preferredMatchGuid);
  if (!castMatch) return false;

  const match = ensureMatch(castMatch.matchGuid);
  match.mode = latestMode;
  match.players = {};
  for (const player of castMatch.players) {
    match.players[player.id] = {
      id: player.id,
      primaryId: player.primaryId,
      name: player.name,
      teamNum: player.teamNum,
      teamColor: colorForCastTeam(castMatch.teams, player.teamNum),
      shortcut: player.shortcut
    };
  }
  match.updatedAtMs = nowMs();
  markUpdated();
  return true;
}

function syncSequenceState(value: unknown) {
  if (!isRecord(value)) return false;
  const nextMode = gameModeFromValue(value.mode);
  const changed = nextMode !== latestMode || state.currentMatch?.mode !== nextMode;
  latestMode = nextMode;
  if (state.currentMatch) {
    state.currentMatch.mode = nextMode;
    state.currentMatch.updatedAtMs = nowMs();
  }
  if (changed) markUpdated();
  return changed;
}

function ensureLatestCastRegistries(context: ServiceContext, preferredMatchGuid: string | null = null) {
  try {
    syncSequenceState(context.registry.get(CAST_SEQUENCE_KEY));
  } catch (error) {
    context.diagnostics.warn("Unable to read Cast Package sequence state for PlayerStreak.", error);
  }

  try {
    const castState = castPlayerStatsStateFromValue(context.registry.get(CAST_PLAYER_STATS_KEY));
    if (castState) syncCurrentMatchFromCastStats(castState, preferredMatchGuid);
  } catch (error) {
    context.diagnostics.warn("Unable to read Cast Package player stats state for PlayerStreak.", error);
  }
}

function ensureRecord(records: Record<string, PublicPlayerStreak>, player: MatchPlayer) {
  let record = records[player.id];
  if (!record) {
    record = {
      id: player.id,
      primaryId: player.primaryId,
      name: player.name,
      aliases: [player.name],
      lastTeamNum: player.teamNum,
      teamColor: player.teamColor,
      all: emptyCounter(),
      modes: {},
      updatedAtMs: nowMs()
    };
    records[player.id] = record;
    return record;
  }

  record.primaryId = player.primaryId ?? record.primaryId;
  record.name = player.name;
  record.lastTeamNum = player.teamNum;
  record.teamColor = player.teamColor;
  if (!record.aliases.some((alias) => normalizedName(alias) === normalizedName(player.name))) {
    record.aliases = [...record.aliases, player.name].slice(-MAX_ALIASES);
  }
  return record;
}

function applyResultToCounter(counter: CounterBucket, won: boolean) {
  if (won) {
    counter.wins += 1;
    counter.streak = counter.streak > 0 ? counter.streak + 1 : 1;
  } else {
    counter.losses += 1;
    counter.streak = counter.streak < 0 ? counter.streak - 1 : -1;
  }
}

function applyResult(records: Record<string, PublicPlayerStreak>, player: MatchPlayer, mode: GameMode, won: boolean) {
  const record = ensureRecord(records, player);
  applyResultToCounter(record.all, won);
  const modeCounter = record.modes[mode] ?? emptyCounter();
  applyResultToCounter(modeCounter, won);
  record.modes[mode] = modeCounter;
  record.updatedAtMs = nowMs();
}

function countedKeyForMatch(match: MatchRuntime) {
  return match.matchGuid ?? `local-${match.startedAtMs}`;
}

function recordMatchResult(match: MatchRuntime, winnerTeamNum: number) {
  const countedKey = countedKeyForMatch(match);
  if (state.countedMatches.includes(countedKey)) return false;

  const players = Object.values(match.players);
  if (players.length === 0) return false;

  const mode = match.mode;
  for (const player of players) {
    const won = player.teamNum === winnerTeamNum;
    applyResult(state.sessionPlayers, player, mode, won);
    applyResult(state.globalPlayers, player, mode, won);
  }

  state.countedMatches = [...state.countedMatches, countedKey].slice(-MAX_COUNTED_MATCHES);
  match.endedAtMs = nowMs();
  markUpdated();
  return true;
}

async function handleCastSequence(event: BakingRLEvent<unknown, string>) {
  if (syncSequenceState(event.Data)) await publishState();
}

async function handleCastPlayerStats(event: BakingRLEvent<unknown, string>) {
  const castState = castPlayerStatsStateFromValue(event.Data);
  if (castState && syncCurrentMatchFromCastStats(castState)) {
    await publishState();
  }
}

async function handleMatchStart(event: BakingRLEvent<RlSimpleMatchPayload, string>) {
  const match = ensureMatch(matchGuidFromEvent(event));
  match.mode = latestMode;
  match.updatedAtMs = nowMs();
  markUpdated();
  await publishState();
}

async function handleMatchEnded(event: BakingRLEvent<RlMatchEndedPayload, "MatchEnded">) {
  const context = serviceContext;
  const matchGuid = matchGuidFromEvent(event);
  if (context) ensureLatestCastRegistries(context, matchGuid);

  const match = ensureMatch(matchGuid);
  const winnerTeamNum = readTeamNum(event.Data?.WinnerTeamNum);
  if (winnerTeamNum < 0) return;

  if (recordMatchResult(match, winnerTeamNum)) {
    await publishState({ persist: true });
  } else {
    await publishState();
  }
}

async function handleMatchDestroyed(event: BakingRLEvent<RlSimpleMatchPayload, "MatchDestroyed">) {
  const matchGuid = matchGuidFromEvent(event);
  if (matchGuid && state.currentMatch?.matchGuid !== matchGuid) return;
  state.currentMatch = null;
  markUpdated();
  await publishState();
}

function findPlayer(records: PublicPlayerStreak[], input: SnapshotInput) {
  const playerId = cleanString(input.playerId);
  if (playerId) return records.find((record) => record.id === playerId) ?? null;

  const playerName = cleanString(input.playerName);
  if (!playerName) return null;
  const normalized = normalizedName(playerName);
  return (
    records.find(
      (record) => normalizedName(record.name) === normalized || record.aliases.some((alias) => normalizedName(alias) === normalized)
    ) ?? null
  );
}

function scopeFromInput(value: unknown): RecordScope | "all" {
  if (value === "session" || value === "global" || value === "all") return value;
  return "all";
}

function snapshot(input: SnapshotInput = {}) {
  const snapshotState = publicState();
  const scope = scopeFromInput(input.scope);
  if (!cleanString(input.playerId) && !cleanString(input.playerName)) return snapshotState;

  if (scope === "session") {
    return { ...snapshotState, player: findPlayer(snapshotState.session.players, input) };
  }
  if (scope === "global") {
    return { ...snapshotState, player: findPlayer(snapshotState.global.players, input) };
  }
  return {
    ...snapshotState,
    player: {
      session: findPlayer(snapshotState.session.players, input),
      global: findPlayer(snapshotState.global.players, input)
    }
  };
}

async function reset(input: ResetInput = {}) {
  const scope = scopeFromInput(input.scope);
  if (scope === "session" || scope === "all") {
    state.sessionPlayers = {};
  }
  if (scope === "global" || scope === "all") {
    state.globalPlayers = {};
    state.countedMatches = [];
  }
  markUpdated();
  return publishState({ persist: scope === "global" || scope === "all" });
}

export default defineService({
  async mount(context: ServiceContext) {
    serviceContext = context;
    await loadState(context);
    ensureLatestCastRegistries(context);

    cleanups = [
      context.bus.subscribe(CAST_SEQUENCE_EVENT, handleCastSequence),
      context.bus.subscribe(CAST_PLAYER_STATS_EVENT, handleCastPlayerStats),
      context.bus.subscribe("MatchCreated", handleMatchStart),
      context.bus.subscribe("MatchInitialized", handleMatchStart),
      context.bus.subscribe("MatchEnded", handleMatchEnded),
      context.bus.subscribe("MatchDestroyed", handleMatchDestroyed)
    ];

    await publishState();
  },
  unmount() {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    serviceContext = null;
    latestMode = "unknown";
  },
  methods: {
    snapshot(input: unknown) {
      return snapshot(isRecord(input) ? input : {});
    },
    reset(input: unknown) {
      return reset(isRecord(input) ? input : {});
    }
  }
});
