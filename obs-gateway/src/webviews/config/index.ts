import { definePluginWebview, type PluginWebviewContext } from "../webviewModule";

const SERVICE_REF = "bakingrl.obs-gateway/obsGateway";
const DEFAULT_LISTEN_PORT = 17844;
const ACCESS_TOKEN_KEY = "obs.gateway.accessToken";

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

type GatewayUrl = {
  label: string;
  description: string;
  value: string;
  group: "obs" | "technical";
  copyLabel: string;
};

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
    secretKeyRef: ACCESS_TOKEN_KEY,
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
    secretKeyRef: ACCESS_TOKEN_KEY,
    requireToken: checkboxInput(root, "#require-token"),
    heartbeatMs: Math.max(1000, numberInput(root, "#heartbeat-ms", current.heartbeatMs)),
    allowedOrigins: originLines(root.querySelector<HTMLTextAreaElement>("#allowed-origins")?.value ?? "")
  };
}

function layoutOptions(layouts: Layout[], selected: string) {
  const options = [`<option value="">Automatique (layout actif)</option>`];
  for (const layout of layouts) {
    const selectedAttr = layout.id === selected ? " selected" : "";
    const detail = layout.itemCount === undefined
      ? layout.source ?? "Layout Studio"
      : `${layout.itemCount} élément${layout.itemCount > 1 ? "s" : ""}`;
    options.push(`<option value="${escapeHtml(layout.id)}"${selectedAttr}>${escapeHtml(layout.name)} (${escapeHtml(detail)})</option>`);
  }
  return options.join("");
}

