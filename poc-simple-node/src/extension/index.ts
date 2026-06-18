import {
  RL_TELEMETRY_FRAME_TEMPLATES,
  defineExtension,
  isBakingRLEvent,
  type BakingRLEvent,
  type ExtensionContext,
  type ExtensionSubscription,
  type RlUpdateStatePayload
} from "@bakingrl/plugin-sdk";

const SERVICE_ID = "pocSimpleNode";
const DEBUG_STATE_KEY = "poc-simple-node/debug";

type UpdateStateFrame = BakingRLEvent<RlUpdateStatePayload, "UpdateState">;

type DebugState = {
  activatedAtMs: number;
  updatedAtMs: number;
  label: string;
  snapshotSource: "mock" | "telemetry";
  pingCount: number;
  lastMatchGuid: string | null;
};

let registrations: ExtensionSubscription[] = [];
let latestSnapshot: UpdateStateFrame = cloneMockSnapshot();
let debugState: DebugState = createDebugState("Simple Node POC", "mock");

function cloneMockSnapshot(): UpdateStateFrame {
  return JSON.parse(JSON.stringify(RL_TELEMETRY_FRAME_TEMPLATES.UpdateState)) as UpdateStateFrame;
}

function nowMs() {
  return Date.now();
}

function createDebugState(label: string, snapshotSource: DebugState["snapshotSource"]): DebugState {
  const timestamp = nowMs();
  return {
    activatedAtMs: timestamp,
    updatedAtMs: timestamp,
    label,
    snapshotSource,
    pingCount: 0,
    lastMatchGuid: latestSnapshot.Data.MatchGuid ?? null
  };
}

function settings(context: ExtensionContext) {
  const values = context.settings?.all?.() ?? {};
  return values && typeof values === "object" && !Array.isArray(values) ? values : {};
}

function debugLabel(context: ExtensionContext) {
  const value = settings(context).debugLabel;
  return typeof value === "string" && value.trim() ? value.trim() : "Simple Node POC";
}

function shouldWriteDebugState(context: ExtensionContext) {
  return settings(context).writeDebugState !== false;
}

async function persistDebugState(context: ExtensionContext) {
  debugState = {
    ...debugState,
    updatedAtMs: nowMs(),
    lastMatchGuid: latestSnapshot.Data.MatchGuid ?? null
  };
  if (!shouldWriteDebugState(context)) return;
  await context.state.set(DEBUG_STATE_KEY, debugState).catch((error) => {
    context.diagnostics.warn("POC Simple Node could not write debug state.", error);
  });
}

async function disposeRegistrations(items: ExtensionSubscription[]) {
  for (const registration of items.reverse()) {
    await registration.dispose();
  }
}

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    await deactivate();

    latestSnapshot = cloneMockSnapshot();
    debugState = createDebugState(debugLabel(context), "mock");

    const hostSnapshot = await context.telemetryHub.snapshot<"UpdateState">();
    if (isBakingRLEvent(hostSnapshot, "UpdateState")) {
      latestSnapshot = hostSnapshot;
      debugState = {
        ...debugState,
        snapshotSource: "telemetry",
        lastMatchGuid: latestSnapshot.Data.MatchGuid ?? null
      };
    }

    const telemetryCleanup = context.telemetryHub.subscribe("UpdateState", async (event) => {
      latestSnapshot = event;
      debugState = {
        ...debugState,
        snapshotSource: "telemetry"
      };
      await persistDebugState(context);
    });

    const serviceRegistration = context.services.register(SERVICE_ID, {
      async ping(input) {
        debugState = {
          ...debugState,
          pingCount: debugState.pingCount + 1
        };
        await persistDebugState(context);
        return {
          ok: true,
          packageId: context.packageId,
          input,
          debugState
        };
      },
      async snapshot() {
        await persistDebugState(context);
        return {
          source: debugState.snapshotSource,
          frame: latestSnapshot
        };
      },
      async debugState() {
        await persistDebugState(context);
        return debugState;
      }
    });

    registrations = [
      {
        dispose: telemetryCleanup
      },
      serviceRegistration
    ];
    context.subscriptions.push(...registrations);
    await persistDebugState(context);
    context.logger.info("POC Simple Node activated.");
  },
  async deactivate() {
    const activeRegistrations = registrations;
    registrations = [];
    await disposeRegistrations(activeRegistrations);
  }
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;
export default extension;
