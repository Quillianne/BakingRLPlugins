import { defineExtension, type ExtensionContext, type ExtensionSubscription } from "@bakingrl/plugin-sdk";

const SERVICE_ID = "visualPack";
const CONTENT_TARGET = "bakingrl.poc-visual-pack/visual-pack.content";
const OVERLAY_TARGET = "bakingrl.poc-overlay-studio/overlay-studio.visual";

type ExtensionDiscoveryApi = {
  contributions?(target?: string): Promise<unknown[]>;
};

type ResourceApi = {
  list?(packageId?: string): Promise<unknown[]>;
  read?(ref: string, path?: string): Promise<unknown>;
  readText?(ref: string, path?: string): Promise<string>;
  readJson?(ref: string, path?: string): Promise<unknown>;
};

type ExtensionContext21 = ExtensionContext & {
  extensions?: ExtensionDiscoveryApi;
  resources?: ResourceApi;
};

let registrations: ExtensionSubscription[] = [];

async function discoverContent(context: ExtensionContext21) {
  try {
    const contributions = await context.extensions?.contributions?.(CONTENT_TARGET);
    return {
      available: Boolean(context.extensions?.contributions),
      target: CONTENT_TARGET,
      contributions: Array.isArray(contributions) ? contributions : []
    };
  } catch (error) {
    context.diagnostics.warn("POC Visual Pack content discovery failed.", error);
    return {
      available: true,
      target: CONTENT_TARGET,
      contributions: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function listResources(context: ExtensionContext21) {
  try {
    const resources = await context.resources?.list?.();
    return Array.isArray(resources) ? resources : [];
  } catch (error) {
    context.diagnostics.warn("POC Visual Pack resource listing failed.", error);
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

    const serviceRegistration = context.services.register(SERVICE_ID, {
      async snapshot() {
        return {
          overlayTarget: OVERLAY_TARGET,
          content: await discoverContent(context21),
          resources: await listResources(context21)
        };
      },
      async content() {
        return discoverContent(context21);
      },
      async renderWidget(input) {
        return {
          ok: true,
          input,
          overlayTarget: OVERLAY_TARGET,
          content: await discoverContent(context21)
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
