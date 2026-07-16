export type CastTransitionPhase = "hidden" | "active" | "exiting";

export const CAST_TRANSITION_EXIT_MS = 700;

export function renderCastTransitionJaws() {
  return `
    <div class="ge-jaw" aria-hidden="true">
      <span class="ge-slab ge-slab-1"></span>
      <span class="ge-slab ge-slab-2"></span>
      <span class="ge-slab ge-slab-3"></span>
      <span class="ge-slab ge-slab-4"></span>
      <span class="ge-slab ge-slab-5"></span>
      <span class="ge-slab ge-slab-6"></span>
    </div>
  `;
}

export function castTransitionClass(phase: CastTransitionPhase) {
  if (phase === "active") return "is-active";
  if (phase === "exiting") return "is-exiting";
  return "is-hidden";
}

export function renderCastTransitionShell(
  content: string,
  options: {
    className: string;
    phase: CastTransitionPhase;
    contentClass?: string;
    ariaLive?: "off" | "polite" | "assertive";
  }
) {
  const contentClass = options.contentClass ? ` ${options.contentClass}` : "";
  return `
    <section class="ge-event ${options.className} ${castTransitionClass(options.phase)}" data-event-root>
      ${renderCastTransitionJaws()}
      <main class="ge-card${contentClass}" aria-live="${options.ariaLive ?? "polite"}">
        ${content}
      </main>
    </section>
  `;
}

export function mountOrUpdateCastTransition(
  root: HTMLElement,
  styles: string,
  content: string,
  options: {
    className: string;
    phase: CastTransitionPhase;
    contentClass?: string;
    ariaLive?: "off" | "polite" | "assertive";
  }
) {
  const eventRoot = root.querySelector<HTMLElement>("[data-event-root]");
  const card = root.querySelector<HTMLElement>(".ge-card");
  const style = root.querySelector<HTMLStyleElement>("style");

  if (!eventRoot || !card || !style) {
    root.innerHTML = `<style>${styles}</style>${renderCastTransitionShell(content, options)}`;
    return;
  }

  if (style.textContent !== styles) style.textContent = styles;
  const nextRootClass = `ge-event ${options.className} ${castTransitionClass(options.phase)}`;
  if (eventRoot.className !== nextRootClass) eventRoot.className = nextRootClass;

  const nextCardClass = `ge-card${options.contentClass ? ` ${options.contentClass}` : ""}`;
  if (card.className !== nextCardClass) card.className = nextCardClass;
  card.setAttribute("aria-live", options.ariaLive ?? "polite");
  card.innerHTML = content;
}

