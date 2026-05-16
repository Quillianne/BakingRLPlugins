import {
  defineVisual,
  type BakingRLEvent,
  type RlPlayer,
  type RlPlayerRef,
  type RlTeam,
  type RlUpdateStatePayload,
  type VisualContext
} from "@bakingrl/plugin-sdk";
import { editorUpdateState, isEditorMode } from "../editorPreviewData";
import { fitVisualScale } from "../fitVisualScale";
import templateHtml from "./template.html?raw";
import styleCss from "./style.css?raw";

type Side = "left" | "right";

type PlayerBoostSettings = {
  playerName: string;
  side: Side;
  showName: boolean;
};

type PlayerBoostInstance = {
  root: HTMLElement;
  settings: PlayerBoostSettings;
  latestUpdate: RlUpdateStatePayload | null;
};

const instances = new Map<HTMLElement, PlayerBoostInstance>();

function readSettings(settings: Record<string, unknown>): PlayerBoostSettings {
  return {
    playerName: typeof settings.playerName === "string" ? settings.playerName.trim() : "",
    side: settings.side === "left" ? "left" : "right",
    showName: settings.showName !== false
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

function boostValue(player: RlPlayer | null) {
  if (!player || typeof player.Boost !== "number" || !Number.isFinite(player.Boost)) return null;
  return Math.min(100, Math.max(0, Math.round(player.Boost)));
}

function selectPlayer(data: RlUpdateStatePayload | null, settings: PlayerBoostSettings) {
  if (!data) return null;
  const players = data.Players ?? [];
  if (settings.playerName) {
    const wanted = settings.playerName.toLowerCase();
    return players.find((player) => player.Name.trim().toLowerCase() === wanted) ?? null;
  }
  const target = data.Game?.bHasTarget ? data.Game.Target : undefined;
  if (!target) return null;
  return players.find((player) => samePlayer(player, target)) ?? null;
}

function renderVisual(data: RlUpdateStatePayload | null, settings: PlayerBoostSettings) {
  const player = selectPlayer(data, settings);
  const teamNum = player?.TeamNum ?? 0;
  const color = safeColor(teamByNum(data, teamNum)?.ColorPrimary, fallbackTeamColor(teamNum));
  const boost = boostValue(player);
  const boostPercent = boost === null ? 0 : boost;

  return `<style>${styleCss}</style>${fillTemplate(templateHtml, {
    side: escapeHtml(settings.side),
    stateClass: boost === null ? "missing" : "",
    teamColor: color,
    teamContrast: contrastColor(color),
    boostPercent: String(boostPercent),
    boostValue: boost === null ? "--" : String(boost),
    playerName: escapeHtml(player?.Name || settings.playerName || "PLAYER"),
    nameState: settings.showName ? "" : "hidden"
  })}`;
}

function renderInstance(instance: PlayerBoostInstance) {
  instance.root.innerHTML = renderVisual(instance.latestUpdate, instance.settings);
}

export default defineVisual({
  async mount(context: VisualContext) {
    const cleanupScale = fitVisualScale(context.root, 220, 120);
    const instance: PlayerBoostInstance = {
      root: context.root,
      settings: readSettings(context.settings),
      latestUpdate: isEditorMode(context) ? editorUpdateState() : null
    };
    instances.set(context.root, instance);

    renderInstance(instance);

    const cleanup = context.bus.subscribe("UpdateState", (event: BakingRLEvent<RlUpdateStatePayload, "UpdateState">) => {
      instance.latestUpdate = event.Data;
      renderInstance(instance);
    });

    return () => {
      instances.delete(context.root);
      cleanupScale();
      cleanup();
    };
  },
  update(context: VisualContext) {
    const instance = instances.get(context.root);
    if (!instance) return;
    instance.settings = readSettings(context.settings);
    renderInstance(instance);
  }
});
