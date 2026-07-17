import { defineWebview, type ServiceCaller, type WebviewContext } from "@bakingrl/plugin-sdk";

const PACKAGE_ID = "bakingrl.stats-extended";
const STATS_SERVICE = `${PACKAGE_ID}/playerStatsTracker`;
const CAGE_SERVICE = `${PACKAGE_ID}/cageStats`;
const REFRESH_INTERVAL_MS = 2000;

type MetricLine = {
  score?: number;
  goals?: number;
  shots?: number;
  assists?: number;
  saves?: number;
  touches?: number;
  demos?: number;
  averageSpeed?: number;
  goalParticipationPercent?: number;
  shootingAccuracyPercent?: number;
  supersonicTimePercent?: number;
  airTimePercent?: number;
};

type PlayerLine = {
  id?: string;
  name?: string;
  teamNum?: number;
  matches?: number;
  stats?: MetricLine;
};

type TeamLine = {
  teamNum?: number;
  name?: string;
  colorPrimary?: string | null;
  matches?: number;
  stats?: MetricLine;
};

type MatchLine = {
  matchGuid?: string;
  matchIndex?: number;
  startedAtMs?: number;
  endedAtMs?: number | null;
  winnerTeamNum?: number | null;
  teams?: TeamLine[];
  players?: PlayerLine[];
};

type StatsSnapshot = {
  currentMatchGuid?: string | null;
  updatedAtMs?: number;
  bo?: {
    bestOf?: number | null;
    leftWins?: number;
    rightWins?: number;
    phase?: string;
    matchCount?: number;
    teams?: TeamLine[];
    players?: PlayerLine[];
  };
  matches?: MatchLine[];
};

type CageSnapshot = {
  updatedAtMs?: number;
  records?: Array<{
    id?: string;
    metric?: string;
    player?: { Name?: string };
    cageSide?: string;
    speed?: number | null;
    createdAtMs?: number;
  }>;
  totals?: Record<string, Record<string, number>>;
};

