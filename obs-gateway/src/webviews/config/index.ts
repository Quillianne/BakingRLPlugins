import { definePluginWebview, type PluginWebviewContext } from "../webviewModule";

const SERVICE_REF = "bakingrl.obs-gateway/obsGateway";
const DEFAULT_LISTEN_PORT = 17844;

type GatewaySettings = {
  enabled: boolean;
  listenAddress: string;
  listenPort: number;
  routePrefix: string;
  streamPath: string;
  streamLayoutId: string;
  secretKeyRef: string;
  requireToken: boolean;
  heartbeatMs: number;
  allowedOrigins: string[];
};

type Layout = {
  id: string;
  name: string;
  source?: string;
  itemCount?: number;
};

type GatewaySnapshot = {
  config: GatewaySettings;
  auth: {
    configured: boolean;
    required: boolean;
    localBind: boolean;
    secretKeyRef: string;
  };
  server: {
    listening: boolean;
    address: string;
    port: number;
    healthUrl?: string | null;
    gatewayApiUrl?: string | null;
    layoutsApiUrl?: string | null;
    eventsUrl?: string | null;
    streamUrl?: string | null;
    websocketUrl?: string | null;
    layoutUrls?: Array<{ layoutId: string; name: string; url: string }>;
    clientCount: number;
  };
  host: {
    layouts: Layout[];
    hostApiAvailable: boolean;
    updatedAtMs?: number | null;
    error?: string | null;
  };
  connected: string;
  lastError?: string | null;
};

