import {
  defineService,
  type BakingRLEvent,
  type RlBallHitPayload,
  type RlCrossbarHitPayload,
  type RlGoalScoredPayload,
  type RlLocation,
  type RlPlayerRef,
  type RlSimpleMatchPayload,
  type RlStatfeedEventPayload,
  type RlUpdateStatePayload,
  type ServiceContext
} from "@bakingrl/plugin-sdk";
import { CAGE_STATS_EVENT, CAGE_STATS_KEY } from "../../shared/events";

type Axis = "X" | "Y" | "Z";
type CageSide = "negative" | "positive";
type Metric = "goal" | "crossbar" | "save";
type Confidence = "exact" | "playerBallHit" | "latestBallHit" | "teamFallback";

type ProjectionConfig = {
  goalAxis: Axis;
  horizontalAxis: Axis;
  verticalAxis: Axis;
  negativeSideTeamNum: number;
  positiveSideTeamNum: number;
  resetOnMatch: boolean;
};

type TeamInfo = {
  name: string;
  teamNum: number;
};

type CageRecord = {
  id: string;
  metric: Metric;
  matchGuid: string | null;
  cageSide: CageSide;
  defendingTeamNum: number;
  attackingTeamNum: number;
  player: RlPlayerRef;
  assister: RlPlayerRef | null;
  location: RlLocation;
  projection: {
    horizontal: number;
    vertical: number;
  };
  speed: number | null;
  impactForce: number | null;
  goalTime: number | null;
  ownGoal: boolean;
  confidence: Confidence;
  createdAtMs: number;
};

type BallHitRecord = {
  matchGuid: string | null;
  players: RlPlayerRef[];
  location: RlLocation;
  cageSide: CageSide;
  projection: CageRecord["projection"];
  seenAtMs: number;
  sequence: number;
};

type PendingCrossbarRecord = Omit<CageRecord, "id" | "createdAtMs"> & {
  seenAtMs: number;
};

type RecentGoalRecord = {
  matchGuid: string | null;
  cageSide: CageSide;
  seenAtMs: number;
};

type InternalState = {
  version: 1;
  config: ProjectionConfig;
  currentMatchGuid: string | null;
  teams: Record<string, TeamInfo>;
  records: CageRecord[];
  updatedAtMs: number;
};

type PublicState = InternalState & {
  totals: Record<CageSide, Record<Metric, number>>;
};

type ConfigureInput = Partial<ProjectionConfig>;

const STORAGE_URI = "plugin://self/cage-stats-state.json";
const MAX_RECORDS = 300;
const MAX_BALL_HITS = 40;
const CROSSBAR_DEBOUNCE_MS = 1000;
const RECENT_GOAL_TTL_MS = 1000;
const DEFAULT_GOAL_DEPTH = 5120;
const DEFAULT_GOAL_HEIGHT = 320;

let serviceContext: ServiceContext | null = null;
let state: InternalState = createDefaultState();
let pendingGoal: RlGoalScoredPayload | null = null;
let lastBallHits: BallHitRecord[] = [];
let pendingCrossbars: PendingCrossbarRecord[] = [];
let recentGoals: RecentGoalRecord[] = [];
let sequence = 0;
let saveChain: Promise<void> = Promise.resolve();

function createDefaultConfig(): ProjectionConfig {
  return {
    goalAxis: "Y",
    horizontalAxis: "X",
    verticalAxis: "Z",
    negativeSideTeamNum: 0,
    positiveSideTeamNum: 1,
    resetOnMatch: true
  };
}

function createDefaultState(): InternalState {
  return {
    version: 1,
    config: createDefaultConfig(),
    currentMatchGuid: null,
    teams: {
      "0": { name: "Blue", teamNum: 0 },
      "1": { name: "Orange", teamNum: 1 }
    },
    records: [],
    updatedAtMs: Date.now()
  };
}

function isAxis(value: unknown): value is Axis {
  return value === "X" || value === "Y" || value === "Z";
}

