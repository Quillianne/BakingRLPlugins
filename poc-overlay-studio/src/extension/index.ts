import {
  RL_TELEMETRY_FRAME_TEMPLATES,
  defineExtension,
  isBakingRLEvent,
  type BakingRLEvent,
  type ExtensionContext,
  type ExtensionSubscription,
  type ResourceDescriptor,
  type ResourceFilter,
  type RlUpdateStatePayload
} from "@bakingrl/plugin-sdk";

const SERVICE_ID = "overlayStudio";
const TARGET = "bakingrl.poc-overlay-studio/overlay-studio.visual";
const DEFAULT_VIEWPORT = {
  width: 1040,
  height: 720
};
const TEXT_RESOURCE_TYPES = new Set(["application/javascript", "image/svg+xml", "text/css", "text/html"]);

type UpdateStateFrame = BakingRLEvent<RlUpdateStatePayload, "UpdateState">;

type ExtensionDiscoveryApi = {
  contributions?(target?: string): Promise<unknown[]>;
  points?(filter?: unknown): Promise<unknown[]>;
};

type PluginDiscoveryApi = {
  list?(): Promise<unknown[]>;
};

type ResourceApi = {
  list(filter?: ResourceFilter): Promise<ResourceDescriptor[]>;
  readText(ref: string, path?: string): Promise<string>;
  readJson<TValue = unknown>(ref: string, path?: string): Promise<TValue>;
};

type ExtensionContext21 = ExtensionContext & {
  extensions?: ExtensionDiscoveryApi;
  plugins?: PluginDiscoveryApi;
  resources?: unknown;
};

type OverlayVisualContribution = {
  id?: string;
  packageId?: string;
  reference?: string;
  target?: string;
  kind?: string;
  title?: string;
  description?: string;
  service?: string;
  resources?: string[];
  metadata?: Record<string, unknown>;
};

type ResolvedVisualResource = {
  id: string;
  packageId: string;
  reference: string;
  type: string;
  role: unknown;
  json?: unknown;
  text?: Array<{
    path: string;
    length: number;
    preview: string;
  }>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeContribution(value: unknown): OverlayVisualContribution | null {
  if (!isRecord(value)) return null;
  return {
    ...value,
    id: typeof value.id === "string" ? value.id : undefined,
    packageId: typeof value.packageId === "string" ? value.packageId : undefined,
    reference: typeof value.reference === "string" ? value.reference : undefined,
    target: typeof value.target === "string" ? value.target : undefined,
    kind: typeof value.kind === "string" ? value.kind : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    service: typeof value.service === "string" ? value.service : undefined,
    resources: Array.isArray(value.resources) ? value.resources.filter((item): item is string => typeof item === "string") : [],
    metadata: asRecord(value.metadata)
  };
}

function resourceId(resource: ResourceDescriptor) {
  if (typeof resource.id === "string" && resource.id) return resource.id;
  if (typeof resource.reference === "string") return resource.reference.split("/").pop() ?? resource.reference;
  return "";
}

function resourceReference(resource: ResourceDescriptor) {
  const id = resourceId(resource);
  if (typeof resource.reference === "string" && resource.reference) return resource.reference;
  if (resource.packageId && id) return `${resource.packageId}/${id}`;
  return "";
}

function resourcePaths(resource: ResourceDescriptor) {
  if (Array.isArray(resource.paths) && resource.paths.length > 0) {
    return resource.paths.filter((item): item is string => typeof item === "string");
  }
  return typeof resource.path === "string" ? [resource.path] : [];
}

function uniqueResources(resources: ResourceDescriptor[]) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const reference = resourceReference(resource);
    if (!reference || seen.has(reference)) return false;
    seen.add(reference);
    return true;
  });
}

function getResources(context: ExtensionContext21): ResourceApi | null {
  const resources = context.resources as Partial<ResourceApi> | undefined;
  if (!resources?.list || !resources.readText || !resources.readJson) return null;
  return resources as ResourceApi;
}

