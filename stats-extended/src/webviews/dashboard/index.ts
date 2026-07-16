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
  return `${number(value, 1)}%`;
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

function ensureStyle() {
  if (document.getElementById("bakingrl-stats-dashboard-style")) return;
  const style = document.createElement("style");
  style.id = "bakingrl-stats-dashboard-style";
  style.textContent = `
    *{box-sizing:border-box}html,body{margin:0;min-width:0;background:#f3f5f4;color:#18201d;font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}button{font:inherit}
    .stats-app{min-height:100%;display:grid;grid-template-rows:auto auto 1fr;background:#f3f5f4}.topbar{min-height:64px;padding:12px 18px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #cdd5d1;background:#fff}.brand{min-width:0;display:grid}.brand strong{font-size:17px}.brand span{color:#64716b;font-size:12px}.status{margin-left:auto;text-align:right;color:#64716b;font-size:12px}.refresh{min-width:38px;height:34px;border:1px solid #aebbb5;border-radius:6px;background:#fff;color:#26342e;cursor:pointer}.refresh:hover{background:#edf4f0}
    .tabs{display:flex;gap:2px;padding:0 18px;border-bottom:1px solid #cdd5d1;background:#fff}.tab{padding:11px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:#64716b;font-weight:700;cursor:pointer}.tab[aria-selected=true]{border-color:#16845b;color:#0f6847}.content{min-width:0;padding:20px;overflow:auto}.notice{padding:12px 14px;border:1px solid #d7aaa2;border-radius:6px;background:#fff3f0;color:#8a3023}
    .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #cdd5d1;background:#fff}.metric{min-width:0;padding:15px;border-right:1px solid #dce2df}.metric:last-child{border-right:0}.metric span{display:block;color:#64716b;font-size:12px;font-weight:700}.metric strong{display:block;margin-top:3px;font-size:24px;font-variant-numeric:tabular-nums}
    .section{margin-top:20px}.section-head{display:flex;align-items:center;gap:12px;margin-bottom:8px}.section-head h2{margin:0;font-size:15px}.section-head span{color:#64716b;font-size:12px}.danger{margin-left:auto;border:1px solid #d7aaa2;border-radius:6px;background:#fff;color:#9a382b;padding:6px 10px;cursor:pointer}.danger:hover{background:#fff3f0}
    .table-wrap{overflow:auto;border:1px solid #cdd5d1;background:#fff}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:10px 12px;text-align:right;border-bottom:1px solid #e2e7e4;font-variant-numeric:tabular-nums}th{position:sticky;top:0;background:#f8faf9;color:#65716b;font-size:11px;text-transform:uppercase}th:first-child,td:first-child{text-align:left}tbody tr:last-child td{border-bottom:0}.player{font-weight:750}.team-dot{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:var(--team,#77857e)}
    .match-list{display:grid;border:1px solid #cdd5d1;background:#fff}.match-row{display:grid;grid-template-columns:70px minmax(180px,1fr) minmax(180px,1fr) 180px;gap:12px;padding:12px 14px;border-bottom:1px solid #e2e7e4;align-items:center}.match-row:last-child{border-bottom:0}.match-row strong{font-size:13px}.muted{color:#64716b;font-size:12px}.cage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cage{border:1px solid #cdd5d1;background:#fff;padding:14px}.cage h3{margin:0 0 10px;font-size:14px}.cage dl{display:grid;grid-template-columns:1fr auto;gap:7px 12px;margin:0}.cage dt{color:#64716b}.cage dd{margin:0;font-weight:800;font-variant-numeric:tabular-nums}
    .empty{padding:32px;border:1px dashed #aebbb5;background:#f8faf9;text-align:center;color:#64716b}
    @media(max-width:760px){.content{padding:14px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid #dce2df}.match-row{grid-template-columns:60px minmax(0,1fr)}.match-row>*:nth-child(n+3){display:none}.cage-grid{grid-template-columns:1fr}.status{display:none}}
  `;
  document.head.append(style);
}

function playerRows(players: PlayerLine[]) {
  if (players.length === 0) return '<tr><td colspan="11">No player data</td></tr>';
  return players
    .map((player) => {
      const stats = player.stats ?? {};
      return `<tr>
        <td class="player">${escapeHtml(player.name ?? player.id ?? "Unknown")}</td>
        <td>${number(player.matches)}</td><td>${number(stats.score)}</td><td>${number(stats.goals)}</td>
        <td>${number(stats.assists)}</td><td>${number(stats.saves)}</td><td>${number(stats.shots)}</td>
        <td>${number(stats.demos)}</td><td>${percent(stats.shootingAccuracyPercent)}</td>
        <td>${percent(stats.goalParticipationPercent)}</td><td>${number(stats.averageSpeed, 0)}</td>
      </tr>`;
    })
    .join("");
}

function playerTable(players: PlayerLine[]) {
  return `<div class="table-wrap"><table><thead><tr><th>Player</th><th>Matches</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th><th>Demos</th><th>Accuracy</th><th>Participation</th><th>Avg speed</th></tr></thead><tbody>${playerRows(players)}</tbody></table></div>`;
}

