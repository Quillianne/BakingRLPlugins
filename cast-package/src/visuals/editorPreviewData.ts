import type { RlPlayer, RlTeam, RlUpdateStatePayload, VisualContext } from "@bakingrl/plugin-sdk";

export type EditorPublicMetrics = {
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

export type EditorPlayerStats = {
  id: string;
  primaryId: string | null;
  shortcut: number | null;
  name: string;
  teamNum: number;
  matches: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  stats: EditorPublicMetrics;
};

export type EditorTeamStats = {
  teamNum: number;
  name: string;
  colorPrimary: string | null;
  colorSecondary: string | null;
  players: number;
  matches: number;
  stats: EditorPublicMetrics;
};

export type EditorMatchStats = {
  matchGuid: string;
  matchIndex: number;
  startedAtMs: number;
  endedAtMs: number | null;
  winnerSide: "left" | "right" | null;
  winnerTeamNum: number | null;
  teams: EditorTeamStats[];
  players: EditorPlayerStats[];
  updatedAtMs: number;
};

export type EditorPlayerStatsState = {
  version: 1;
  currentMatchGuid: string;
  bo: {
    bestOf: 5;
    leftWins: number;
    rightWins: number;
    phase: "tracking";
    currentMatchGuid: string;
    winner: null;
    matchCount: number;
    teams: EditorTeamStats[];
    players: EditorPlayerStats[];
  };
  matches: EditorMatchStats[];
  updatedAtMs: number;
};

export type EditorCageRecord = {
  id: string;
  metric: "goal" | "crossbar" | "save";
  matchGuid: string | null;
  cageSide: "negative" | "positive";
  defendingTeamNum: number;
  attackingTeamNum: number;
  player: {
    Name: string;
    Shortcut?: number;
    TeamNum: number;
  };
  assister: {
    Name: string;
    Shortcut?: number;
    TeamNum: number;
  } | null;
  location: {
    X: number;
    Y: number;
    Z: number;
  };
  projection: {
    horizontal: number;
    vertical: number;
  };
  speed: number | null;
  impactForce: number | null;
  goalTime: number | null;
  ownGoal: boolean;
  confidence: "exact" | "playerBallHit" | "latestBallHit" | "teamFallback";
  createdAtMs: number;
};

export type EditorCageStatsState = {
  version: 1;
  config: {
    goalAxis: "X" | "Y" | "Z";
    horizontalAxis: "X" | "Y" | "Z";
    verticalAxis: "X" | "Y" | "Z";
    negativeSideTeamNum: number;
    positiveSideTeamNum: number;
    resetOnMatch: boolean;
  };
  currentMatchGuid: string | null;
  teams: Record<string, { name: string; teamNum: number }>;
  records: EditorCageRecord[];
  totals: Record<"negative" | "positive", Record<"goal" | "crossbar" | "save", number>>;
  updatedAtMs: number;
};

const MATCH_GUID = "editor-preview";
const BASE_TIME_MS = 1_710_000_000_000;

type VisualContextWithMode = VisualContext & {
  mode?: "runtime" | "editor";
};

type EditorUpdateStateOptions = {
  leftScore?: number;
  rightScore?: number;
  timeSeconds?: number;
  overtime?: boolean;
};

const TEAMS: RlTeam[] = [
  {
    TeamNum: 0,
    Name: "Blue",
    Score: 3,
    ColorPrimary: "#0055ff",
    ColorSecondary: "#60a5fa"
  },
  {
    TeamNum: 1,
    Name: "Orange",
    Score: 2,
    ColorPrimary: "#ff7700",
    ColorSecondary: "#fb923c"
  }
];

const PLAYERS: RlPlayer[] = [
  {
    Name: "M0nkey M00n",
    PrimaryId: "editor-blue-1",
    Shortcut: 1,
    TeamNum: 0,
    Score: 642,
    Goals: 2,
    Shots: 5,
    Assists: 0,
    Saves: 1,
    Touches: 58,
    CarTouches: 58,
    Demos: 1,
    Boost: 72,
    Speed: 1510,
    bHasCar: true,
    bBoosting: false,
    bOnGround: true,
    bOnWall: false,
    bPowersliding: false,
    bDemolished: false,
    bSupersonic: false
  },
  {
    Name: "ExoTiiK",
    PrimaryId: "editor-blue-2",
    Shortcut: 2,
    TeamNum: 0,
    Score: 411,
    Goals: 1,
    Shots: 3,
    Assists: 1,
    Saves: 2,
    Touches: 46,
    CarTouches: 46,
    Demos: 0,
    Boost: 38,
    Speed: 1280,
    bHasCar: true,
    bBoosting: true,
    bOnGround: false,
    bOnWall: false,
    bPowersliding: false,
    bDemolished: false,
    bSupersonic: false
  },
  {
    Name: "Seikoo",
    PrimaryId: "editor-blue-3",
    Shortcut: 3,
    TeamNum: 0,
    Score: 376,
    Goals: 0,
    Shots: 2,
    Assists: 2,
    Saves: 3,
    Touches: 51,
    CarTouches: 51,
    Demos: 1,
    Boost: 18,
    Speed: 1395,
    bHasCar: true,
    bBoosting: false,
    bOnGround: true,
    bOnWall: false,
    bPowersliding: true,
    bDemolished: false,
    bSupersonic: false
  },
  {
    Name: "Vatira",
    PrimaryId: "editor-orange-1",
    Shortcut: 4,
    TeamNum: 1,
    Score: 523,
    Goals: 1,
    Shots: 4,
    Assists: 0,
    Saves: 2,
    Touches: 52,
    CarTouches: 52,
    Demos: 1,
    Boost: 55,
    Speed: 1630,
    bHasCar: true,
    bBoosting: true,
    bOnGround: true,
    bOnWall: false,
    bPowersliding: false,
    bDemolished: false,
    bSupersonic: true
  },
  {
    Name: "Atow",
    PrimaryId: "editor-orange-2",
    Shortcut: 5,
    TeamNum: 1,
    Score: 468,
    Goals: 1,
    Shots: 3,
    Assists: 1,
    Saves: 2,
    Touches: 48,
    CarTouches: 48,
    Demos: 0,
    Boost: 31,
    Speed: 1460,
    bHasCar: true,
    bBoosting: false,
    bOnGround: false,
    bOnWall: true,
    bPowersliding: false,
    bDemolished: false,
    bSupersonic: false
  },
  {
    Name: "Rise",
    PrimaryId: "editor-orange-3",
    Shortcut: 6,
    TeamNum: 1,
    Score: 287,
    Goals: 0,
    Shots: 2,
    Assists: 1,
    Saves: 1,
    Touches: 37,
    CarTouches: 37,
    Demos: 0,
    Boost: 12,
    Speed: 1120,
    bHasCar: true,
    bBoosting: false,
    bOnGround: true,
    bOnWall: false,
    bPowersliding: false,
    bDemolished: true,
    bSupersonic: false,
    Attacker: {
      Name: "Seikoo",
      Shortcut: 3,
      TeamNum: 0
    }
  }
];

const PLAYER_STATS: EditorPlayerStats[] = [
  playerStats("editor-blue-1", "M0nkey M00n", 1, 0, {
    score: 642,
    goals: 2,
    shots: 5,
    assists: 0,
    saves: 1,
    touches: 58,
    demos: 1,
    boostConsumed: 318,
    demoedCount: 0,
    demoDifferential: 1,
    goalParticipation: 2,
    observedSeconds: 310,
    averageSpeed: 1510,
    zeroBoostSeconds: 4.2,
    goalParticipationPercent: 66.7,
    shootingAccuracyPercent: 40,
    supersonicTimePercent: 18.6,
    airTimePercent: 31.2
  }),
  playerStats("editor-blue-2", "ExoTiiK", 2, 0, {
    score: 411,
    goals: 1,
    shots: 3,
    assists: 1,
    saves: 2,
    touches: 46,
    demos: 0,
    boostConsumed: 276,
    demoedCount: 1,
    demoDifferential: -1,
    goalParticipation: 2,
    observedSeconds: 309,
    averageSpeed: 1280,
    zeroBoostSeconds: 8.6,
    goalParticipationPercent: 66.7,
    shootingAccuracyPercent: 33.3,
    supersonicTimePercent: 11.4,
    airTimePercent: 37.5
  }),
  playerStats("editor-blue-3", "Seikoo", 3, 0, {
    score: 376,
    goals: 0,
    shots: 2,
    assists: 2,
    saves: 3,
    touches: 51,
    demos: 1,
    boostConsumed: 304,
    demoedCount: 0,
    demoDifferential: 1,
    goalParticipation: 2,
    observedSeconds: 310,
    averageSpeed: 1395,
    zeroBoostSeconds: 6.1,
    goalParticipationPercent: 66.7,
    shootingAccuracyPercent: 0,
    supersonicTimePercent: 14.1,
    airTimePercent: 24.7
  }),
  playerStats("editor-orange-1", "Vatira", 4, 1, {
    score: 523,
    goals: 1,
    shots: 4,
    assists: 0,
    saves: 2,
    touches: 52,
    demos: 1,
    boostConsumed: 295,
    demoedCount: 0,
    demoDifferential: 1,
    goalParticipation: 1,
    observedSeconds: 310,
    averageSpeed: 1630,
    zeroBoostSeconds: 3.8,
    goalParticipationPercent: 50,
    shootingAccuracyPercent: 25,
    supersonicTimePercent: 22.3,
    airTimePercent: 28.5
  }),
  playerStats("editor-orange-2", "Atow", 5, 1, {
    score: 468,
    goals: 1,
    shots: 3,
    assists: 1,
    saves: 2,
    touches: 48,
    demos: 0,
    boostConsumed: 338,
    demoedCount: 1,
    demoDifferential: -1,
    goalParticipation: 2,
    observedSeconds: 308,
    averageSpeed: 1460,
    zeroBoostSeconds: 9.4,
    goalParticipationPercent: 100,
    shootingAccuracyPercent: 33.3,
    supersonicTimePercent: 16.7,
    airTimePercent: 35.1
  }),
  playerStats("editor-orange-3", "Rise", 6, 1, {
    score: 287,
    goals: 0,
    shots: 2,
    assists: 1,
    saves: 1,
    touches: 37,
    demos: 0,
    boostConsumed: 241,
    demoedCount: 2,
    demoDifferential: -2,
    goalParticipation: 1,
    observedSeconds: 310,
    averageSpeed: 1120,
    zeroBoostSeconds: 14.2,
    goalParticipationPercent: 50,
    shootingAccuracyPercent: 0,
    supersonicTimePercent: 8.8,
    airTimePercent: 19.6
  })
];

const TEAM_STATS: EditorTeamStats[] = [
  {
    teamNum: 0,
    name: "Blue",
    colorPrimary: "#0055ff",
    colorSecondary: "#60a5fa",
    players: 3,
    matches: 1,
    stats: {
      score: 1429,
      goals: 3,
      shots: 10,
      assists: 3,
      saves: 6,
      touches: 155,
      demos: 2,
      boostConsumed: 898,
      demoedCount: 1,
      demoDifferential: 1,
      goalParticipation: 6,
      observedSeconds: 929,
      averageSpeed: 1395,
      zeroBoostSeconds: 18.9,
      goalParticipationPercent: 60,
      shootingAccuracyPercent: 30,
      supersonicTimePercent: 14.7,
      airTimePercent: 31.1
    }
  },
  {
    teamNum: 1,
    name: "Orange",
    colorPrimary: "#ff7700",
    colorSecondary: "#fb923c",
    players: 3,
    matches: 1,
    stats: {
      score: 1278,
      goals: 2,
      shots: 9,
      assists: 2,
      saves: 5,
      touches: 137,
      demos: 1,
      boostConsumed: 874,
      demoedCount: 3,
      demoDifferential: -2,
      goalParticipation: 4,
      observedSeconds: 928,
      averageSpeed: 1403,
      zeroBoostSeconds: 27.4,
      goalParticipationPercent: 40,
      shootingAccuracyPercent: 22.2,
      supersonicTimePercent: 15.9,
      airTimePercent: 27.7
    }
  }
];

function playerStats(
  primaryId: string,
  name: string,
  shortcut: number,
  teamNum: number,
  stats: EditorPublicMetrics
): EditorPlayerStats {
  return {
    id: `primary:${primaryId}`,
    primaryId,
    shortcut,
    name,
    teamNum,
    matches: 1,
    firstSeenAtMs: BASE_TIME_MS,
    lastSeenAtMs: BASE_TIME_MS + 310_000,
    stats
  };
}

function cloneTeam(team: RlTeam): RlTeam {
  return { ...team };
}

function clonePlayer(player: RlPlayer): RlPlayer {
  const clone = { ...player };
  if (player.Attacker) {
    clone.Attacker = { ...player.Attacker };
  } else {
    delete clone.Attacker;
  }
  return clone;
}

function cloneMetrics(metrics: EditorPublicMetrics): EditorPublicMetrics {
  return { ...metrics };
}

function clonePlayerStats(player: EditorPlayerStats): EditorPlayerStats {
  return {
    ...player,
    stats: cloneMetrics(player.stats)
  };
}

function cloneTeamStats(team: EditorTeamStats): EditorTeamStats {
  return {
    ...team,
    stats: cloneMetrics(team.stats)
  };
}

function editorMatchStats(): EditorMatchStats {
  return {
    matchGuid: MATCH_GUID,
    matchIndex: 1,
    startedAtMs: BASE_TIME_MS,
    endedAtMs: null,
    winnerSide: null,
    winnerTeamNum: null,
    teams: TEAM_STATS.map(cloneTeamStats),
    players: PLAYER_STATS.map(clonePlayerStats),
    updatedAtMs: BASE_TIME_MS + 310_000
  };
}

export function editorUpdateState(options: EditorUpdateStateOptions = {}): RlUpdateStatePayload {
  return {
    MatchGuid: MATCH_GUID,
    Game: {
      Teams: TEAMS.map((team) => ({
        ...cloneTeam(team),
        Score: team.TeamNum === 0 ? options.leftScore ?? team.Score : options.rightScore ?? team.Score
      })),
      TimeSeconds: options.timeSeconds ?? 184,
      bOvertime: options.overtime ?? false,
      Frame: 1200,
      Elapsed: 116,
      Ball: {
        Speed: 1200,
        TeamNum: 0
      },
      bReplay: false,
      bHasWinner: false,
      Winner: "",
      Arena: "DFH Stadium",
      bHasTarget: true,
      Target: {
        Name: "M0nkey M00n",
        Shortcut: 1,
        TeamNum: 0
      }
    },
    Players: PLAYERS.map(clonePlayer)
  };
}

export function editorPlayerStatsState(): EditorPlayerStatsState {
  const match = editorMatchStats();
  return {
    version: 1,
    currentMatchGuid: MATCH_GUID,
    bo: {
      bestOf: 5,
      leftWins: 1,
      rightWins: 0,
      phase: "tracking",
      currentMatchGuid: MATCH_GUID,
      winner: null,
      matchCount: 1,
      teams: TEAM_STATS.map(cloneTeamStats),
      players: PLAYER_STATS.map(clonePlayerStats)
    },
    matches: [match],
    updatedAtMs: BASE_TIME_MS + 310_000
  };
}

function editorCageRecord(
  id: string,
  metric: EditorCageRecord["metric"],
  cageSide: EditorCageRecord["cageSide"],
  playerIndex: number,
  horizontal: number,
  vertical: number,
  createdOffsetMs: number
): EditorCageRecord {
  const player = PLAYERS[playerIndex] ?? PLAYERS[0];
  const defendingTeamNum = cageSide === "positive" ? 1 : 0;
  return {
    id,
    metric,
    matchGuid: MATCH_GUID,
    cageSide,
    defendingTeamNum,
    attackingTeamNum: metric === "save" ? (player.TeamNum === 0 ? 1 : 0) : player.TeamNum,
    player: {
      Name: player.Name,
      Shortcut: player.Shortcut,
      TeamNum: player.TeamNum
    },
    assister: null,
    location: {
      X: horizontal,
      Y: cageSide === "positive" ? 5120 : -5120,
      Z: vertical
    },
    projection: {
      horizontal,
      vertical
    },
    speed: metric === "save" ? null : 96,
    impactForce: metric === "crossbar" ? 1.2 : null,
    goalTime: metric === "goal" ? 184 : null,
    ownGoal: false,
    confidence: "exact",
    createdAtMs: BASE_TIME_MS + createdOffsetMs
  };
}

export function editorCageStatsState(): EditorCageStatsState {
  const records = [
    editorCageRecord("editor-cage-goal-1", "goal", "positive", 0, -420, 330, 92_000),
    editorCageRecord("editor-cage-save-1", "save", "negative", 2, 310, 210, 134_000),
    editorCageRecord("editor-cage-cross-1", "crossbar", "positive", 1, 180, 640, 176_000),
    editorCageRecord("editor-cage-goal-2", "goal", "negative", 3, -260, 410, 214_000),
    editorCageRecord("editor-cage-save-2", "save", "positive", 4, 520, 260, 251_000),
    editorCageRecord("editor-cage-cross-2", "crossbar", "negative", 5, -610, 625, 284_000)
  ];
  return {
    version: 1,
    config: {
      goalAxis: "Y",
      horizontalAxis: "X",
      verticalAxis: "Z",
      negativeSideTeamNum: 0,
      positiveSideTeamNum: 1,
      resetOnMatch: true
    },
    currentMatchGuid: MATCH_GUID,
    teams: {
      "0": { name: "Blue", teamNum: 0 },
      "1": { name: "Orange", teamNum: 1 }
    },
    records,
    totals: {
      negative: {
        goal: records.filter((record) => record.cageSide === "negative" && record.metric === "goal").length,
        crossbar: records.filter((record) => record.cageSide === "negative" && record.metric === "crossbar").length,
        save: records.filter((record) => record.cageSide === "negative" && record.metric === "save").length
      },
      positive: {
        goal: records.filter((record) => record.cageSide === "positive" && record.metric === "goal").length,
        crossbar: records.filter((record) => record.cageSide === "positive" && record.metric === "crossbar").length,
        save: records.filter((record) => record.cageSide === "positive" && record.metric === "save").length
      }
    },
    updatedAtMs: BASE_TIME_MS + 310_000
  };
}

export function isEditorMode(context: VisualContext) {
  return (context as VisualContextWithMode).mode === "editor";
}