async function listContributionResources(resources: ResourceApi, contribution: OverlayVisualContribution) {
  const packageId = contribution.packageId;
  const referencedResources = new Set(contribution.resources ?? []);
  if (!packageId || referencedResources.size === 0) return [];

  const publicResources = await resources.list({
    packageId,
    visibility: "public"
  });
  return uniqueResources(publicResources).filter(
    (resource) => resource.visibility !== "private" && resource.public !== false && referencedResources.has(resourceId(resource))
  );
}

async function resolveVisualResource(resources: ResourceApi, resource: ResourceDescriptor): Promise<ResolvedVisualResource | null> {
  const id = resourceId(resource);
  const reference = resourceReference(resource);
  const type = resource.type ?? "application/octet-stream";
  if (!id || !resource.packageId || !reference) return null;

  const resolved: ResolvedVisualResource = {
    id,
    packageId: resource.packageId,
    reference,
    type,
    role: resource.metadata?.role
  };

  if (type === "application/json") {
    resolved.json = await resources.readJson(reference);
  } else if (TEXT_RESOURCE_TYPES.has(type)) {
    resolved.text = [];
    for (const path of resourcePaths(resource)) {
      const contents = await resources.readText(reference, path);
      resolved.text.push({
        path,
        length: contents.length,
        preview: contents.slice(0, 160)
      });
    }
  }

  return resolved;
}

async function resolveContributionResources(resources: ResourceApi, contribution: OverlayVisualContribution) {
  const descriptors = await listContributionResources(resources, contribution);
  const resolved = [];
  for (const descriptor of descriptors) {
    const resource = await resolveVisualResource(resources, descriptor);
    if (resource) resolved.push(resource);
  }
  return resolved;
}

function viewportFromInput(input: unknown) {
  const value = asRecord(input);
  return {
    width: Math.max(320, finiteNumber(value.width, DEFAULT_VIEWPORT.width)),
    height: Math.max(180, finiteNumber(value.height, DEFAULT_VIEWPORT.height))
  };
}

function defaultSize(metadata: Record<string, unknown>) {
  const size = Array.isArray(metadata.defaultSize) ? metadata.defaultSize : [];
  return {
    width: Math.max(120, finiteNumber(size[0], 380)),
    height: Math.max(80, finiteNumber(size[1], 160))
  };
}

function frameForPlacement(metadata: Record<string, unknown>, viewport: { width: number; height: number }, index: number) {
  const size = defaultSize(metadata);
  const margin = 24;
  const stagger = index * 16;
  const placement = typeof metadata.placement === "string" ? metadata.placement : "bottom-right";

  if (placement === "bottom-left") {
    return {
      x: margin + stagger,
      y: Math.max(margin, viewport.height - size.height - margin - stagger),
      ...size
    };
  }
  if (placement === "top-left") {
    return {
      x: margin + stagger,
      y: margin + stagger,
      ...size
    };
  }
  if (placement === "top-right") {
    return {
      x: Math.max(margin, viewport.width - size.width - margin - stagger),
      y: margin + stagger,
      ...size
    };
  }

  return {
    x: Math.max(margin, viewport.width - size.width - margin - stagger),
    y: Math.max(margin, viewport.height - size.height - margin - stagger),
    ...size
  };
}

function rendererMetadata(metadata: Record<string, unknown>) {
  const renderer = asRecord(metadata.renderer);
  return {
    kind: typeof renderer.kind === "string" ? renderer.kind : null,
    resource: typeof renderer.resource === "string" ? renderer.resource : null,
    moduleFormat: typeof renderer.moduleFormat === "string" ? renderer.moduleFormat : null,
    export: typeof renderer.export === "string" ? renderer.export : null
  };
}

function widgetPreset(resources: ResolvedVisualResource[]) {
  const presetResource = resources.find((resource) => resource.id === "widgetPreset" || resource.role === "widget-preset");
  return asRecord(presetResource?.json);
}

