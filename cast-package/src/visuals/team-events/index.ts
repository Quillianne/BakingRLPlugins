import {
  defineVisual,
  type BakingRLEvent,
  type RlGoalScoredPayload,
  type RlPlayer,
  type RlPlayerRef,
  type RlStatfeedEventPayload,
  type RlTeam,
  type RlUpdateStatePayload,
  type VisualContext
} from "@bakingrl/plugin-sdk";
import { editorUpdateState, isEditorMode } from "../editorPreviewData";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type Side = "left" | "right";
type EventKind = "save" | "shot" | "goal" | "assist" | "demo" | "demoed";

type TeamEventsSettings = {
  teamNum: number;
  side: Side;
  maxPlayers: number;
  showBoost: boolean;
  eventDurationMs: number;
};

type RecentEvent = {
  kind: EventKind;
  label: string;
  atMs: number;
  preview?: boolean;
};

type TeamEventsInstance = {
  updateSettings(settings: Record<string, unknown>): void;
};

const EVENT_LABELS: Record<EventKind, string> = {
  save: "SAVE",
  shot: "SHOT",
  goal: "GOAL",
  assist: "AST",
  demo: "DEMO",
  demoed: "DEMOED"
};

const instances = new Map<HTMLElement, TeamEventsInstance>();

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readSettings(settings: Record<string, unknown>): TeamEventsSettings {
  const side = settings.side === "right" ? "right" : "left";
  return {
    teamNum: clampInt(settings.teamNum, 0, 0, 1),
    side,
    maxPlayers: clampInt(settings.maxPlayers, 4, 1, 8),
    showBoost: settings.showBoost !== false,
    eventDurationMs: clampInt(settings.eventDurationMs, 2600, 500, 8000)
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function normalName(player: RlPlayerRef) {
  return player.Name.trim().toLowerCase();
}

function playerKeys(player: RlPlayerRef | null | undefined) {
  if (!player) return [];
  const keys = [`name:${player.TeamNum}:${normalName(player)}`];
  if (typeof player.Shortcut === "number") {
    keys.unshift(`shortcut:${player.TeamNum}:${player.Shortcut}`);
  }
  return keys;
}

function samePlayer(left: RlPlayerRef | null | undefined, right: RlPlayerRef | null | undefined) {
  if (!left || !right || left.TeamNum !== right.TeamNum) return false;
  if (typeof left.Shortcut === "number" && typeof right.Shortcut === "number") {
    return left.Shortcut === right.Shortcut;
  }
  return normalName(left) === normalName(right);
}

function safeColor(value: string | undefined, fallback: string) {
  const trimmed = (value ?? "").trim();
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
  return fallback;
}

function fallbackTeamColor(teamNum: number) {
  return teamNum === 0 ? "#47a3ff" : "#ff9a38";
}

function contrastColor(hexColor: string) {
  const hex = hexColor.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness > 150 ? "#101827" : "#ffffff";
}

function teamByNum(data: RlUpdateStatePayload | null, teamNum: number): RlTeam | null {
  return data?.Game?.Teams?.find((team) => team.TeamNum === teamNum) ?? null;
}

function teamColor(data: RlUpdateStatePayload | null, teamNum: number) {
  return safeColor(teamByNum(data, teamNum)?.ColorPrimary, fallbackTeamColor(teamNum));
}

function boostValue(player: RlPlayer) {
  if (typeof player.Boost !== "number" || !Number.isFinite(player.Boost)) return null;
  return Math.min(100, Math.max(0, Math.round(player.Boost)));
}

function renderBoostLine(player: RlPlayer, showBoost: boolean) {
  if (!showBoost) return "";
  const boost = boostValue(player);
  if (boost === null) {
    return `<div class="boost-line missing"><div class="boost-fill" style="--boost: 0%"></div></div>`;
  }
  return `<div class="boost-line"><div class="boost-fill" style="--boost: ${boost}%"></div></div>`;
}

function renderEvent(event: RecentEvent | undefined) {
  if (!event) return "";
  return `<span class="event-marker ${event.kind}">${event.label}</span>`;
}

function sortPlayers(left: RlPlayer, right: RlPlayer) {
  if (typeof left.Shortcut === "number" && typeof right.Shortcut === "number") {
    return left.Shortcut - right.Shortcut;
  }
  return left.Name.localeCompare(right.Name);
}

function renderPlayer(
  player: RlPlayer,
  target: RlPlayerRef | undefined,
  event: RecentEvent | undefined,
  settings: TeamEventsSettings
) {
  const classes = ["player-row"];
  if (samePlayer(player, target)) classes.push("target");
  return `
    <div class="player-entry">
      <div class="${classes.join(" ")}">
        <div class="player-info">
          <div class="player-name">${escapeHtml(player.Name || "Player")}</div>
          ${renderBoostLine(player, settings.showBoost)}
        </div>
      </div>
      <div class="event-slot">${renderEvent(event)}</div>
    </div>
  `;
}

function recentEventFor(player: RlPlayer, recentEvents: Map<string, RecentEvent>, durationMs: number) {
  const now = Date.now();
  for (const key of playerKeys(player)) {
    const event = recentEvents.get(key);
    if (!event) continue;
    if (event.preview) return event;
    if (now - event.atMs <= durationMs) return event;
    recentEvents.delete(key);
  }
  return undefined;
}

function renderVisual(
  data: RlUpdateStatePayload | null,
  settings: TeamEventsSettings,
  recentEvents: Map<string, RecentEvent>
) {
  const color = teamColor(data, settings.teamNum);
  const players =
    (data?.Players ?? [])
      .filter((player) => player.TeamNum === settings.teamNum)
      .sort(sortPlayers)
      .slice(0, settings.maxPlayers);

  const playerRows = players.length
    ? players
        .map((player) =>
          renderPlayer(
            player,
            data?.Game?.bHasTarget ? data.Game.Target : undefined,
            recentEventFor(player, recentEvents, settings.eventDurationMs),
            settings
          )
        )
        .join("")
    : `<div class="empty"></div>`;

  return `<style>${styleCss}</style>${fillTemplate(templateHtml, {
    side: escapeHtml(settings.side),
    teamColor: color,
    teamContrast: contrastColor(color),
    players: playerRows
  })}`;
}

function classifyStatfeed(event: RlStatfeedEventPayload): Array<{ player: RlPlayerRef; kind: EventKind }> {
  const value = `${event.EventName} ${event.Type}`.toLowerCase();
  if (value.includes("demo") || value.includes("demolish")) {
    const events: Array<{ player: RlPlayerRef; kind: EventKind }> = [{ player: event.MainTarget, kind: "demo" }];
    if (event.SecondaryTarget) events.push({ player: event.SecondaryTarget, kind: "demoed" });
    return events;
  }
  if (value.includes("save")) return [{ player: event.MainTarget, kind: "save" }];
  if (value.includes("shot")) return [{ player: event.MainTarget, kind: "shot" }];
  if (value.includes("assist")) return [{ player: event.MainTarget, kind: "assist" }];
  if (value.includes("goal")) return [{ player: event.MainTarget, kind: "goal" }];
  return [];
}

export default defineVisual({
  async mount(context: VisualContext) {
    const editorMode = isEditorMode(context);
    let latestUpdate: RlUpdateStatePayload | null = null;
    let settings = readSettings(context.settings);
    const recentEvents = new Map<string, RecentEvent>();
    const demolishedState = new Map<string, boolean>();
    let clearTimer: number | null = null;

    function render() {
      context.root.innerHTML = renderVisual(latestUpdate, settings, recentEvents);
    }

    function markEvent(player: RlPlayerRef | null | undefined, kind: EventKind, preview = false) {
      const event = { kind, label: EVENT_LABELS[kind], atMs: Date.now(), preview };
      for (const key of playerKeys(player)) recentEvents.set(key, event);
    }

    function clearPreviewEvents() {
      for (const [key, event] of recentEvents.entries()) {
        if (event.preview) recentEvents.delete(key);
      }
    }

    function seedEditorPreview() {
      if (!editorMode) return;
      latestUpdate = editorUpdateState();
      clearPreviewEvents();
      const previewPlayer =
        latestUpdate.Players.find((player) => player.TeamNum === settings.teamNum && player.Goals && player.Goals > 0) ??
        latestUpdate.Players.find((player) => player.TeamNum === settings.teamNum);
      markEvent(previewPlayer, settings.teamNum === 0 ? "goal" : "save", true);
    }

    function markDemolitionsFromUpdate(data: RlUpdateStatePayload) {
      let marked = false;
      for (const player of data.Players ?? []) {
        const [key] = playerKeys(player);
        if (!key) continue;
        const isDemolished = player.bDemolished === true;
        const wasDemolished = demolishedState.get(key) === true;
        if (isDemolished && !wasDemolished) {
          markEvent(player, "demoed");
          markEvent(player.Attacker, "demo");
          marked = true;
        }
        demolishedState.set(key, isDemolished);
      }
      return marked;
    }

    function scheduleEventClear() {
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => {
        render();
        clearTimer = null;
      }, settings.eventDurationMs + 50);
    }

    seedEditorPreview();

    render();
    instances.set(context.root, {
      updateSettings(nextSettings) {
        settings = readSettings(nextSettings);
        seedEditorPreview();
        render();
        if (recentEvents.size) scheduleEventClear();
      }
    });

    const cleanups = [
      context.bus.subscribe("UpdateState", (event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) => {
        latestUpdate = event.Data;
        const hasNewDemolition = markDemolitionsFromUpdate(event.Data);
        render();
        if (hasNewDemolition) scheduleEventClear();
      }),
      context.bus.subscribe("StatfeedEvent", (event: BakingRLEvent<RlStatfeedEventPayload, "StatfeedEvent">) => {
        for (const item of classifyStatfeed(event.Data)) markEvent(item.player, item.kind);
        render();
        scheduleEventClear();
      }),
      context.bus.subscribe("GoalScored", (event: BakingRLEvent<RlGoalScoredPayload, "GoalScored">) => {
        markEvent(event.Data.Scorer, "goal");
        if (event.Data.Assister) markEvent(event.Data.Assister, "assist");
        render();
        scheduleEventClear();
      })
    ];

    return () => {
      instances.delete(context.root);
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      for (const cleanup of cleanups) cleanup();
    };
  },
  update(context: VisualContext) {
    instances.get(context.root)?.updateSettings(context.settings);
  }
});
