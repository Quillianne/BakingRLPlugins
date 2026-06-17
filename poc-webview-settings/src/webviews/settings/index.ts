import { defineWebview, type WebviewContext } from "@bakingrl/plugin-sdk";

type SettingsValues = {
  enabled: boolean;
  displayName: string;
  accentColor: string;
  refreshSeconds: number;
};

const fallbackSettings: SettingsValues = {
  enabled: true,
  displayName: "Settings POC",
  accentColor: "#16a34a",
  refreshSeconds: 5
};

function cleanString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(60, parsed)) : fallback;
}

function readSettings(values: Record<string, unknown>): SettingsValues {
  return {
    enabled: values.enabled !== false,
    displayName: cleanString(values.displayName, fallbackSettings.displayName),
    accentColor: cleanString(values.accentColor, fallbackSettings.accentColor),
    refreshSeconds: cleanNumber(values.refreshSeconds, fallbackSettings.refreshSeconds)
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render(root: HTMLElement, currentSettings: SettingsValues, message: string) {
  root.innerHTML = `
    <main class="settings-poc">
      <header>
        <p>POC Webview Settings</p>
        <strong>${currentSettings.enabled ? "Enabled" : "Disabled"}</strong>
      </header>
      <form>
        <label class="check">
          <input id="enabled" type="checkbox"${currentSettings.enabled ? " checked" : ""}>
          Enabled
        </label>
        <label>
          Display name
          <input id="displayName" value="${escapeHtml(currentSettings.displayName)}">
        </label>
        <label>
          Accent color
          <input id="accentColor" value="${escapeHtml(currentSettings.accentColor)}">
        </label>
        <label>
          Refresh seconds
          <input id="refreshSeconds" type="number" min="1" max="60" value="${currentSettings.refreshSeconds}">
        </label>
        <button type="submit">Save</button>
      </form>
      <section style="border-color:${escapeHtml(currentSettings.accentColor)}">
        <span>Preview</span>
        <strong>${escapeHtml(currentSettings.displayName)}</strong>
      </section>
      <p class="message">${escapeHtml(message)}</p>
    </main>
  `;
}

function collect(root: HTMLElement) {
  const enabled = root.querySelector<HTMLInputElement>("#enabled")?.checked ?? true;
  const displayName = root.querySelector<HTMLInputElement>("#displayName")?.value ?? fallbackSettings.displayName;
  const accentColor = root.querySelector<HTMLInputElement>("#accentColor")?.value ?? fallbackSettings.accentColor;
  const refreshSeconds = Number(root.querySelector<HTMLInputElement>("#refreshSeconds")?.value ?? fallbackSettings.refreshSeconds);
  return readSettings({ enabled, displayName, accentColor, refreshSeconds });
}

function ensureStyle() {
  if (document.getElementById("poc-webview-settings-style")) return;
  const style = document.createElement("style");
  style.id = "poc-webview-settings-style";
  style.textContent = `
    *{box-sizing:border-box}.settings-poc{min-height:100%;padding:20px;display:grid;gap:16px;align-content:start;background:#f8fafc;color:#172033;font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d8e0eb;padding-bottom:12px}
    header p{margin:0;color:#64748b;text-transform:uppercase;font-size:12px;font-weight:800}header strong{font-size:20px}
    form{display:grid;gap:12px;max-width:520px}label{display:grid;gap:6px;font-weight:800}.check{display:flex;gap:8px;align-items:center}
    input{width:100%;border:1px solid #cbd5e1;background:#fff;color:#172033;padding:9px 10px;font:inherit}.check input{width:auto}
    button{width:max-content;border:0;background:#172033;color:#fff;padding:10px 14px;font-weight:900;cursor:pointer}
    section{border:3px solid #16a34a;background:#fff;padding:16px;display:grid;gap:6px;max-width:520px}
    section span{color:#64748b;text-transform:uppercase;font-size:12px;font-weight:800}.message{margin:0;color:#475569}
  `;
  document.head.append(style);
}

export default defineWebview({
  async mount(context: WebviewContext) {
    ensureStyle();
    let currentSettings = readSettings(await context.settings.get());
    let message = "Loaded from host settings.";
    let disposed = false;

    const draw = () => {
      render(context.root, currentSettings, message);
      context.root.querySelector("form")?.addEventListener("submit", (event: Event) => {
        event.preventDefault();
        void save();
      });
    };

    const save = async () => {
      const next = collect(context.root);
      currentSettings = readSettings(await context.settings.save(next));
      message = "Saved through host settings bridge.";
      if (!disposed) draw();
    };

    const unsubscribe = context.settings.subscribe((settings: Record<string, unknown>) => {
      currentSettings = readSettings(settings);
      message = "Updated from host settings.";
      if (!disposed) draw();
    });

    draw();

    return () => {
      disposed = true;
      unsubscribe();
      context.root.innerHTML = "";
    };
  }
});
