type SettingsValues = {
  enabled: boolean;
  displayName: string;
  accentColor: string;
  refreshSeconds: number;
};

type HostSettingsBridge = {
  get?(): Promise<Record<string, unknown>>;
  save?(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  subscribe?(callback: (values: Record<string, unknown>) => void): () => void;
};

declare global {
  interface Window {
    BakingRL?: {
      settings?: HostSettingsBridge;
    };
  }
}

const fallbackSettings: SettingsValues = {
  enabled: true,
  displayName: "Settings POC",
  accentColor: "#16a34a",
  refreshSeconds: 5
};

let currentSettings = { ...fallbackSettings };
let message = "";

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

function render() {
  document.body.innerHTML = `
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
  document.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });
}

function collect() {
  const enabled = document.querySelector<HTMLInputElement>("#enabled")?.checked ?? true;
  const displayName = document.querySelector<HTMLInputElement>("#displayName")?.value ?? fallbackSettings.displayName;
  const accentColor = document.querySelector<HTMLInputElement>("#accentColor")?.value ?? fallbackSettings.accentColor;
  const refreshSeconds = Number(document.querySelector<HTMLInputElement>("#refreshSeconds")?.value ?? fallbackSettings.refreshSeconds);
  return readSettings({ enabled, displayName, accentColor, refreshSeconds });
}

async function load() {
  const hostSettings = window.BakingRL?.settings;
  if (hostSettings?.get) {
    currentSettings = readSettings(await hostSettings.get());
    message = "Loaded from host settings.";
  } else {
    currentSettings = { ...fallbackSettings };
    message = "Preview mode: host settings bridge unavailable.";
  }
  render();
}

async function save() {
  const next = collect();
  const hostSettings = window.BakingRL?.settings;
  if (hostSettings?.save) {
    currentSettings = readSettings(await hostSettings.save(next));
    message = "Saved through host settings bridge.";
  } else {
    currentSettings = next;
    message = "Saved locally for preview.";
  }
  render();
}

const style = document.createElement("style");
style.textContent = `
  *{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#172033;font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .settings-poc{min-height:100vh;padding:20px;display:grid;gap:16px;align-content:start}
  header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d8e0eb;padding-bottom:12px}
  header p{margin:0;color:#64748b;text-transform:uppercase;font-size:12px;font-weight:800}header strong{font-size:20px}
  form{display:grid;gap:12px;max-width:520px}label{display:grid;gap:6px;font-weight:800}.check{display:flex;gap:8px;align-items:center}
  input{width:100%;border:1px solid #cbd5e1;background:#fff;color:#172033;padding:9px 10px;font:inherit}.check input{width:auto}
  button{width:max-content;border:0;background:#172033;color:#fff;padding:10px 14px;font-weight:900;cursor:pointer}
  section{border:3px solid #16a34a;background:#fff;padding:16px;display:grid;gap:6px;max-width:520px}
  section span{color:#64748b;text-transform:uppercase;font-size:12px;font-weight:800}.message{margin:0;color:#475569}
`;
document.head.append(style);
void load();

export {};
