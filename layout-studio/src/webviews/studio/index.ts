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

type PreviewModule = {
  default?: {
    mount?(context: unknown): void | (() => void) | Promise<void | (() => void)>;
    unmount?(): void | Promise<void>;
  };
  mount?(context: unknown): void | (() => void) | Promise<void | (() => void)>;
  unmount?(): void | Promise<void>;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    return `<div class="native-shape" style="background:${escapeHtml(item.settings.fill ?? "rgba(18,132,91,.65)")};border-radius:${finite(item.settings.borderRadius, 4)}px"></div>`;
  }
  return `<div class="visual-root" data-preview="${escapeHtml(item.id)}"><span>${escapeHtml(item.name)}</span></div>`;
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
          ${selected && !locked ? '<button class="resize-handle" data-resize="true" aria-label="Resize" title="Resize"></button>' : ""}
        </article>`;
      })
    )
    .join("");
}

function catalogEntries(state: EditorState) {
  const filter = state.catalogFilter.trim().toLowerCase();
  const entries = (state.snapshot?.catalog ?? []).filter((item) =>
    `${item.title} ${item.category} ${item.packageId}`.toLowerCase().includes(filter)
  );
  if (entries.length === 0) return '<div class="panel-empty">No matching visuals</div>';
  return entries
    .map(
      (item) => `<button class="catalog-item" data-catalog="${escapeHtml(item.id)}">
        <span class="catalog-mark"></span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)}</small></span><b>+</b>
      </button>`
    )
    .join("");
}

function layoutRows(state: EditorState) {
  return (state.snapshot?.layouts ?? [])
    .map(
      (layout) => `<button class="layout-row${layout.id === state.layoutId ? " selected" : ""}" data-layout="${escapeHtml(layout.id)}">
        <span><strong>${escapeHtml(layout.name)}</strong><small>${layout.width} x ${layout.height} / ${itemCount(layout)} items</small></span>
        ${layout.id === state.snapshot?.activeLayoutId ? '<b title="Active layout">LIVE</b>' : ""}
      </button>`
    )
    .join("");
}

function layerRows(layout: LayoutDocument, state: EditorState) {
  return [...layout.layers]
    .sort((left, right) => right.order - left.order)
    .map(
      (layer) => `<div class="layer-row${layer.id === state.layerId ? " selected" : ""}" data-layer-row="${escapeHtml(layer.id)}">
        <button data-layer-select="${escapeHtml(layer.id)}"><span>${escapeHtml(layer.name)}</span><small>${layer.items.length}</small></button>
        <button class="icon-button" data-layer-visible="${escapeHtml(layer.id)}" title="${layer.visible ? "Hide layer" : "Show layer"}" aria-label="${layer.visible ? "Hide layer" : "Show layer"}">${layer.visible ? "O" : "-"}</button>
        <button class="icon-button" data-layer-lock="${escapeHtml(layer.id)}" title="${layer.locked ? "Unlock layer" : "Lock layer"}" aria-label="${layer.locked ? "Unlock layer" : "Lock layer"}">${layer.locked ? "L" : "U"}</button>
      </div>`
    )
    .join("");
}

function numberInput(label: string, field: string, value: number, options = "") {
  return `<label><span>${label}</span><input type="number" data-field="${field}" value="${value}" ${options}></label>`;
}

function inspector(state: EditorState) {
  const selected = findItem(state);
  if (!selected) return '<div class="inspector-empty">Select an item</div>';
  const { item } = selected;
  const contentField = item.kind === "text"
    ? `<label class="wide"><span>Text</span><textarea data-setting="text">${escapeHtml(item.settings.text ?? item.name)}</textarea></label>
       <label><span>Color</span><input type="color" data-setting="color" value="${escapeHtml(item.settings.color ?? "#f8fafc")}"></label>
       ${numberInput("Font", "setting:fontSize", finite(item.settings.fontSize, 48), 'min="8" max="300"')}`
    : item.kind === "shape"
      ? `<label class="wide"><span>Fill</span><input data-setting="fill" value="${escapeHtml(item.settings.fill ?? "rgba(18,132,91,.65)")}"></label>${numberInput("Radius", "setting:borderRadius", finite(item.settings.borderRadius, 4), 'min="0" max="200"')}`
      : item.kind === "image"
        ? `<label class="wide"><span>Image URL</span><input data-setting="src" value="${escapeHtml(item.settings.src ?? "")}"></label>`
        : `<div class="visual-reference"><span>${escapeHtml(item.packageId ?? "-")}</span><strong>${escapeHtml(item.resourceId ?? "-")}</strong></div>`;

  return `<div class="inspector-form">
    <label class="wide"><span>Name</span><input data-field="name" value="${escapeHtml(item.name)}"></label>
    ${numberInput("X", "x", item.x)}${numberInput("Y", "y", item.y)}
    ${numberInput("Width", "width", item.width, 'min="20"')}${numberInput("Height", "height", item.height, 'min="20"')}
    ${numberInput("Order", "zIndex", item.zIndex)}
    <label><span>Opacity</span><input type="range" data-field="opacity" min="0" max="1" step="0.05" value="${item.opacity}"></label>
    ${contentField}
    <label class="toggle"><input type="checkbox" data-field="visible" ${item.visible ? "checked" : ""}><span>Visible</span></label>
    <label class="toggle"><input type="checkbox" data-field="locked" ${item.locked ? "checked" : ""}><span>Locked</span></label>
    <div class="inspector-actions"><button data-action="backward">Back</button><button data-action="forward">Forward</button><button class="danger" data-action="delete-item">Delete</button></div>
  </div>`;
}

function ensureStyle() {
  if (document.getElementById("bakingrl-layout-studio-style")) return;
  const style = document.createElement("style");
  style.id = "bakingrl-layout-studio-style";
  style.textContent = `
    *{box-sizing:border-box}html,body{margin:0;min-width:0;background:#e9edeb;color:#18201d;font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}button,input,textarea{font:inherit}button{cursor:pointer}.studio-app{height:100vh;min-height:540px;display:grid;grid-template-rows:56px minmax(0,1fr);overflow:hidden}
    .toolbar{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #bcc7c1;background:#fff}.wordmark{display:grid;min-width:160px;margin-right:8px}.wordmark strong{font-size:15px}.wordmark span{font-size:11px;color:#6a756f}.toolbar button,.toolbar select{height:34px;border:1px solid #abb8b1;border-radius:6px;background:#fff;color:#243029;padding:0 10px}.toolbar button:hover{background:#eef5f1}.toolbar .primary{border-color:#137653;background:#16845b;color:#fff}.toolbar .danger{color:#a13f31}.toolbar-spacer{flex:1}.save-state{min-width:66px;color:#6a756f;text-align:right;font-size:11px}.zoom{display:flex;align-items:center;gap:7px;color:#58655f}.zoom input{width:94px;accent-color:#16845b}.workspace{min-width:0;min-height:0;display:grid;grid-template-columns:244px minmax(360px,1fr) 286px}
    .sidebar,.inspector{min-width:0;min-height:0;overflow:auto;background:#f8faf9}.sidebar{border-right:1px solid #bcc7c1}.inspector{border-left:1px solid #bcc7c1}.panel-section{padding:13px;border-bottom:1px solid #d6ddda}.panel-title{display:flex;align-items:center;margin-bottom:8px}.panel-title strong{font-size:12px;text-transform:uppercase;color:#59665f}.panel-title button{margin-left:auto;border:1px solid #b3beb8;border-radius:5px;background:#fff;width:28px;height:26px}.search{width:100%;height:32px;border:1px solid #b9c4be;border-radius:5px;background:#fff;padding:0 9px;margin-bottom:8px}.layout-list,.catalog-list{display:grid;gap:3px}.layout-row,.catalog-item{width:100%;min-width:0;display:flex;align-items:center;gap:8px;border:1px solid transparent;border-radius:5px;background:transparent;padding:8px;text-align:left;color:#26332d}.layout-row:hover,.catalog-item:hover{background:#edf3f0}.layout-row.selected{border-color:#90b9a7;background:#e3f1ea}.layout-row span,.catalog-item span{min-width:0;display:grid}.layout-row strong,.catalog-item strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.layout-row small,.catalog-item small{color:#728078}.layout-row b{margin-left:auto;color:#11734f;font-size:9px}.catalog-mark{width:7px;height:28px;background:#ef785f}.catalog-item b{margin-left:auto;font-size:17px;color:#16845b}.native-tools{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.native-tools button{height:32px;border:1px solid #b5c0ba;border-radius:5px;background:#fff}.panel-empty,.inspector-empty{padding:24px 10px;text-align:center;color:#75817b}
    .canvas-viewport{min-width:0;min-height:0;overflow:auto;background-color:#cfd6d2;background-image:linear-gradient(45deg,#c3cbc7 25%,transparent 25%),linear-gradient(-45deg,#c3cbc7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c3cbc7 75%),linear-gradient(-45deg,transparent 75%,#c3cbc7 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}.canvas-pad{min-width:100%;min-height:100%;display:grid;place-items:center;padding:42px}.stage-shell{position:relative;flex:none;box-shadow:0 12px 32px rgba(28,38,33,.22)}.stage{position:absolute;inset:0;transform-origin:top left;overflow:hidden;background:var(--layout-bg,transparent)}
    .stage-item{position:absolute;overflow:hidden;outline:1px solid rgba(255,255,255,.22);background:rgba(30,38,35,.35);user-select:none;touch-action:none}.stage-item:hover{outline:2px solid rgba(239,120,95,.72)}.stage-item.selected{outline:3px solid #ef785f}.stage-item.hidden{filter:grayscale(1);opacity:.28!important}.stage-item.locked .item-label:after{content:" / locked"}.item-label{position:absolute;left:0;top:0;max-width:100%;padding:3px 6px;background:rgba(16,23,20,.78);color:#fff;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}.resize-handle{position:absolute;right:0;bottom:0;width:18px;height:18px;border:0;border-top:2px solid #fff;border-left:2px solid #fff;background:#ef785f;cursor:nwse-resize}.visual-root,.native-shape,.native-image,.native-text,.native-empty{width:100%;height:100%;pointer-events:none}.visual-root{display:grid;place-items:center;background:#26332d;color:#dbe6e0}.visual-root>span{padding:8px;text-align:center}.native-text{display:flex;align-items:center;justify-content:center;padding:8px;white-space:pre-wrap;overflow:hidden}.native-image{display:block;object-fit:cover}.native-empty{display:grid;place-items:center;background:#dce2df;color:#64716b}
    .inspector h2{margin:0;padding:13px;border-bottom:1px solid #d6ddda;font-size:13px}.layer-list{padding:8px;border-bottom:1px solid #d6ddda}.layer-row{display:grid;grid-template-columns:minmax(0,1fr) 28px 28px;gap:3px;margin-bottom:3px;border:1px solid transparent;border-radius:5px}.layer-row.selected{border-color:#90b9a7;background:#e3f1ea}.layer-row>button{min-width:0;border:0;background:transparent}.layer-row>button:first-child{display:flex;align-items:center;gap:6px;padding:7px;text-align:left}.layer-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.layer-row small{margin-left:auto;color:#6d7973}.icon-button{font-size:10px}.inspector-form{padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.inspector-form label{min-width:0;display:grid;gap:4px}.inspector-form label>span{font-size:11px;color:#66736c}.inspector-form input,.inspector-form textarea{min-width:0;width:100%;border:1px solid #b5c0ba;border-radius:5px;background:#fff;padding:7px}.inspector-form textarea{min-height:72px;resize:vertical}.inspector-form .wide,.visual-reference,.inspector-actions{grid-column:1/-1}.toggle{display:flex!important;align-items:center;gap:7px}.toggle input{width:auto}.visual-reference{display:grid;padding:9px;border-left:3px solid #ef785f;background:#edf1ef}.visual-reference span{color:#6b7771;font-size:11px}.inspector-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px}.inspector-actions button{height:32px;border:1px solid #b5c0ba;border-radius:5px;background:#fff}.inspector-actions .danger{color:#a13f31}.error-banner{position:fixed;left:50%;bottom:18px;z-index:200000;transform:translateX(-50%);max-width:min(720px,calc(100vw - 32px));padding:10px 14px;border:1px solid #c86755;border-radius:6px;background:#fff2ef;color:#8c3225}
    @media(max-width:900px){.workspace{grid-template-columns:210px minmax(320px,1fr)}.inspector{display:none}.wordmark span,.save-state{display:none}.toolbar{gap:5px}.toolbar button{padding:0 8px}.canvas-pad{padding:24px}}
    @media(max-width:640px){.studio-app{min-width:620px}.workspace{grid-template-columns:190px minmax(360px,1fr)}}
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
  root.innerHTML = `<main class="studio-app">
    <header class="toolbar">
      <div class="wordmark"><strong>Layout Studio</strong><span>${escapeHtml(layout.name)}</span></div>
      <button data-action="new-layout">New</button><button data-action="duplicate-layout">Duplicate</button><button class="danger" data-action="delete-layout">Delete</button>
      <button class="${layout.id === state.snapshot?.activeLayoutId ? "primary" : ""}" data-action="set-active">${layout.id === state.snapshot?.activeLayoutId ? "Active" : "Set active"}</button>
      <div class="toolbar-spacer"></div><span class="save-state">${state.saving ? "Saving..." : state.dirty ? "Unsaved" : "Saved"}</span>
      <label class="zoom">Zoom <input type="range" data-action="zoom" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.05" value="${state.zoom}"><span>${Math.round(state.zoom * 100)}%</span></label>
    </header>
    <section class="workspace">
      <aside class="sidebar">
        <section class="panel-section"><div class="panel-title"><strong>Layouts</strong></div><div class="layout-list">${layoutRows(state)}</div></section>
        <section class="panel-section"><div class="panel-title"><strong>Native</strong></div><div class="native-tools"><button data-native="text">Text</button><button data-native="shape">Shape</button><button data-native="image">Image</button></div></section>
        <section class="panel-section"><div class="panel-title"><strong>Visuals</strong><button data-action="refresh" title="Refresh catalogue" aria-label="Refresh catalogue">R</button></div><input class="search" data-action="catalog-filter" placeholder="Search" value="${escapeHtml(state.catalogFilter)}"><div class="catalog-list">${catalogEntries(state)}</div></section>
      </aside>
      <div class="canvas-viewport"><div class="canvas-pad"><div class="stage-shell" style="width:${stageWidth}px;height:${stageHeight}px"><section class="stage" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${state.zoom});--layout-bg:${escapeHtml(layout.background)}">${stageItems(layout, state)}</section></div></div></div>
      <aside class="inspector"><h2>${escapeHtml(selected?.item.name ?? "Inspector")}</h2><div class="layer-list"><div class="panel-title"><strong>Layers</strong><button data-action="add-layer" title="Add layer" aria-label="Add layer">+</button></div>${layerRows(layout, state)}</div>${inspector(state)}</aside>
    </section>
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ""}
  </main>`;
}

function createNativeItem(kind: "text" | "shape" | "image", layout: LayoutDocument): LayoutItem {
  const settings = kind === "text"
    ? { text: "Broadcast title", color: "#f8fafc", fontSize: 48, textAlign: "center" }
    : kind === "shape"
      ? { fill: "rgba(18,132,91,.65)", borderRadius: 4 }
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
    name: "New layout",
    width: 1920,
    height: 1080,
    background: "transparent",
    layers: [{ id: id("layer"), name: "Main", kind: "normal", visible: true, locked: false, order: 0, items: [] }],
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
    const mountedPreviews = new Map<string, () => void | Promise<void>>();
    const moduleUrls = new Map<string, string>();

    function showError(error: unknown) {
      state.error = error instanceof Error ? error.message : String(error);
      render(context.root, state);
    }

    async function cleanupPreviews() {
      const cleanups = [...mountedPreviews.values()];
      mountedPreviews.clear();
      for (const cleanup of cleanups) await cleanup();
    }

    async function loadModule(ref: string) {
      let url = moduleUrls.get(ref);
      if (!url) {
        const payload = await services.call<{ source: string }>(SERVICE_REF, "resourceSource", { ref });
        url = URL.createObjectURL(new Blob([payload.source], { type: "text/javascript" }));
        moduleUrls.set(ref, url);
      }
      return import(/* @vite-ignore */ url) as Promise<PreviewModule>;
    }

    async function mountVisualPreviews() {
      await cleanupPreviews();
      const layout = activeLayout(state);
      if (!layout || disposed) return;
      for (const layer of layout.layers) {
        for (const item of layer.items) {
          if (item.kind !== "visual" || !item.resourceRef) continue;
          const root = context.root.querySelector<HTMLElement>(`[data-preview="${CSS.escape(item.id)}"]`);
          if (!root) continue;
          try {
            const module = await loadModule(item.resourceRef);
            if (!root.isConnected || disposed) continue;
            const visual = module.default ?? module;
            const cleanup = await visual.mount?.({
              root,
              package: { id: item.packageId ?? "", name: item.packageId ?? "", enabled: true },
              exportName: item.exportName ?? item.resourceId,
              item: {
                ...item,
                package_id: item.packageId ?? "",
                export_name: item.resourceId ?? item.exportName ?? "",
                z_index: item.zIndex
              },
              settings: item.settings,
              mode: "editor",
              editor: { emit() {} },
              setActive() {},
              bus: context.telemetryHub,
              telemetryHub: context.telemetryHub,
              registry: context.registry,
              state: context.state,
              services,
              configuration: context.configuration,
              assets: context.assets,
              diagnostics: context.diagnostics,
              telemetry: context.telemetry,
              secrets: context.secrets
            });
            mountedPreviews.set(item.id, typeof cleanup === "function" ? cleanup : () => visual.unmount?.());
          } catch (error) {
            root.innerHTML = `<span>${escapeHtml(item.name)}</span>`;
            root.title = error instanceof Error ? error.message : String(error);
          }
        }
      }
    }

    function paint() {
      render(context.root, state);
      void mountVisualPreviews();
    }

    async function refresh(options: { keepSelection?: boolean } = {}) {
      const currentLayoutId = options.keepSelection ? state.layoutId : null;
      state.snapshot = await services.call<LayoutStudioSnapshot>(SERVICE_REF, "snapshot", {});
      state.layoutId = currentLayoutId && state.snapshot.layouts.some((layout) => layout.id === currentLayoutId)
        ? currentLayoutId
        : state.snapshot.activeLayoutId;
      ensureSelection(state);
      state.error = null;
      state.dirty = false;
      paint();
    }

    async function saveNow() {
      if (!state.dirty || state.saving) return;
      const layout = activeLayout(state);
      if (!layout) return;
      state.saving = true;
      render(context.root, state);
      try {
        const saved = await services.call<LayoutDocument>(SERVICE_REF, "save", { layout });
        const index = state.snapshot?.layouts.findIndex((candidate) => candidate.id === saved.id) ?? -1;
        if (state.snapshot && index >= 0) state.snapshot.layouts[index] = saved;
        state.dirty = false;
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.saving = false;
        if (!disposed) paint();
      }
    }

    function queueSave() {
      state.dirty = true;
      if (saveTimer !== null) window.clearTimeout(saveTimer);
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

    function updateSelectedField(field: string, value: unknown) {
      const selected = findItem(state);
      if (!selected) return;
      const item = selected.item;
      if (field.startsWith("setting:")) {
        item.settings[field.slice("setting:".length)] = finite(Number(value), 0);
      } else if (field === "name") {
        item.name = String(value || "Item");
      } else if (field === "visible" || field === "locked") {
        item[field] = Boolean(value);
      } else if (field === "x" || field === "y" || field === "width" || field === "height" || field === "zIndex" || field === "opacity") {
        item[field] = finite(Number(value), item[field]);
        if (field === "width" || field === "height") item[field] = Math.max(20, item[field]);
        if (field === "opacity") item.opacity = Math.max(0, Math.min(1, item.opacity));
      }
      queueSave();
      paint();
    }

    const onClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button,[data-item]") : null;
      if (!target) return;
      const layoutId = target.dataset.layout;
      if (layoutId) {
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
      if (action === "refresh") void refresh({ keepSelection: true }).catch(showError);
      if (action === "new-layout") {
        const layout = newLayout();
        void services.call<LayoutDocument>(SERVICE_REF, "save", { layout }).then(() => refresh()).then(() => {
          state.layoutId = layout.id;
          paint();
        }).catch(showError);
      }
      if (action === "duplicate-layout" && state.layoutId) {
        void services.call<LayoutDocument>(SERVICE_REF, "duplicate", { id: state.layoutId }).then((layout) => refresh().then(() => {
          state.layoutId = layout.id;
          paint();
        })).catch(showError);
      }
      if (action === "delete-layout" && state.layoutId && window.confirm("Delete this layout?")) {
        void services.call(SERVICE_REF, "remove", { id: state.layoutId }).then(() => refresh()).catch(showError);
      }
      if (action === "set-active" && state.layoutId) {
        void services.call(SERVICE_REF, "setActive", { id: state.layoutId }).then(() => refresh({ keepSelection: true })).catch(showError);
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
      }
      if (action === "delete-item") {
        const selected = findItem(state);
        if (!selected) return;
        selected.layer.items = selected.layer.items.filter((item) => item.id !== selected.item.id);
        state.itemId = null;
        queueSave();
        paint();
      }
      if (action === "forward" || action === "backward") {
        const selected = findItem(state);
        if (!selected) return;
        selected.item.zIndex += action === "forward" ? 1 : -1;
        queueSave();
        paint();
      }
      const visibleLayerId = target.dataset.layerVisible;
      if (visibleLayerId) {
        const layer = activeLayout(state)?.layers.find((candidate) => candidate.id === visibleLayerId);
        if (layer) layer.visible = !layer.visible;
        queueSave();
        paint();
      }
      const lockedLayerId = target.dataset.layerLock;
      if (lockedLayerId) {
        const layer = activeLayout(state)?.layers.find((candidate) => candidate.id === lockedLayerId);
        if (layer) layer.locked = !layer.locked;
        queueSave();
        paint();
      }
    };

    const onInput = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
      if (input.dataset.action === "zoom") {
        state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, finite(Number(input.value), state.zoom)));
        paint();
        return;
      }
      if (input.dataset.action === "catalog-filter") {
        state.catalogFilter = input.value;
        render(context.root, state);
        return;
      }
      const field = input.dataset.field;
      if (field) updateSelectedField(field, input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value);
      const setting = input.dataset.setting;
      if (setting) {
        const selected = findItem(state);
        if (!selected) return;
        selected.item.settings[setting] = input.value;
        queueSave();
        paint();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>(".stage-item") : null;
      if (!element) return;
      const selected = findItem(state);
      const itemId = element.dataset.item;
      if (!selected || selected.item.id !== itemId || selected.item.locked || selected.layer.locked) return;
      const resize = event.target instanceof Element && Boolean(event.target.closest("[data-resize]"));
      const item = selected.item;
      const origin = { x: event.clientX, y: event.clientY, itemX: item.x, itemY: item.y, width: item.width, height: item.height };
      event.preventDefault();

      const move = (moveEvent: PointerEvent) => {
        const dx = (moveEvent.clientX - origin.x) / state.zoom;
        const dy = (moveEvent.clientY - origin.y) / state.zoom;
        if (resize) {
          item.width = Math.max(20, Math.round(origin.width + dx));
          item.height = Math.max(20, Math.round(origin.height + dy));
          element.style.width = `${item.width}px`;
          element.style.height = `${item.height}px`;
        } else {
          item.x = Math.round(origin.itemX + dx);
          item.y = Math.round(origin.itemY + dy);
          element.style.left = `${item.x}px`;
          element.style.top = `${item.y}px`;
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        queueSave();
        paint();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    };

    context.root.addEventListener("click", onClick);
    context.root.addEventListener("input", onInput);
    context.root.addEventListener("pointerdown", onPointerDown);
    try {
      await refresh();
    } catch (error) {
      showError(error);
    }

    return async () => {
      disposed = true;
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      await saveNow();
      await cleanupPreviews();
      for (const url of moduleUrls.values()) URL.revokeObjectURL(url);
      context.root.removeEventListener("click", onClick);
      context.root.removeEventListener("input", onInput);
      context.root.removeEventListener("pointerdown", onPointerDown);
      context.root.innerHTML = "";
    };
  }
});
