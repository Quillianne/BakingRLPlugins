import type {
  BakingRLEvent,
  BakingRLEventData,
  CleanupFn,
  Diagnostics,
  ExtensionContext,
  ExtensionSubscription
} from "@bakingrl/plugin-sdk";

export type PluginRuntimeContext = {
  bus: {
    subscribe<TEvent extends string>(
      eventName: TEvent,
      callback: (event: BakingRLEvent<BakingRLEventData<TEvent>, TEvent>) => void | Promise<void>
    ): CleanupFn;
    emit<TEvent extends string>(eventName: TEvent, payload?: BakingRLEventData<TEvent>): void | Promise<void>;
  };
  registry: {
    get<TValue = unknown>(key: string): Promise<TValue | null>;
    set<TValue = unknown>(key: string, value: TValue): Promise<void>;
  };
  storage: {
    readText(uri: string): Promise<string>;
    writeText(uri: string, contents: string): Promise<void>;
  };
  services: {
    call<TOutput = unknown>(ref: string, method: string, input?: unknown): Promise<TOutput>;
  };
  secrets: {
    get(key: string): Promise<string | undefined>;
    configured(key: string): Promise<boolean>;
  };
  settings: {
    get<TValue = unknown>(key: string): TValue | undefined;
    all(): Record<string, unknown>;
  };
  diagnostics: Diagnostics;
};

export type RuntimeService = {
  mount?(context: PluginRuntimeContext): void | Promise<void>;
  unmount?(): void | Promise<void>;
  methods?: Record<string, (input: unknown, context: PluginRuntimeContext) => unknown | Promise<unknown>>;
};

export type RuntimeServiceRegistration = ExtensionSubscription;

function noop() {}

function runtimeDiagnostics(context: ExtensionContext): Diagnostics {
  return {
    log: context.diagnostics?.log ?? context.logger?.info ?? context.logger?.log ?? noop,
    warn: context.diagnostics?.warn ?? context.logger?.warn ?? noop,
    error: context.diagnostics?.error ?? context.logger?.error ?? noop
  };
}

function runtimeSettings(context: ExtensionContext): PluginRuntimeContext["settings"] {
  return (
    context.settings ?? {
      get() {
        return undefined;
      },
      all() {
        return {};
      }
    }
  );
}

function once(cleanup: CleanupFn): CleanupFn {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    cleanup();
  };
}

function createPluginRuntimeContext(context: ExtensionContext) {
  const cleanups: CleanupFn[] = [];

  const serviceContext: PluginRuntimeContext = {
    bus: {
      subscribe(eventName, callback) {
        const cleanup = once(context.bus.subscribe(eventName, callback));
        cleanups.push(cleanup);
        return cleanup;
      },
      emit(eventName, payload) {
        return context.bus.emit(eventName, payload);
      }
    },
    registry: context.registry,
    storage: context.storage,
    services: {
      call(ref, method, input) {
        return context.services.call(ref, method, input);
      }
    },
    secrets: context.secrets ?? {
      async get() {
        return undefined;
      },
      async configured() {
        return false;
      }
    },
    settings: runtimeSettings(context),
    diagnostics: runtimeDiagnostics(context)
  };

  return {
    serviceContext,
    disposeSubscriptions() {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    }
  };
}

export async function registerRuntimeService(
  context: ExtensionContext,
  serviceId: string,
  service: RuntimeService
): Promise<RuntimeServiceRegistration> {
  const mounted = createPluginRuntimeContext(context);

  try {
    await service.mount?.(mounted.serviceContext);
  } catch (error) {
    mounted.disposeSubscriptions();
    throw error;
  }

  const methods = Object.fromEntries(
    Object.entries(service.methods ?? {}).map(([methodName, method]) => [
      methodName,
      (input: unknown) => method(input, mounted.serviceContext)
    ])
  );

  let registration: RuntimeServiceRegistration;
  try {
    registration = context.services.register(serviceId, methods);
  } catch (error) {
    try {
      await service.unmount?.();
    } finally {
      mounted.disposeSubscriptions();
    }
    throw error;
  }

  let disposed = false;
  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await registration.dispose();
      } finally {
        try {
          await service.unmount?.();
        } finally {
          mounted.disposeSubscriptions();
        }
      }
    }
  };
}