type DashboardState = {
  tab: "overview" | "matches" | "cages";
  stats: StatsSnapshot | null;
  cages: CageSnapshot | null;
  loading: boolean;
  error: string | null;
  refreshedAt: number | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function number(value: unknown, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function percent(value: unknown) {
  const formatted = number(value, 1);
  return formatted === "-" ? formatted : `${formatted}%`;
}

function timestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function teamName(teams: TeamLine[] | undefined, teamNum: number | null | undefined) {
  return teams?.find((team) => team.teamNum === teamNum)?.name ?? (teamNum === null || teamNum === undefined ? "-" : `Team ${teamNum}`);
}

function teamColor(team: TeamLine | undefined, fallback: string) {
  const color = team?.colorPrimary;
  return typeof color === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : fallback;
}

function phaseLabel(value: string | undefined) {
  if (!value) return "Waiting for a series";
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metricLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    goal: "Goal",
    save: "Save",
    crossbar: "Crossbar hit"
  };
  return value ? (labels[value] ?? phaseLabel(value)) : "Unknown event";
}

function cageSideLabel(value: string | undefined) {
  if (value === "negative") return "Negative goal area";
  if (value === "positive") return "Positive goal area";
  return value ? phaseLabel(value) : "Unknown goal area";
}

function ensureStyle() {
  if (document.getElementById("bakingrl-stats-dashboard-style")) return;
  const style = document.createElement("style");
  style.id = "bakingrl-stats-dashboard-style";
  style.textContent = `
    :root{color-scheme:light;--canvas:#f1f0ec;--surface:#fff;--surface-subtle:#f7f6f2;--graphite:#202528;--graphite-soft:#31373a;--ink:#22282b;--muted:#687176;--border:#d8d5cd;--border-strong:#bbb7ad;--amber:#ad641d;--amber-soft:#fff3df;--danger:#a33b32;--danger-soft:#fff1ef}
    *{box-sizing:border-box}html,body{margin:0;min-width:0;min-height:100%;background:var(--canvas);color:var(--ink);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font:inherit}
    .stats-app{min-height:100%;display:grid;grid-template-rows:auto auto 1fr;background:var(--canvas)}
    .topbar{min-height:86px;padding:16px 22px;display:flex;align-items:center;gap:24px;border-bottom:1px solid #141719;background:var(--graphite);color:#fff}.brand{min-width:210px;display:grid;gap:2px}.eyebrow{color:#e0a05b;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.brand strong{font-size:19px;letter-spacing:-.02em}.match-context{min-width:0;display:grid;gap:2px;padding-left:20px;border-left:1px solid #454b4e}.match-context span,.status span{color:#abb2b5;font-size:11px}.match-context strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:650}.header-actions{margin-left:auto;display:flex;align-items:center;gap:14px}.status{display:grid;text-align:right}.status strong{font-size:12px;font-weight:650}
    .button{min-height:36px;padding:7px 12px;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface);color:var(--ink);font-weight:750;cursor:pointer;transition:background .15s,border-color .15s}.button:hover{background:var(--surface-subtle);border-color:#959188}.button:focus-visible,.tab:focus-visible{outline:3px solid rgba(224,160,91,.4);outline-offset:2px}.button:disabled{cursor:progress;opacity:.62}.topbar .button{border-color:#596064;background:var(--graphite-soft);color:#fff}.topbar .button:hover{background:#3b4246;border-color:#737b7f}.button-danger{border-color:#d8aaa5;color:var(--danger);background:#fff}.button-danger:hover{border-color:#c67971;background:var(--danger-soft)}
    .tabs{display:flex;gap:22px;padding:0 22px;border-bottom:1px solid var(--border);background:var(--surface)}.tab{padding:13px 2px 11px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--muted);font-weight:750;cursor:pointer}.tab:hover{color:var(--ink)}.tab[aria-selected=true]{border-color:var(--amber);color:var(--ink)}
    .content{min-width:0;padding:24px;overflow:auto}.notice{display:grid;gap:2px;margin-bottom:16px;padding:12px 14px;border:1px solid #d8aaa5;border-radius:6px;background:var(--danger-soft);color:#702c26}.notice strong{font-size:13px}.notice span{font-size:12px}.muted{color:var(--muted);font-size:12px}
    .series-hero{border:1px solid var(--border);background:var(--surface)}.series-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:16px 18px;border-bottom:1px solid var(--border)}.section-kicker{margin:0 0 2px;color:var(--amber);font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.series-header h1,.section-head h2{margin:0;letter-spacing:-.015em}.series-header h1{font-size:19px}.phase{display:inline-flex;align-items:center;min-height:27px;padding:4px 9px;border:1px solid #e2c79f;border-radius:999px;background:var(--amber-soft);color:#75420e;font-size:11px;font-weight:800}
    .scoreboard{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:24px;padding:26px 18px}.team-score{min-width:0;display:flex;align-items:center;gap:12px}.team-score:last-child{justify-content:flex-end;text-align:right}.team-mark{flex:0 0 auto;width:10px;height:38px;border-radius:2px;background:var(--team,var(--graphite))}.team-copy{min-width:0;display:grid}.team-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase}.team-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px}.team-wins{font-size:42px;font-weight:850;line-height:1;font-variant-numeric:tabular-nums}.series-format{display:grid;justify-items:center;gap:2px;color:var(--muted);font-size:11px;font-weight:750;text-transform:uppercase}.series-format strong{color:var(--ink);font-size:13px}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--border);background:var(--surface-subtle)}.metric{min-width:0;padding:13px 16px;border-right:1px solid var(--border)}.metric:last-child{border-right:0}.metric span{display:block;color:var(--muted);font-size:11px;font-weight:750}.metric strong{display:block;overflow:hidden;margin-top:2px;text-overflow:ellipsis;white-space:nowrap;font-size:17px;font-variant-numeric:tabular-nums}.metric small{color:var(--muted);font-size:11px}
    .section{margin-top:22px}.section-head{display:flex;align-items:flex-end;gap:16px;margin-bottom:10px}.section-head h2{font-size:16px}.section-head p{margin:2px 0 0;color:var(--muted);font-size:12px}.section-actions{margin-left:auto;display:grid;justify-items:end;gap:3px}.destructive-note{color:#8d5751;font-size:10px}
    .table-hint{display:none;margin:0 0 6px;color:var(--muted);font-size:11px}.table-wrap{max-width:100%;overflow:auto;border:1px solid var(--border);background:var(--surface);scrollbar-color:#aaa69d transparent}.table-wrap:focus-visible{outline:3px solid rgba(173,100,29,.25);outline-offset:2px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:10px 12px;text-align:right;border-bottom:1px solid #e8e5de;font-variant-numeric:tabular-nums}th{position:sticky;top:0;z-index:1;background:var(--surface-subtle);color:var(--muted);font-size:10px;letter-spacing:.035em;text-transform:uppercase}th:first-child,td:first-child{position:sticky;left:0;text-align:left}th:first-child{z-index:2}td:first-child{background:var(--surface)}tbody tr:last-child td{border-bottom:0}tbody tr:hover td{background:#fbfaf7}tbody tr:hover td:first-child{background:#fbfaf7}.player{font-weight:780}.team-cell{text-align:left}.team-dot{display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:2px;background:var(--team,#777)}.empty-cell{height:80px;color:var(--muted);text-align:center!important}.empty-cell:first-child{position:static}
    .match-list{display:grid;gap:14px}.match-card{overflow:hidden;border:1px solid var(--border);background:var(--surface)}.match-card-head{display:flex;align-items:flex-start;gap:18px;padding:14px 16px;border-bottom:1px solid var(--border)}.match-index{display:grid;gap:1px}.match-index span{color:var(--muted);font-size:10px;font-weight:750;text-transform:uppercase}.match-index strong{font-size:18px}.match-meta{min-width:0;display:grid;gap:1px}.match-meta strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.match-state{margin-left:auto;display:inline-flex;padding:3px 8px;border:1px solid var(--border);border-radius:999px;background:var(--surface-subtle);color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.match-state.live{border-color:#e2c79f;background:var(--amber-soft);color:#75420e}.match-score{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border-bottom:1px solid var(--border)}.match-team{display:flex;align-items:center;gap:10px;padding:14px 16px}.match-team:first-child{border-right:1px solid var(--border)}.match-team:last-child{justify-content:flex-end;text-align:right}.match-team strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.match-team b{margin-left:auto;font-size:24px;font-variant-numeric:tabular-nums}.match-team:last-child b{order:-1;margin:0 auto 0 0}.winner{color:var(--amber)}.match-players{padding:12px 14px 14px}.match-players h3{margin:0 0 8px;font-size:12px}.match-players .table-wrap{border-color:#e2dfd8}
    .cage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cage{border:1px solid var(--border);background:var(--surface)}.cage h3{margin:0;padding:12px 14px;border-bottom:1px solid var(--border);font-size:13px}.cage dl{display:grid;grid-template-columns:1fr auto;gap:0;margin:0}.cage dt,.cage dd{padding:9px 14px;border-bottom:1px solid #e8e5de}.cage dt:nth-last-of-type(1),.cage dd:nth-last-of-type(1){border-bottom:0}.cage dt{color:var(--muted)}.cage dd{margin:0;font-weight:800;font-variant-numeric:tabular-nums}.cage-records{margin-top:18px}
    .empty{display:grid;justify-items:center;gap:4px;padding:44px 24px;border:1px dashed var(--border-strong);background:var(--surface-subtle);text-align:center;color:var(--muted)}.empty strong{color:var(--ink);font-size:14px}.empty p{max-width:420px;margin:0;font-size:12px}
    @media(max-width:800px){.topbar{align-items:flex-start;flex-wrap:wrap;gap:12px 18px}.match-context{flex:1}.header-actions{width:100%;margin-left:0;padding-top:10px;border-top:1px solid #454b4e}.status{margin-right:auto;text-align:left}.content{padding:16px}.scoreboard{gap:12px}.team-score{align-items:flex-start}.team-wins{font-size:34px}.team-copy strong{font-size:16px}.section-head{align-items:flex-start}.section-actions{max-width:230px}.table-hint{display:block}.cage-grid{grid-template-columns:1fr}}
    @media(max-width:560px){.topbar{padding:14px 16px}.brand{min-width:0}.match-context{order:3;flex-basis:100%;padding:10px 0 0;border-top:1px solid #454b4e;border-left:0}.tabs{gap:16px;padding:0 16px;overflow:auto}.tab{white-space:nowrap}.content{padding:12px}.series-header{align-items:flex-start;padding:14px}.scoreboard{grid-template-columns:minmax(0,1fr) 42px minmax(0,1fr);gap:6px;padding:20px 12px}.team-score{gap:5px}.team-mark{width:5px;height:28px}.team-copy span{display:none}.team-copy strong{font-size:13px}.team-wins{font-size:30px}.series-format{font-size:9px}.summary{grid-template-columns:1fr}.metric{border-right:0;border-bottom:1px solid var(--border)}.metric:last-child{border-bottom:0}.section-head{display:grid}.section-actions{margin:0;justify-items:start;max-width:none}.match-card-head{flex-wrap:wrap;gap:8px 12px}.match-meta{order:3;flex-basis:100%}.match-score{grid-template-columns:1fr}.match-team:first-child{border-right:0;border-bottom:1px solid var(--border)}.match-team:last-child{justify-content:flex-start;text-align:left}.match-team:last-child b{order:initial;margin:0 0 0 auto}.match-players{padding:10px}.status span{display:none}}
  `;
  document.head.append(style);
}

function playerRows(players: PlayerLine[], teams: TeamLine[]) {
  if (players.length === 0) return '<tr><td class="empty-cell" colspan="15">No player statistics are available yet.</td></tr>';
  return players
    .map((player) => {
      const stats = player.stats ?? {};
      const team = teams.find((candidate) => candidate.teamNum === player.teamNum);
      return `<tr>
        <td class="player">${escapeHtml(player.name ?? player.id ?? "Unknown")}</td>
        <td class="team-cell"><span class="team-dot" style="--team:${teamColor(team, "#777d80")}"></span>${escapeHtml(team?.name ?? teamName(teams, player.teamNum))}</td>
        <td>${number(player.matches)}</td><td>${number(stats.score)}</td><td>${number(stats.goals)}</td>
        <td>${number(stats.assists)}</td><td>${number(stats.saves)}</td><td>${number(stats.shots)}</td>
        <td>${number(stats.demos)}</td><td>${percent(stats.shootingAccuracyPercent)}</td>
        <td>${percent(stats.goalParticipationPercent)}</td><td>${number(stats.touches)}</td><td>${number(stats.averageSpeed, 0)}</td>
        <td>${percent(stats.supersonicTimePercent)}</td><td>${percent(stats.airTimePercent)}</td>
      </tr>`;
    })
    .join("");
}

function playerTable(players: PlayerLine[], teams: TeamLine[], label: string) {
  return `<p class="table-hint">Scroll horizontally to compare every metric.</p><div class="table-wrap" tabindex="0" aria-label="${escapeHtml(label)}"><table><thead><tr><th>Player</th><th>Team</th><th>Matches</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th><th>Demos</th><th>Shooting accuracy</th><th>Goal participation</th><th>Touches</th><th>Average speed</th><th>Supersonic time</th><th>Air time</th></tr></thead><tbody>${playerRows(players, teams)}</tbody></table></div>`;
}

function overview(snapshot: StatsSnapshot) {
  const bo = snapshot.bo ?? {};
  const teams = bo.teams ?? [];
  const players = bo.players ?? [];
  const leader = [...players].sort((a, b) => (b.stats?.score ?? 0) - (a.stats?.score ?? 0))[0];
  const leftTeam = teams[0];
  const rightTeam = teams[1];
  const matchCount = bo.matchCount ?? snapshot.matches?.length;
  return `
    <section class="series-hero" aria-label="Series score">
      <div class="series-header"><div><p class="section-kicker">Official match analysis</p><h1>Series overview</h1></div><span class="phase">${escapeHtml(phaseLabel(bo.phase))}</span></div>
      <div class="scoreboard">
        <div class="team-score"><span class="team-mark" style="--team:${teamColor(leftTeam, "#343a3d")}"></span><div class="team-copy"><span>Left side</span><strong>${escapeHtml(leftTeam?.name ?? "Team 1")}</strong></div><b class="team-wins">${number(bo.leftWins)}</b></div>
        <div class="series-format"><span>Series</span><strong>${bo.bestOf ? `Best of ${escapeHtml(bo.bestOf)}` : "Format pending"}</strong></div>
        <div class="team-score"><b class="team-wins">${number(bo.rightWins)}</b><div class="team-copy"><span>Right side</span><strong>${escapeHtml(rightTeam?.name ?? "Team 2")}</strong></div><span class="team-mark" style="--team:${teamColor(rightTeam, "#ad641d")}"></span></div>
      </div>
      <div class="summary">
        <div class="metric"><span>Matches recorded</span><strong>${number(matchCount)}</strong></div>
        <div class="metric"><span>Series leader by score</span><strong>${escapeHtml(leader?.name ?? "No leader yet")}</strong>${leader ? `<small>${number(leader.stats?.score)} points</small>` : ""}</div>
        <div class="metric"><span>Data timestamp</span><strong>${timestamp(snapshot.updatedAtMs)}</strong></div>
      </div>
    </section>
    <section class="section"><div class="section-head"><div><h2>Player performance</h2><p>Cumulative statistics for the current series.</p></div><div class="section-actions"><button class="button button-danger" data-action="reset-stats">Clear series statistics...</button><span class="destructive-note">Removes all series and player history</span></div></div>${playerTable(players, teams, "Series player performance")}</section>
  `;
}

function matches(snapshot: StatsSnapshot) {
  const matches = [...(snapshot.matches ?? [])].reverse();
  if (matches.length === 0) return '<div class="empty"><strong>No matches recorded</strong><p>Completed and in-progress matches will appear here with their score and player performance.</p></div>';
  return `<div class="section-head"><div><h2>Match history</h2><p>${matches.length} ${matches.length === 1 ? "match" : "matches"} available for review.</p></div></div><div class="match-list">${matches
    .map((match) => {
      const teams = match.teams ?? [];
      const winner = teamName(teams, match.winnerTeamNum);
      const leftTeam = teams[0];
      const rightTeam = teams[1];
      const isLive = match.endedAtMs === null || match.endedAtMs === undefined;
      const matchLabel = match.matchIndex === undefined ? "Match" : `Match ${number(match.matchIndex)}`;
      return `<article class="match-card">
        <div class="match-card-head"><div class="match-index"><span>Series match</span><strong>${escapeHtml(matchLabel)}</strong></div><div class="match-meta"><span class="muted">${timestamp(match.endedAtMs ?? match.startedAtMs)}</span><strong title="${escapeHtml(match.matchGuid ?? "No match identifier")}">${escapeHtml(match.matchGuid ?? "No match identifier")}</strong></div><span class="match-state${isLive ? " live" : ""}">${isLive ? "In progress" : `Winner: ${escapeHtml(winner)}`}</span></div>
        <div class="match-score">
          <div class="match-team${leftTeam?.teamNum === match.winnerTeamNum ? " winner" : ""}"><span class="team-dot" style="--team:${teamColor(leftTeam, "#343a3d")}"></span><strong>${escapeHtml(leftTeam?.name ?? "Team 1")}</strong><b>${number(leftTeam?.stats?.goals)}</b></div>
          <div class="match-team${rightTeam?.teamNum === match.winnerTeamNum ? " winner" : ""}"><span class="team-dot" style="--team:${teamColor(rightTeam, "#ad641d")}"></span><strong>${escapeHtml(rightTeam?.name ?? "Team 2")}</strong><b>${number(rightTeam?.stats?.goals)}</b></div>
        </div>
        <div class="match-players"><h3>Player performance in this match</h3>${playerTable(match.players ?? [], teams, `${matchLabel} player performance`)}</div>
      </article>`;
    })
    .join("")}</div>`;
}

function cages(snapshot: CageSnapshot) {
  const totals = snapshot.totals ?? {};
  const sides = ["negative", "positive"];
  const records = [...(snapshot.records ?? [])].reverse();
  return `<div class="section-head"><div><h2>Goal-area events</h2><p>${records.length} ${records.length === 1 ? "event" : "events"} recorded across both sides.</p></div><div class="section-actions"><button class="button button-danger" data-action="reset-cages">Clear goal-area data...</button><span class="destructive-note">Removes all saved goal-area events</span></div></div><div class="cage-grid">${sides
    .map((side) => {
      const line = totals[side] ?? {};
      return `<section class="cage"><h3>${side === "negative" ? "Negative goal area" : "Positive goal area"}</h3><dl><dt>Goals</dt><dd>${number(line.goal)}</dd><dt>Saves</dt><dd>${number(line.save)}</dd><dt>Crossbar hits</dt><dd>${number(line.crossbar)}</dd></dl></section>`;
    })
    .join("")}</div>
    <section class="cage-records"><div class="section-head"><div><h2>Recent events</h2><p>Chronological detail for review and verification.</p></div></div><p class="table-hint">Scroll horizontally to view every event detail.</p><div class="table-wrap" tabindex="0" aria-label="Recorded goal-area events"><table><thead><tr><th>Player</th><th>Event</th><th>Goal area</th><th>Recorded speed</th><th>Recorded at</th></tr></thead><tbody>${records.length === 0 ? '<tr><td class="empty-cell" colspan="5">No goal-area events are available yet.</td></tr>' : records.map((record) => `<tr><td class="player">${escapeHtml(record.player?.Name ?? "Unknown player")}</td><td>${escapeHtml(metricLabel(record.metric))}</td><td>${escapeHtml(cageSideLabel(record.cageSide))}</td><td>${number(record.speed, 1)}</td><td>${timestamp(record.createdAtMs)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function render(root: HTMLElement, state: DashboardState) {
  const hasData = state.stats !== null || state.cages !== null;
  const activeData = state.tab === "cages" ? state.cages : state.stats;
  const body = state.loading && activeData === null
    ? '<div class="empty"><strong>Loading match data</strong><p>Series and event statistics are being retrieved.</p></div>'
    : activeData === null
      ? '<div class="empty"><strong>Statistics unavailable</strong><p>Use Refresh data to try connecting to the statistics services again.</p></div>'
      : state.tab === "matches"
        ? matches(state.stats ?? {})
        : state.tab === "cages"
          ? cages(state.cages ?? {})
          : overview(state.stats ?? {});

  const error = state.error ? `<div class="notice" role="alert"><strong>Statistics could not be updated.</strong><span>${escapeHtml(state.error)}${hasData ? " The last successful snapshot remains visible." : ""}</span></div>` : "";
  const matchIdentifier = state.stats?.currentMatchGuid;

  root.innerHTML = `<main class="stats-app">
    <header class="topbar"><div class="brand"><span class="eyebrow">Extended Statistics</span><strong>Match analysis</strong></div><div class="match-context"><span>${matchIdentifier ? "Active match" : "Match status"}</span><strong title="${escapeHtml(matchIdentifier ?? "No active match")}">${escapeHtml(matchIdentifier ?? "No active match")}</strong></div><div class="header-actions"><div class="status"><span>Automatic update every 2 seconds</span><strong>${state.loading ? "Updating data..." : state.refreshedAt ? `Updated ${timestamp(state.refreshedAt)}` : "Waiting for data"}</strong></div><button class="button" data-action="refresh"${state.loading ? " disabled" : ""}>Refresh data</button></div></header>
    <nav class="tabs" aria-label="Match analysis views">
      ${(["overview", "matches", "cages"] as const).map((tab) => `<button class="tab" data-tab="${tab}" aria-pressed="${state.tab === tab}" aria-controls="stats-panel">${tab === "overview" ? "Series overview" : tab === "matches" ? "Match history" : "Goal areas"}</button>`).join("")}
    </nav>
    <section class="content" id="stats-panel" aria-busy="${state.loading}">${error}${body}</section>
  </main>`;
}

type ViewState = {
  focus: { kind: "tab" | "action" | "label"; value: string } | null;
  rootScrollTop: number;
  rootScrollLeft: number;
  windowScrollX: number;
  windowScrollY: number;
  tables: Array<{ label: string; left: number; top: number }>;
};

function captureViewState(root: HTMLElement): ViewState {
  const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
    ? document.activeElement
    : null;
  const focus = active?.dataset.tab
    ? { kind: "tab" as const, value: active.dataset.tab }
    : active?.dataset.action
      ? { kind: "action" as const, value: active.dataset.action }
      : active?.getAttribute("aria-label")
        ? { kind: "label" as const, value: active.getAttribute("aria-label") ?? "" }
        : null;
  const tables = Array.from(root.querySelectorAll<HTMLElement>(".table-wrap[aria-label]")).map((table) => ({
    label: table.getAttribute("aria-label") ?? "",
    left: table.scrollLeft,
    top: table.scrollTop
  }));
  return {
    focus,
    rootScrollTop: root.scrollTop,
    rootScrollLeft: root.scrollLeft,
    windowScrollX: window.scrollX,
    windowScrollY: window.scrollY,
    tables
  };
}

function restoreViewState(root: HTMLElement, view: ViewState) {
  root.scrollTop = view.rootScrollTop;
  root.scrollLeft = view.rootScrollLeft;
  window.scrollTo(view.windowScrollX, view.windowScrollY);
  for (const saved of view.tables) {
    const table = Array.from(root.querySelectorAll<HTMLElement>(".table-wrap[aria-label]")).find(
      (candidate) => candidate.getAttribute("aria-label") === saved.label
    );
    if (table) {
      table.scrollLeft = saved.left;
      table.scrollTop = saved.top;
    }
  }
  if (!view.focus) return;
  const focusTarget = Array.from(root.querySelectorAll<HTMLElement>("button, [tabindex], [aria-label]")).find((candidate) => {
    if (view.focus?.kind === "tab") return candidate.dataset.tab === view.focus.value;
    if (view.focus?.kind === "action") return candidate.dataset.action === view.focus.value;
    return candidate.getAttribute("aria-label") === view.focus?.value;
  });
  focusTarget?.focus({ preventScroll: true });
}

function renderPreservingView(root: HTMLElement, state: DashboardState) {
  const view = captureViewState(root);
  render(root, state);
  restoreViewState(root, view);
}

function updateLoadingChrome(root: HTMLElement, loading: boolean) {
  root.querySelector<HTMLElement>(".content")?.setAttribute("aria-busy", String(loading));
  const refresh = root.querySelector<HTMLButtonElement>('[data-action="refresh"]');
  if (refresh) refresh.disabled = loading;
  const status = root.querySelector<HTMLElement>(".status strong");
  if (loading && status) status.textContent = "Updating data...";
}

async function readSnapshots(services: ServiceCaller) {
  const [statsResult, cagesResult] = await Promise.allSettled([
    services.call<StatsSnapshot>(STATS_SERVICE, "snapshot", {}),
    services.call<CageSnapshot>(CAGE_SERVICE, "snapshot", {})
  ]);
  const errors: string[] = [];
  if (statsResult.status === "rejected") {
    errors.push(`Series statistics: ${statsResult.reason instanceof Error ? statsResult.reason.message : String(statsResult.reason)}`);
  }
  if (cagesResult.status === "rejected") {
    errors.push(`Goal-area data: ${cagesResult.reason instanceof Error ? cagesResult.reason.message : String(cagesResult.reason)}`);
  }
  return {
    stats: statsResult.status === "fulfilled" ? statsResult.value : undefined,
    cages: cagesResult.status === "fulfilled" ? cagesResult.value : undefined,
    errors
  };
}

export default defineWebview({
  async mount(context: WebviewContext) {
    ensureStyle();
    if (!context.services) throw new Error("Extended Statistics requires the host service API.");
    const services = context.services;
    let disposed = false;
    let refreshRunning = false;
    const state: DashboardState = {
      tab: "overview",
      stats: null,
      cages: null,
      loading: true,
      error: null,
      refreshedAt: null
    };

    async function refresh() {
      if (refreshRunning || disposed) return;
      refreshRunning = true;
      state.loading = true;
      updateLoadingChrome(context.root, true);
      try {
        const snapshots = await readSnapshots(services);
        if (disposed) return;
        if (snapshots.stats !== undefined) state.stats = snapshots.stats;
        if (snapshots.cages !== undefined) state.cages = snapshots.cages;
        state.error = snapshots.errors.length ? snapshots.errors.join(" ") : null;
        if (snapshots.stats !== undefined || snapshots.cages !== undefined) state.refreshedAt = Date.now();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.loading = false;
        refreshRunning = false;
        if (!disposed) renderPreservingView(context.root, state);
      }
    }

    async function reset(serviceRef: string, confirmation: string) {
      if (!window.confirm(confirmation)) return;
      try {
        await services.call(serviceRef, "reset", {});
        await refresh();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        renderPreservingView(context.root, state);
      }
    }

    const onClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
      if (!target) return;
      const tab = target.dataset.tab as DashboardState["tab"] | undefined;
      if (tab) {
        state.tab = tab;
        renderPreservingView(context.root, state);
        return;
      }
      if (target.dataset.action === "refresh") void refresh();
      if (target.dataset.action === "reset-stats") {
        void reset(STATS_SERVICE, "Clear all series and player statistics? This removes the complete match history for this series and cannot be undone.");
      }
      if (target.dataset.action === "reset-cages") {
        void reset(CAGE_SERVICE, "Clear all goal-area data? This removes every saved goal, save, and crossbar event and cannot be undone.");
      }
    };

    context.root.addEventListener("click", onClick);
    render(context.root, state);
    await refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      context.root.removeEventListener("click", onClick);
      context.root.innerHTML = "";
    };
  }
});
