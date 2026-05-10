import { defineComponent, type ComponentContext } from "@bakingrl/plugin-sdk";
import { cageMapStyles, renderCageMap, type CageMapRecord, type CageMapSide } from "../../shared/cage-map";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function side(value: unknown): CageMapSide | undefined {
  return value === "negative" || value === "positive" ? value : undefined;
}

function recordsFromProps(props: Record<string, unknown>): CageMapRecord[] {
  const fallbackSide = side(props.side);
  if (!Array.isArray(props.records)) return [];
  return props.records.flatMap((item): CageMapRecord[] => {
    if (!isRecord(item) || !isRecord(item.projection)) return [];
    const metric = item.metric;
    if (metric !== "goal" && metric !== "crossbar" && metric !== "save") return [];
    const horizontal = item.projection.horizontal;
    const vertical = item.projection.vertical;
    if (typeof horizontal !== "number" || typeof vertical !== "number") return [];
    const player = isRecord(item.player) && typeof item.player.Name === "string" ? { Name: item.player.Name } : undefined;
    return [
      {
        metric,
        cageSide: side(item.cageSide) ?? fallbackSide,
        player,
        projection: { horizontal, vertical }
      }
    ];
  });
}

export default defineComponent({
  async mount(context: ComponentContext, props: Record<string, unknown>) {
    context.root.innerHTML = `
      <style>
        :root,
        body {
          margin: 0;
          background: transparent;
        }
        .cage-map-host {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent;
        }
        ${cageMapStyles}
      </style>
      <div class="cage-map-host">${renderCageMap(recordsFromProps(props))}</div>
    `;
  }
});
