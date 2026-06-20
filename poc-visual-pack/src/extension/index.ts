import {
  defineExtension,
  type ExtensionContext,
  type ExtensionSubscription,
  type ResourceDescriptor,
  type ResourceFilter
} from "@bakingrl/plugin-sdk";

const SERVICE_ID = "visualPack";
const CONTENT_TARGET = "bakingrl.poc-visual-pack/visual-pack.content";
const OVERLAY_TARGET = "bakingrl.poc-overlay-studio/overlay-studio.visual";
const CONTENT_RESOURCE_TYPES = ["application/json", "image/svg+xml"] as const;

type ExtensionDiscoveryApi = {
  contributions(target?: string): Promise<unknown[]>;
};

type ResourceApi = {
  list(filter?: ResourceFilter): Promise<ResourceDescriptor[]>;
  read?(ref: string, path?: string): Promise<unknown>;
  readText(ref: string, path?: string): Promise<string>;
  readJson(ref: string, path?: string): Promise<unknown>;
};

type ExtensionContext21 = ExtensionContext & {
  extensions?: ExtensionDiscoveryApi;
  resources?: unknown;
};

type ContentContribution = {
  id?: string;
  packageId?: string;
  reference?: string;
  target?: string;
  resources?: string[];
  metadata?: Record<string, unknown>;
};

type ResolvedContentResource = {
  id: string;
  packageId: string;
  reference: string;
  type: string;
  role: unknown;
  json?: unknown;
  text?: Array<{
    path: string;
    contents: string;
  }>;
};

let registrations: ExtensionSubscription[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requireExtensions(context: ExtensionContext21): ExtensionDiscoveryApi {
  if (!context.extensions?.contributions) {
    throw new Error("POC Visual Pack requires host extensions.contributions.");
  }
  return context.extensions;
}

function requireResources(context: ExtensionContext21): ResourceApi {
  const resources = context.resources as Partial<ResourceApi> | undefined;
  if (!resources?.list || !resources.readJson || !resources.readText) {
    throw new Error("POC Visual Pack requires host resources.list, resources.readJson, and resources.readText.");
  }
  return resources as ResourceApi;
}

function normalizeContribution(value: unknown): ContentContribution | null {
  if (!isRecord(value)) return null;
  return {
    ...value,
    packageId: typeof value.packageId === "string" ? value.packageId : undefined,
    reference: typeof value.reference === "string" ? value.reference : undefined,
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

function uniqueResources(resources: ResourceDescriptor[]) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const reference = resourceReference(resource);
    if (!reference || seen.has(reference)) return false;
    seen.add(reference);
    return true;
  });
}

function publicContentFilters(packageId: string): ResourceFilter[] {
  return CONTENT_RESOURCE_TYPES.map((type) => ({
    packageId,
    type,
    visibility: "public"
  }));
}

async function listPublicContentResources(resources: ResourceApi, packageId: string) {
  const listed = await Promise.all(publicContentFilters(packageId).map((filter) => resources.list(filter)));
  return uniqueResources(listed.flat()).filter((resource) => resource.visibility !== "private" && resource.public !== false);
}

async function resolveResource(resources: ResourceApi, resource: ResourceDescriptor): Promise<ResolvedContentResource | null> {
  const id = resourceId(resource);
  const reference = resourceReference(resource);
  const type = resource.type ?? "application/octet-stream";
  if (!id || !resource.packageId || !reference) return null;

  if (type === "application/json") {
    return {
      id,
      packageId: resource.packageId,
      reference,
      type,
      role: resource.metadata?.role,
      json: await resources.readJson(reference)
    };
  }

  if (type === "image/svg+xml") {
    const paths = resource.paths?.length ? resource.paths : resource.path ? [resource.path] : [];
    const text = [];
    for (const path of paths) {
      text.push({
        path,
        contents: await resources.readText(reference, path)
      });
    }
    return {
      id,
      packageId: resource.packageId,
      reference,
      type,
      role: resource.metadata?.role,
      text
    };
  }

  return null;
}

async function resolveContributionResources(resources: ResourceApi, contribution: ContentContribution) {
  const packageId = contribution.packageId;
  const referencedResources = new Set(contribution.resources ?? []);
  if (!packageId || referencedResources.size === 0) return [];

  const publicResources = await listPublicContentResources(resources, packageId);
  const resolved = [];
  for (const resource of publicResources) {
    if (!referencedResources.has(resourceId(resource))) continue;
    const item = await resolveResource(resources, resource);
    if (item) resolved.push(item);
  }
  return resolved;
}

function summarizeResolvedResources(items: ResolvedContentResource[]) {
  const jsonItems = items.filter((item) => item.json !== undefined);
  const svgItems = items.flatMap((item) => item.text ?? []);
  const firstJson = jsonItems.find((item) => isRecord(item.json))?.json;
  const json = asRecord(firstJson);
  const messages = Array.isArray(json.messages) ? json.messages.filter((item): item is string => typeof item === "string") : [];

  return {
    resourceCount: items.length,
    jsonResourceCount: jsonItems.length,
    textResourceCount: svgItems.length,
    title: typeof json.title === "string" ? json.title : null,
    messages,
    badgePaths: svgItems.map((item) => item.path)
  };
}

async function discoverContent(context: ExtensionContext21) {
  try {
    const extensions = requireExtensions(context);
    const resources = requireResources(context);
    const contributions = await extensions.contributions(CONTENT_TARGET);
    const normalizedContributions = Array.isArray(contributions)
      ? contributions.map(normalizeContribution).filter((contribution): contribution is ContentContribution => Boolean(contribution))
      : [];
    const resolvedResources = [];
    for (const contribution of normalizedContributions) {
      resolvedResources.push(...(await resolveContributionResources(resources, contribution)));
    }
    return {
      available: true,
      target: CONTENT_TARGET,
      contributions: normalizedContributions,
      resources: resolvedResources,
      summary: {
        contributionCount: normalizedContributions.length,
        ...summarizeResolvedResources(resolvedResources)
      }
    };
  } catch (error) {
    context.diagnostics.warn("POC Visual Pack content discovery failed.", error);
    throw error;
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

    const serviceRegistration = context.services.register(SERVICE_ID, {
      async snapshot() {
        const content = await discoverContent(context21);
        return {
          overlayTarget: OVERLAY_TARGET,
          content,
          resources: content.resources
        };
      },
      async content() {
        return discoverContent(context21);
      },
      async renderWidget(input) {
        const content = await discoverContent(context21);
        return {
          ok: true,
          input,
          overlayTarget: OVERLAY_TARGET,
          content,
          render: {
            title: content.summary.title,
            messages: content.summary.messages,
            badgePaths: content.summary.badgePaths
          }
        };
      }
    });

    registrations = [serviceRegistration];
    context.subscriptions.push(serviceRegistration);
    context.logger.info("POC Visual Pack activated.");
  },
  deactivate: deactivateExtension
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;
export default extension;
