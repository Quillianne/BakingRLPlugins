import { defineService, type ServiceContext } from "@bakingrl/plugin-sdk";
import {
  REGIE_EVENT,
  REGIE_KEY,
  type RegieCommand,
  type RegieCue,
  type RegieState
} from "../../shared/events";

type TriggerInput = {
  cue?: unknown;
  payload?: unknown;
  durationMs?: unknown;
};

type ClearInput = {
  cue?: unknown;
};

const DEFAULT_DURATION_MS = 8000;
const MIN_DURATION_MS = 500;
const MAX_DURATION_MS = 60000;

let serviceContext: ServiceContext | null = null;
let active = new Map<string, RegieCommand>();
let timers = new Map<string, ReturnType<typeof setTimeout>>();

function nowMs() {
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeCue(value: unknown): RegieCue {
  if (value === "headToHead") return "headToHead";
  if (value === "teamDetail") return "teamDetail";
  if (value === "teamSummary") return "teamSummary";
  if (value === "cageStats") return "cageStats";
  return "statistics";
}

function normalizePayload(value: unknown) {
  return isRecord(value) ? value : {};
}

function normalizeDuration(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DURATION_MS;
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.trunc(value)));
}

function snapshot(): RegieState {
  return {
    version: 1,
    active: [...active.values()].map((command) => ({ ...command, payload: { ...command.payload } })),
    updatedAtMs: nowMs()
  };
}

function publish(command?: RegieCommand) {
  const context = serviceContext;
  const state = snapshot();
  if (!context) return state;
  context.registry.set(REGIE_KEY, state);
  if (command) context.bus.emit(REGIE_EVENT, command);
  return state;
}

function setTimer(callback: () => void, durationMs: number) {
  const scheduler = globalThis.setTimeout;
  return typeof scheduler === "function" ? scheduler(callback, durationMs) : null;
}

function unsetTimer(timer: ReturnType<typeof setTimeout>) {
  const clearer = globalThis.clearTimeout;
  if (typeof clearer === "function") clearer(timer);
}

function clearTimer(id: string) {
  const timer = timers.get(id);
  if (!timer) return;
  unsetTimer(timer);
  timers.delete(id);
}

function clearCue(cue?: RegieCue) {
  const ids = [...active.values()]
    .filter((command) => !cue || command.cue === cue)
    .map((command) => command.id);

  let lastCommand: RegieCommand | undefined;
  for (const id of ids) {
    const command = active.get(id);
    if (!command) continue;
    clearTimer(id);
    active.delete(id);
    lastCommand = {
      ...command,
      action: "clear",
      updatedAtMs: nowMs()
    };
    publish(lastCommand);
  }

  if (!lastCommand) {
    publish({
      version: 1,
      id: `clear-${nowMs()}`,
      action: "clear",
      cue,
      payload: {},
      durationMs: 0,
      updatedAtMs: nowMs()
    });
  }

  return snapshot();
}

function trigger(input: TriggerInput = {}) {
  const cue = normalizeCue(input.cue);
  clearCue(cue);

  const durationMs = normalizeDuration(input.durationMs);
  const command: RegieCommand = {
    version: 1,
    id: `${cue}-${nowMs()}`,
    action: "trigger",
    cue,
    payload: normalizePayload(input.payload),
    durationMs,
    updatedAtMs: nowMs()
  };

  active.set(command.id, command);
  clearTimer(command.id);
  const timer = setTimer(() => {
    active.delete(command.id);
    timers.delete(command.id);
    publish({ ...command, action: "clear", updatedAtMs: nowMs() });
  }, durationMs);
  if (timer) timers.set(command.id, timer);

  return publish(command);
}

export default defineService({
  mount(context: ServiceContext) {
    serviceContext = context;
    publish();
  },
  unmount() {
    for (const timer of timers.values()) unsetTimer(timer);
    timers.clear();
    active.clear();
    serviceContext = null;
  },
  methods: {
    async trigger(input) {
      return trigger((input ?? {}) as TriggerInput);
    },
    async clear(input) {
      const cue = isRecord(input) && (input as ClearInput).cue !== undefined ? normalizeCue((input as ClearInput).cue) : undefined;
      return clearCue(cue);
    },
    async snapshot() {
      return snapshot();
    }
  }
});
