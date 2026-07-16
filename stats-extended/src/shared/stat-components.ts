export type StatsScope = "lastMatch" | "match" | "bo";
export type StatsView = "teamDetail" | "teamSummary" | "player";
export type StatisticMetric =
  | "score"
  | "goals"
  | "assists"
  | "shots"
  | "saves"
  | "touches"
  | "demos"
  | "demoedCount"
  | "demoDifferential"
  | "goalParticipation"
  | "goalParticipationPercent"
  | "shootingAccuracyPercent"
  | "averageSpeed"
  | "boostConsumed"
  | "zeroBoostSeconds"
  | "supersonicTimePercent"
  | "airTimePercent";

export type PublicMetrics = {
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  touches: number;
  demos: number;
  boostConsumed?: number;
  demoedCount: number;
  demoDifferential: number;
  goalParticipation: number;
  observedSeconds?: number;
  averageSpeed: number;
  zeroBoostSeconds?: number;
  goalParticipationPercent: number;
  shootingAccuracyPercent: number;
  supersonicTimePercent?: number;
  airTimePercent?: number;
};

export type PlayerStats = {
  id: string;
  primaryId: string | null;
  name: string;
  teamNum: number;
  matches?: number;
  stats: PublicMetrics;
};

export type TeamStats = {
  teamNum: number;
  name: string;
  colorPrimary: string | null;
  colorSecondary?: string | null;
  players?: number;
  matches?: number;
  stats?: PublicMetrics;
};

export type MatchStats = {
  matchGuid: string;
  matchIndex: number;
  teams: TeamStats[];
  players: PlayerStats[];
};

export type PlayerStatsState = {
  version: 1;
  bo: {
    matchCount?: number;
    teams: TeamStats[];
    players: PlayerStats[];
  };
  matches: MatchStats[];
  updatedAtMs?: number;
};

export type StatsSelection = {
  label: string;
  teams: TeamStats[];
  players: PlayerStats[];
};

export type MetricDefinition = {
  id: StatisticMetric;
  tableLabel: string;
  cardLabel: string;
  value(stats: PublicMetrics): string | number;
};

export type StatsSelectionSettings = {
  scope: StatsScope;
  teamNum?: number;
  playerId?: string;
  playerName?: string;
  matchIndex?: number | null;
  matchGuid?: string;
};

export const DEFAULT_VISIBLE_METRICS: StatisticMetric[] = [
  "score",
  "goals",
  "assists",
  "shots",
  "saves",
  "touches",
  "demos",
  "demoDifferential",
  "goalParticipation",
  "shootingAccuracyPercent",
  "averageSpeed"
];

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function metric(value: number | undefined, suffix = "") {
  return `${Number.isFinite(value) ? value : 0}${suffix}`;
}

