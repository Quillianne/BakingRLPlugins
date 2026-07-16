export type CageMapMetric = "goal" | "crossbar" | "save";
export type CageMapSide = "negative" | "positive";

export type CageMapRecord = {
  metric: CageMapMetric;
  cageSide?: CageMapSide;
  player?: {
    Name?: string;
  };
  projection: {
    horizontal: number;
    vertical: number;
  };
};

type CageMapOptions = {
  label?: string;
};

const GOAL_HALF_WIDTH = 900;
const GOAL_HEIGHT = 650;
const FRAME_X = 10;
const FRAME_Y = 14;
const FRAME_WIDTH = 140;
const FRAME_HEIGHT = 50;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function metricLabel(metric: CageMapMetric) {
  switch (metric) {
    case "goal":
      return "Goal";
    case "crossbar":
      return "Crossbar";
    case "save":
      return "Save";
  }
}

function pointX(record: CageMapRecord) {
  const horizontal = record.cageSide === "positive" ? -record.projection.horizontal : record.projection.horizontal;
  return clamp(
    FRAME_X + ((horizontal + GOAL_HALF_WIDTH) / (GOAL_HALF_WIDTH * 2)) * FRAME_WIDTH,
    FRAME_X + 3,
    FRAME_X + FRAME_WIDTH - 3
  );
}

function pointY(record: CageMapRecord) {
  return clamp(
    FRAME_Y + FRAME_HEIGHT - (record.projection.vertical / GOAL_HEIGHT) * FRAME_HEIGHT,
    FRAME_Y + 3,
    FRAME_Y + FRAME_HEIGHT - 3
  );
}

function renderMarker(record: CageMapRecord) {
  const xValue = pointX(record);
  const yValue = pointY(record);
  const x = xValue.toFixed(2);
  const y = yValue.toFixed(2);
  const label = `${metricLabel(record.metric)} - ${record.player?.Name ?? "Unknown"}`;

  if (record.metric === "crossbar") {
    return `
      <g class="point crossbar" aria-label="${escapeHtml(label)}">
        <title>${escapeHtml(label)}</title>
        <line x1="${(xValue - 2.8).toFixed(2)}" y1="${(yValue - 2.8).toFixed(2)}" x2="${(xValue + 2.8).toFixed(2)}" y2="${(yValue + 2.8).toFixed(2)}"></line>
        <line x1="${(xValue + 2.8).toFixed(2)}" y1="${(yValue - 2.8).toFixed(2)}" x2="${(xValue - 2.8).toFixed(2)}" y2="${(yValue + 2.8).toFixed(2)}"></line>
      </g>
    `;
  }

  return `<circle class="point ${record.metric}" cx="${x}" cy="${y}" r="3.8">
    <title>${escapeHtml(label)}</title>
  </circle>`;
}

export const cageMapStyles = `
  .cage-map {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: block;
    background: transparent;
  }
  .goal-surface {
    fill: var(--cage-tint, rgba(255, 255, 255, 0.025));
  }
  .stats-label {
    fill: rgba(226, 232, 240, 0.64);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 5px;
    font-weight: 800;
    letter-spacing: 0;
  }
  .goal-frame,
  .goal-line {
    fill: none;
    stroke: var(--cage-line, rgba(255, 255, 255, 0.34));
    stroke-width: 1.2;
  }
  .goal-line.muted {
    stroke: rgba(255, 255, 255, 0.11);
  }
  .point.goal {
    fill: #22c55e;
    stroke: rgba(255, 255, 255, 0.62);
    stroke-width: 0.65;
  }
  .point.save {
    fill: #ef4444;
    stroke: rgba(255, 255, 255, 0.62);
    stroke-width: 0.65;
  }
  .point.crossbar line {
    stroke: #ef4444;
    stroke-linecap: round;
    stroke-width: 1.8;
  }
`;

export function renderCageMap(records: CageMapRecord[], options: CageMapOptions = {}) {
  const label = options.label?.trim();
  return `
    <svg class="cage-map" viewBox="0 0 160 70" role="img" aria-label="Cage projection">
      ${label ? `<text class="stats-label" x="${FRAME_X + FRAME_WIDTH}" y="${FRAME_Y - 5}" text-anchor="end">${escapeHtml(label)}</text>` : ""}
      <rect class="goal-surface" x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" rx="1.5"></rect>
      <rect class="goal-frame" x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" rx="1.5"></rect>
      <line class="goal-line muted" x1="${FRAME_X + FRAME_WIDTH / 2}" y1="${FRAME_Y}" x2="${FRAME_X + FRAME_WIDTH / 2}" y2="${FRAME_Y + FRAME_HEIGHT}"></line>
      <line class="goal-line muted" x1="${FRAME_X}" y1="${FRAME_Y + FRAME_HEIGHT / 2}" x2="${FRAME_X + FRAME_WIDTH}" y2="${FRAME_Y + FRAME_HEIGHT / 2}"></line>
      ${records.map(renderMarker).join("")}
    </svg>
  `;
}
