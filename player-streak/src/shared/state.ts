export const PACKAGE_ID = "com.bakingrl.player-streak";
export const STATE_EVENT = `plugin.${PACKAGE_ID}.state`;
export const STATE_KEY = `plugin.${PACKAGE_ID}.state`;

export type GameMode = "1v1" | "2v2" | "3v3" | "4v4" | "unknown";
export type RecordScope = "session" | "global";

export type CounterBucket = {
  wins: number;
  losses: number;
  streak: number;
};

export type PublicPlayerStreak = {
  id: string;
  primaryId: string | null;
  name: string;
  aliases: string[];
  lastTeamNum: number;
  teamColor: string;
  all: CounterBucket;
  modes: Record<string, CounterBucket>;
  updatedAtMs: number;
};

export type PublicCurrentPlayer = {
  id: string;
  name: string;
  teamNum: number;
  teamColor: string;
};

export type PublicState = {
  version: 1;
  current: {
    matchGuid: string | null;
    mode: GameMode;
    targetPlayerId: string | null;
    players: PublicCurrentPlayer[];
  };
  session: {
    players: PublicPlayerStreak[];
  };
  global: {
    players: PublicPlayerStreak[];
  };
  updatedAtMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCounterBucket(value: unknown): value is CounterBucket {
  if (!isRecord(value)) return false;
  return typeof value.wins === "number" && typeof value.losses === "number" && typeof value.streak === "number";
}

function isPublicPlayerStreak(value: unknown): value is PublicPlayerStreak {
  if (!isRecord(value) || !isCounterBucket(value.all) || !isRecord(value.modes)) return false;
  return (
    typeof value.id === "string" &&
    (value.primaryId === null || typeof value.primaryId === "string") &&
    typeof value.name === "string" &&
    Array.isArray(value.aliases) &&
    value.aliases.every((alias) => typeof alias === "string") &&
    typeof value.lastTeamNum === "number" &&
    typeof value.teamColor === "string" &&
    Object.values(value.modes).every(isCounterBucket) &&
    typeof value.updatedAtMs === "number"
  );
}

function isPublicCurrentPlayer(value: unknown): value is PublicCurrentPlayer {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.teamNum === "number" &&
    typeof value.teamColor === "string"
  );
}

export function isPublicState(value: unknown): value is PublicState {
  if (!isRecord(value) || !isRecord(value.current) || !isRecord(value.session) || !isRecord(value.global)) {
    return false;
  }
  const current = value.current;
  return (
    value.version === 1 &&
    (current.matchGuid === null || typeof current.matchGuid === "string") &&
    (current.mode === "1v1" ||
      current.mode === "2v2" ||
      current.mode === "3v3" ||
      current.mode === "4v4" ||
      current.mode === "unknown") &&
    (current.targetPlayerId === null || typeof current.targetPlayerId === "string") &&
    Array.isArray(current.players) &&
    current.players.every(isPublicCurrentPlayer) &&
    Array.isArray(value.session.players) &&
    value.session.players.every(isPublicPlayerStreak) &&
    Array.isArray(value.global.players) &&
    value.global.players.every(isPublicPlayerStreak) &&
    typeof value.updatedAtMs === "number"
  );
}