let currentCleanup: (() => void) | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringSetting(settings: Record<string, unknown>, key: string, fallback: string) {
  const value = settings[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number) {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function readSettings(settings: Record<string, unknown>): GatewaySettings {
  return {
    enabled: settings.enabled !== false,
    listenAddress: stringSetting(settings, "listenAddress", "127.0.0.1"),
    listenPort: numberSetting(settings, "listenPort", DEFAULT_LISTEN_PORT),
    routePrefix: stringSetting(settings, "routePrefix", "/overlay"),
    streamPath: stringSetting(settings, "streamPath", "/stream"),
    streamLayoutId: typeof settings.streamLayoutId === "string" ? settings.streamLayoutId : "",
    secretKeyRef: stringSetting(settings, "secretKeyRef", "obs.gateway.accessToken"),
    requireToken: settings.requireToken === true,
    heartbeatMs: Math.max(1000, numberSetting(settings, "heartbeatMs", 15000)),
    allowedOrigins: Array.isArray(settings.allowedOrigins)
      ? settings.allowedOrigins.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : ["http://localhost", "http://127.0.0.1"]
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isGatewaySnapshot(value: unknown): value is GatewaySnapshot {
  return isRecord(value) && isRecord(value.config) && isRecord(value.server) && isRecord(value.auth);
}

function textInput(root: HTMLElement, selector: string, fallback: string) {
  return root.querySelector<HTMLInputElement>(selector)?.value.trim() || fallback;
}

function numberInput(root: HTMLElement, selector: string, fallback: number) {
  const value = Number(root.querySelector<HTMLInputElement>(selector)?.value);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function checkboxInput(root: HTMLElement, selector: string) {
  return root.querySelector<HTMLInputElement>(selector)?.checked === true;
}

function originLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectSettings(root: HTMLElement, current: GatewaySettings): GatewaySettings {
  return {
    enabled: checkboxInput(root, "#enabled"),
    listenAddress: textInput(root, "#listen-address", current.listenAddress),
    listenPort: Math.max(1024, Math.min(65535, numberInput(root, "#listen-port", current.listenPort))),
    routePrefix: textInput(root, "#route-prefix", current.routePrefix),
    streamPath: textInput(root, "#stream-path", current.streamPath),
    streamLayoutId: root.querySelector<HTMLSelectElement>("#stream-layout")?.value ?? current.streamLayoutId,
    secretKeyRef: textInput(root, "#secret-key-ref", current.secretKeyRef),
    requireToken: checkboxInput(root, "#require-token"),
    heartbeatMs: Math.max(1000, numberInput(root, "#heartbeat-ms", current.heartbeatMs)),
    allowedOrigins: originLines(root.querySelector<HTMLTextAreaElement>("#allowed-origins")?.value ?? "")
  };
}

function layoutOptions(layouts: Layout[], selected: string) {
  const options = [`<option value="">Auto</option>`];
  for (const layout of layouts) {
    const selectedAttr = layout.id === selected ? " selected" : "";
    const detail = layout.itemCount === undefined ? layout.source ?? "host" : `${layout.source ?? "host"} / ${layout.itemCount} items`;
    options.push(`<option value="${escapeHtml(layout.id)}"${selectedAttr}>${escapeHtml(layout.name)} (${escapeHtml(detail)})</option>`);
  }
  return options.join("");
}

function copyButton(url: string | null | undefined, label: string) {
  if (!url) return "";
  return `<div class="url-row"><code>${escapeHtml(url)}</code><button type="button" data-copy="${escapeHtml(url)}">${escapeHtml(label)}</button></div>`;
}

function renderUrls(snapshot: GatewaySnapshot | null) {
  if (!snapshot?.server.listening) return `<p class="empty">Serveur arrete.</p>`;
  const rows = [
    copyButton(snapshot.server.streamUrl, "Copier stream"),
    copyButton(snapshot.server.gatewayApiUrl, "Copier API"),
    copyButton(snapshot.server.layoutsApiUrl, "Copier layouts"),
    copyButton(snapshot.server.eventsUrl, "Copier events"),
    ...(snapshot.server.layoutUrls ?? []).map((item) => copyButton(item.url, `Copier ${item.name}`))
  ].filter(Boolean);
  return rows.join("") || `<p class="empty">Aucune URL disponible.</p>`;
}

function statusText(snapshot: GatewaySnapshot | null) {
  if (!snapshot) return "chargement";
  if (snapshot.lastError) return "erreur";
  return snapshot.server.listening ? "actif" : "inactif";
}

function render(snapshot: GatewaySnapshot | null, settings: GatewaySettings, message = "") {
  const layouts = snapshot?.host.layouts ?? [];
  const nonLocal = snapshot ? !snapshot.auth.localBind : !isLocal(settings.listenAddress);
  const tokenMissing = nonLocal && !snapshot?.auth.configured;
  const warning = nonLocal
    ? `<div class="warning">Bind non-local: le token est requis des qu'un secret est configure. ${tokenMissing ? "Aucun token configure pour le moment." : ""}</div>`
    : "";
  const hostWarning = snapshot?.host.hostApiAvailable === false
    ? `<div class="warning">API host layouts/snapshots indisponible: ${escapeHtml(snapshot.host.error ?? "contrat host manquant")}</div>`
    : "";

  return `<style>${styleCss}</style>
<section class="obs-config">
  <header>
    <div>
      <p class="eyebrow">OBS Gateway</p>
      <h1>Configuration</h1>
    </div>
    <span class="status ${snapshot?.server.listening ? "ok" : "idle"}">${escapeHtml(statusText(snapshot))}</span>
  </header>
  ${warning}${hostWarning}
  <div class="grid">
    <form class="settings">
      <label class="check"><input id="enabled" type="checkbox"${settings.enabled ? " checked" : ""}> Activer le serveur</label>
      <div class="cols">
        <label>Host<input id="listen-address" value="${escapeHtml(settings.listenAddress)}"></label>
        <label>Port<input id="listen-port" type="number" min="1024" max="65535" value="${settings.listenPort}"></label>
      </div>
      <div class="cols">
        <label>Prefix<input id="route-prefix" value="${escapeHtml(settings.routePrefix)}"></label>
        <label>Stream path<input id="stream-path" value="${escapeHtml(settings.streamPath)}"></label>
      </div>
      <label>Stream layout<select id="stream-layout">${layoutOptions(layouts, settings.streamLayoutId)}</select></label>
      <div class="cols">
        <label>Secret key ref<input id="secret-key-ref" value="${escapeHtml(settings.secretKeyRef)}"></label>
        <label>Heartbeat ms<input id="heartbeat-ms" type="number" min="1000" value="${settings.heartbeatMs}"></label>
      </div>
      <label class="check"><input id="require-token" type="checkbox"${settings.requireToken ? " checked" : ""}> Requerir le token aussi en local</label>
      <label>Allowed origins<textarea id="allowed-origins">${escapeHtml(settings.allowedOrigins.join("\n"))}</textarea></label>
      <div class="actions">
        <button type="submit">Appliquer</button>
        <button type="button" class="secondary refresh">Rafraichir</button>
      </div>
      <p class="message">${escapeHtml(message)}</p>
    </form>
    <aside>
      <div class="server">
        <h2>Serveur</h2>
        <dl>
          <dt>Etat</dt><dd>${escapeHtml(statusText(snapshot))}</dd>
          <dt>Adresse</dt><dd>${escapeHtml(snapshot?.server.address ?? settings.listenAddress)}:${escapeHtml(snapshot?.server.port ?? settings.listenPort)}</dd>
          <dt>Connexion</dt><dd>${escapeHtml(snapshot?.connected ?? "unknown")}</dd>
          <dt>Clients</dt><dd>${escapeHtml(snapshot?.server.clientCount ?? 0)}</dd>
          <dt>Auth</dt><dd>${snapshot?.auth.required ? "token requis" : "sans token"}</dd>
        </dl>
      </div>
      <div class="layouts">
        <h2>Layouts detectes</h2>
        ${layouts.length ? layouts.map((layout) => `<div class="layout"><strong>${escapeHtml(layout.name)}</strong><span>${escapeHtml(layout.id)}</span></div>`).join("") : `<p class="empty">Aucun layout detecte.</p>`}
      </div>
      <div class="urls">
        <h2>URLs OBS</h2>
        ${renderUrls(snapshot)}
      </div>
    </aside>
  </div>
</section>`;
}

function isLocal(address: string) {
  const value = address.trim().replace(/^\[/, "").replace(/\]$/, "");
  return value === "localhost" || value === "::1" || value.startsWith("127.");
}

const styleCss = `
.obs-config{box-sizing:border-box;min-height:100%;padding:20px;color:#172033;background:#f7f9fc;font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
h1,h2,p{margin:0} h1{font-size:24px} h2{font-size:14px;margin-bottom:10px}.eyebrow{font-size:12px;text-transform:uppercase;color:#63718a;font-weight:700}
.status{border:1px solid #cfd8e6;background:#fff;padding:6px 10px;font-weight:700}.status.ok{border-color:#8fc8b1;color:#116149}.status.idle{color:#69758a}
.warning{border:1px solid #e9b86e;background:#fff8e7;color:#6f4200;padding:10px 12px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:minmax(360px,1fr) minmax(320px,.9fr);gap:16px}.settings,aside>div{background:#fff;border:1px solid #d9e1ec;padding:14px}
label{display:grid;gap:6px;font-weight:700;color:#31405a}.cols{display:grid;grid-template-columns:1fr 140px;gap:10px;margin-top:10px}
input,select,textarea{box-sizing:border-box;width:100%;border:1px solid #c8d2e0;background:#fbfdff;color:#172033;padding:9px 10px;font:inherit}textarea{min-height:82px;resize:vertical}
.check{display:flex;align-items:center;gap:8px;margin-top:10px}.check input{width:auto}.actions{display:flex;gap:8px;margin-top:14px}
button{border:1px solid #22304a;background:#22304a;color:#fff;padding:9px 12px;font-weight:800;cursor:pointer}button.secondary{background:#fff;color:#22304a}button:disabled{opacity:.55;cursor:wait}
.message{min-height:20px;margin-top:10px;color:#5b6980}aside{display:grid;gap:12px;align-content:start}dl{display:grid;grid-template-columns:92px 1fr;gap:6px 10px;margin:0}dt{color:#69758a}dd{margin:0;font-weight:700;word-break:break-word}
.layout{display:grid;gap:2px;border-top:1px solid #edf1f6;padding:8px 0}.layout span{color:#69758a;font-size:12px}.empty{color:#69758a}
.url-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border-top:1px solid #edf1f6;padding:8px 0}code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#31405a}
@media (max-width: 760px){.grid,.cols{grid-template-columns:1fr}.obs-config{padding:12px}.url-row{grid-template-columns:1fr}}
`;

export default definePluginWebview({
  async mount(context: PluginWebviewContext) {
    let settings = readSettings(context.configuration ? await context.configuration.settings.get() : context.settings);
    let snapshot: GatewaySnapshot | null = null;
    let message = "";
    let busy = false;

    async function load() {
      busy = true;
      paint();
      try {
        const refreshed = await context.services.call(SERVICE_REF, "refreshHostData", {});
        snapshot = isGatewaySnapshot(refreshed) ? refreshed : await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {});
        settings = readSettings(snapshot.config);
        message = "";
      } catch (error) {
        message = errorMessage(error);
        context.diagnostics.error("OBS Gateway config refresh failed.", error);
      } finally {
        busy = false;
        paint();
      }
    }

    async function apply(next: GatewaySettings) {
      busy = true;
      message = "Application...";
      paint();
      try {
        settings = context.configuration ? readSettings(await context.configuration.settings.save(next)) : next;
        const configured = await context.services.call(SERVICE_REF, "configure", settings);
        snapshot = isGatewaySnapshot(configured) ? configured : await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {});
        message = "Configuration appliquee.";
      } catch (error) {
        message = errorMessage(error);
        context.diagnostics.error("OBS Gateway config apply failed.", error);
      } finally {
        busy = false;
        paint();
      }
    }

    function bind() {
      const form = context.root.querySelector<HTMLFormElement>("form.settings");
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        void apply(collectSettings(context.root, settings));
      });
      context.root.querySelector<HTMLButtonElement>(".refresh")?.addEventListener("click", () => {
        void load();
      });
      for (const button of context.root.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
        button.addEventListener("click", async () => {
          const value = button.dataset.copy ?? "";
          await navigator.clipboard?.writeText(value);
          message = "URL copiee.";
          paint();
        });
      }
      for (const node of context.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")) {
        node.disabled = busy;
      }
      for (const button of context.root.querySelectorAll<HTMLButtonElement>("button")) {
        button.disabled = busy;
      }
    }

    function paint() {
      context.root.innerHTML = render(snapshot, settings, message);
      bind();
    }

    paint();
    await load();

    if (context.configuration) {
      currentCleanup = context.configuration.settings.subscribe((nextSettings) => {
        settings = readSettings(nextSettings);
        paint();
      });
    }

    return () => {
      currentCleanup?.();
      currentCleanup = null;
    };
  }
});
