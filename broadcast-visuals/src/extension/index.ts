import type { ExtensionContext } from "@bakingrl/plugin-sdk";
import regieControllerService from "../services/regie-controller";
import { registerRuntimeService, type RuntimeServiceRegistration } from "./runtimeService";

let registrations: RuntimeServiceRegistration[] = [];

async function disposeRegistrations(items: RuntimeServiceRegistration[]) {
  for (const registration of items.reverse()) await registration.dispose();
}

export async function activate(context: ExtensionContext) {
  await deactivate();
  const registration = await registerRuntimeService(context, "regieController", regieControllerService);
  registrations = [registration];
  context.subscriptions.push(registration);
}

export async function deactivate() {
  const activeRegistrations = registrations;
  registrations = [];
  await disposeRegistrations(activeRegistrations);
}

export default { activate, deactivate };
