import {
  defineVisual,
  type BakingRLEvent,
  type RlTeam,
  type RlUpdateStatePayload,
  type VisualContext
} from "@bakingrl/plugin-sdk";

type ThemeId =
  | "app"
  | "modern-dark"
  | "neon-cyber"
  | "industrial-bakery"
  | "pro-streamer"
  | "hacker-terminal"
  | "broadcast-clean";

type Side = "left" | "right";

type BoTrackerState = {
  bestOf: 1 | 3 | 5 | 7;
  leftWins: number;
  rightWins: number;
  tracking: boolean;
  phase: "idle" | "waiting_for_start" | "tracking" | "complete";
  teams: {
    left: {
      name: string;
      teamNum: number;
    };
    right: {
      name: string;
      teamNum: number;
    };
  };
  winsRequired: number;
  winner: Side | null;
};

type ScoreboardSettings = {
  theme: ThemeId;
  showClock: boolean;
  showBoWhenTracking: boolean;
  uppercaseNames: boolean;
};

const BO_STATE_EVENT = "plugin.com.bakingrl.bo-tracker.state";
const BO_STATE_KEY = "plugin.com.bakingrl.bo-tracker.state";

const THEME_CLASS_BY_APP_THEME: Record<string, ThemeId> = {
  "modern-dark": "modern-dark",
  "neon-cyber": "neon-cyber",
  "industrial-bakery": "industrial-bakery",
  "pro-streamer": "pro-streamer",
  "hacker-terminal": "hacker-terminal"
};

function readSettings(settings: Record<string, unknown>): ScoreboardSettings {
  const theme = typeof settings.theme === "string" ? settings.theme : "app";
  return {
    theme: isTheme(theme) ? theme : "app",
    showClock: settings.showClock !== false,
    showBoWhenTracking: settings.showBoWhenTracking !== false,
    uppercaseNames: settings.uppercaseNames === true
  };
}

function isTheme(value: string): value is ThemeId {
  return (
    value === "app" ||
    value === "modern-dark" ||
    value === "neon-cyber" ||
    value === "industrial-bakery" ||
    value === "pro-streamer" ||
    value === "hacker-terminal" ||
    value === "broadcast-clean"
  );
}

function appTheme(): ThemeId {
  const theme = document.documentElement.dataset.theme ?? "modern-dark";
  return THEME_CLASS_BY_APP_THEME[theme] ?? "modern-dark";
}

function displayTheme(theme: ThemeId) {
  return theme === "app" ? appTheme() : theme;
}

function formatTeamName(name: string, uppercase: boolean) {
  const trimmed = name.trim() || "Team";
  return uppercase ? trimmed.toUpperCase() : trimmed;
}

