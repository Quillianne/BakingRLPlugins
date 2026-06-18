import { defineVisual, type VisualContext } from "../visualModule";

const SERVICE_REF = "bakingrl.poc-visual-pack/visualPack";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render(contentCount: number, message: string) {
  return `
    <style>
      .visual-pack-widget{height:100%;display:grid;align-content:center;gap:8px;padding:16px;background:#0f172a;color:#f8fafc;border-left:6px solid #38bdf8;font:14px/1.35 Inter,ui-sans-serif,system-ui,sans-serif}
      .label{color:#93c5fd;text-transform:uppercase;font-size:12px;font-weight:900}.value{font-size:26px;font-weight:950}.meta{color:#cbd5e1}
    </style>
    <section class="visual-pack-widget">
      <div class="label">Visual Pack Widget</div>
      <div class="value">${contentCount} content contribution(s)</div>
      <div class="meta">${escapeHtml(message)}</div>
    </section>
  `;
}

export default defineVisual({
  async mount(context: VisualContext) {
    async function paint() {
      try {
        const snapshot = await context.services.call<{ content?: { contributions?: unknown[] } }>(SERVICE_REF, "snapshot", {});
        const count = snapshot.content?.contributions?.length ?? 0;
        context.root.innerHTML = render(count, "Host-mediated content discovery");
      } catch (error) {
        context.root.innerHTML = render(0, error instanceof Error ? error.message : "Content discovery unavailable");
      }
    }

    await paint();
  }
});