export function safeColor(value: string | null | undefined, teamNum: number) {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color}`;
  return teamNum === 1 ? "#ff7700" : "#0055ff";
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { id: "score", tableLabel: "Score", cardLabel: "Score", value: (stats) => stats.score },
  { id: "goals", tableLabel: "G", cardLabel: "Goals", value: (stats) => stats.goals },
  { id: "assists", tableLabel: "A", cardLabel: "Assists", value: (stats) => stats.assists },
  { id: "shots", tableLabel: "Sh", cardLabel: "Shots", value: (stats) => stats.shots },
  { id: "saves", tableLabel: "Sv", cardLabel: "Saves", value: (stats) => stats.saves },
  { id: "touches", tableLabel: "Tch", cardLabel: "Touches", value: (stats) => stats.touches },
  { id: "demos", tableLabel: "Dem", cardLabel: "Demos", value: (stats) => stats.demos },
  { id: "demoedCount", tableLabel: "Demoed", cardLabel: "Demoed", value: (stats) => stats.demoedCount },
  {
    id: "demoDifferential",
    tableLabel: "+/-",
    cardLabel: "Demo +/-",
    value: (stats) => `${stats.demoDifferential >= 0 ? "+" : ""}${stats.demoDifferential}`
  },
  { id: "goalParticipation", tableLabel: "GPAR", cardLabel: "GPAR", value: (stats) => stats.goalParticipation },
  {
    id: "goalParticipationPercent",
    tableLabel: "GPAR %",
    cardLabel: "GPAR %",
    value: (stats) => metric(stats.goalParticipationPercent, "%")
  },
  {
    id: "shootingAccuracyPercent",
    tableLabel: "Acc",
    cardLabel: "Accuracy",
    value: (stats) => metric(stats.shootingAccuracyPercent, "%")
  },
  { id: "averageSpeed", tableLabel: "Spd", cardLabel: "Avg speed", value: (stats) => stats.averageSpeed },
  { id: "boostConsumed", tableLabel: "Boost", cardLabel: "Boost used", value: (stats) => stats.boostConsumed ?? 0 },
  { id: "zeroBoostSeconds", tableLabel: "0 boost", cardLabel: "0 boost", value: (stats) => metric(stats.zeroBoostSeconds, "s") },
  {
    id: "supersonicTimePercent",
    tableLabel: "SS %",
    cardLabel: "Supersonic",
    value: (stats) => metric(stats.supersonicTimePercent, "%")
  },
  { id: "airTimePercent", tableLabel: "Air %", cardLabel: "Air", value: (stats) => metric(stats.airTimePercent, "%") }
];

const METRIC_BY_ID = new Map(METRIC_DEFINITIONS.map((definition) => [definition.id, definition]));

export function isStatisticMetric(value: unknown): value is StatisticMetric {
  return typeof value === "string" && METRIC_BY_ID.has(value as StatisticMetric);
}

export function readVisibleMetrics(value: unknown): StatisticMetric[] {
  if (!Array.isArray(value)) return DEFAULT_VISIBLE_METRICS;
  return value.filter(isStatisticMetric);
}

export function visibleMetricDefinitions(metricIds: StatisticMetric[]) {
  return metricIds.flatMap((metricId) => {
    const definition = METRIC_BY_ID.get(metricId);
    return definition ? [definition] : [];
  });
}

export function latestMatch(state: PlayerStatsState) {
  return [...state.matches].sort((left, right) => left.matchIndex - right.matchIndex).at(-1) ?? null;
}

export function matchForSettings(state: PlayerStatsState, settings: StatsSelectionSettings) {
  if (settings.matchGuid) return state.matches.find((match) => match.matchGuid === settings.matchGuid) ?? null;
  if (settings.matchIndex !== null && settings.matchIndex !== undefined) {
    return state.matches.find((match) => match.matchIndex === settings.matchIndex) ?? null;
  }
  return latestMatch(state);
}

function playerMatches(player: PlayerStats, settings: StatsSelectionSettings) {
  const playerId = settings.playerId ?? "";
  const playerName = settings.playerName ?? "";
  if (playerId && player.id !== playerId && player.primaryId !== playerId) return false;
  if (playerName && player.name.trim().toLowerCase() !== playerName.toLowerCase()) return false;
  return true;
}

export function selectStats(state: PlayerStatsState | null, settings: StatsSelectionSettings): StatsSelection {
  if (!state) return { label: "No stats", teams: [], players: [] };

  let label = "BO";
  let teams = state.bo.teams;
  let players = state.bo.players;

  if (settings.scope === "lastMatch") {
    const match = latestMatch(state);
    label = match ? `Match ${match.matchIndex}` : "Last match";
    teams = match?.teams ?? [];
    players = match?.players ?? [];
  } else if (settings.scope === "match") {
    const match = matchForSettings(state, settings);
    label = match ? `Match ${match.matchIndex}` : "Match";
    teams = match?.teams ?? [];
    players = match?.players ?? [];
  }

  if (settings.teamNum !== undefined && settings.teamNum >= 0) {
    teams = teams.filter((team) => team.teamNum === settings.teamNum);
    players = players.filter((player) => player.teamNum === settings.teamNum);
  }

  if (settings.playerId || settings.playerName) {
    players = players.filter((player) => playerMatches(player, settings));
    const teamNums = new Set(players.map((player) => player.teamNum));
    teams = teams.filter((team) => teamNums.has(team.teamNum));
  }

  return { label, teams, players };
}

export function statCell(label: string, value: string | number) {
  return `<div class="stat-cell"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

