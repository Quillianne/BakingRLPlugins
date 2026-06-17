import {
  RL_TELEMETRY_FRAME_TEMPLATES,
  defineVisual,
  type BakingRLEvent,
  type RlUpdateStatePayload,
  type VisualContext
} from "@bakingrl/plugin-sdk";

const SERVICE_REF = "bakingrl.poc-overlay-studio/overlayStudio";

type UpdateStateFrame = BakingRLEvent<RlUpdateStatePayload, "UpdateState">;

function cloneMockSnapshot(): UpdateStateFrame {
  return JSON.parse(JSON.stringify(RL_TELEMETRY_FRAME_TEMPLATES.UpdateState)) as UpdateStateFrame;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clock(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remaining = Math.floor(Math.max(0, seconds) % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function render(frame: UpdateStateFrame, contributionCount: number, message: string) {
  const [blue, orange] = frame.Data.Game.Teams;
  return `
    <style>
      .overlay-poc{height:100%;min-height:100%;display:grid;grid-template-rows:auto 1fr auto;background:#101820;color:#f8fafc;font:16px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;overflow:hidden}
      header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;padding:18px 22px;background:#172033;border-bottom:1px solid rgba(255,255,255,.14)}
      .team{display:flex;align-items:center;gap:12px;min-width:0}.team:last-child{justify-content:flex-end}.swatch{width:14px;height:38px}.name{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.score{font-size:42px;font-weight:900}
      .clock{display:grid;place-items:center;min-width:120px;font-size:32px;font-weight:900;color:#dbeafe}
      main{display:grid;place-items:center;text-align:center;padding:24px}.title{font-size:28px;font-weight:900}.subtitle{color:#9fb2c8;margin-top:8px}
      footer{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;color:#9fb2c8;background:rgba(255,255,255,.06);font-size:13px}
    </style>
    <section class="overlay-poc">
      <header>
        <div class="team"><span class="swatch" style="background:${escapeHtml(blue?.ColorPrimary ?? "#2563eb")}"></span><span class="name">${escapeHtml(blue?.Name ?? "Blue")}</span><span class="score">${escapeHtml(blue?.Score ?? 0)}</span></div>
        <div class="clock">${escapeHtml(clock(frame.Data.Game.TimeSeconds))}</div>
        <div class="team"><span class="score">${escapeHtml(orange?.Score ?? 0)}</span><span class="name">${escapeHtml(orange?.Name ?? "Orange")}</span><span class="swatch" style="background:${escapeHtml(orange?.ColorPrimary ?? "#f97316")}"></span></div>
      </header>
      <main>
        <div class="title">Overlay Studio POC</div>
        <div class="subtitle">${escapeHtml(contributionCount)} visual contribution(s) discovered</div>
      </main>
      <footer><span>${escapeHtml(frame.Data.MatchGuid ?? "mock-match")}</span><span>${escapeHtml(message)}</span></footer>
    </section>
  `;
}

export default defineVisual({
  async mount(context: VisualContext) {
    let frame = cloneMockSnapshot();
    let contributionCount = 0;
    let message = "Waiting for host discovery";

    function paint() {
      context.root.innerHTML = render(frame, contributionCount, message);
    }

    async function refreshDiscovery() {
      try {
        const snapshot = await context.services.call<{ discovery?: { contributions?: unknown[] } }>(SERVICE_REF, "snapshot", {});
        contributionCount = snapshot.discovery?.contributions?.length ?? 0;
        message = "Host discovery available";
      } catch (error) {
        contributionCount = 0;
        message = error instanceof Error ? error.message : "Discovery unavailable";
      }
      paint();
    }

    const cleanup = context.telemetryHub.subscribe("UpdateState", (event) => {
      frame = event;
      paint();
    });

    paint();
    await refreshDiscovery();

    return cleanup;
  }
});