function normalizeAxis(value: unknown, fallback: Axis): Axis {
  return isAxis(value) ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizeBool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeLocation(value: unknown, fallback: RlLocation): RlLocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Partial<RlLocation>;
  return {
    X: typeof raw.X === "number" && Number.isFinite(raw.X) ? raw.X : fallback.X,
    Y: typeof raw.Y === "number" && Number.isFinite(raw.Y) ? raw.Y : fallback.Y,
    Z: typeof raw.Z === "number" && Number.isFinite(raw.Z) ? raw.Z : fallback.Z
  };
}

function normalizePlayer(value: unknown, fallback: RlPlayerRef): RlPlayerRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Partial<RlPlayerRef>;
  return {
    Name: typeof raw.Name === "string" && raw.Name.trim() ? raw.Name.trim() : fallback.Name,
    Shortcut: typeof raw.Shortcut === "number" && Number.isFinite(raw.Shortcut) ? Math.trunc(raw.Shortcut) : fallback.Shortcut,
    TeamNum: normalizeNumber(raw.TeamNum, fallback.TeamNum)
  };
}

function validAxes(config: ProjectionConfig) {
  return new Set([config.goalAxis, config.horizontalAxis, config.verticalAxis]).size === 3;
}

function normalizeConfig(input: Partial<ProjectionConfig>, fallback: ProjectionConfig): ProjectionConfig {
  const next = {
    goalAxis: normalizeAxis(input.goalAxis, fallback.goalAxis),
    horizontalAxis: normalizeAxis(input.horizontalAxis, fallback.horizontalAxis),
    verticalAxis: normalizeAxis(input.verticalAxis, fallback.verticalAxis),
    negativeSideTeamNum: normalizeNumber(input.negativeSideTeamNum, fallback.negativeSideTeamNum),
    positiveSideTeamNum: normalizeNumber(input.positiveSideTeamNum, fallback.positiveSideTeamNum),
    resetOnMatch: normalizeBool(input.resetOnMatch, fallback.resetOnMatch)
  };
  return validAxes(next) ? next : fallback;
}

function restoreState(value: unknown): InternalState {
  const fallback = createDefaultState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Partial<InternalState>;
  const config = normalizeConfig(raw.config ?? {}, fallback.config);
  const restored: InternalState = {
    version: 1,
    config,
    currentMatchGuid: typeof raw.currentMatchGuid === "string" ? raw.currentMatchGuid : null,
    teams: fallback.teams,
    records: [],
    updatedAtMs: normalizeNumber(raw.updatedAtMs, Date.now())
  };

  if (raw.teams && typeof raw.teams === "object" && !Array.isArray(raw.teams)) {
    for (const [key, team] of Object.entries(raw.teams)) {
      if (!team || typeof team !== "object" || Array.isArray(team)) continue;
      const candidate = team as Partial<TeamInfo>;
      const teamNum = normalizeNumber(candidate.teamNum, Number(key));
      restored.teams[String(teamNum)] = {
        name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : `Team ${teamNum}`,
        teamNum
      };
    }
  }

  if (Array.isArray(raw.records)) {
    restored.records = raw.records
      .map((record): CageRecord | null => {
        if (!record || typeof record !== "object" || Array.isArray(record)) return null;
        const item = record as Partial<CageRecord>;
        if (item.metric !== "goal" && item.metric !== "crossbar" && item.metric !== "save") return null;
        const cageSide = item.cageSide === "positive" ? "positive" : "negative";
        const player = normalizePlayer(item.player, { Name: "Unknown", TeamNum: -1 });
        const location = normalizeLocation(item.location, defaultLocationForSide(cageSide));
        return {
          id: typeof item.id === "string" && item.id ? item.id : uniqueId(item.metric),
          metric: item.metric,
          matchGuid: typeof item.matchGuid === "string" ? item.matchGuid : null,
          cageSide,
          defendingTeamNum: normalizeNumber(item.defendingTeamNum, teamNumForSide(cageSide, config)),
          attackingTeamNum: normalizeNumber(item.attackingTeamNum, player.TeamNum),
          player,
          assister: item.assister ? normalizePlayer(item.assister, { Name: "Unknown", TeamNum: -1 }) : null,
          location,
          projection: project(location, config),
          speed: typeof item.speed === "number" && Number.isFinite(item.speed) ? item.speed : null,
          impactForce: typeof item.impactForce === "number" && Number.isFinite(item.impactForce) ? item.impactForce : null,
          goalTime: typeof item.goalTime === "number" && Number.isFinite(item.goalTime) ? item.goalTime : null,
          ownGoal: false,
          confidence: item.confidence === "playerBallHit" || item.confidence === "latestBallHit" || item.confidence === "teamFallback" ? item.confidence : "exact",
          createdAtMs: normalizeNumber(item.createdAtMs, Date.now())
        };
      })
      .filter((record): record is CageRecord => record !== null)
      .slice(-MAX_RECORDS);
  }

  return restored;
}

