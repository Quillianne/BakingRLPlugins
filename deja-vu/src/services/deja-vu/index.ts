import {
  type BakingRLEvent,
  type RlPlayer,
  type RlSimpleMatchPayload,
  type RlTeam,
  type RlUpdateStatePayload
} from "@bakingrl/plugin-sdk";
import type { PluginRuntimeContext, RuntimeService } from "../../extension/runtimeService";

type TeamSnapshot = {
  name: string;
  teamNum: number;
  colorPrimary: string;
  colorSecondary: string;
};

type PlayerRecord = {
  id: string;
  primaryId: string | null;
  name: string;
  aliases: string[];
  matchGuids: string[];
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  lastTeamNum: number;
};

type PublicPlayer = {
  id: string;
  name: string;
  encounterCount: number;
};

type PublicTeam = {
  teamNum: number;
  name: string;
  color: string;
  players: PublicPlayer[];
};

type InternalState = {
  version: 1;
  currentMatchGuid: string | null;
  currentPlayers: string[];
  teams: Record<string, TeamSnapshot>;
  players: Record<string, PlayerRecord>;
  updatedAtMs: number;
};

type PublicState = {
  version: 1;
  currentMatchGuid: string | null;
  teams: PublicTeam[];
  updatedAtMs: number;
};

const PACKAGE_ID = "com.bakingrl.deja-vu";
const STATE_EVENT = `plugin.${PACKAGE_ID}.state`;
const REGISTRY_KEY = `plugin.${PACKAGE_ID}.state`;
const STORAGE_URI = "plugin://self/deja-vu-state.json";
const MAX_MATCHES_PER_PLAYER = 500;

let serviceContext: PluginRuntimeContext | null = null;
let state: InternalState = createDefaultState();
let saveChain: Promise<void> = Promise.resolve();

function createDefaultState(): InternalState {
  return {
    version: 1,
    currentMatchGuid: null,
    currentPlayers: [],
    teams: {
      "0": {
        name: "Blue",
        teamNum: 0,
        colorPrimary: "#3b82f6",
        colorSecondary: "#60a5fa"
      },
      "1": {
        name: "Orange",
        teamNum: 1,
        colorPrimary: "#f97316",
        colorSecondary: "#fb923c"
      }
    },
    players: {},
    updatedAtMs: Date.now()
  };
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizeName(value: unknown, fallback = "Unknown") {
  return cleanString(value) ?? fallback;
}

function matchGuidFromValue(value: unknown) {
  return cleanString(value);
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

function fallbackColor(teamNum: number) {
  if (teamNum === 0) return "#3b82f6";
  if (teamNum === 1) return "#f97316";
  return "#94a3b8";
}

function playerIdentity(player: RlPlayer) {
  const primaryId = cleanString(player.PrimaryId);
  if (primaryId) {
    return {
      id: `primary:${primaryId}`,
      primaryId
    };
  }
  const name = normalizeName(player.Name).toLowerCase();
  return {
    id: `name:${name}`,
    primaryId: null
  };
}

function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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

function restorePlayer(value: unknown): PlayerRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<PlayerRecord>;
  const id = cleanString(raw.id);
  const name = normalizeName(raw.name);
  if (!id) return null;
  return {
    id,
    primaryId: cleanString(raw.primaryId),
    name,
    aliases: uniqueStrings(raw.aliases).slice(-12),
    matchGuids: uniqueStrings(raw.matchGuids).slice(-MAX_MATCHES_PER_PLAYER),
    firstSeenAtMs: normalizeNumber(raw.firstSeenAtMs, Date.now()),
    lastSeenAtMs: normalizeNumber(raw.lastSeenAtMs, Date.now()),
    lastTeamNum: normalizeNumber(raw.lastTeamNum, -1)
  };
}

function restoreTeam(value: unknown, fallback: TeamSnapshot): TeamSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Partial<TeamSnapshot>;
  const teamNum = normalizeNumber(raw.teamNum, fallback.teamNum);
  return {
    name: normalizeName(raw.name, fallback.name),
    teamNum,
    colorPrimary: normalizeColor(raw.colorPrimary, fallbackColor(teamNum)),
    colorSecondary: normalizeColor(raw.colorSecondary, fallbackColor(teamNum))
  };
}

function restoreState(value: unknown): InternalState {
  const fallback = createDefaultState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Partial<InternalState>;
  const restored = createDefaultState();
  restored.updatedAtMs = normalizeNumber(raw.updatedAtMs, Date.now());

  if (raw.teams && typeof raw.teams === "object" && !Array.isArray(raw.teams)) {
    for (const [key, team] of Object.entries(raw.teams)) {
      const teamNum = normalizeNumber((team as Partial<TeamSnapshot> | null)?.teamNum, Number(key));
      restored.teams[String(teamNum)] = restoreTeam(team, restored.teams[String(teamNum)] ?? {
        name: `Team ${teamNum}`,
        teamNum,
        colorPrimary: fallbackColor(teamNum),
        colorSecondary: fallbackColor(teamNum)
      });
    }
  }

  if (raw.players && typeof raw.players === "object" && !Array.isArray(raw.players)) {
    for (const player of Object.values(raw.players)) {
      const restoredPlayer = restorePlayer(player);
      if (restoredPlayer) restored.players[restoredPlayer.id] = restoredPlayer;
    }
  }

  return restored;
}

function markUpdated() {
  state.updatedAtMs = Date.now();
}

