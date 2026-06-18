import {
  defineWebview,
  isBakingRLEvent,
  type BakingRLEvent,
  type RlUpdateStatePayload,
  type WebviewContext
} from "@bakingrl/plugin-sdk";

type UpdateStateFrame = BakingRLEvent<RlUpdateStatePayload, "UpdateState">;

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function score(frame: UpdateStateFrame | null) {
  const [blue, orange] = frame?.Data.Game.Teams ?? [];
  return `${blue?.Score ?? "-"}-${orange?.Score ?? "-"}`;
}

function ensureStyle() {
  if (document.getElementById("poc-overlay-studio-webview-style")) return;
  const style = document.createElement("style");
  style.id = "poc-overlay-studio-webview-style";
  style.textContent = `
    *{box-sizing:border-box}.studio{min-height:100%;padding:22px;display:grid;gap:18px;align-content:start;background:#f8fafc;color:#172033;font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}
    header{display:grid;gap:4px;border-bottom:1px solid #d8e0eb;padding-bottom:14px}header p{margin:0;color:#64748b;text-transform:uppercase;font-size:12px;font-weight:900}header strong{font-size:20px}
    section{max-width:720px;background:#fff;border:1px solid #d8e0eb;padding:18px;display:grid;gap:8px}h1{margin:0;font-size:22px}p{margin:0;color:#475569}
    dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:6px 12px}dt{color:#64748b;font-weight:900}dd{margin:0;font-weight:800}
  `;
  document.head.append(style);
}

export default defineWebview({
  async mount(context: WebviewContext) {
    ensureStyle();

    let latestFrame: UpdateStateFrame | null = null;
    let telemetrySource = "none";
    let updateCount = 0;

    function render() {
      context.root.innerHTML = `
        <main class="studio">
          <header>
            <p>POC Overlay Studio</p>
            <strong>Extension point: overlay-studio.visual</strong>
          </header>
          <section>
            <h1>Platform plugin surface</h1>
            <p>This webview receives host-owned Rocket League telemetry without depending on the legacy overlay editor.</p>
            <dl>
              <dt>Source</dt><dd>${escapeHtml(telemetrySource)}</dd>
              <dt>Match</dt><dd>${escapeHtml(latestFrame?.Data.MatchGuid ?? "no-host-snapshot")}</dd>
              <dt>Score</dt><dd>${escapeHtml(score(latestFrame))}</dd>
              <dt>Updates</dt><dd>${updateCount}</dd>
            </dl>
          </section>
        </main>
      `;
    }

    const snapshot = await context.telemetryHub.snapshot<"UpdateState">();
    if (isBakingRLEvent(snapshot, "UpdateState")) {
      latestFrame = snapshot;
      telemetrySource = "snapshot";
    }
    render();

    const unsubscribe = context.telemetryHub.subscribe("UpdateState", (event) => {
      latestFrame = event;
      telemetrySource = "event";
      updateCount += 1;
      render();
    });

    return () => {
      unsubscribe();
      context.root.innerHTML = "";
    };
  }
});