function markUpdated() {
  state.updatedAtMs = Date.now();
}

function axisValue(location: RlLocation, axis: Axis) {
  return location[axis];
}

function sideFromLocation(location: RlLocation, fallback: CageSide = "positive") {
  const value = axisValue(location, state.config.goalAxis);
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return fallback;
}

function sideForTeamNum(teamNum: number, config = state.config): CageSide {
  return teamNum === config.positiveSideTeamNum ? "positive" : "negative";
}

function teamNumForSide(side: CageSide, config = state.config) {
  return side === "positive" ? config.positiveSideTeamNum : config.negativeSideTeamNum;
}

function opponentTeamNum(teamNum: number, config = state.config) {
  if (teamNum === config.negativeSideTeamNum) return config.positiveSideTeamNum;
  if (teamNum === config.positiveSideTeamNum) return config.negativeSideTeamNum;
  return teamNum === 0 ? 1 : 0;
}

function defaultLocationForSide(side: CageSide): RlLocation {
  const depth = side === "positive" ? DEFAULT_GOAL_DEPTH : -DEFAULT_GOAL_DEPTH;
  return {
    X: state.config.goalAxis === "X" ? depth : 0,
    Y: state.config.goalAxis === "Y" ? depth : 0,
    Z: state.config.goalAxis === "Z" ? depth : DEFAULT_GOAL_HEIGHT
  };
}

function project(location: RlLocation, config = state.config) {
  return {
    horizontal: axisValue(location, config.horizontalAxis),
    vertical: axisValue(location, config.verticalAxis)
  };
}

function uniqueId(metric: Metric) {
  sequence += 1;
  return `${metric}-${state.currentMatchGuid ?? "session"}-${sequence}`;
}

function publicState(): PublicState {
  const totals: PublicState["totals"] = {
    negative: { goal: 0, crossbar: 0, save: 0 },
    positive: { goal: 0, crossbar: 0, save: 0 }
  };
  for (const record of state.records) {
    totals[record.cageSide][record.metric] += 1;
  }
  return {
    ...state,
    config: { ...state.config },
    teams: Object.fromEntries(Object.entries(state.teams).map(([key, team]) => [key, { ...team }])),
    records: state.records.map((record) => ({
      ...record,
      player: { ...record.player },
      assister: record.assister ? { ...record.assister } : null,
      location: { ...record.location },
      projection: { ...record.projection }
    })),
    totals
  };
}

async function publishState() {
  const context = serviceContext;
  const snapshot = publicState();
  if (!context) return snapshot;
  context.registry.set(CAGE_STATS_KEY, snapshot);
  context.bus.emit(CAGE_STATS_EVENT, snapshot);
  saveChain = saveChain
    .catch(() => undefined)
    .then(() => context.storage.writeText(STORAGE_URI, JSON.stringify(state, null, 2)));
  return snapshot;
}

async function loadState(context: ServiceContext) {
  try {
    const raw = await context.storage.readText(STORAGE_URI);
    state = restoreState(JSON.parse(raw));
  } catch {
    state = createDefaultState();
  }
}