function safeUrlDisplay(value: string) {
  return value.replace(/([?&](?:token|access_token)=)[^&#]*/gi, "$1••••••••");
}

function gatewayUrls(snapshot: GatewaySnapshot | null): GatewayUrl[] {
  if (!snapshot?.server.listening) return [];
  const urls: GatewayUrl[] = [];
  if (snapshot.server.streamUrl) {
    urls.push({
      label: "Flux sélectionné",
      description: "URL recommandée pour la source navigateur OBS.",
      value: snapshot.server.streamUrl,
      group: "obs",
      copyLabel: "Copier l’URL du flux"
    });
  }
  for (const layout of snapshot.server.layoutUrls ?? []) {
    urls.push({
      label: layout.name,
      description: "URL directe vers ce layout.",
      value: layout.url,
      group: "obs",
      copyLabel: `Copier l’URL de ${layout.name}`
    });
  }
  const technicalUrls = [
    ["État de la passerelle", "Point d’accès API de la passerelle.", snapshot.server.gatewayApiUrl, "Copier l’URL de l’API"],
    ["Liste des layouts", "Point d’accès API des layouts.", snapshot.server.layoutsApiUrl, "Copier l’URL des layouts"],
    ["Événements", "Flux d’événements serveur.", snapshot.server.eventsUrl, "Copier l’URL des événements"]
  ] as const;
  for (const [label, description, value, copyLabel] of technicalUrls) {
    if (value) urls.push({ label, description, value, group: "technical", copyLabel });
  }
  return urls;
}

function renderUrlCards(urls: GatewayUrl[], group: GatewayUrl["group"]) {
  return urls
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.group === group)
    .map(({ item, index }) => `<article class="url-card${index === 0 ? " primary-url" : ""}">
      <div class="url-copy">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.description)}</span>
        <code>${escapeHtml(safeUrlDisplay(item.value))}</code>
      </div>
      <button type="button" class="copy-button" data-copy-index="${index}">${escapeHtml(item.copyLabel)}</button>
    </article>`)
    .join("");
}

function serverStatus(snapshot: GatewaySnapshot | null) {
  if (!snapshot) return { label: "Chargement", tone: "pending" };
  if (snapshot.lastError) return { label: "Erreur", tone: "danger" };
  return snapshot.server.listening
    ? { label: "Serveur en ligne", tone: "success" }
    : { label: "Serveur arrêté", tone: "neutral" };
}

function connectionText(value: string | null | undefined) {
  switch (value?.toLowerCase()) {
    case "connected":
      return "OBS connecté";
    case "connecting":
      return "Connexion en cours";
    case "error":
      return "Erreur de connexion";
    case "disconnected":
      return "En attente d’OBS";
    default:
      return "État inconnu";
  }
}

function stepState(label: string, tone: "success" | "warning" | "neutral") {
  return `<span class="step-state ${tone}">${escapeHtml(label)}</span>`;
}

function render(snapshot: GatewaySnapshot | null, settings: GatewaySettings, message = "", messageTone: "neutral" | "success" | "danger" = "neutral") {
  const layouts = snapshot?.host.layouts ?? [];
  const nonLocal = !isLocal(settings.listenAddress);
  const snapshotReady = snapshot !== null;
  const tokenConfigured = snapshot?.auth.configured === true;
  const protectionExpected = protectionRequired(settings);
  const tokenMissing = snapshotReady && protectionExpected && !tokenConfigured;
  const status = serverStatus(snapshot);
  const urls = gatewayUrls(snapshot);
  const warning = tokenMissing
    ? `<div class="notice danger-notice" role="alert"><strong>Démarrage bloqué pour sécurité</strong><span>${nonLocal ? "L’adresse saisie rendrait le serveur accessible depuis le réseau" : "L’authentification locale est demandée"}, mais aucun jeton n’est disponible dans le coffre sécurisé. Enregistrez un jeton avant d’appliquer cette configuration.</span></div>`
    : nonLocal
      ? `<div class="notice warning-notice"><strong>Accès réseau prévu</strong><span>L’adresse saisie ne limite pas le serveur à cette machine. Vérifiez les origines autorisées avant d’appliquer.</span></div>`
      : "";
  const hostWarning = snapshot?.host.hostApiAvailable === false
    ? `<div class="notice warning-notice"><strong>Layout Studio indisponible</strong><span>${escapeHtml(snapshot.host.error ?? "Les layouts ne peuvent pas être chargés pour le moment.")}</span></div>`
    : "";
  const endpoint = `${snapshot?.server.address ?? settings.listenAddress}:${snapshot?.server.port ?? settings.listenPort}`;
  const serverReady = snapshot?.server.listening === true;
  const layoutReady = layouts.length > 0;

  return `<style>${styleCss}</style>
<section class="obs-config">
  <header class="page-header">
    <div class="title-block">
      <p class="eyebrow">OBS Gateway · configuration guidée</p>
      <h1>Connecter OBS à BakingRL</h1>
      <p class="intro">Configurez le serveur local, vérifiez sa sécurité, puis copiez l’URL du layout dans une source navigateur OBS.</p>
    </div>
    <button type="button" class="secondary refresh">Actualiser l’état</button>
  </header>

  <section class="connection-summary" aria-label="État de la connexion">
    <div class="status-block">
      <span class="status-dot ${status.tone}" aria-hidden="true"></span>
      <div>
        <span class="summary-label">État du serveur</span>
        <strong>${escapeHtml(status.label)}</strong>
      </div>
    </div>
    <div>
      <span class="summary-label">Adresse active</span>
      <strong class="mono">${escapeHtml(endpoint)}</strong>
    </div>
    <div>
      <span class="summary-label">Connexion</span>
      <strong>${escapeHtml(connectionText(snapshot?.connected))}</strong>
    </div>
    <div>
      <span class="summary-label">Clients actifs</span>
      <strong>${escapeHtml(snapshot?.server.clientCount ?? 0)}</strong>
    </div>
    ${snapshot?.lastError ? `<p class="server-error">${escapeHtml(snapshot.lastError)}</p>` : ""}
  </section>

  ${warning}

  <form class="settings">
    <section class="step-card">
      <div class="step-index">1</div>
      <div class="step-content">
        <div class="step-heading">
          <div>
            <p class="step-kicker">Serveur</p>
            <h2>Choisir l’adresse et le port</h2>
            <p>Pour OBS sur cette machine, conservez <span class="mono">127.0.0.1</span>. Changez le port uniquement s’il est déjà utilisé.</p>
          </div>
          ${stepState(serverReady ? "En ligne" : "À appliquer", serverReady ? "success" : "neutral")}
        </div>

        <label class="toggle-row" for="enabled">
          <span>
            <strong>Serveur OBS Gateway</strong>
            <small>Le serveur doit être actif pour produire les URL OBS.</small>
          </span>
          <span class="toggle-control"><input id="enabled" type="checkbox"${settings.enabled ? " checked" : ""}><span aria-hidden="true"></span></span>
        </label>

        <div class="field-grid server-fields">
          <label for="listen-address"><span>Adresse d’écoute</span><input id="listen-address" value="${escapeHtml(settings.listenAddress)}" spellcheck="false" autocomplete="off"><small>Utilisez une adresse réseau uniquement si OBS est installé sur une autre machine.</small></label>
          <label for="listen-port"><span>Port</span><input id="listen-port" type="number" min="1024" max="65535" value="${settings.listenPort}" inputmode="numeric"><small>Plage autorisée : 1024 à 65535.</small></label>
        </div>

        <details class="advanced">
          <summary>Réglage de synchronisation</summary>
          <div class="advanced-content single-field">
            <label for="heartbeat-ms"><span>Intervalle de synchronisation</span><div class="input-suffix"><input id="heartbeat-ms" type="number" min="1000" value="${settings.heartbeatMs}" inputmode="numeric"><span>ms</span></div><small>Valeur minimale : 1 000 ms.</small></label>
          </div>
        </details>
      </div>
    </section>

    <section class="step-card">
      <div class="step-index">2</div>
      <div class="step-content">
        <div class="step-heading">
          <div>
            <p class="step-kicker">Sécurité</p>
            <h2>Protéger l’accès au serveur</h2>
            <p>Le jeton reste dans le coffre sécurisé de BakingRL. Sa valeur n’est jamais affichée dans cette interface.</p>
          </div>
          ${stepState(!snapshotReady ? "Vérification" : tokenMissing ? "Action requise" : tokenConfigured ? "Jeton configuré" : "Accès local", tokenMissing ? "warning" : tokenConfigured ? "success" : "neutral")}
        </div>

        <div class="security-status ${tokenMissing ? "danger" : tokenConfigured ? "success" : "neutral"}">
          <div>
            <span class="summary-label">Jeton d’accès</span>
            <strong>${!snapshotReady ? "Vérification en cours" : tokenConfigured ? "Configuré dans le coffre" : "Aucun jeton configuré"}</strong>
          </div>
          <p>${!snapshotReady ? "BakingRL vérifie uniquement si la référence existe, sans lire ni afficher sa valeur." : tokenConfigured ? "Les URL copiées incluent automatiquement l’authentification lorsqu’elle est requise." : "Une connexion strictement locale peut fonctionner sans jeton. N’exposez pas le serveur au réseau dans cet état."}</p>
        </div>

        <div class="token-editor">
          <label for="access-token"><span>Nouveau jeton d’accès</span><input id="access-token" type="password" autocomplete="new-password" spellcheck="false" placeholder="Saisissez une nouvelle valeur"><small>La valeur est envoyée directement au coffre hôte, puis retirée de ce formulaire. Cette interface ne peut ensuite ni la relire ni l’afficher.</small></label>
          <div class="token-actions">
            <button type="button" class="secondary save-token">Enregistrer dans le coffre</button>
            <button type="button" class="secondary clear-token"${tokenConfigured ? "" : " disabled"}>Effacer le jeton</button>
          </div>
        </div>

        <label class="toggle-row" for="require-token">
          <span>
            <strong>Demander le jeton aussi en local</strong>
            <small>Recommandé si d’autres utilisateurs ont accès à cette machine.</small>
          </span>
          <span class="toggle-control"><input id="require-token" type="checkbox"${settings.requireToken ? " checked" : ""}><span aria-hidden="true"></span></span>
        </label>

        <details class="advanced">
          <summary>Référence du secret et origines autorisées</summary>
          <div class="advanced-content">
            <div class="secret-reference"><span>Référence du secret hôte</span><code>${escapeHtml(settings.secretKeyRef)}</code><small>Référence fixe déclarée par le plugin ; elle ne contient jamais le jeton lui-même.</small></div>
            <label for="allowed-origins"><span>Origines CORS autorisées</span><textarea id="allowed-origins" spellcheck="false">${escapeHtml(settings.allowedOrigins.join("\n"))}</textarea><small>Une origine par ligne. Une liste vide bloque les requêtes provenant d’une autre origine, sans bloquer les appels directs d’OBS.</small></label>
          </div>
        </details>
      </div>
    </section>

    <section class="step-card">
      <div class="step-index">3</div>
      <div class="step-content">
        <div class="step-heading">
          <div>
            <p class="step-kicker">Source navigateur OBS</p>
            <h2>Choisir le layout et copier son URL</h2>
            <p>Dans OBS, ajoutez une source « Navigateur », puis collez l’URL du flux ci-dessous.</p>
          </div>
          ${stepState(serverReady && layoutReady ? "Prêt à copier" : layoutReady ? "Serveur arrêté" : "Layout requis", serverReady && layoutReady ? "success" : "neutral")}
        </div>

        ${hostWarning}

        <label for="stream-layout"><span>Layout du flux</span><select id="stream-layout">${layoutOptions(layouts, settings.streamLayoutId)}</select><small>${layouts.length ? `${layouts.length} layout${layouts.length > 1 ? "s" : ""} détecté${layouts.length > 1 ? "s" : ""} depuis Layout Studio.` : "Créez d’abord un layout dans Layout Studio, puis actualisez l’état."}</small></label>

        <div class="url-section">
          <div class="subheading">
            <h3>URL à utiliser dans OBS</h3>
            ${snapshot?.auth.required ? `<span class="privacy-note">Jeton masqué à l’écran</span>` : ""}
          </div>
          ${urls.length ? renderUrlCards(urls, "obs") : `<div class="empty-state"><strong>Aucune URL disponible</strong><span>Activez puis appliquez le serveur pour générer les URL.</span></div>`}
        </div>

        ${urls.some((item) => item.group === "technical") ? `<details class="advanced technical-urls"><summary>URL techniques</summary><div class="url-list">${renderUrlCards(urls, "technical")}</div></details>` : ""}

        <details class="advanced">
          <summary>Chemins avancés du serveur</summary>
          <div class="advanced-content path-fields">
            <label for="route-prefix"><span>Préfixe des routes</span><input id="route-prefix" value="${escapeHtml(settings.routePrefix)}" spellcheck="false" autocomplete="off"><small>Préfixe commun à toutes les routes du plugin.</small></label>
            <label for="stream-path"><span>Chemin du flux</span><input id="stream-path" value="${escapeHtml(settings.streamPath)}" spellcheck="false" autocomplete="off"><small>Chemin utilisé pour l’URL principale d’OBS.</small></label>
          </div>
        </details>
      </div>
    </section>

    <footer class="form-actions">
      <p class="message ${messageTone}" aria-live="polite">${escapeHtml(message)}</p>
      <div class="action-buttons">
        <button type="button" class="secondary refresh">Recharger l’état actif</button>
        <button type="submit" class="primary-action">Enregistrer et appliquer</button>
      </div>
    </footer>
  </form>
</section>`;
}

function isLocal(address: string) {
  const value = address.trim().replace(/^\[/, "").replace(/\]$/, "");
  return value === "localhost" || value === "::1" || value.startsWith("127.");
}

function protectionRequired(settings: GatewaySettings) {
  return settings.enabled && (settings.requireToken || !isLocal(settings.listenAddress));
}

function sameSettings(left: GatewaySettings, right: GatewaySettings) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const styleCss = `
.obs-config,.obs-config *{box-sizing:border-box}
.obs-config{--bg:#111315;--panel:#181b1e;--panel-raised:#1e2226;--border:#30353a;--border-strong:#444a50;--text:#f2eee7;--muted:#aaa59c;--muted-strong:#c8c2b8;--amber:#e2a64b;--amber-strong:#f0b75f;--amber-soft:#32281a;--success:#72bd99;--success-soft:#172a22;--danger:#e18478;--danger-soft:#321e1d;min-height:100%;padding:28px;color:var(--text);background:var(--bg);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.obs-config h1,.obs-config h2,.obs-config h3,.obs-config p{margin:0}.obs-config h1{max-width:760px;font-size:clamp(28px,4vw,42px);line-height:1.08;letter-spacing:-.035em}.obs-config h2{font-size:22px;line-height:1.2;letter-spacing:-.015em}.obs-config h3{font-size:15px}.obs-config button,.obs-config input,.obs-config select,.obs-config textarea{font:inherit}
.page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;max-width:1120px;margin:0 auto 22px}.title-block{display:grid;gap:9px}.eyebrow,.step-kicker{color:var(--amber-strong);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.intro{max-width:760px;color:var(--muted-strong);font-size:15px}
.connection-summary{display:grid;grid-template-columns:1.2fr 1fr 1fr .65fr;gap:1px;max-width:1120px;margin:0 auto 18px;overflow:hidden;border:1px solid var(--border);background:var(--border)}.connection-summary>div{min-width:0;padding:15px 17px;background:var(--panel)}.connection-summary strong{display:block;margin-top:4px;overflow:hidden;color:var(--text);font-size:14px;text-overflow:ellipsis;white-space:nowrap}.status-block{display:flex;align-items:center;gap:11px}.status-dot{width:9px;height:9px;flex:0 0 auto;border-radius:50%;background:var(--muted)}.status-dot.success{background:var(--success);box-shadow:0 0 0 4px rgba(114,189,153,.1)}.status-dot.danger{background:var(--danger);box-shadow:0 0 0 4px rgba(225,132,120,.1)}.status-dot.pending{background:var(--amber)}.summary-label{display:block;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.server-error{grid-column:1/-1;padding:11px 16px!important;color:#f2b0a7;background:var(--danger-soft)!important;font-size:13px}
.notice{display:flex;gap:8px;max-width:1120px;margin:0 auto 14px;padding:12px 14px;border:1px solid var(--border)}.notice strong{flex:0 0 auto}.notice span{color:var(--muted-strong)}.warning-notice{border-color:#6b5432;background:var(--amber-soft)}.danger-notice{border-color:#6e3934;background:var(--danger-soft)}
.settings{display:grid;gap:14px;max-width:1120px;margin:0 auto}.step-card{display:grid;grid-template-columns:58px 1fr;border:1px solid var(--border);background:var(--panel)}.step-index{display:flex;align-items:flex-start;justify-content:center;padding-top:23px;border-right:1px solid var(--border);color:var(--amber-strong);font-size:19px;font-weight:850}.step-content{min-width:0;padding:23px 25px}.step-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:20px}.step-heading>div{display:grid;gap:5px}.step-heading p:last-child{max-width:720px;color:var(--muted)}.step-state{flex:0 0 auto;margin-top:2px;padding:5px 9px;border:1px solid var(--border-strong);color:var(--muted-strong);background:var(--panel-raised);font-size:11px;font-weight:800;letter-spacing:.025em}.step-state.success{border-color:#345f4d;color:#a4d8be;background:var(--success-soft)}.step-state.warning{border-color:#745839;color:#f0c27e;background:var(--amber-soft)}
.toggle-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 15px;border:1px solid var(--border);background:var(--panel-raised);cursor:pointer}.toggle-row>span:first-child{display:grid;gap:2px}.toggle-row small,.obs-config label small{color:var(--muted);font-size:12px;font-weight:400}.toggle-control{position:relative;width:40px;height:22px;flex:0 0 auto}.toggle-control input{position:absolute;width:1px;height:1px;opacity:0}.toggle-control span{position:absolute;inset:0;border:1px solid var(--border-strong);border-radius:999px;background:#282c30;transition:.16s ease}.toggle-control span:after{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--muted-strong);content:"";transition:.16s ease}.toggle-control input:checked+span{border-color:#9b6d29;background:var(--amber-soft)}.toggle-control input:checked+span:after{left:21px;background:var(--amber-strong)}.toggle-control input:focus-visible+span{outline:2px solid var(--amber-strong);outline-offset:3px}
.field-grid{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:14px;margin-top:14px}.obs-config label:not(.toggle-row){display:grid;gap:6px;color:var(--muted-strong);font-size:12px;font-weight:750}.obs-config input,.obs-config select,.obs-config textarea{width:100%;min-height:42px;border:1px solid var(--border-strong);border-radius:0;outline:0;color:var(--text);background:#121416;padding:9px 11px}.obs-config input:focus,.obs-config select:focus,.obs-config textarea:focus{border-color:var(--amber);box-shadow:0 0 0 2px rgba(226,166,75,.13)}.obs-config textarea{min-height:96px;resize:vertical}.input-suffix{display:grid;grid-template-columns:1fr auto;align-items:center;border:1px solid var(--border-strong);background:#121416}.input-suffix input{border:0}.input-suffix span{padding:0 11px;color:var(--muted);font-size:12px}.mono,.obs-config code{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace}
.security-status{display:grid;grid-template-columns:minmax(220px,.55fr) 1fr;gap:18px;margin-bottom:14px;padding:14px 15px;border:1px solid var(--border);background:var(--panel-raised)}.security-status strong{display:block;margin-top:4px}.security-status p{align-self:center;color:var(--muted);font-size:13px}.security-status.success{border-color:#345f4d;background:var(--success-soft)}.security-status.danger{border-color:#6e3934;background:var(--danger-soft)}
.token-editor{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:14px;margin-bottom:14px;padding:14px 15px;border:1px solid var(--border);background:#151719}.token-actions{display:flex;gap:8px}.secret-reference{display:grid;align-content:start;gap:6px;color:var(--muted-strong);font-size:12px;font-weight:750}.secret-reference code{padding:11px;border:1px solid var(--border-strong);color:var(--muted-strong);background:#121416;font-weight:400}.secret-reference small{color:var(--muted);font-weight:400}
.advanced{margin-top:14px;border:1px solid var(--border);background:#151719}.advanced summary{padding:12px 14px;color:var(--muted-strong);font-weight:750;cursor:pointer;user-select:none}.advanced[open] summary{border-bottom:1px solid var(--border);color:var(--text)}.advanced-content{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:15px}.advanced-content.single-field{grid-template-columns:minmax(220px,360px)}
.url-section{display:grid;gap:10px;margin-top:18px}.subheading{display:flex;align-items:center;justify-content:space-between;gap:12px}.privacy-note{color:var(--amber-strong);font-size:11px;font-weight:750}.url-card{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;padding:13px 14px;border:1px solid var(--border);background:#151719}.url-card.primary-url{border-color:#73572e;background:var(--amber-soft)}.url-copy{display:grid;min-width:0;gap:2px}.url-copy>span{color:var(--muted);font-size:12px}.url-copy code{display:block;min-width:0;margin-top:5px;overflow:hidden;color:var(--muted-strong);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.url-list{display:grid;gap:8px;padding:12px}.technical-urls .url-card{background:var(--panel)}.empty-state{display:grid;gap:3px;padding:18px;border:1px dashed var(--border-strong);color:var(--muted);background:#151719}.empty-state strong{color:var(--muted-strong)}
.obs-config button{min-height:40px;border:1px solid var(--border-strong);border-radius:0;padding:9px 13px;color:var(--text);background:var(--panel-raised);font-weight:800;cursor:pointer}.obs-config button:hover:not(:disabled){border-color:#777067;background:#282b2e}.obs-config button:focus-visible{outline:2px solid var(--amber-strong);outline-offset:2px}.obs-config button.primary-action{border-color:var(--amber);color:#17130e;background:var(--amber)}.obs-config button.primary-action:hover:not(:disabled){border-color:var(--amber-strong);background:var(--amber-strong)}.obs-config button.copy-button{min-width:178px;border-color:#745a33;color:#f1c27d;background:transparent}.obs-config button.secondary{background:transparent}.obs-config button:disabled,.obs-config input:disabled,.obs-config select:disabled,.obs-config textarea:disabled{opacity:.52;cursor:wait}
.form-actions{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 16px;border:1px solid var(--border-strong);background:rgba(24,27,30,.96);backdrop-filter:blur(12px)}.action-buttons{display:flex;gap:9px;flex:0 0 auto}.message{min-height:20px;color:var(--muted);font-size:13px}.message.success{color:#9fd3b9}.message.danger{color:#f0aaa0}
@media (max-width:800px){.obs-config{padding:18px}.page-header{display:grid}.page-header>.refresh{justify-self:start}.connection-summary{grid-template-columns:1fr 1fr}.step-card{grid-template-columns:42px 1fr}.step-index{padding-top:20px}.step-content{padding:19px 17px}.field-grid,.advanced-content,.security-status,.token-editor{grid-template-columns:1fr}.step-heading{display:grid;gap:12px}.step-state{justify-self:start}.url-card{grid-template-columns:1fr}.obs-config button.copy-button{width:100%;min-width:0}.form-actions{position:static;display:grid}.action-buttons{display:grid;grid-template-columns:1fr 1fr}.notice{display:grid}}
@media (max-width:520px){.obs-config{padding:12px}.connection-summary{grid-template-columns:1fr}.step-card{grid-template-columns:1fr}.step-index{justify-content:flex-start;padding:13px 16px;border-right:0;border-bottom:1px solid var(--border)}.step-content{padding:17px 15px}.toggle-row{align-items:flex-start}.action-buttons,.token-actions{display:grid;grid-template-columns:1fr}.page-header>.refresh{width:100%}}
`;

export default definePluginWebview({
  async mount(context: PluginWebviewContext) {
    let settings = readSettings(context.configuration ? await context.configuration.settings.get() : context.settings);
    let draft = settings;
    let dirty = false;
    let snapshot: GatewaySnapshot | null = null;
    let message = "";
    let messageTone: "neutral" | "success" | "danger" = "neutral";
    let busy = false;
    let unsubscribeSettings: (() => void) | null = null;

    function captureDraft() {
      if (context.root.querySelector("form.settings")) {
        draft = collectSettings(context.root, draft);
        dirty = !sameSettings(draft, settings);
      }
      return draft;
    }

    async function load() {
      const preserveDraft = dirty;
      busy = true;
      paint();
      try {
        const refreshed = await context.services.call(SERVICE_REF, "refreshHostData", {});
        snapshot = isGatewaySnapshot(refreshed) ? refreshed : await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {});
        settings = readSettings(snapshot.config);
        dirty = preserveDraft && !sameSettings(draft, settings);
        if (!dirty) {
          draft = settings;
        }
        message = dirty ? "État actif actualisé. Vos modifications non enregistrées sont conservées." : "";
        messageTone = "neutral";
      } catch (error) {
        message = `Impossible d’actualiser l’état : ${errorMessage(error)}`;
        messageTone = "danger";
        context.diagnostics.error("OBS Gateway config refresh failed.", error);
      } finally {
        busy = false;
        paint();
      }
    }

    async function apply(next: GatewaySettings) {
      draft = next;
      dirty = !sameSettings(draft, settings);
      if (protectionRequired(next) && snapshot?.auth.configured !== true) {
        message = "Ajoutez d’abord un jeton dans le coffre BakingRL : cette configuration ne peut pas démarrer sans authentification.";
        messageTone = "danger";
        paint();
        context.root.querySelector<HTMLInputElement>("#access-token")?.focus();
        return;
      }
      busy = true;
      message = "Enregistrement et application en cours…";
      messageTone = "neutral";
      paint();
      try {
        settings = context.configuration ? readSettings(await context.configuration.settings.save(next)) : next;
        draft = settings;
        dirty = false;
        const configured = await context.services.call(SERVICE_REF, "configure", settings);
        snapshot = isGatewaySnapshot(configured) ? configured : await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {});
        message = "Configuration enregistrée et appliquée.";
        messageTone = "success";
      } catch (error) {
        dirty = !sameSettings(draft, settings);
        snapshot = await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {}).catch(() => snapshot);
        message = `Impossible d’appliquer la configuration : ${errorMessage(error)}`;
        messageTone = "danger";
        context.diagnostics.error("OBS Gateway config apply failed.", error);
      } finally {
        busy = false;
        paint();
      }
    }

    async function saveAccessToken(value: string) {
      if (!context.configuration) {
        message = "Le coffre hôte n’est pas disponible dans cette fenêtre.";
        messageTone = "danger";
        paint();
        return;
      }
      if (!value) {
        message = "Saisissez un jeton avant de l’enregistrer dans le coffre.";
        messageTone = "danger";
        paint();
        context.root.querySelector<HTMLInputElement>("#access-token")?.focus();
        return;
      }
      busy = true;
      message = "Enregistrement sécurisé du jeton…";
      messageTone = "neutral";
      paint();
      let stored = false;
      try {
        await context.configuration.secrets.set(ACCESS_TOKEN_KEY, value);
        stored = true;
        const configured = await context.services.call(SERVICE_REF, "configure", settings);
        snapshot = isGatewaySnapshot(configured) ? configured : await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {});
        message = "Jeton enregistré dans le coffre et passerelle sécurisée.";
        messageTone = "success";
      } catch {
        snapshot = await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {}).catch(() => snapshot);
        message = stored
          ? "Le jeton est dans le coffre, mais la passerelle n’a pas pu être réappliquée. Actualisez l’état avant de réessayer."
          : "Impossible d’enregistrer le jeton dans le coffre hôte.";
        messageTone = "danger";
        context.diagnostics.error("OBS Gateway vault update failed.");
      } finally {
        busy = false;
        paint();
      }
    }

    async function clearAccessToken() {
      if (!context.configuration) return;
      busy = true;
      message = "Suppression du jeton du coffre…";
      messageTone = "neutral";
      paint();
      try {
        await context.configuration.secrets.clear(ACCESS_TOKEN_KEY);
        await context.services.call(SERVICE_REF, "configure", settings).catch(() => undefined);
        snapshot = await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {});
        const activeProtectionRequired = protectionRequired(settings);
        const draftProtectionRequired = protectionRequired(draft);
        message = activeProtectionRequired
          ? "Jeton effacé. La passerelle est arrêtée tant que sa configuration active exige une authentification."
          : draftProtectionRequired
            ? "Jeton effacé. Vos modifications sont conservées, mais elles ne pourront pas être appliquées sans nouveau jeton."
            : "Jeton effacé du coffre hôte.";
        messageTone = activeProtectionRequired || draftProtectionRequired ? "danger" : "success";
      } catch {
        snapshot = await context.services.call<GatewaySnapshot>(SERVICE_REF, "snapshot", {}).catch(() => snapshot);
        message = "Impossible d’effacer le jeton du coffre hôte.";
        messageTone = "danger";
        context.diagnostics.error("OBS Gateway vault clear failed.");
      } finally {
        busy = false;
        paint();
      }
    }

    function bind() {
      const form = context.root.querySelector<HTMLFormElement>("form.settings");
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        void apply(captureDraft());
      });
      for (const button of context.root.querySelectorAll<HTMLButtonElement>(".refresh")) {
        button.addEventListener("click", () => {
          captureDraft();
          void load();
        });
      }
      context.root.querySelector<HTMLButtonElement>(".save-token")?.addEventListener("click", () => {
        captureDraft();
        const value = context.root.querySelector<HTMLInputElement>("#access-token")?.value ?? "";
        void saveAccessToken(value);
      });
      context.root.querySelector<HTMLButtonElement>(".clear-token")?.addEventListener("click", () => {
        captureDraft();
        void clearAccessToken();
      });
      const urls = gatewayUrls(snapshot);
      for (const button of context.root.querySelectorAll<HTMLButtonElement>("[data-copy-index]")) {
        button.addEventListener("click", async () => {
          captureDraft();
          const index = Number(button.dataset.copyIndex);
          const url = Number.isInteger(index) ? urls[index] : undefined;
          if (!url) return;
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Le presse-papiers n’est pas disponible dans cette fenêtre.");
            await navigator.clipboard.writeText(url.value);
            message = snapshot?.auth.required
              ? "URL copiée. Elle contient l’authentification nécessaire : ne la partagez pas."
              : "URL copiée dans le presse-papiers.";
            messageTone = "success";
          } catch (error) {
            message = `Impossible de copier l’URL : ${errorMessage(error)}`;
            messageTone = "danger";
          }
          paint();
        });
      }
      for (const node of context.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")) {
        if (node.id !== "access-token") {
          node.addEventListener("input", captureDraft);
        }
        if (node.id === "listen-address" || node.id === "require-token" || node.id === "enabled") {
          node.addEventListener("change", () => {
            captureDraft();
            window.setTimeout(() => {
              if (!busy) paint();
            }, 0);
          });
        }
        if (busy) node.disabled = true;
      }
      for (const button of context.root.querySelectorAll<HTMLButtonElement>("button")) {
        if (busy) button.disabled = true;
      }
    }

    function paint() {
      context.root.innerHTML = render(snapshot, draft, message, messageTone);
      bind();
    }

    paint();
    await load();

    if (context.configuration) {
      unsubscribeSettings = context.configuration.settings.subscribe((nextSettings) => {
        const preserveDraft = dirty;
        settings = readSettings(nextSettings);
        dirty = preserveDraft && !sameSettings(draft, settings);
        if (!dirty) draft = settings;
        paint();
      });
    }

    return () => {
      unsubscribeSettings?.();
      unsubscribeSettings = null;
    };
  }
});
