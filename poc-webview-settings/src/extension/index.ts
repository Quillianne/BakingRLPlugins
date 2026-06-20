import { defineExtension, type ExtensionContext, type ExtensionSubscription } from "@bakingrl/plugin-sdk";

const SERVICE_ID = "pocWebviewSettings";
const COMMAND_OPEN_SETTINGS = "openSettings";
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

async function openSettings(context: ExtensionContext, input: unknown) {
  const result = await context.webviews.open(WEBVIEW_ID, input ?? {});
  return {
    ok: true,
    webviewId: WEBVIEW_ID,
    result
  };
}

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    await deactivateExtension();

    const serviceRegistration = context.services.register(SERVICE_ID, {
      async openSettings(input) {
        return openSettings(context, input);
      },
      async settingsSnapshot() {
        return {
          packageId: context.packageId,
          settings: readSettings(context)
        };
      }
    });
    const commandRegistration = context.commands.registerCommand(COMMAND_OPEN_SETTINGS, async (input) => {
      return openSettings(context, input);
    });

    registrations = [serviceRegistration, commandRegistration];
    context.subscriptions.push(serviceRegistration, commandRegistration);
    context.logger.info("POC Webview Settings activated.");
  },
  deactivate: deactivateExtension
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;
export default extension;