function playerMatches(a: RlPlayerRef, b: RlPlayerRef) {
  if (a.TeamNum !== b.TeamNum) return false;
  if (typeof a.Shortcut === "number" && typeof b.Shortcut === "number") return a.Shortcut === b.Shortcut;
  return a.Name.trim().toLowerCase() === b.Name.trim().toLowerCase();
}

function sameMatch(a: string | null, b: string | null) {
  return a === b || a === null || b === null;
}

function addRecord(record: Omit<CageRecord, "id" | "createdAtMs">) {
  state.records = [
    ...state.records,
    {
      ...record,
      id: uniqueId(record.metric),
      createdAtMs: Date.now()
    }
  ].slice(-MAX_RECORDS);
  markUpdated();
}

function clearPendingCrossbars() {
  pendingCrossbars = [];
}

async function flushPendingCrossbars(now = Date.now()) {
  pruneRecentGoals(now);
  const ready: Array<Omit<CageRecord, "id" | "createdAtMs">> = [];
  const waiting: PendingCrossbarRecord[] = [];

  for (const pending of pendingCrossbars) {
    if (now - pending.seenAtMs < CROSSBAR_DEBOUNCE_MS) {
      waiting.push(pending);
      continue;
    }
    if (!hasRecentGoalForCrossbar(pending, now)) {
      const { seenAtMs: _seenAtMs, ...record } = pending;
      ready.push(record);
    }
  }

  pendingCrossbars = waiting;
  if (!ready.length) return false;

  for (const record of ready) {
    addRecord(record);
  }
  await publishState();
  return true;
}

function pruneRecentGoals(now = Date.now()) {
  recentGoals = recentGoals.filter((goal) => now - goal.seenAtMs <= RECENT_GOAL_TTL_MS);
}

function hasRecentGoalForCrossbar(record: Omit<CageRecord, "id" | "createdAtMs">, now = Date.now()) {
  pruneRecentGoals(now);
  return recentGoals.some((goal) => sameMatch(goal.matchGuid, record.matchGuid) && goal.cageSide === record.cageSide);
}

async function queueCrossbar(record: Omit<CageRecord, "id" | "createdAtMs">) {
  const now = Date.now();
  await flushPendingCrossbars(now);
  if (hasRecentGoalForCrossbar(record, now)) return;

  const existing = pendingCrossbars.find(
    (pending) =>
      sameMatch(pending.matchGuid, record.matchGuid) &&
      pending.cageSide === record.cageSide &&
      now - pending.seenAtMs <= CROSSBAR_DEBOUNCE_MS
  );
  if (existing) {
    Object.assign(existing, record, { seenAtMs: now });
    return;
  }

  const pending: PendingCrossbarRecord = {
    ...record,
    seenAtMs: now
  };
  pendingCrossbars = [...pendingCrossbars, pending];
}

function cancelCrossbarsForGoal(goal: RlGoalScoredPayload, cageSide: CageSide) {
  const now = Date.now();
  const matchGuid = goal.MatchGuid ?? state.currentMatchGuid;
  recentGoals = [...recentGoals, { matchGuid, cageSide, seenAtMs: now }];
  pruneRecentGoals(now);

  for (const pending of pendingCrossbars) {
    if (sameMatch(pending.matchGuid, matchGuid) && pending.cageSide === cageSide && now - pending.seenAtMs <= CROSSBAR_DEBOUNCE_MS) {
      pendingCrossbars = pendingCrossbars.filter((item) => item !== pending);
    }
  }
}

function resetRecords(matchGuid: string | null = state.currentMatchGuid) {
  state.currentMatchGuid = matchGuid;
  state.records = [];
  pendingGoal = null;
  lastBallHits = [];
  clearPendingCrossbars();
  recentGoals = [];
  markUpdated();
}

async function maybeResetForMatch(event: BakingRLEvent<RlSimpleMatchPayload, string>) {
  const matchGuid = event.Data?.MatchGuid ?? null;
  if (!state.config.resetOnMatch) {
    await flushPendingCrossbars();
    state.currentMatchGuid = matchGuid ?? state.currentMatchGuid;
    markUpdated();
    await publishState();
    return;
  }
  if (matchGuid && matchGuid !== state.currentMatchGuid) {
    resetRecords(matchGuid);
    await publishState();
  }
}