function buildWidgetState(
  contribution: OverlayVisualContribution,
  resources: ResolvedVisualResource[],
  score: ReturnType<typeof summarizeScore>,
  viewport: { width: number; height: number },
  index: number
) {
  const metadata = asRecord(contribution.metadata);
  const renderer = rendererMetadata(metadata);
  const rendererResource = renderer.resource ? resources.find((resource) => resource.id === renderer.resource) : undefined;
  const preset = widgetPreset(resources);
  const title =
    contribution.title ??
    (typeof preset.defaultLabel === "string" ? preset.defaultLabel : undefined) ??
    contribution.id ??
    contribution.reference ??
    `Visual ${index + 1}`;
  const serviceRef = contribution.packageId && contribution.service ? `${contribution.packageId}/${contribution.service}` : null;
  const frame = frameForPlacement(metadata, viewport, index);
  const [blue, orange] = score.teams;

  return {
    id: contribution.id ?? contribution.reference ?? `visual-${index + 1}`,
    packageId: contribution.packageId ?? null,
    reference: contribution.reference ?? null,
    target: contribution.target ?? TARGET,
    kind: contribution.kind ?? "widget",
    title,
    description: contribution.description ?? null,
    serviceRef,
    placement: typeof metadata.placement === "string" ? metadata.placement : "bottom-right",
    frame,
    visible: Boolean(rendererResource),
    contentTarget: typeof metadata.contentTarget === "string" ? metadata.contentTarget : null,
    renderer: {
      ...renderer,
      resourceRef: rendererResource?.reference ?? null,
      available: Boolean(rendererResource)
    },
    preset: Object.keys(preset).length > 0 ? preset : null,
    resources: resources.map((resource) => ({
      id: resource.id,
      reference: resource.reference,
      type: resource.type,
      role: resource.role,
      hasJson: resource.json !== undefined,
      text: resource.text ?? []
    })),
    preview: {
      label: title,
      score: `${blue?.score ?? 0}-${orange?.score ?? 0}`,
      message: rendererResource ? "Renderer resource ready" : "Renderer resource missing"
    }
  };
}

async function discoverContributions(context: ExtensionContext21) {
  try {
    const contributions = await context.extensions?.contributions?.(TARGET);
    const normalizedContributions = Array.isArray(contributions)
      ? contributions.map(normalizeContribution).filter((contribution): contribution is OverlayVisualContribution => Boolean(contribution))
      : [];
    return {
      available: Boolean(context.extensions?.contributions),
      target: TARGET,
      contributions: normalizedContributions
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

async function buildRenderState(context: ExtensionContext21, input: unknown) {
  const discovery = await discoverContributions(context);
  const score = summarizeScore(latestSnapshot);
  const viewport = viewportFromInput(input);
  const resources = getResources(context);
  const widgets = [];
  let resourceState: { available: boolean; error?: string } = {
    available: Boolean(resources)
  };

  if (resources) {
    try {
      for (const [index, contribution] of discovery.contributions.entries()) {
        const resolvedResources = await resolveContributionResources(resources, contribution);
        widgets.push(buildWidgetState(contribution, resolvedResources, score, viewport, index));
      }
    } catch (error) {
      context.diagnostics.warn("POC Overlay Studio visual resource resolution failed.", error);
      resourceState = {
        available: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return {
    source: snapshotSource,
    score,
    viewport,
    plugins: await discoverPlugins(context),
    discovery,
    resources: resourceState,
    widgets,
    visibleWidgets: widgets.filter((widget) => widget.visible).length,
    emptyReason: widgets.length > 0 ? null : "no-active-visual-contributions"
  };
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

    const hostSnapshot = await context.telemetryHub.snapshot<"UpdateState">();
    if (isBakingRLEvent(hostSnapshot, "UpdateState")) {
      latestSnapshot = hostSnapshot;
      snapshotSource = "telemetry";
    }

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
      async renderState(input) {
        return buildRenderState(context21, input);
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
