import boTrackerService from "../services/bo-tracker";
import cageStatsService from "../services/cage-stats";
import gameSequenceService from "../services/game-sequence";
import playerStatsService from "../services/player-stats";
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

  const nextRegistrations: RuntimeServiceRegistration[] = [];
  try {
    nextRegistrations.push(await registerRuntimeService(context, "boTracker", boTrackerService));
    nextRegistrations.push(await registerRuntimeService(context, "gameSequence", gameSequenceService));
    nextRegistrations.push(await registerRuntimeService(context, "playerStatsTracker", playerStatsService));
    nextRegistrations.push(await registerRuntimeService(context, "cageStats", cageStatsService));
  } catch (error) {
    await disposeRegistrations(nextRegistrations);
    throw error;
  }

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