async function handleUpdateState(event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) {
  await flushPendingCrossbars();
  let changed = false;
  const matchGuid = event.Data?.MatchGuid ?? null;
  if (matchGuid && matchGuid !== state.currentMatchGuid && !state.config.resetOnMatch) {
    state.currentMatchGuid = matchGuid;
    changed = true;
  }
  for (const team of event.Data?.Game?.Teams ?? []) {
    const key = String(team.TeamNum);
    const previous = state.teams[key];
    if (!previous || previous.name !== team.Name || previous.teamNum !== team.TeamNum) {
      state.teams[key] = { name: team.Name || `Team ${team.TeamNum}`, teamNum: team.TeamNum };
      changed = true;
    }
  }
  if (changed) {
    markUpdated();
    await publishState();
  }
}

async function handleBallHit(event: BakingRLEvent<RlBallHitPayload, "BallHit">) {
  await flushPendingCrossbars();
  const location = event.Data?.Ball?.Location;
  if (!location) return;
  const cageSide = sideFromLocation(location);
  lastBallHits = [
    {
      matchGuid: event.Data.MatchGuid ?? state.currentMatchGuid,
      players: event.Data.Players ?? [],
      location,
      cageSide,
      projection: project(location),
      seenAtMs: Date.now(),
      sequence: sequence + 1
    },
    ...lastBallHits
  ].slice(0, MAX_BALL_HITS);
}

async function handleCrossbarHit(event: BakingRLEvent<RlCrossbarHitPayload, "CrossbarHit">) {
  const location = event.Data?.BallLocation;
  if (!location) return;
  const player = event.Data.BallLastTouch?.Player;
  if (!player) return;
  const cageSide = sideFromLocation(location, sideForTeamNum(opponentTeamNum(player.TeamNum)));
  const defendingTeamNum = teamNumForSide(cageSide);
  await queueCrossbar({
    metric: "crossbar",
    matchGuid: event.Data.MatchGuid ?? state.currentMatchGuid,
    cageSide,
    defendingTeamNum,
    attackingTeamNum: player.TeamNum,
    player,
    assister: null,
    location,
    projection: project(location),
    speed: event.Data.BallSpeed ?? event.Data.BallLastTouch?.Speed ?? null,
    impactForce: event.Data.ImpactForce ?? null,
    goalTime: null,
    ownGoal: false,
    confidence: "exact"
  });
}

function goalFallbackSide(goal: RlGoalScoredPayload) {
  return sideForTeamNum(opponentTeamNum(goal.Scorer.TeamNum));
}

async function handleGoalScored(event: BakingRLEvent<RlGoalScoredPayload, "GoalScored">) {
  if (!event.Data?.ImpactLocation || !event.Data?.Scorer) return;
  const cageSide = sideFromLocation(event.Data.ImpactLocation, goalFallbackSide(event.Data));
  await flushPendingCrossbars();
  cancelCrossbarsForGoal(event.Data, cageSide);
  pendingGoal = event.Data;
}

async function commitPendingGoal() {
  const goal = pendingGoal;
  if (!goal) return false;
  pendingGoal = null;
  const cageSide = sideFromLocation(goal.ImpactLocation, goalFallbackSide(goal));
  const defendingTeamNum = teamNumForSide(cageSide);
  addRecord({
    metric: "goal",
    matchGuid: goal.MatchGuid ?? state.currentMatchGuid,
    cageSide,
    defendingTeamNum,
    attackingTeamNum: goal.Scorer.TeamNum,
    player: goal.Scorer,
    assister: goal.Assister ?? null,
    location: goal.ImpactLocation,
    projection: project(goal.ImpactLocation),
    speed: goal.GoalSpeed ?? goal.BallLastTouch?.Speed ?? null,
    impactForce: null,
    goalTime: goal.GoalTime ?? null,
    ownGoal: false,
    confidence: "exact"
  });
  await publishState();
  return true;
}

