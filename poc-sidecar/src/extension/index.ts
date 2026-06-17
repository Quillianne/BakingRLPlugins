import { defineExtension, type ExtensionContext, type ExtensionSubscription } from "@bakingrl/plugin-sdk";

const SERVICE_ID = "pocSidecar";
const SIDECAR_ID = "worker";

let registrations: ExtensionSubscription[] = [];
let activeContext: ExtensionContext | null = null;

async function callSidecar<TOutput = unknown>(method: string, params?: unknown): Promise<TOutput> {
  const context = activeContext;
  if (!context) throw new Error("POC sidecar extension is not active.");
  await context.sidecars.start(SIDECAR_ID);
  return context.sidecars.call<TOutput>(SIDECAR_ID, method, params);
}

async function disposeRegistrations(items: ExtensionSubscription[]) {
  for (const registration of items.reverse()) {
    await registration.dispose();
  }
}

async function deactivateExtension() {
  const activeRegistrations = registrations;
  registrations = [];
  activeContext = null;
  await disposeRegistrations(activeRegistrations);
}

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    await deactivateExtension();
    activeContext = context;

    const serviceRegistration = context.services.register(SERVICE_ID, {
      async ping(input) {
        return callSidecar("ping", input ?? {});
      },
      async health(input) {
        return callSidecar("health", input ?? {});
      },
      async crash(input) {
        return callSidecar("crash", input ?? {});
      }
    });

    registrations = [serviceRegistration];
    context.subscriptions.push(serviceRegistration);
    context.logger.info("POC Sidecar activated.");
  },
  deactivate: deactivateExtension
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;
export default extension;