export function renderTeamSummary(team: TeamStats, metrics: MetricDefinition[]) {
  const stats = team.stats;
  const color = safeColor(team.colorPrimary, team.teamNum);
  return `
    <article class="team-card" style="--team-color:${escapeHtml(color)}">
      <header>
        <span>${escapeHtml(team.name)}</span>
        <strong>${metric(stats?.goals)}</strong>
      </header>
      <div class="stats-row">
        ${stats ? metrics.map((definition) => statCell(definition.cardLabel, definition.value(stats))).join("") : ""}
      </div>
    </article>
  `;
}

export function renderPlayerRow(player: PlayerStats, metrics: MetricDefinition[]) {
  return `
    <tr>
      <th>${escapeHtml(player.name)}</th>
      ${metrics.map((definition) => `<td>${escapeHtml(definition.value(player.stats))}</td>`).join("")}
    </tr>
  `;
}

export function renderTeamDetail(team: TeamStats, players: PlayerStats[], metrics: MetricDefinition[]) {
  const color = safeColor(team.colorPrimary, team.teamNum);
  const rows = players
    .filter((player) => player.teamNum === team.teamNum)
    .map((player) => renderPlayerRow(player, metrics))
    .join("");
  return `
    <article class="team-detail" style="--team-color:${escapeHtml(color)}">
      <header>
        <span>${escapeHtml(team.name)}</span>
        <strong>${team.stats?.goals ?? 0} goals</strong>
      </header>
      <table>
        <thead>
          <tr>
            <th>Player</th>${metrics.map((definition) => `<td>${escapeHtml(definition.tableLabel)}</td>`).join("")}
          </tr>
        </thead>
        <tbody>${rows || `<tr><th>No players</th><td colspan="${Math.max(1, metrics.length)}"></td></tr>`}</tbody>
      </table>
    </article>
  `;
}

export function renderPlayerDetail(players: PlayerStats[], metrics: MetricDefinition[]) {
  const player = players[0] ?? null;
  if (!player) return `<div class="empty">No player selected</div>`;
  return `
    <article class="player-detail">
      <header>
        <span>${escapeHtml(player.name)}</span>
        <strong>${player.stats.score}</strong>
      </header>
      <div class="stats-row wide">
        ${metrics.map((definition) => statCell(definition.cardLabel, definition.value(player.stats))).join("") || `<div class="empty">No metrics selected</div>`}
      </div>
    </article>
  `;
}

export function findPlayer(players: PlayerStats[], id: string, name: string) {
  const lowerName = name.toLowerCase();
  if (id) return players.find((player) => player.id === id || player.primaryId === id) ?? null;
  if (name) return players.find((player) => player.name.trim().toLowerCase() === lowerName) ?? null;
  return null;
}

export function pickHeadToHeadPlayers(
  selection: StatsSelection,
  left: { id: string; name: string },
  right: { id: string; name: string }
): [PlayerStats | null, PlayerStats | null] {
  const leftPlayer = findPlayer(selection.players, left.id, left.name);
  const rightPlayer = findPlayer(selection.players, right.id, right.name);
  if (leftPlayer || rightPlayer) return [leftPlayer, rightPlayer];
  const sorted = [...selection.players].sort((a, b) => b.stats.score - a.stats.score);
  return [sorted[0] ?? null, sorted.find((player) => player.id !== sorted[0]?.id) ?? null];
}

export function teamForPlayer(teams: TeamStats[], player: PlayerStats | null) {
  if (!player) return null;
  return teams.find((team) => team.teamNum === player.teamNum) ?? null;
}

export function renderPlayerCard(player: PlayerStats | null, team: TeamStats | null, side: "left" | "right") {
  const color = safeColor(team?.colorPrimary, player?.teamNum ?? 0);
  return `
    <article class="player-card ${side}" style="--team-color:${escapeHtml(color)}">
      <span>${escapeHtml(team?.name ?? "Team")}</span>
      <strong>${escapeHtml(player?.name ?? "Player")}</strong>
      <em>${escapeHtml(player?.stats.score ?? 0)} score</em>
    </article>
  `;
}

export function statLine(label: string, left: number, right: number, suffix = "") {
  return `
    <div class="stat-line">
      <span>${escapeHtml(left)}${suffix}</span>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(right)}${suffix}</span>
    </div>
  `;
}