function isSaveEvent(payload: RlStatfeedEventPayload) {
  const eventName = payload.EventName?.toLowerCase() ?? "";
  const eventType = payload.Type?.toLowerCase() ?? "";
  return eventName.includes("save") || eventType.includes("save");
}

function findBallHitForSave(matchGuid: string | null, player: RlPlayerRef) {
  const sameMatch = (hit: BallHitRecord) => !matchGuid || !hit.matchGuid || hit.matchGuid === matchGuid;
  const playerHit = lastBallHits.find((hit) => sameMatch(hit) && hit.players.some((hitPlayer) => playerMatches(hitPlayer, player)));
  if (playerHit) return { hit: playerHit, confidence: "playerBallHit" as const };
  const latestHit = lastBallHits.find(sameMatch);
  if (latestHit) return { hit: latestHit, confidence: "latestBallHit" as const };
  return null;
}

async function handleStatfeedEvent(event: BakingRLEvent<RlStatfeedEventPayload, "StatfeedEvent">) {
  await flushPendingCrossbars();
  const payload = event.Data;
  if (!payload || !isSaveEvent(payload) || !payload.MainTarget) return;
  const player = payload.MainTarget;
  const matchGuid = payload.MatchGuid ?? state.currentMatchGuid;
  const hitMatch = findBallHitForSave(matchGuid, player);
  const fallbackSide = sideForTeamNum(player.TeamNum);
  const cageSide = hitMatch?.hit.cageSide ?? fallbackSide;
  const location = hitMatch?.hit.location ?? defaultLocationForSide(cageSide);
  const defendingTeamNum = teamNumForSide(cageSide);
  addRecord({
    metric: "save",
    matchGuid,
    cageSide,
    defendingTeamNum,
    attackingTeamNum: opponentTeamNum(player.TeamNum),
    player,
    assister: null,
    location,
    projection: project(location),
    speed: null,
    impactForce: null,
    goalTime: null,
    ownGoal: false,
    confidence: hitMatch?.confidence ?? "teamFallback"
  });
  await publishState();
}

async function configure(input: ConfigureInput = {}) {
  clearPendingCrossbars();
  state.config = normalizeConfig(input, state.config);
  state.records = state.records.map((record) => {
    const cageSide = sideFromLocation(record.location, record.cageSide);
    const defendingTeamNum = teamNumForSide(cageSide);
    return {
      ...record,
      cageSide,
      defendingTeamNum,
      attackingTeamNum: record.metric === "save" ? opponentTeamNum(defendingTeamNum) : record.player.TeamNum,
      projection: project(record.location),
      ownGoal: false
    };
  });
  markUpdated();
  return publishState();
}

async function reset() {
  resetRecords(state.currentMatchGuid);
  return publishState();
}

export default defineService({
  async mount(context: ServiceContext) {
    serviceContext = context;
    await loadState(context);
    context.bus.subscribe("UpdateState", handleUpdateState);
    context.bus.subscribe("MatchCreated", maybeResetForMatch);
    context.bus.subscribe("MatchInitialized", maybeResetForMatch);
    context.bus.subscribe("BallHit", handleBallHit);
    context.bus.subscribe("CrossbarHit", handleCrossbarHit);
    context.bus.subscribe("GoalScored", handleGoalScored);
    context.bus.subscribe("CountdownBegin", async () => {
      await commitPendingGoal();
    });
    context.bus.subscribe("StatfeedEvent", handleStatfeedEvent);
    await publishState();
  },
  unmount() {
    clearPendingCrossbars();
    recentGoals = [];
    pendingGoal = null;
    lastBallHits = [];
    serviceContext = null;
  },
  methods: {
    async snapshot() {
      await flushPendingCrossbars();
      return publicState();
    },
    async configure(input) {
      return configure((input ?? {}) as ConfigureInput);
    },
    async reset() {
      return reset();
    }
  }
});
