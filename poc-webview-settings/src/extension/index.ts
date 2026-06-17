import { defineExtension, type ExtensionContext, type ExtensionSubscription } from "@bakingrl/plugin-sdk";

const SERVICE_ID = "pocWebviewSettings";
const WEBVIEW_ID = "settings";

let registrations: ExtensionSubscription[] = [];

function readSettings(context: ExtensionContext) {
  const values = context.settings?.all?.() ?? {};
  return values && typeof values === "object" && !Array.isArray(values) ? values : {};
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

    const serviceRegistration = context.services.register(SERVICE_ID, {
      async openSettings(input) {
        const result = await context.webviews.open(WEBVIEW_ID, input ?? {});
        return {
          ok: true,
          webviewId: WEBVIEW_ID,
          result
        };
      },
      async settingsSnapshot() {
        return {
          packageId: context.packageId,
          settings: readSettings(context)
        };
      }
    });

    registrations = [serviceRegistration];
    context.subscriptions.push(serviceRegistration);
    context.logger.info("POC Webview Settings activated.");
  },
  deactivate: deactivateExtension
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;
export default extension;
