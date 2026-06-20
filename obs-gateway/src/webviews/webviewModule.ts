import type {
  AssetResolver,
  BakingRLEventData,
  CleanupFn,
  ConfigurationContext,
  ContextState,
  ExtensionDiagnostics,
  ExtensionSecretReader,
  ExtensionTelemetry,
  ReadonlyRegistry,
  ServiceCaller,
  TelemetryHub
} from "@bakingrl/plugin-sdk";

export type PluginWebviewContext = {
  root: HTMLElement;
  package?: {
    id: string;
    name: string;
    enabled: boolean;
  };
  exportName?: string;
  item: {
    id: string;
    package_id: string;
    export_name: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z_index: number;
    visible: boolean;
    locked: boolean;
    opacity: number;
    settings: Record<string, unknown>;
  };
  settings: Record<string, unknown>;
  mode: "runtime" | "editor";
  editor?: {
    emit<TEvent extends string>(eventName: TEvent, payload?: BakingRLEventData<TEvent>): void;
  };
  setActive(active: boolean): void;
  bus: TelemetryHub;
  telemetryHub: TelemetryHub;
  registry: ReadonlyRegistry;
  state: ContextState;
  services: ServiceCaller;
  configuration?: ConfigurationContext;
  assets: AssetResolver;
  diagnostics: ExtensionDiagnostics;
  telemetry: ExtensionTelemetry;
  secrets: ExtensionSecretReader;
};

export type PluginWebviewEditorAction = {
  id: string;
  label: string;
  disabled?: boolean;
  run(context: PluginWebviewContext): void | Promise<void>;
};

export type PluginWebviewExport = {
  mount(context: PluginWebviewContext): void | CleanupFn | Promise<void | CleanupFn>;
  update?(context: PluginWebviewContext): void | Promise<void>;
  unmount?(): void | Promise<void>;
  editor?: {
    mount?(context: PluginWebviewContext): void | CleanupFn | Promise<void | CleanupFn>;
    actions?(context: PluginWebviewContext): PluginWebviewEditorAction[] | Promise<PluginWebviewEditorAction[]>;
  };
};

export function definePluginWebview<T extends PluginWebviewExport>(webview: T): T {
  return webview;
}