function overview(snapshot: StatsSnapshot) {
  const bo = snapshot.bo ?? {};
  const players = bo.players ?? [];
  const leader = [...players].sort((a, b) => (b.stats?.score ?? 0) - (a.stats?.score ?? 0))[0];
  return `
    <div class="summary">
      <div class="metric"><span>Series</span><strong>${number(bo.leftWins)} - ${number(bo.rightWins)}</strong></div>
      <div class="metric"><span>Format</span><strong>${bo.bestOf ? `BO${escapeHtml(bo.bestOf)}` : "-"}</strong></div>
      <div class="metric"><span>Matches</span><strong>${number(bo.matchCount)}</strong></div>
      <div class="metric"><span>Top score</span><strong>${escapeHtml(leader?.name ?? "-")}</strong></div>
    </div>
    <section class="section"><div class="section-head"><h2>Series players</h2><span>${escapeHtml(bo.phase ?? "idle")}</span><button class="danger" data-action="reset-stats">Reset statistics</button></div>${playerTable(players)}</section>
  `;
}

function matches(snapshot: StatsSnapshot) {
  const matches = [...(snapshot.matches ?? [])].reverse();
  if (matches.length === 0) return '<div class="empty">No matches recorded</div>';
  return `<div class="match-list">${matches
    .map((match) => {
      const teams = match.teams ?? [];
      const winner = teamName(teams, match.winnerTeamNum);
      const score = teams.map((team) => `${escapeHtml(team.name ?? `Team ${team.teamNum ?? "-"}`)} ${number(team.stats?.goals)}`).join(" / ");
      return `<div class="match-row"><strong>#${number(match.matchIndex)}</strong><div><strong>${score || "Match"}</strong><div class="muted">${escapeHtml(match.matchGuid ?? "-")}</div></div><div><strong>${escapeHtml(winner)}</strong><div class="muted">Winner</div></div><div class="muted">${timestamp(match.endedAtMs ?? match.startedAtMs)}</div></div>`;
    })
    .join("")}</div>`;
}

function cages(snapshot: CageSnapshot) {
  const totals = snapshot.totals ?? {};
  const sides = ["negative", "positive"];
  return `<div class="section-head"><h2>Cage events</h2><span>${snapshot.records?.length ?? 0} records</span><button class="danger" data-action="reset-cages">Reset cage data</button></div><div class="cage-grid">${sides
    .map((side) => {
      const line = totals[side] ?? {};
      return `<section class="cage"><h3>${side === "negative" ? "Negative cage" : "Positive cage"}</h3><dl><dt>Goals</dt><dd>${number(line.goal)}</dd><dt>Saves</dt><dd>${number(line.save)}</dd><dt>Crossbar hits</dt><dd>${number(line.crossbar)}</dd></dl></section>`;
    })
    .join("")}</div>`;
}

function render(root: HTMLElement, state: DashboardState) {
  const body = state.error
    ? `<div class="notice">${escapeHtml(state.error)}</div>`
    : state.loading && !state.stats
      ? '<div class="empty">Loading statistics...</div>'
      : state.tab === "matches"
        ? matches(state.stats ?? {})
        : state.tab === "cages"
          ? cages(state.cages ?? {})
          : overview(state.stats ?? {});

  root.innerHTML = `<main class="stats-app">
    <header class="topbar"><div class="brand"><strong>Extended Statistics</strong><span>${escapeHtml(state.stats?.currentMatchGuid ?? "No active match")}</span></div><div class="status">Updated ${state.refreshedAt ? timestamp(state.refreshedAt) : "-"}</div><button class="refresh" data-action="refresh" title="Refresh" aria-label="Refresh">&#8635;</button></header>
    <nav class="tabs" aria-label="Statistics views">
      ${(["overview", "matches", "cages"] as const).map((tab) => `<button class="tab" data-tab="${tab}" aria-selected="${state.tab === tab}">${tab === "overview" ? "Overview" : tab === "matches" ? "Matches" : "Cages"}</button>`).join("")}
    </nav>
    <section class="content">${body}</section>
  </main>`;
}

async function readSnapshots(services: ServiceCaller) {
  const [stats, cages] = await Promise.all([
    services.call<StatsSnapshot>(STATS_SERVICE, "snapshot", {}),
    services.call<CageSnapshot>(CAGE_SERVICE, "snapshot", {})
  ]);
  return { stats, cages };
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
      render(context.root, state);
      try {
        const snapshots = await readSnapshots(services);
        if (disposed) return;
        state.stats = snapshots.stats;
        state.cages = snapshots.cages;
        state.error = null;
        state.refreshedAt = Date.now();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.loading = false;
        refreshRunning = false;
        if (!disposed) render(context.root, state);
      }
    }

    async function reset(serviceRef: string, label: string) {
      if (!window.confirm(`Reset ${label}?`)) return;
      await services.call(serviceRef, "reset", {});
      await refresh();
    }

    const onClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
      if (!target) return;
      const tab = target.dataset.tab as DashboardState["tab"] | undefined;
      if (tab) {
        state.tab = tab;
        render(context.root, state);
        return;
      }
      if (target.dataset.action === "refresh") void refresh();
      if (target.dataset.action === "reset-stats") void reset(STATS_SERVICE, "player and series statistics");
      if (target.dataset.action === "reset-cages") void reset(CAGE_SERVICE, "cage statistics");
    };

    context.root.addEventListener("click", onClick);
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
