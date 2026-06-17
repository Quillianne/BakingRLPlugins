import {
  RL_TELEMETRY_FRAME_TEMPLATES,
  defineExtension,
  type BakingRLEvent,
  type ExtensionContext,
  type ExtensionSubscription,
  type RlUpdateStatePayload
} from "@bakingrl/plugin-sdk";

const SERVICE_ID = "overlayStudio";
const TARGET = "bakingrl.poc-overlay-studio/overlay-studio.visual";

type UpdateStateFrame = BakingRLEvent<RlUpdateStatePayload, "UpdateState">;

type ExtensionDiscoveryApi = {
  contributions?(target?: string): Promise<unknown[]>;
  points?(filter?: unknown): Promise<unknown[]>;
};

type PluginDiscoveryApi = {
  list?(): Promise<unknown[]>;
};

type ExtensionContext21 = ExtensionContext & {
  extensions?: ExtensionDiscoveryApi;
  plugins?: PluginDiscoveryApi;
};

let registrations: ExtensionSubscription[] = [];
let latestSnapshot: UpdateStateFrame = cloneMockSnapshot();
let snapshotSource: "mock" | "telemetry" = "mock";

function cloneMockSnapshot(): UpdateStateFrame {
  return JSON.parse(JSON.stringify(RL_TELEMETRY_FRAME_TEMPLATES.UpdateState)) as UpdateStateFrame;
}

function summarizeScore(frame: UpdateStateFrame) {
  const teams = frame.Data.Game.Teams;
  return {
    matchGuid: frame.Data.MatchGuid ?? null,
    arena: frame.Data.Game.Arena,
    timeSeconds: frame.Data.Game.TimeSeconds,
    teams: teams.map((team) => ({
      name: team.Name,
      score: team.Score,
      color: team.ColorPrimary
    }))
  };
}

async function discoverContributions(context: ExtensionContext21) {
  try {
    const contributions = await context.extensions?.contributions?.(TARGET);
    return {
      available: Boolean(context.extensions?.contributions),
      target: TARGET,
      contributions: Array.isArray(contributions) ? contributions : []
    };
  } catch (error) {
    context.diagnostics.warn("POC Overlay Studio contribution discovery failed.", error);
    return {
      available: true,
      target: TARGET,
      contributions: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function discoverPlugins(context: ExtensionContext21) {
  try {
    const plugins = await context.plugins?.list?.();
    return Array.isArray(plugins) ? plugins : [];
  } catch (error) {
    context.diagnostics.warn("POC Overlay Studio plugin discovery failed.", error);
    return [];
  }
}

async function disposeRegistrations(items: ExtensionSubscription[]) {
  for (const registration of items.reverse()) {
    await registration.dispose();
  }
}

async function deactivateExtension() {
  const activeRegistrations = registrations;
  registrations = [];
  await disposeRegistrations(activeRegistrations);
}

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    await deactivateExtension();
    const context21 = context as ExtensionContext21;

    latestSnapshot = cloneMockSnapshot();
    snapshotSource = "mock";

    const telemetryCleanup = context.telemetryHub.subscribe("UpdateState", (event) => {
      latestSnapshot = event;
      snapshotSource = "telemetry";
    });

    const serviceRegistration = context.services.register(SERVICE_ID, {
      async snapshot() {
        const discovery = await discoverContributions(context21);
        return {
          source: snapshotSource,
          score: summarizeScore(latestSnapshot),
          discovery
        };
      },
      async contributions() {
        return discoverContributions(context21);
      },
      async renderState() {
        return {
          source: snapshotSource,
          score: summarizeScore(latestSnapshot),
          plugins: await discoverPlugins(context21),
          discovery: await discoverContributions(context21)
        };
      }
    });

    registrations = [
      {
        dispose: telemetryCleanup
      },
      serviceRegistration
    ];
    context.subscriptions.push(...registrations);
    context.logger.info("POC Overlay Studio activated.");
  },
  deactivate: deactivateExtension
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;
export default extension;
