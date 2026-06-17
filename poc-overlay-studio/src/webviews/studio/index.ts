const root = document.createElement("main");
root.className = "studio";
root.innerHTML = `
  <header>
    <p>POC Overlay Studio</p>
    <strong>Extension point: overlay-studio.visual</strong>
  </header>
  <section>
    <h1>Platform plugin surface</h1>
    <p>This webview is intentionally thin. The host owns discovery, service mediation, and resource access.</p>
  </section>
`;

const style = document.createElement("style");
style.textContent = `
  *{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#172033;font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}
  .studio{min-height:100vh;padding:22px;display:grid;gap:18px;align-content:start}
  header{display:grid;gap:4px;border-bottom:1px solid #d8e0eb;padding-bottom:14px}header p{margin:0;color:#64748b;text-transform:uppercase;font-size:12px;font-weight:900}header strong{font-size:20px}
  section{max-width:720px;background:#fff;border:1px solid #d8e0eb;padding:18px}h1{margin:0 0 8px;font-size:22px}p{margin:0;color:#475569}
`;

document.head.append(style);
document.body.append(root);
