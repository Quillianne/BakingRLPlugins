export function fitVisualScale(root: HTMLElement, designWidth: number, designHeight: number) {
  root.style.setProperty("--brl-visual-design-width", `${designWidth}px`);
  root.style.setProperty("--brl-visual-design-height", `${designHeight}px`);

  function update(width = root.clientWidth, height = root.clientHeight) {
    const nextScale =
      width > 0 && height > 0 && designWidth > 0 && designHeight > 0
        ? Math.min(width / designWidth, height / designHeight)
        : 1;
    root.style.setProperty("--brl-visual-scale", String(Math.max(0.01, nextScale)));
  }

  update();
  const frame = window.requestAnimationFrame(() => update());
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    update(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(root);

  return () => {
    window.cancelAnimationFrame(frame);
    observer.disconnect();
    root.style.removeProperty("--brl-visual-design-width");
    root.style.removeProperty("--brl-visual-design-height");
    root.style.removeProperty("--brl-visual-scale");
  };
}
