import { ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { WorkerFrame } from "../../data/useVehicleWorker";

/** Circle representation fed straight from the worker's typed-array output — no per-vehicle
 * JS object is ever created on the main thread. This is the path meant to scale: deck.gl
 * uploads `positions`/`colors` as GPU attribute buffers directly, the same way it would for
 * any large point cloud, instead of paying per-item accessor-function overhead.
 */
export function createVehicleBinaryScatterLayer(frame: WorkerFrame): ScatterplotLayer {
  return new ScatterplotLayer({
    id: "vehicles-binary",
    data: {
      length: frame.count,
      attributes: {
        getPosition: { value: frame.positions, size: 2 },
        getFillColor: { value: frame.colors, size: 3 }
      }
    },
    getRadius: 6,
    radiusUnits: "pixels",
    updateTriggers: { getPosition: frame.version, getFillColor: frame.version }
  });
}

export function createVehicleBinaryHeatmapLayer(frame: WorkerFrame): HeatmapLayer {
  return new HeatmapLayer({
    id: "vehicles-binary-heatmap",
    data: {
      length: frame.count,
      attributes: {
        getPosition: { value: frame.positions, size: 2 },
        getWeight: { value: frame.weights, size: 1 }
      }
    },
    radiusPixels: 40,
    intensity: 1,
    threshold: 0.05,
    updateTriggers: { getPosition: frame.version, getWeight: frame.version }
  });
}
