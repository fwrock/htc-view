import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { VehiclePosition } from "./vehicleScatterLayer";

export type EmissionKind = "co2Grams" | "noxGrams" | "pm25Grams";

/** Only ever added to the layer stack when `manifest.hasEmissions === true` — callers must
 * check that flag themselves; this layer doesn't defend against an all-zero dataset.
 */
export function createEmissionHeatmapLayer(
  positions: VehiclePosition[],
  kind: EmissionKind
): HeatmapLayer<VehiclePosition> {
  return new HeatmapLayer<VehiclePosition>({
    id: `emission-heatmap-${kind}`,
    data: positions,
    getPosition: (d) => d.position,
    getWeight: (d) => Math.max(0, d[kind] || 0),
    radiusPixels: 40,
    intensity: 2,
    threshold: 0.03
  });
}
