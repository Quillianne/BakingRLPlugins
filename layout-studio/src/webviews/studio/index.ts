import { defineWebview, type ServiceCaller, type WebviewContext } from "@bakingrl/plugin-sdk";
import type {
  LayoutDocument,
  LayoutItem,
  LayoutLayer,
  LayoutStudioSnapshot,
  VisualCatalogItem
} from "../../shared/layout";

const SERVICE_REF = "bakingrl.layout-studio/layoutStudio";
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1;

type EditorState = {
  snapshot: LayoutStudioSnapshot | null;
  layoutId: string | null;
  layerId: string | null;
  itemId: string | null;
  zoom: number;
  catalogFilter: string;
  saving: boolean;
  dirty: boolean;
  error: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function id(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

function activeLayout(state: EditorState) {
  return state.snapshot?.layouts.find((layout) => layout.id === state.layoutId) ?? state.snapshot?.layouts[0] ?? null;
}

function activeLayer(state: EditorState) {
  const layout = activeLayout(state);
  return layout?.layers.find((layer) => layer.id === state.layerId) ?? layout?.layers[0] ?? null;
}

function findItem(state: EditorState) {
  const layout = activeLayout(state);
  for (const layer of layout?.layers ?? []) {
    const item = layer.items.find((candidate) => candidate.id === state.itemId);
    if (item) return { layer, item };
  }
  return null;
}

function itemCount(layout: LayoutDocument) {
  return layout.layers.reduce((total, layer) => total + layer.items.length, 0);
}

function cloneLayout(layout: LayoutDocument) {
  return structuredClone(layout);
}

function ensureSelection(state: EditorState) {
  const layout = activeLayout(state);
  if (!layout) {
    state.layoutId = null;
    state.layerId = null;
    state.itemId = null;
    return;
  }
  state.layoutId = layout.id;
  if (!layout.layers.some((layer) => layer.id === state.layerId)) state.layerId = layout.layers[0]?.id ?? null;
  if (!findItem(state)) state.itemId = null;
}

function nativeContent(item: LayoutItem) {
  if (item.kind === "text") {
    return `<div class="native-text" style="color:${escapeHtml(item.settings.color ?? "#f8fafc")};font-size:${finite(item.settings.fontSize, 48)}px;text-align:${escapeHtml(item.settings.textAlign ?? "center")}">${escapeHtml(item.settings.text ?? item.name)}</div>`;
  }
  if (item.kind === "image") {
    const src = typeof item.settings.src === "string" ? item.settings.src : "";
    return src
      ? `<img class="native-image" src="${escapeHtml(src)}" alt="${escapeHtml(item.name)}">`
      : '<div class="native-empty">Image</div>';
  }
  if (item.kind === "shape") {
    return `<div class="native-shape" style="background:${escapeHtml(item.settings.fill ?? "rgba(217,155,54,.72)")};border-radius:${finite(item.settings.borderRadius, 4)}px"></div>`;
  }
  const provider = item.packageId ?? "External plugin";
  const reference = item.resourceId ?? item.exportName ?? "Visual";
  return `<div class="visual-root" data-visual-placeholder="${escapeHtml(item.id)}">
    <span class="visual-placeholder-kicker">Plugin visual</span>
    <strong>${escapeHtml(item.name)}</strong>
    <small>${escapeHtml(provider)} · ${escapeHtml(reference)}</small>
    <em>Preview disabled in editor · rendered in output</em>
  </div>`;
}

function stageItems(layout: LayoutDocument, state: EditorState) {
  return [...layout.layers]
    .sort((left, right) => left.order - right.order)
    .flatMap((layer) =>
      layer.items.map((item) => {
        const selected = item.id === state.itemId;
        const hidden = !layer.visible || !item.visible;
        const locked = layer.locked || item.locked;
        return `<article class="stage-item${selected ? " selected" : ""}${hidden ? " hidden" : ""}${locked ? " locked" : ""}" data-item="${escapeHtml(item.id)}" data-layer="${escapeHtml(layer.id)}" style="left:${item.x}px;top:${item.y}px;width:${item.width}px;height:${item.height}px;z-index:${item.zIndex};opacity:${item.opacity}">
          ${nativeContent(item)}
          <span class="item-label">${escapeHtml(item.name)}</span>
          ${selected && !locked ? '<button class="resize-handle" data-resize="true" aria-label="Resize item" title="Resize item"></button>' : ""}
        </article>`;
      })
    )
    .join("");
}

function catalogEntries(state: EditorState) {
  const filter = state.catalogFilter.trim().toLowerCase();
  const canAdd = !activeLayer(state)?.locked;
  const entries = (state.snapshot?.catalog ?? []).filter((item) =>
    `${item.title} ${item.category} ${item.packageId}`.toLowerCase().includes(filter)
  );
  if (entries.length === 0) return '<div class="panel-empty"><strong>No visual found</strong><span>Try another name or refresh the catalog.</span></div>';
  return entries
    .map(
      (item) => `<button class="catalog-item" data-catalog="${escapeHtml(item.id)}" ${canAdd ? "" : 'disabled title="Unlock the selected layer to add content"'}>
        <span class="catalog-mark" aria-hidden="true"></span><span class="catalog-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(item.packageId)}</small></span><span class="catalog-add">Add</span>
      </button>`
    )
    .join("");
}

function layoutRows(state: EditorState) {
  return (state.snapshot?.layouts ?? [])
    .map(
      (layout) => `<button class="layout-row${layout.id === state.layoutId ? " selected" : ""}" data-layout="${escapeHtml(layout.id)}" aria-pressed="${layout.id === state.layoutId}">
        <span><strong>${escapeHtml(layout.name)}</strong><small>${layout.width} × ${layout.height} · ${itemCount(layout)} ${itemCount(layout) === 1 ? "item" : "items"}</small></span>
        ${layout.id === state.snapshot?.activeLayoutId ? '<b title="This layout is currently used for the stream"><i aria-hidden="true"></i>On stream</b>' : ""}
      </button>`
    )
    .join("");
}

function layerRows(layout: LayoutDocument, state: EditorState) {
  return [...layout.layers]
    .sort((left, right) => right.order - left.order)
    .map((layer) => {
      const items = [...layer.items]
        .sort((left, right) => right.zIndex - left.zIndex)
        .map((item) => {
          const status = [!layer.visible || !item.visible ? "hidden" : "", layer.locked || item.locked ? "locked" : ""].filter(Boolean).join(" · ");
          return `<li><button class="layer-item-select${item.id === state.itemId ? " selected" : ""}" data-item="${escapeHtml(item.id)}" data-layer="${escapeHtml(layer.id)}" aria-pressed="${item.id === state.itemId}">
            <span>${escapeHtml(item.name)}</span>${status ? `<small>${status}</small>` : ""}
          </button></li>`;
        })
        .join("");
      return `<div class="layer-row${layer.id === state.layerId ? " selected" : ""}${!layer.visible ? " is-hidden" : ""}" data-layer-row="${escapeHtml(layer.id)}">
        <button class="layer-select" data-layer-select="${escapeHtml(layer.id)}" aria-pressed="${layer.id === state.layerId}"><span>${escapeHtml(layer.name)}</span><small>${layer.items.length} ${layer.items.length === 1 ? "item" : "items"}</small></button>
        <div class="layer-actions">
          <button data-layer-visible="${escapeHtml(layer.id)}" aria-pressed="${!layer.visible}" title="${layer.visible ? "Hide this layer" : "Show this layer"}" ${layer.locked ? "disabled" : ""}>${layer.visible ? "Hide" : "Show"}</button>
          <button data-layer-lock="${escapeHtml(layer.id)}" aria-pressed="${layer.locked}" title="${layer.locked ? "Unlock this layer" : "Lock this layer"}">${layer.locked ? "Unlock" : "Lock"}</button>
        </div>
        ${items ? `<ul class="layer-items" aria-label="Items in ${escapeHtml(layer.name)}">${items}</ul>` : ""}
      </div>`;
    })
    .join("");
}

function numberInput(label: string, field: string, value: number, options = "") {
  return `<label><span>${label}</span><input type="number" data-field="${field}" value="${value}" ${options}></label>`;
}

function layoutInspector(layout: LayoutDocument) {
  return `<div class="inspector-intro">
      <strong>Layout settings</strong>
      <span>These settings apply to the complete canvas.</span>
    </div>
    <div class="inspector-form">
      <label class="wide"><span>Layout name</span><input data-layout-field="name" value="${escapeHtml(layout.name)}"></label>
      <label><span>Canvas width</span><input type="number" data-layout-field="width" value="${layout.width}" min="320"></label>
      <label><span>Canvas height</span><input type="number" data-layout-field="height" value="${layout.height}" min="180"></label>
      <label class="wide"><span>Background</span><input data-layout-field="background" value="${escapeHtml(layout.background)}" placeholder="transparent or a CSS color"></label>
      <p class="field-help">Select an item on the canvas to edit its content, position and visibility.</p>
    </div>`;
}

function inspector(state: EditorState) {
  const selected = findItem(state);
  const layout = activeLayout(state);
  if (!selected) return layout ? layoutInspector(layout) : '<div class="inspector-empty">Select an item</div>';
  const { item, layer } = selected;
  const locked = layer.locked || item.locked;
  const disabled = locked ? "disabled" : "";
  const contentField = item.kind === "text"
    ? `<label class="wide"><span>Text</span><textarea data-setting="text" ${disabled}>${escapeHtml(item.settings.text ?? item.name)}</textarea></label>
       <label><span>Color</span><input type="color" data-setting="color" value="${escapeHtml(item.settings.color ?? "#f8fafc")}" ${disabled}></label>
       ${numberInput("Font size", "setting:fontSize", finite(item.settings.fontSize, 48), `min="8" max="300" ${disabled}`)}`
    : item.kind === "shape"
      ? `<label class="wide"><span>Fill</span><input data-setting="fill" value="${escapeHtml(item.settings.fill ?? "rgba(217,155,54,.72)")}" ${disabled}></label>${numberInput("Corner radius", "setting:borderRadius", finite(item.settings.borderRadius, 4), `min="0" max="200" ${disabled}`)}`
      : item.kind === "image"
        ? `<label class="wide"><span>Image URL</span><input data-setting="src" value="${escapeHtml(item.settings.src ?? "")}" ${disabled}></label>`
        : `<div class="visual-reference"><span>${escapeHtml(item.packageId ?? "-")}</span><strong>${escapeHtml(item.resourceId ?? "-")}</strong></div>`;

  return `<div class="inspector-intro"><strong>Edit selected item</strong><span>Adjust its content and position on the canvas.</span></div><div class="inspector-form">
    ${locked ? `<p class="locked-help">${layer.locked ? "Unlock the layer to edit this item." : "Unlock the item to edit it."}</p>` : ""}
    <label class="wide"><span>Item name</span><input data-field="name" value="${escapeHtml(item.name)}" ${disabled}></label>
    ${numberInput("X", "x", item.x, disabled)}${numberInput("Y", "y", item.y, disabled)}
    ${numberInput("Width", "width", item.width, `min="20" ${disabled}`)}${numberInput("Height", "height", item.height, `min="20" ${disabled}`)}
    ${numberInput("Stack order", "zIndex", item.zIndex, disabled)}
    <label><span>Opacity</span><input type="range" data-field="opacity" min="0" max="1" step="0.05" value="${item.opacity}" ${disabled}></label>
    ${contentField}
    <label class="toggle"><input type="checkbox" data-field="visible" ${item.visible ? "checked" : ""} ${disabled}><span>Show item</span></label>
    <label class="toggle"><input type="checkbox" data-field="locked" ${item.locked ? "checked" : ""} ${layer.locked ? "disabled" : ""}><span>Lock item</span></label>
    <div class="inspector-actions"><button data-action="backward" ${disabled}>Send backward</button><button data-action="forward" ${disabled}>Bring forward</button><button class="danger" data-action="delete-item" ${disabled}>Delete item</button></div>
  </div>`;
}

function saveStatus(state: EditorState) {
  if (state.saving) return { label: "Saving changes", className: "is-saving" };
  if (state.dirty) return { label: "Changes pending", className: "is-dirty" };
  return { label: "All changes saved", className: "is-saved" };
}

function updateSaveIndicator(root: HTMLElement, state: EditorState) {
  const indicator = root.querySelector<HTMLElement>(".save-indicator");
  if (!indicator) return;
  const status = saveStatus(state);
  indicator.className = `save-indicator ${status.className}`;
  const label = indicator.querySelector("strong");
  if (label) label.textContent = status.label;
}

function updateErrorBanner(root: HTMLElement, state: EditorState) {
  let banner = root.querySelector<HTMLElement>(".error-banner");
  if (!state.error) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "error-banner";
    banner.setAttribute("role", "alert");
    root.append(banner);
  }
  banner.textContent = state.error;
}

function ensureStyle() {
  if (document.getElementById("bakingrl-layout-studio-style")) return;
  const style = document.createElement("style");
  style.id = "bakingrl-layout-studio-style";
  style.textContent = `
    :root{color-scheme:dark;--bg:#141413;--panel:#1c1c1a;--panel-raised:#242421;--panel-soft:#2a2925;--line:#3b3933;--line-strong:#555044;--text:#f1eee6;--muted:#aaa69d;--subtle:#7e7a72;--amber:#e0a13b;--amber-soft:#3b3020;--amber-text:#ffd98e;--danger:#ef8b7f;--danger-soft:#3b2421}
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;min-width:0;background:var(--bg);color:var(--text);font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--amber);outline-offset:2px}.studio-app{height:100vh;min-height:560px;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;background:var(--bg)}
    .topbar{min-width:0;display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--line);background:#191918}.brand{display:grid;flex:none;min-width:150px}.brand-kicker,.section-kicker{color:var(--amber);font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.brand strong{font-size:16px;letter-spacing:-.01em}.current-layout{min-width:150px;display:grid;padding-left:14px;border-left:1px solid var(--line)}.current-layout span,.save-indicator small{color:var(--muted);font-size:11px}.current-layout strong{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.layout-actions{display:flex;align-items:center;gap:6px;margin-left:auto}.topbar button,.section-action,.native-tools button,.inspector-actions button{min-height:34px;border:1px solid var(--line-strong);border-radius:7px;background:var(--panel-raised);color:var(--text);padding:0 11px}.topbar button:hover,.section-action:hover,.native-tools button:hover,.inspector-actions button:hover{border-color:#716b5d;background:#2d2c28}.topbar .primary{border-color:#c78627;background:var(--amber);color:#20190e;font-weight:750}.topbar .primary:hover{background:#edaf4b}.topbar .primary.is-active{border-color:#74613e;background:var(--amber-soft);color:var(--amber-text)}.topbar .primary:disabled{opacity:1}.topbar .danger,.inspector-actions .danger{color:var(--danger)}.topbar .danger:hover,.inspector-actions .danger:hover{border-color:#855048;background:var(--danger-soft)}.save-indicator{min-width:122px;display:grid;grid-template-columns:9px 1fr;column-gap:8px;align-items:center}.save-indicator i{grid-row:1/3;width:8px;height:8px;border-radius:50%;background:#807b72}.save-indicator strong{font-size:11px}.save-indicator.is-dirty i{background:var(--amber)}.save-indicator.is-saving i{background:var(--amber);animation:pulse 1s ease-in-out infinite}.save-indicator.is-saved i{background:#b6b0a4}@keyframes pulse{50%{opacity:.35}}
    .workspace{min-width:0;min-height:0;display:grid;grid-template-columns:264px minmax(380px,1fr) 330px}.sidebar,.inspector{min-width:0;min-height:0;overflow:auto;background:var(--panel)}.sidebar{border-right:1px solid var(--line)}.inspector{border-left:1px solid var(--line)}.panel-section{padding:16px;border-bottom:1px solid var(--line)}.section-heading,.panel-title{display:flex;align-items:flex-start;gap:9px;margin-bottom:12px}.step-number{flex:none;width:22px;height:22px;display:grid;place-items:center;border:1px solid #745a2f;border-radius:50%;background:var(--amber-soft);color:var(--amber-text);font-size:11px;font-weight:750}.section-heading>span:not(.step-number),.panel-title>span{min-width:0;display:grid}.section-heading strong,.panel-title strong{font-size:12px}.section-heading small,.panel-title small{color:var(--muted);font-size:11px}.section-action{margin-left:auto;min-height:30px;padding:0 9px;color:var(--amber-text)}.layout-list,.catalog-list{display:grid;gap:5px}.layout-row,.catalog-item{width:100%;min-width:0;display:flex;align-items:center;gap:9px;border:1px solid transparent;border-radius:8px;background:transparent;padding:9px;text-align:left;color:var(--text)}.layout-row:hover,.catalog-item:hover{border-color:var(--line);background:var(--panel-raised)}.layout-row.selected{border-color:#846634;background:var(--amber-soft)}.layout-row>span,.catalog-copy{min-width:0;display:grid}.layout-row strong,.catalog-item strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.layout-row small,.catalog-item small{overflow:hidden;color:var(--muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.layout-row b{display:flex;align-items:center;gap:5px;margin-left:auto;color:var(--amber-text);font-size:9px;font-style:normal;white-space:nowrap;text-transform:uppercase}.layout-row b i{width:6px;height:6px;border-radius:50%;background:var(--amber)}
    .native-tools{display:grid;gap:6px}.native-tools button{min-width:0;display:grid;justify-items:start;height:auto;padding:8px 10px;text-align:left}.native-tools strong{font-size:12px}.native-tools small{color:var(--muted);font-size:10px}.native-tools button:disabled,.catalog-item:disabled{opacity:.45}.search{width:100%;height:34px;border:1px solid var(--line-strong);border-radius:7px;background:#151514;color:var(--text);padding:0 10px;margin-bottom:8px}.search::placeholder{color:var(--subtle)}.catalog-mark{flex:none;width:4px;height:34px;border-radius:3px;background:var(--amber)}.catalog-add{margin-left:auto;color:var(--amber-text);font-size:11px;font-weight:700}.panel-empty,.inspector-empty{display:grid;gap:4px;padding:24px 10px;text-align:center;color:var(--muted)}.panel-empty strong{color:var(--text)}.panel-empty span{font-size:11px}
    .canvas-workspace{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);background:#10100f}.canvas-bar{min-width:0;display:flex;align-items:center;gap:12px;padding:9px 14px;border-bottom:1px solid var(--line);background:#1a1a18}.canvas-title{min-width:0;display:grid}.canvas-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.canvas-title small{color:var(--muted);font-size:10px}.canvas-hint{margin-left:auto;color:var(--muted);font-size:11px}.zoom{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:11px;white-space:nowrap}.zoom input{width:94px;accent-color:var(--amber)}.zoom output{min-width:34px;color:var(--text);text-align:right}.canvas-viewport{min-width:0;min-height:0;overflow:auto;background-color:#24231f;background-image:linear-gradient(45deg,#2e2d28 25%,transparent 25%),linear-gradient(-45deg,#2e2d28 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2e2d28 75%),linear-gradient(-45deg,transparent 75%,#2e2d28 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}.canvas-pad{min-width:100%;min-height:100%;display:grid;place-items:center;padding:42px}.stage-shell{position:relative;flex:none;box-shadow:0 18px 42px rgba(0,0,0,.48),0 0 0 1px rgba(255,255,255,.13)}.stage{position:absolute;inset:0;transform-origin:top left;overflow:hidden;background:var(--layout-bg,transparent)}
    .stage-item{position:absolute;overflow:hidden;outline:1px solid rgba(255,255,255,.25);background:rgba(25,25,23,.4);user-select:none;touch-action:none}.stage-item:hover{outline:2px solid rgba(224,161,59,.75)}.stage-item.selected{outline:3px solid var(--amber)}.stage-item.hidden{filter:grayscale(1);opacity:.28!important}.stage-item.locked .item-label:after{content:" · locked"}.item-label{position:absolute;left:0;top:0;max-width:100%;padding:3px 6px;background:rgba(15,15,14,.86);color:#fff;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}.resize-handle{position:absolute;right:0;bottom:0;width:20px;height:20px;border:0;border-top:2px solid #241b0e;border-left:2px solid #241b0e;background:var(--amber);cursor:nwse-resize}.visual-root,.native-shape,.native-image,.native-text,.native-empty{width:100%;height:100%;pointer-events:none}.visual-root{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:12px;background:repeating-linear-gradient(135deg,#252522,#252522 14px,#2a2925 14px,#2a2925 28px);color:#e7e2d7;text-align:center}.visual-root strong,.visual-root small,.visual-root em{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.visual-root strong{font-size:18px}.visual-root small{color:#c4bfb4;font-size:11px}.visual-root em{color:var(--amber-text);font-size:10px;font-style:normal}.visual-placeholder-kicker{color:var(--muted);font-size:9px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.native-text{display:flex;align-items:center;justify-content:center;padding:8px;white-space:pre-wrap;overflow:hidden}.native-image{display:block;object-fit:cover}.native-empty{display:grid;place-items:center;background:#35342f;color:#bbb5aa}
    .workflow-heading{padding:15px 14px 12px;border-bottom:1px solid var(--line)}.workflow-heading .section-heading{margin:0}.layer-list{padding:12px;border-bottom:1px solid var(--line)}.layer-list .panel-title{align-items:center;margin-bottom:9px}.layer-list .panel-title>span{display:grid}.layer-row{display:grid;gap:6px;margin-bottom:6px;padding:7px;border:1px solid transparent;border-radius:8px;background:#191918}.layer-row.selected{border-color:#846634;background:var(--amber-soft)}.layer-row.is-hidden .layer-select{opacity:.55}.layer-select{min-width:0;display:flex;align-items:center;gap:7px;border:0;background:transparent;color:var(--text);padding:1px;text-align:left}.layer-select span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.layer-select small{margin-left:auto;color:var(--muted);font-size:10px;white-space:nowrap}.layer-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}.layer-actions button{min-height:26px;border:1px solid var(--line);border-radius:5px;background:var(--panel-raised);color:var(--muted);font-size:10px}.layer-actions button:hover{border-color:var(--line-strong);color:var(--text)}.layer-actions button[aria-pressed="true"]{border-color:#745a2f;background:#342b1e;color:var(--amber-text)}.layer-actions button:disabled{opacity:.4}.layer-items{display:grid;gap:3px;margin:2px 0 0;padding:5px 0 0;border-top:1px solid var(--line);list-style:none}.layer-item-select{width:100%;min-width:0;display:flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--muted);padding:5px 6px;text-align:left}.layer-item-select:hover{border-color:var(--line);background:var(--panel-raised);color:var(--text)}.layer-item-select.selected{border-color:#846634;background:#342b1e;color:var(--text)}.layer-item-select span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.layer-item-select small{margin-left:auto;color:var(--subtle);font-size:9px;white-space:nowrap}.properties-panel{min-width:0}.properties-heading{display:grid;padding:13px 14px 0}.properties-heading span{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.1em}.properties-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.inspector-intro{display:grid;gap:2px;padding:12px 14px 0}.inspector-intro strong{font-size:12px}.inspector-intro span{color:var(--muted);font-size:11px}.inspector-form{padding:12px 14px 18px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.inspector-form label{min-width:0;display:grid;gap:4px}.inspector-form label>span{color:var(--muted);font-size:10px}.inspector-form input,.inspector-form textarea{min-width:0;width:100%;border:1px solid var(--line-strong);border-radius:6px;background:#141413;color:var(--text);padding:7px}.inspector-form input:disabled,.inspector-form textarea:disabled{opacity:.5}.inspector-form input[type="color"]{min-height:34px;padding:3px}.inspector-form input[type="range"]{accent-color:var(--amber)}.inspector-form textarea{min-height:72px;resize:vertical}.inspector-form .wide,.visual-reference,.inspector-actions,.field-help,.locked-help{grid-column:1/-1}.field-help,.locked-help{margin:2px 0 0;padding:10px;border-left:2px solid var(--amber);background:var(--amber-soft);color:var(--muted);font-size:11px}.locked-help{border-left-color:var(--line-strong);background:var(--panel-soft)}.toggle{display:flex!important;align-items:center;gap:7px}.toggle input{width:auto}.visual-reference{display:grid;padding:9px;border-left:3px solid var(--amber);background:var(--amber-soft)}.visual-reference span{color:var(--muted);font-size:10px}.inspector-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.inspector-actions button{height:auto;min-height:34px;padding:6px 8px;font-size:11px}.inspector-actions button:disabled{opacity:.4}.inspector-actions .danger{grid-column:1/-1}.error-banner{position:fixed;left:50%;bottom:18px;z-index:200000;transform:translateX(-50%);max-width:min(720px,calc(100vw - 32px));padding:10px 14px;border:1px solid #96564d;border-radius:7px;background:#3b2421;color:#ffd0ca;box-shadow:0 14px 36px rgba(0,0,0,.4)}
    @media(max-width:1150px){.topbar{gap:10px}.brand{min-width:auto}.brand-kicker{display:none}.current-layout{display:none}.workspace{grid-template-columns:236px minmax(340px,1fr);grid-template-rows:minmax(330px,1fr) minmax(250px,36vh)}.inspector{grid-column:1/-1;display:grid;grid-template-columns:280px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);overflow:hidden;border-top:1px solid var(--line);border-left:0}.workflow-heading{grid-column:1/-1}.layer-list{min-height:0;overflow:auto;border-right:1px solid var(--line);border-bottom:0}.properties-panel{min-height:0;overflow:auto}.canvas-pad{padding:28px}}
    @media(max-width:780px){html,body{height:auto;min-height:100%;overflow:auto}.studio-app{height:auto;min-height:100vh;overflow:visible}.topbar{align-items:flex-start;flex-wrap:wrap}.brand{width:100%}.layout-actions{order:3;width:100%;margin:0}.layout-actions button{flex:1}.save-indicator{margin-left:auto}.workspace{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(440px,65vh) auto}.sidebar{display:grid;grid-template-columns:1fr 1fr;overflow:visible;border-right:0;border-bottom:1px solid var(--line)}.layouts-panel{grid-row:1/3}.panel-section{border-right:1px solid var(--line)}.canvas-workspace{min-height:440px}.canvas-hint{display:none}.inspector{grid-column:auto;display:grid;grid-template-columns:240px minmax(0,1fr);grid-template-rows:auto minmax(300px,auto);overflow:visible;border-top:1px solid var(--line)}.layer-list,.properties-panel{overflow:visible}.canvas-pad{padding:24px}}
    @media(max-width:560px){.topbar{padding:11px 12px}.layout-actions{display:grid;grid-template-columns:1fr 1fr}.layout-actions .primary{grid-column:1/-1;grid-row:1}.workspace{grid-template-rows:auto minmax(400px,62vh) auto}.sidebar{display:block}.panel-section{border-right:0}.canvas-bar{align-items:flex-start;flex-wrap:wrap}.zoom{width:100%}.zoom input{flex:1}.inspector{display:block}.layer-list{border-right:0;border-bottom:1px solid var(--line)}.inspector-form{grid-template-columns:1fr}.inspector-form .wide,.visual-reference,.inspector-actions,.field-help{grid-column:auto}.inspector-actions{grid-template-columns:1fr}.inspector-actions .danger{grid-column:auto}}
  `;
  document.head.append(style);
}

function render(root: HTMLElement, state: EditorState) {
  ensureSelection(state);
  const layout = activeLayout(state);
  if (!layout) {
    root.innerHTML = '<div class="panel-empty">No layout available</div>';
    return;
  }
  const selected = findItem(state);
  const stageWidth = Math.round(layout.width * state.zoom);
  const stageHeight = Math.round(layout.height * state.zoom);
  const isActive = layout.id === state.snapshot?.activeLayoutId;
  const canAddContent = !activeLayer(state)?.locked;
  const save = saveStatus(state);
  root.innerHTML = `<main class="studio-app">
    <header class="topbar">
      <div class="brand"><span class="brand-kicker">Streamer workspace</span><strong>Layout Studio</strong></div>
      <div class="current-layout"><span>Currently editing</span><strong>${escapeHtml(layout.name)}</strong></div>
      <div class="layout-actions">
        <button class="${isActive ? "primary is-active" : "primary"}" data-action="set-active" aria-pressed="${isActive}" ${isActive ? "disabled" : ""}>${isActive ? "Used on stream" : "Use on stream"}</button>
        <button data-action="duplicate-layout">Duplicate layout</button>
        <button class="danger" data-action="delete-layout">Delete layout</button>
      </div>
      <div class="save-indicator ${save.className}" role="status" aria-live="polite" title="Changes are saved automatically"><i aria-hidden="true"></i><strong>${save.label}</strong><small>Automatic save</small></div>
    </header>
    <section class="workspace">
      <aside class="sidebar">
        <section class="panel-section layouts-panel">
          <div class="section-heading"><span class="step-number">1</span><span><strong>Choose a layout</strong><small>Open an existing scene or start a new one.</small></span><button class="section-action" data-action="new-layout">Create layout</button></div>
          <div class="layout-list">${layoutRows(state)}</div>
        </section>
        <section class="panel-section native-panel">
          <div class="section-heading"><span class="step-number">2</span><span><strong>Add content</strong><small>Insert a basic element.</small></span></div>
          <div class="native-tools">
            <button data-native="text" ${canAddContent ? "" : 'disabled title="Unlock the selected layer to add content"'}><strong>Add text</strong><small>Titles, labels and messages</small></button>
            <button data-native="shape" ${canAddContent ? "" : 'disabled title="Unlock the selected layer to add content"'}><strong>Add shape</strong><small>Panels and color blocks</small></button>
            <button data-native="image" ${canAddContent ? "" : 'disabled title="Unlock the selected layer to add content"'}><strong>Add image</strong><small>Logos and custom artwork</small></button>
          </div>
        </section>
        <section class="panel-section catalog-panel">
          <div class="panel-title"><span><strong>Plugin visuals</strong><small>Add visuals supplied by installed plugins.</small></span><button class="section-action" data-action="refresh">Refresh catalog</button></div>
          <input class="search" data-action="catalog-filter" aria-label="Search plugin visuals" placeholder="Search visuals…" value="${escapeHtml(state.catalogFilter)}">
          <div class="catalog-list">${catalogEntries(state)}</div>
        </section>
      </aside>
      <section class="canvas-workspace">
        <header class="canvas-bar">
          <div class="canvas-title"><span class="section-kicker">Canvas</span><strong>${escapeHtml(layout.name)}</strong><small>${layout.width} × ${layout.height}</small></div>
          <span class="canvas-hint">Select an item to edit · drag to move · use the corner to resize</span>
          <label class="zoom"><span>Zoom</span><input type="range" data-action="zoom" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.05" value="${state.zoom}"><output>${Math.round(state.zoom * 100)}%</output></label>
        </header>
        <div class="canvas-viewport"><div class="canvas-pad"><div class="stage-shell" style="width:${stageWidth}px;height:${stageHeight}px"><section class="stage" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${state.zoom});--layout-bg:${escapeHtml(layout.background)}">${stageItems(layout, state)}</section></div></div></div>
      </section>
      <aside class="inspector">
        <div class="workflow-heading"><div class="section-heading"><span class="step-number">3</span><span><strong>Arrange and edit</strong><small>Manage layers, then fine-tune the selection.</small></span></div></div>
        <div class="layer-list"><div class="panel-title"><span><strong>Layers</strong><small>Show or lock groups of content.</small></span><button class="section-action" data-action="add-layer">Add layer</button></div>${layerRows(layout, state)}</div>
        <section class="properties-panel"><div class="properties-heading"><span>${selected ? "Selected item" : "Current layout"}</span><strong>${escapeHtml(selected?.item.name ?? layout.name)}</strong></div>${inspector(state)}</section>
      </aside>
    </section>
    ${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error)}</div>` : ""}
  </main>`;
}

function createNativeItem(kind: "text" | "shape" | "image", layout: LayoutDocument): LayoutItem {
  const settings = kind === "text"
    ? { text: "Broadcast title", color: "#f8fafc", fontSize: 48, textAlign: "center" }
    : kind === "shape"
      ? { fill: "rgba(217,155,54,.72)", borderRadius: 4 }
      : { src: "", fit: "cover" };
  return {
    id: id("item"),
    name: kind[0].toUpperCase() + kind.slice(1),
    kind,
    x: Math.round(layout.width * 0.35),
    y: Math.round(layout.height * 0.4),
    width: kind === "text" ? 580 : 420,
    height: kind === "text" ? 120 : 240,
    zIndex: itemCount(layout),
    visible: true,
    locked: false,
    opacity: 1,
    settings
  };
}

function createVisualItem(visual: VisualCatalogItem, layout: LayoutDocument): LayoutItem {
  const [width, height] = visual.defaultSize;
  return {
    id: id("item"),
    name: visual.title,
    kind: "visual",
    packageId: visual.packageId,
    resourceId: visual.resourceId,
    resourceRef: visual.resourceRef,
    exportName: visual.exportName,
    x: Math.max(0, Math.round((layout.width - width) / 2)),
    y: Math.max(0, Math.round((layout.height - height) / 2)),
    width,
    height,
    zIndex: itemCount(layout),
    visible: true,
    locked: false,
    opacity: 1,
    settings: {}
  };
}

function newLayout(): LayoutDocument {
  const now = Date.now();
  return {
    version: 1,
    id: id("layout"),
    name: "Untitled layout",
    width: 1920,
    height: 1080,
    background: "transparent",
    layers: [{ id: id("layer"), name: "Main content", kind: "normal", visible: true, locked: false, order: 0, items: [] }],
    createdAtMs: now,
    updatedAtMs: now
  };
}

export default defineWebview({
  async mount(context: WebviewContext) {
    ensureStyle();
    if (!context.services) throw new Error("Layout Studio requires the host service API.");
    const services: ServiceCaller = context.services;
    const state: EditorState = {
      snapshot: null,
      layoutId: null,
      layerId: null,
      itemId: null,
      zoom: 0.45,
      catalogFilter: "",
      saving: false,
      dirty: false,
      error: null
    };
    let disposed = false;
    let saveTimer: number | null = null;
    let editRevision = 0;
    let savedRevision = 0;
    let activeSave: Promise<boolean> | null = null;
    let stopPointerInteraction: (() => void) | null = null;

    function showError(error: unknown) {
      state.error = error instanceof Error ? error.message : String(error);
      render(context.root, state);
    }

    function paint() {
      render(context.root, state);
    }

    async function refresh(options: { keepSelection?: boolean } = {}) {
      const currentLayoutId = options.keepSelection ? state.layoutId : null;
      state.snapshot = await services.call<LayoutStudioSnapshot>(SERVICE_REF, "snapshot", {});
      state.layoutId = currentLayoutId && state.snapshot.layouts.some((layout) => layout.id === currentLayoutId)
        ? currentLayoutId
        : state.snapshot.activeLayoutId;
      ensureSelection(state);
      state.error = null;
      editRevision = 0;
      savedRevision = 0;
      state.dirty = false;
      paint();
    }

    function clearSaveTimer() {
      if (saveTimer === null) return;
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    async function runSaveLoop() {
      state.saving = true;
      updateSaveIndicator(context.root, state);
      try {
        while (state.dirty) {
          const layout = activeLayout(state);
          if (!layout) return false;
          const revision = editRevision;
          const layoutId = layout.id;
          const draft = cloneLayout(layout);
          try {
            const saved = await services.call<LayoutDocument>(SERVICE_REF, "save", { layout: draft });
            savedRevision = Math.max(savedRevision, revision);
            if (editRevision === revision) {
              const index = state.snapshot?.layouts.findIndex((candidate) => candidate.id === layoutId) ?? -1;
              if (state.snapshot && index >= 0) state.snapshot.layouts[index] = saved;
            }
            state.dirty = editRevision > savedRevision;
            state.error = null;
          } catch (error) {
            state.error = error instanceof Error ? error.message : String(error);
            return false;
          }
        }
        return true;
      } finally {
        state.saving = false;
        if (!disposed) {
          updateSaveIndicator(context.root, state);
          updateErrorBanner(context.root, state);
        }
      }
    }

    async function saveNow() {
      clearSaveTimer();
      if (activeSave) return activeSave;
      if (!state.dirty) return true;
      const save = runSaveLoop();
      activeSave = save;
      try {
        return await save;
      } finally {
        if (activeSave === save) activeSave = null;
      }
    }

    function queueSave() {
      editRevision += 1;
      state.dirty = true;
      updateSaveIndicator(context.root, state);
      clearSaveTimer();
      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        void saveNow();
      }, 350);
    }

    function addItem(item: LayoutItem) {
      const layer = activeLayer(state);
      if (!layer || layer.locked) return;
      layer.items.push(item);
      state.itemId = item.id;
      queueSave();
      paint();
    }

    function updateLayoutField(field: string, value: unknown) {
      const layout = activeLayout(state);
      if (!layout) return false;
      let next: string | number;
      if (field === "name") {
        next = String(value).trim() || "Untitled layout";
      } else if (field === "width") {
        next = Math.max(320, Math.round(finite(Number(value), layout.width)));
      } else if (field === "height") {
        next = Math.max(180, Math.round(finite(Number(value), layout.height)));
      } else if (field === "background") {
        next = String(value).trim() || "transparent";
      } else return false;
      if (layout[field as "name" | "width" | "height" | "background"] === next) return false;
      if (field === "name") layout.name = String(next);
      else if (field === "width") layout.width = Number(next);
      else if (field === "height") layout.height = Number(next);
      else layout.background = String(next);
      queueSave();
      return true;
    }

    function updateSelectedField(field: string, value: unknown) {
      const selected = findItem(state);
      if (!selected) return false;
      const item = selected.item;
      const unlockingItem = field === "locked" && item.locked && !Boolean(value);
      if (selected.layer.locked || (item.locked && !unlockingItem)) return false;
      if (field.startsWith("setting:")) {
        const setting = field.slice("setting:".length);
        const next = finite(Number(value), finite(item.settings[setting], 0));
        if (Object.is(item.settings[setting], next)) return false;
        item.settings[setting] = next;
      } else if (field === "name") {
        const next = String(value || "Item");
        if (item.name === next) return false;
        item.name = next;
      } else if (field === "visible" || field === "locked") {
        const next = Boolean(value);
        if (item[field] === next) return false;
        item[field] = next;
      } else if (field === "x" || field === "y" || field === "width" || field === "height" || field === "zIndex" || field === "opacity") {
        let next = finite(Number(value), item[field]);
        if (field === "width" || field === "height") next = Math.max(20, next);
        if (field === "opacity") next = Math.max(0, Math.min(1, next));
        if (item[field] === next) return false;
        item[field] = next;
      } else return false;
      queueSave();
      return true;
    }

    function updateSelectedSetting(setting: string, value: unknown) {
      const selected = findItem(state);
      if (!selected || selected.layer.locked || selected.item.locked) return false;
      if (Object.is(selected.item.settings[setting], value)) return false;
      selected.item.settings[setting] = value;
      queueSave();
      return true;
    }

    function syncEditorControl(input: HTMLInputElement | HTMLTextAreaElement) {
      const value = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value;
      const layoutField = input.dataset.layoutField;
      if (layoutField) return updateLayoutField(layoutField, value);
      const field = input.dataset.field;
      if (field) return updateSelectedField(field, value);
      const setting = input.dataset.setting;
      if (setting) return updateSelectedSetting(setting, input.value);
      return false;
    }

    function captureFocusedEditorControl() {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) return;
      if (!context.root.contains(focused)) return;
      syncEditorControl(focused);
    }

    const onClick = async (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button,[data-item]") : null;
      if (!target) return;
      const layoutId = target.dataset.layout;
      if (layoutId) {
        if (!(await saveNow())) return;
        state.layoutId = layoutId;
        state.layerId = null;
        state.itemId = null;
        paint();
        return;
      }
      const itemId = target.dataset.item;
      if (itemId && !target.dataset.resize) {
        state.itemId = itemId;
        state.layerId = target.dataset.layer ?? state.layerId;
        paint();
        return;
      }
      const layerId = target.dataset.layerSelect;
      if (layerId) {
        state.layerId = layerId;
        state.itemId = null;
        paint();
        return;
      }
      const visualId = target.dataset.catalog;
      if (visualId) {
        const layout = activeLayout(state);
        const visual = state.snapshot?.catalog.find((candidate) => candidate.id === visualId);
        if (layout && visual) addItem(createVisualItem(visual, layout));
        return;
      }
      const nativeKind = target.dataset.native as "text" | "shape" | "image" | undefined;
      if (nativeKind) {
        const layout = activeLayout(state);
        if (layout) addItem(createNativeItem(nativeKind, layout));
        return;
      }
      const action = target.dataset.action;
      if (action === "refresh") {
        if (await saveNow()) await refresh({ keepSelection: true }).catch(showError);
        return;
      }
      if (action === "new-layout") {
        if (!(await saveNow())) return;
        const layout = newLayout();
        await services.call<LayoutDocument>(SERVICE_REF, "save", { layout }).then(() => refresh()).then(() => {
          state.layoutId = layout.id;
          paint();
        }).catch(showError);
        return;
      }
      if (action === "duplicate-layout" && state.layoutId) {
        if (!(await saveNow())) return;
        await services.call<LayoutDocument>(SERVICE_REF, "duplicate", { id: state.layoutId }).then((layout) => refresh().then(() => {
          state.layoutId = layout.id;
          paint();
        })).catch(showError);
        return;
      }
      if (action === "delete-layout" && state.layoutId && window.confirm("Delete this layout?")) {
        if (!(await saveNow())) return;
        await services.call(SERVICE_REF, "remove", { id: state.layoutId }).then(() => refresh()).catch(showError);
        return;
      }
      if (action === "set-active" && state.layoutId) {
        if (!(await saveNow())) return;
        await services.call(SERVICE_REF, "setActive", { id: state.layoutId }).then(() => refresh({ keepSelection: true })).catch(showError);
        return;
      }
      if (action === "add-layer") {
        const layout = activeLayout(state);
        if (!layout) return;
        const layer: LayoutLayer = { id: id("layer"), name: `Layer ${layout.layers.length + 1}`, kind: "normal", visible: true, locked: false, order: layout.layers.length, items: [] };
        layout.layers.push(layer);
        state.layerId = layer.id;
        state.itemId = null;
        queueSave();
        paint();
        return;
      }
      if (action === "delete-item") {
        const selected = findItem(state);
        if (!selected || selected.layer.locked || selected.item.locked) return;
        selected.layer.items = selected.layer.items.filter((item) => item.id !== selected.item.id);
        state.itemId = null;
        queueSave();
        paint();
        return;
      }
      if (action === "forward" || action === "backward") {
        const selected = findItem(state);
        if (!selected || selected.layer.locked || selected.item.locked) return;
        selected.item.zIndex += action === "forward" ? 1 : -1;
        queueSave();
        paint();
        return;
      }
      const visibleLayerId = target.dataset.layerVisible;
      if (visibleLayerId) {
        const layer = activeLayout(state)?.layers.find((candidate) => candidate.id === visibleLayerId);
        if (!layer || layer.locked) return;
        layer.visible = !layer.visible;
        queueSave();
        paint();
        return;
      }
      const lockedLayerId = target.dataset.layerLock;
      if (lockedLayerId) {
        const layer = activeLayout(state)?.layers.find((candidate) => candidate.id === lockedLayerId);
        if (!layer) return;
        layer.locked = !layer.locked;
        queueSave();
        paint();
        return;
      }
    };

    function applyZoom() {
      const layout = activeLayout(state);
      if (!layout) return;
      const shell = context.root.querySelector<HTMLElement>(".stage-shell");
      if (shell) {
        shell.style.width = `${Math.round(layout.width * state.zoom)}px`;
        shell.style.height = `${Math.round(layout.height * state.zoom)}px`;
      }
      const stage = context.root.querySelector<HTMLElement>(".stage");
      if (stage) stage.style.transform = `scale(${state.zoom})`;
      const output = context.root.querySelector<HTMLOutputElement>(".zoom output");
      if (output) output.value = `${Math.round(state.zoom * 100)}%`;
    }

    const onInput = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
      if (input.dataset.action === "zoom") {
        state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, finite(Number(input.value), state.zoom)));
        applyZoom();
        return;
      }
      if (input.dataset.action === "catalog-filter") {
        state.catalogFilter = input.value;
        const list = context.root.querySelector<HTMLElement>(".catalog-list");
        if (list) list.innerHTML = catalogEntries(state);
        return;
      }
      syncEditorControl(input);
    };

    const onChange = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
      if (!input.dataset.layoutField && !input.dataset.field && !input.dataset.setting) return;
      syncEditorControl(input);
      paint();
    };

    const onPointerDown = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>(".stage-item") : null;
      if (!element) return;
      const selected = findItem(state);
      const itemId = element.dataset.item;
      if (!selected || selected.item.id !== itemId || selected.item.locked || selected.layer.locked) return;
      stopPointerInteraction?.();
      const resize = event.target instanceof Element && Boolean(event.target.closest("[data-resize]"));
      const origin = { x: event.clientX, y: event.clientY, itemX: selected.item.x, itemY: selected.item.y, width: selected.item.width, height: selected.item.height };
      let moved = false;
      event.preventDefault();

      const move = (moveEvent: PointerEvent) => {
        const current = findItem(state);
        if (!current || current.item.id !== itemId || current.item.locked || current.layer.locked) return;
        const item = current.item;
        const dx = (moveEvent.clientX - origin.x) / state.zoom;
        const dy = (moveEvent.clientY - origin.y) / state.zoom;
        if (resize) {
          const width = Math.max(20, Math.round(origin.width + dx));
          const height = Math.max(20, Math.round(origin.height + dy));
          if (item.width === width && item.height === height) return;
          item.width = width;
          item.height = height;
          element.style.width = `${item.width}px`;
          element.style.height = `${item.height}px`;
        } else {
          const x = Math.round(origin.itemX + dx);
          const y = Math.round(origin.itemY + dy);
          if (item.x === x && item.y === y) return;
          item.x = x;
          item.y = y;
          element.style.left = `${item.x}px`;
          element.style.top = `${item.y}px`;
        }
        moved = true;
        queueSave();
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (stopPointerInteraction === stop) stopPointerInteraction = null;
      };
      const up = () => {
        stop();
        if (moved) paint();
      };
      stopPointerInteraction = stop;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
      window.addEventListener("pointercancel", up, { once: true });
    };

    context.root.addEventListener("click", onClick);
    context.root.addEventListener("input", onInput);
    context.root.addEventListener("change", onChange);
    context.root.addEventListener("pointerdown", onPointerDown);
    try {
      await refresh();
    } catch (error) {
      showError(error);
    }

    return async () => {
      stopPointerInteraction?.();
      captureFocusedEditorControl();
      disposed = true;
      clearSaveTimer();
      await saveNow();
      context.root.removeEventListener("click", onClick);
      context.root.removeEventListener("input", onInput);
      context.root.removeEventListener("change", onChange);
      context.root.removeEventListener("pointerdown", onPointerDown);
      context.root.innerHTML = "";
    };
  }
});
