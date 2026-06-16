import dejaVuService from "../services/deja-vu";
import {
  registerRuntimeService,
  type RuntimeServiceRegistration
} from "./runtimeService";
import type { ExtensionContext } from "@bakingrl/plugin-sdk";

let registrations: RuntimeServiceRegistration[] = [];

async function disposeRegistrations(items: RuntimeServiceRegistration[]) {
  for (const registration of items.reverse()) {
    await registration.dispose();
  }
}

export async function activate(context: ExtensionContext): Promise<void> {
  await deactivate();

  const nextRegistrations = [
    await registerRuntimeService(context, "dejaVu", dejaVuService)
  ];

  registrations = nextRegistrations;
  context.subscriptions?.push(...nextRegistrations);
}

export async function deactivate(): Promise<void> {
  const activeRegistrations = registrations;
  registrations = [];
  await disposeRegistrations(activeRegistrations);
}

export default {
  activate,
  deactivate
};