function updateTeams(teams: RlTeam[]) {
  let changed = false;
  for (const team of teams) {
    const teamNum = normalizeNumber(team.TeamNum, -1);
    const key = String(teamNum);
    const next: TeamSnapshot = {
      name: normalizeName(team.Name, `Team ${teamNum}`),
      teamNum,
      colorPrimary: normalizeColor(team.ColorPrimary, fallbackColor(teamNum)),
      colorSecondary: normalizeColor(team.ColorSecondary, fallbackColor(teamNum))
    };
    const previous = state.teams[key];
    if (
      !previous ||
      previous.name !== next.name ||
      previous.teamNum !== next.teamNum ||
      previous.colorPrimary !== next.colorPrimary ||
      previous.colorSecondary !== next.colorSecondary
    ) {
      state.teams[key] = next;
      changed = true;
    }
  }
  return changed;
}

function rememberPlayer(player: RlPlayer, matchGuid: string | null, seenAtMs: number) {
  const identity = playerIdentity(player);
  const name = normalizeName(player.Name);
  const teamNum = normalizeNumber(player.TeamNum, -1);
  let changed = false;
  let record = state.players[identity.id];

  if (!record) {
    record = {
      id: identity.id,
      primaryId: identity.primaryId,
      name,
      aliases: [name],
      matchGuids: [],
      firstSeenAtMs: seenAtMs,
      lastSeenAtMs: seenAtMs,
      lastTeamNum: teamNum
    };
    state.players[identity.id] = record;
    changed = true;
  }

  if (record.name !== name) {
    record.name = name;
    if (!record.aliases.includes(name)) {
      record.aliases = [...record.aliases, name].slice(-12);
    }
    changed = true;
  }

  if (record.primaryId !== identity.primaryId) {
    record.primaryId = identity.primaryId;
    changed = true;
  }

  if (record.lastTeamNum !== teamNum) {
    record.lastTeamNum = teamNum;
    changed = true;
  }

  if (matchGuid && !record.matchGuids.includes(matchGuid)) {
    record.matchGuids = [...record.matchGuids, matchGuid].slice(-MAX_MATCHES_PER_PLAYER);
    record.lastSeenAtMs = seenAtMs;
    changed = true;
  }

  return { id: identity.id, changed };
}

function publicPlayer(record: PlayerRecord, currentMatchGuid: string | null): PublicPlayer {
  const encounterCount = currentMatchGuid
    ? record.matchGuids.filter((matchGuid) => matchGuid !== currentMatchGuid).length
    : record.matchGuids.length;
  return {
    id: record.id,
    name: record.name,
    encounterCount
  };
}

function publicState(): PublicState {
  const teams = new Map<number, PublicTeam>();

  function teamFor(teamNum: number) {
    const knownTeam = state.teams[String(teamNum)];
    const existingTeam = teams.get(teamNum);
    if (existingTeam) return existingTeam;
    const nextTeam: PublicTeam = {
      teamNum,
      name: knownTeam?.name ?? `Team ${teamNum}`,
      color: knownTeam?.colorPrimary ?? fallbackColor(teamNum),
      players: []
    };
    teams.set(teamNum, nextTeam);
    return nextTeam;
  }

  for (const playerId of state.currentPlayers) {
    const record = state.players[playerId];
    if (!record) continue;
    teamFor(record.lastTeamNum).players.push(publicPlayer(record, state.currentMatchGuid));
  }

  return {
    version: 1,
    currentMatchGuid: state.currentMatchGuid,
    teams: [...teams.values()].sort((a, b) => a.teamNum - b.teamNum),
    updatedAtMs: state.updatedAtMs
  };
}

async function publishState() {
  const context = serviceContext;
  const snapshot = publicState();
  if (!context) return snapshot;
  context.registry.set(REGISTRY_KEY, snapshot);
  context.bus.emit(STATE_EVENT, snapshot);
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
  const matchGuid = matchGuidFromValue(event.Data?.MatchGuid);
  if (!matchGuid || matchGuid === state.currentMatchGuid) return;
  state.currentMatchGuid = matchGuid;
  state.currentPlayers = [];
  markUpdated();
  await publishState();
}

async function handleMatchDestroyed() {
  if (!state.currentMatchGuid && state.currentPlayers.length === 0) return;
  state.currentMatchGuid = null;
  state.currentPlayers = [];
  markUpdated();
  await publishState();
}

async function handleUpdateState(event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) {
  const payload = event.Data;
  if (!payload) return;

  let changed = false;
  const matchGuid = matchGuidFromValue(payload.MatchGuid);
  const seenAtMs = Date.now();
  if (matchGuid !== state.currentMatchGuid) {
    state.currentMatchGuid = matchGuid;
    changed = true;
  }

  if (updateTeams(payload.Game?.Teams ?? [])) {
    changed = true;
  }

  const seenIds = new Set<string>();
  const currentPlayers: string[] = [];
  for (const player of payload.Players ?? []) {
    const remembered = rememberPlayer(player, matchGuid, seenAtMs);
    if (remembered.changed) changed = true;
    if (seenIds.has(remembered.id)) continue;
    seenIds.add(remembered.id);
    currentPlayers.push(remembered.id);
  }

  if (!arraysEqual(state.currentPlayers, currentPlayers)) {
    state.currentPlayers = currentPlayers;
    changed = true;
  }

  if (changed) {
    markUpdated();
    await publishState();
  }
}

async function reset() {
  state = createDefaultState();
  markUpdated();
  return publishState();
}

export default {
  async mount(context: PluginRuntimeContext) {
    serviceContext = context;
    await loadState(context);
    context.bus.subscribe("UpdateState", handleUpdateState);
    context.bus.subscribe("MatchCreated", handleMatchStart);
    context.bus.subscribe("MatchInitialized", handleMatchStart);
    context.bus.subscribe("MatchDestroyed", handleMatchDestroyed);
    await publishState();
  },
  methods: {
    async snapshot() {
      return publicState();
    },
    async reset() {
      return reset();
    }
  }
} satisfies RuntimeService;