function formatClock(data: RlUpdateStatePayload | null) {
  const game = data?.Game;
  if (!game) return "--:--";
  if (game.bOvertime) return "OT";
  const seconds = Math.max(0, Math.ceil(game.TimeSeconds ?? 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function teamByNum(data: RlUpdateStatePayload | null, teamNum: number): RlTeam | null {
  return data?.Game?.Teams?.find((team) => team.TeamNum === teamNum) ?? null;
}

function defaultTeam(data: RlUpdateStatePayload | null, teamNum: number, fallbackName: string): RlTeam {
  return (
    teamByNum(data, teamNum) ?? {
      TeamNum: teamNum,
      Name: fallbackName,
      Score: 0,
      ColorPrimary: "",
      ColorSecondary: ""
    }
  );
}

function isBoState(value: unknown): value is BoTrackerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<BoTrackerState>;
  return (
    typeof candidate.tracking === "boolean" &&
    typeof candidate.bestOf === "number" &&
    typeof candidate.leftWins === "number" &&
    typeof candidate.rightWins === "number" &&
    typeof candidate.teams?.left?.teamNum === "number" &&
    typeof candidate.teams?.right?.teamNum === "number"
  );
}

function pipClass(index: number, wins: number) {
  return index < wins ? "bo-pip filled" : "bo-pip";
}

export default defineVisual({
  async mount(context: VisualContext) {
    const settings = readSettings(context.settings);
    let latestUpdate: RlUpdateStatePayload | null = null;
    let boState: BoTrackerState | null = null;

    context.root.innerHTML = `
      <style>
        .brl-scoreboard {
          --sb-bg: rgba(9, 12, 18, 0.84);
          --sb-panel: rgba(255, 255, 255, 0.08);
          --sb-border: rgba(255, 255, 255, 0.18);
          --sb-text: #f8fafc;
          --sb-muted: rgba(226, 232, 240, 0.68);
          --sb-accent: #3b82f6;
          --sb-blue: #3b82f6;
          --sb-orange: #f97316;
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          align-items: stretch;
          overflow: hidden;
          border: 1px solid var(--sb-border);
          border-radius: 8px;
          background: var(--sb-bg);
          color: var(--sb-text);
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .brl-scoreboard.theme-neon-cyber {
          --sb-bg: rgba(5, 5, 8, 0.9);
          --sb-panel: rgba(0, 229, 255, 0.08);
          --sb-border: rgba(0, 229, 255, 0.42);
          --sb-text: #eaffff;
          --sb-muted: rgba(0, 229, 255, 0.72);
          --sb-accent: #ff6b00;
          --sb-blue: #00e5ff;
          --sb-orange: #ff6b00;
        }
        .brl-scoreboard.theme-industrial-bakery {
          --sb-bg: rgba(25, 25, 25, 0.9);
          --sb-panel: rgba(217, 92, 20, 0.12);
          --sb-border: rgba(224, 224, 224, 0.22);
          --sb-text: #f0f0f0;
          --sb-muted: rgba(224, 224, 224, 0.64);
          --sb-accent: #d95c14;
          --sb-blue: #5aa3d8;
          --sb-orange: #d95c14;
        }
        .brl-scoreboard.theme-pro-streamer {
          --sb-bg: rgba(13, 8, 20, 0.9);
          --sb-panel: rgba(255, 0, 127, 0.12);
          --sb-border: rgba(255, 0, 127, 0.38);
          --sb-text: #ffffff;
          --sb-muted: rgba(255, 255, 255, 0.68);
          --sb-accent: #ff007f;
          --sb-blue: #8b5cf6;
          --sb-orange: #ff007f;
        }
        .brl-scoreboard.theme-hacker-terminal {
          --sb-bg: rgba(2, 10, 5, 0.92);
          --sb-panel: rgba(0, 255, 102, 0.08);
          --sb-border: rgba(0, 255, 102, 0.34);
          --sb-text: #00ff66;
          --sb-muted: rgba(0, 255, 102, 0.64);
          --sb-accent: #00ff66;
          --sb-blue: #00b8ff;
          --sb-orange: #00ff66;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        }
        .brl-scoreboard.theme-broadcast-clean {
          --sb-bg: rgba(247, 249, 252, 0.94);
          --sb-panel: rgba(15, 23, 42, 0.06);
          --sb-border: rgba(15, 23, 42, 0.16);
          --sb-text: #101827;
          --sb-muted: rgba(15, 23, 42, 0.62);
          --sb-accent: #2563eb;
          --sb-blue: #2563eb;
          --sb-orange: #ea580c;
          box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
        }
        .team {
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(64px, 0.34fr);
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--sb-panel);
        }
        .team.right {
          grid-template-columns: minmax(64px, 0.34fr) minmax(0, 1fr);
          text-align: right;
        }
        .team.left { border-left: 5px solid var(--sb-blue); }
        .team.right { border-right: 5px solid var(--sb-orange); }
        .team-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 21px;
          font-weight: 800;
          letter-spacing: 0;
        }
        .score {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 64px;
          height: 64px;
          border-radius: 7px;
          background: rgba(0, 0, 0, 0.26);
          color: var(--sb-text);
          font-size: 42px;
          font-weight: 900;
          line-height: 1;
        }
        .theme-broadcast-clean .score {
          background: rgba(15, 23, 42, 0.08);
        }
        .center {
          min-width: 156px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 16px;
          border-left: 1px solid var(--sb-border);
          border-right: 1px solid var(--sb-border);
        }
        .clock {
          min-width: 74px;
          padding: 5px 10px;
          border: 1px solid var(--sb-border);
          border-radius: 999px;
          color: var(--sb-text);
          font-size: 17px;
          font-weight: 800;
          text-align: center;
        }
        .bo {
          display: none;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 116px;
        }
        .bo.active {
          display: flex;
        }
        .bo-label {
          color: var(--sb-muted);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .bo-score {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 900;
        }
        .bo-pips {
          display: flex;
          gap: 4px;
        }
        .bo-pip {
          width: 8px;
          height: 8px;
          border: 1px solid var(--sb-border);
          border-radius: 999px;
          background: transparent;
        }
        .bo-pip.filled {
          border-color: var(--sb-accent);
          background: var(--sb-accent);
        }
        .placeholder {
          color: var(--sb-muted);
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
        }
      </style>
      <div class="brl-scoreboard">
        <div class="team left">
          <span class="team-name left-name">Blue</span>
          <span class="score left-score">0</span>
        </div>
        <div class="center">
          <div class="clock">--:--</div>
          <div class="bo">
            <span class="bo-label">BO</span>
            <span class="bo-score"><span class="bo-left">0</span><span>-</span><span class="bo-right">0</span></span>
            <div class="bo-pips"></div>
          </div>
          <div class="placeholder">Waiting</div>
        </div>
        <div class="team right">
          <span class="score right-score">0</span>
          <span class="team-name right-name">Orange</span>
        </div>
      </div>
    `;

    const root = context.root.querySelector<HTMLElement>(".brl-scoreboard");
    const leftName = context.root.querySelector<HTMLElement>(".left-name");
    const rightName = context.root.querySelector<HTMLElement>(".right-name");
    const leftScore = context.root.querySelector<HTMLElement>(".left-score");
    const rightScore = context.root.querySelector<HTMLElement>(".right-score");
    const clock = context.root.querySelector<HTMLElement>(".clock");
    const bo = context.root.querySelector<HTMLElement>(".bo");
    const boLabel = context.root.querySelector<HTMLElement>(".bo-label");
    const boLeft = context.root.querySelector<HTMLElement>(".bo-left");
    const boRight = context.root.querySelector<HTMLElement>(".bo-right");
    const boPips = context.root.querySelector<HTMLElement>(".bo-pips");
    const placeholder = context.root.querySelector<HTMLElement>(".placeholder");

    function render() {
      if (!root || !leftName || !rightName || !leftScore || !rightScore || !clock || !bo || !boLabel || !boLeft || !boRight || !boPips || !placeholder) {
        return;
      }

      root.className = `brl-scoreboard theme-${displayTheme(settings.theme)}`;
      const activeBoState = settings.showBoWhenTracking && boState?.tracking === true ? boState : null;
      const leftTeam = activeBoState
        ? defaultTeam(latestUpdate, activeBoState.teams.left.teamNum, activeBoState.teams.left.name)
        : defaultTeam(latestUpdate, 0, "Blue");
      const rightTeam = activeBoState
        ? defaultTeam(latestUpdate, activeBoState.teams.right.teamNum, activeBoState.teams.right.name)
        : defaultTeam(latestUpdate, 1, "Orange");

      leftName.textContent = formatTeamName(activeBoState ? activeBoState.teams.left.name : leftTeam.Name, settings.uppercaseNames);
      rightName.textContent = formatTeamName(activeBoState ? activeBoState.teams.right.name : rightTeam.Name, settings.uppercaseNames);
      leftScore.textContent = String(leftTeam.Score ?? 0);
      rightScore.textContent = String(rightTeam.Score ?? 0);
      clock.textContent = settings.showClock ? formatClock(latestUpdate) : "";
      clock.style.display = settings.showClock ? "block" : "none";
      placeholder.style.display = latestUpdate ? "none" : "block";

      bo.classList.toggle("active", activeBoState !== null);
      if (activeBoState) {
        const required = Math.max(1, activeBoState.winsRequired || Math.floor(activeBoState.bestOf / 2) + 1);
        boLabel.textContent = `BO${activeBoState.bestOf}`;
        boLeft.textContent = String(activeBoState.leftWins);
        boRight.textContent = String(activeBoState.rightWins);
        boPips.innerHTML = `
          ${Array.from({ length: required }, (_, index) => `<span class="${pipClass(index, activeBoState.leftWins)}"></span>`).join("")}
          <span style="width:6px"></span>
          ${Array.from({ length: required }, (_, index) => `<span class="${pipClass(index, activeBoState.rightWins)}"></span>`).join("")}
        `;
      }
    }

    const cleanups = [
      context.bus.subscribe("UpdateState", (event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) => {
        latestUpdate = event.Data;
        render();
      }),
      context.bus.subscribe(BO_STATE_EVENT, (event) => {
        if (isBoState(event.Data)) {
          boState = event.Data;
          render();
        }
      })
    ];

    try {
      const registryState = await context.registry.get(BO_STATE_KEY);
      if (isBoState(registryState)) {
        boState = registryState;
      }
    } catch (error) {
      context.diagnostics.warn("Unable to read BO Tracker registry state.", error);
    }

    render();

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }
});