export const castTransitionCss = `
  .ge-event {
    --event-border: rgba(255, 255, 255, 0.16);
    --event-text: #f8fafc;
    --event-muted: rgba(226, 232, 240, 0.72);
    --event-team: #ffaa00;
    --event-contrast: #101827;
    position: absolute;
    left: 50%;
    top: 50%;
    container-type: size;
    width: var(--brl-visual-design-width, 100%);
    height: var(--brl-visual-design-height, 100%);
    transform: translate(-50%, -50%) scale(var(--brl-visual-scale, 1));
    transform-origin: center;
    min-width: 0;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    color: var(--event-text);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    opacity: 1;
    visibility: visible;
    pointer-events: none;
  }

  .ge-event.is-hidden {
    opacity: 0;
    visibility: hidden;
  }

  .ge-jaw {
    position: absolute;
    inset: -12% -10%;
    overflow: hidden;
  }

  .ge-slab {
    position: absolute;
    width: 132cqw;
    height: 31cqh;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: linear-gradient(105deg, rgba(6, 8, 12, 1), rgba(10, 12, 18, 0.99) 72%, var(--event-team));
    box-shadow: 0 18px 38px rgba(0, 0, 0, 0.38);
    opacity: 0;
    transform: var(--from);
  }

  .ge-slab-1,
  .ge-slab-3,
  .ge-slab-5 {
    left: -54cqw;
    --from: translateX(-170cqw) skewX(-14deg);
    --to: translateX(28cqw) skewX(-14deg);
    --out: translateX(170cqw) skewX(-14deg);
  }

  .ge-slab-2,
  .ge-slab-4,
  .ge-slab-6 {
    right: -54cqw;
    --from: translateX(170cqw) skewX(-14deg);
    --to: translateX(-28cqw) skewX(-14deg);
    --out: translateX(-170cqw) skewX(-14deg);
  }

  .ge-slab-1 { top: -16%; }
  .ge-slab-2 { top: 2%; }
  .ge-slab-3 { top: 20%; }
  .ge-slab-4 { top: 38%; }
  .ge-slab-5 { top: 56%; }
  .ge-slab-6 { top: 74%; }

  .ge-card {
    position: relative;
    z-index: 2;
    width: min(1280px, 86cqw);
    min-height: min(390px, 72cqh);
    display: grid;
    justify-items: center;
    align-content: center;
    gap: clamp(8px, 1.6cqh, 18px);
    padding: clamp(18px, 4.8cqh, 54px) clamp(24px, 5.6cqw, 76px);
    box-sizing: border-box;
    background: transparent;
    transform: translateY(16px) scale(0.98);
    opacity: 0;
  }

  .ge-card.ge-data-card {
    width: min(1680px, 92cqw);
    height: min(900px, 86cqh);
    min-height: 0;
    padding: 0;
    align-content: stretch;
    justify-items: stretch;
  }

  .ge-kicker {
    margin: 0;
    color: var(--event-muted);
    font-size: clamp(14px, min(1.9cqw, 4cqh), 30px);
    font-weight: 900;
    line-height: 1;
    text-shadow: 0 4px 22px rgba(0, 0, 0, 0.72);
    text-transform: uppercase;
  }

  .ge-title {
    max-width: 100%;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--event-team);
    font-size: clamp(34px, min(8.4cqw, 14cqh), 156px);
    font-weight: 950;
    line-height: 0.88;
    text-align: center;
    text-shadow: 0 8px 28px rgba(0, 0, 0, 0.78);
    text-transform: uppercase;
  }

  .ge-team {
    max-width: 100%;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--event-text);
    font-size: clamp(18px, min(3.6cqw, 6cqh), 64px);
    font-weight: 900;
    line-height: 1;
    text-align: center;
    text-shadow: 0 7px 24px rgba(0, 0, 0, 0.76);
  }

  .ge-meta {
    min-height: 38px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }

  .ge-meta span {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    border: 1px solid var(--event-border);
    background: rgba(15, 15, 20, 0.48);
    color: var(--event-muted);
    font-size: clamp(11px, min(1.35cqw, 3.2cqh), 22px);
    font-weight: 800;
    line-height: 1;
    text-transform: uppercase;
  }

  .ge-meta span:empty {
    display: none;
  }

  .ge-rule {
    width: min(460px, 44cqw);
    height: 4px;
    background: var(--event-team);
    box-shadow: 0 5px 18px rgba(0, 0, 0, 0.54);
    transform: scaleX(0);
    transform-origin: center;
  }

  .ge-event.is-active .ge-slab {
    animation: ge-slab-in 560ms cubic-bezier(0.2, 0.82, 0.2, 1) both;
  }

  .ge-event.is-active .ge-slab-2 { animation-delay: 45ms; }
  .ge-event.is-active .ge-slab-3 { animation-delay: 90ms; }
  .ge-event.is-active .ge-slab-4 { animation-delay: 135ms; }
  .ge-event.is-active .ge-slab-5 { animation-delay: 180ms; }
  .ge-event.is-active .ge-slab-6 { animation-delay: 225ms; }

  .ge-event.is-active .ge-card {
    animation: ge-card-in 360ms 820ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .ge-event.is-active .ge-rule {
    animation: ge-rule-in 460ms 920ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .ge-event.is-active .ge-title {
    animation: ge-title-hit 800ms 880ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .ge-event.is-exiting .ge-slab {
    animation: ge-slab-out 640ms cubic-bezier(0.74, 0, 0.24, 1) both;
  }

  .ge-event.is-exiting .ge-card {
    animation: ge-card-out 160ms cubic-bezier(0.4, 0, 1, 1) both;
  }

  @keyframes ge-slab-in {
    from {
      opacity: 0;
      transform: var(--from);
    }
    to {
      opacity: 1;
      transform: var(--to);
    }
  }

  @keyframes ge-slab-out {
    from {
      opacity: 1;
      transform: var(--to);
    }
    to {
      opacity: 0;
      transform: var(--out);
    }
  }

  @keyframes ge-card-in {
    from {
      opacity: 0;
      transform: translateY(28px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes ge-card-out {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(-16px) scale(0.98);
    }
  }

  @keyframes ge-rule-in {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }

  @keyframes ge-title-hit {
    0% {
      opacity: 0;
      transform: translateY(18px) scale(0.92);
    }
    54% {
      opacity: 1;
      transform: translateY(0) scale(1.04);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ge-event.is-active .ge-slab,
    .ge-event.is-exiting .ge-slab,
    .ge-event.is-active .ge-card,
    .ge-event.is-exiting .ge-card,
    .ge-event.is-active .ge-rule,
    .ge-event.is-active .ge-title {
      animation-duration: 1ms;
      animation-delay: 0ms;
    }
  }
`;
