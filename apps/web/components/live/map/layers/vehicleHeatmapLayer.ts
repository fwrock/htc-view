import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { VehiclePosition } from "./vehicleScatterLayer";

/** Congestion heatmap: weight is inverse speed, so slow-moving clusters read as "hot".
 * This is the zoomed-out rendering path — it scales with viewport pixel grid, not vehicle
 * count, which is what makes the millions-of-vehicles target tractable (see docs/KNOWN_GAPS.md
 * for what's still missing to reach that scale for real: server-side tiling/binning).
 */
export function createVehicleHeatmapLayer(positions: VehiclePosition[]): HeatmapLayer<VehiclePosition> {
  return new HeatmapLayer<VehiclePosition>({
    id: "vehicle-congestion-heatmap",
    data: positions,
    getPosition: (d) => d.position,
    getWeight: (d) => (d.speedKmh > 0 ? 1 / d.speedKmh : 1),
    radiusPixels: 40,
    intensity: 1,
    threshold: 0.05
  });
}
