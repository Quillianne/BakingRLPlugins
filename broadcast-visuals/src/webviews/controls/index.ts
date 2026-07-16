import { defineWebview, type WebviewContext } from "@bakingrl/plugin-sdk";
import controlPanel from "../../visuals/control-panel";

export default defineWebview({
  async mount(context: WebviewContext) {
    const settings = await context.settings.get();
    const item = context.item ?? {
      id: "broadcast-controls",
      package_id: context.packageId,
      export_name: "broadcastControls",
      name: "Broadcast Controls",
      x: 0,
      y: 0,
      width: context.dimensions.width,
      height: context.dimensions.height,
      z_index: 0,
      visible: true,
      locked: false,
      opacity: 1,
      settings
    };
    return controlPanel.mount({
      ...context,
      item,
      settings,
      mode: "runtime",
      bus: context.telemetryHub,
      telemetryHub: context.telemetryHub,
      registry: context.registry!,
      state: {
        get: (key) => context.state!.get(key),
        set: (key, value) => context.state?.set?.(key, value) ?? Promise.resolve()
      },
      services: context.services!,
      assets: context.assets!,
      diagnostics: context.diagnostics!,
      telemetry: context.telemetry!,
      secrets: {
        get: (key) => context.secrets?.get?.(key) ?? Promise.resolve(undefined),
        configured: (key) => context.secrets!.configured(key)
      },
      setActive() {}
    });
  }
});
