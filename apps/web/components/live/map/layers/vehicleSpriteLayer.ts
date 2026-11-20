import { IconLayer } from "@deck.gl/layers"
import type { VehiclePosition } from "./vehicleScatterLayer"
import { vehicleSprite, VEHICLE_DIMENSIONS } from "../entitySprites"
import { speedBucket } from "../speedColor"

export function createVehicleSpriteLayer(
  positions: VehiclePosition[],
  color?: (d: VehiclePosition) => [number, number, number]
): IconLayer<VehiclePosition> {
  return new IconLayer<VehiclePosition>({
    id: "vehicles-svg",
    data: positions,
    getPosition: (d) => d.position,
    getIcon: (d) =>
      (color ? { ...vehicleSprite(d.vehicleKind, speedBucket(d.speedKmh, d.freeSpeedKmh)), mask: true } : vehicleSprite(d.vehicleKind, speedBucket(d.speedKmh, d.freeSpeedKmh))),
    getColor: color ?? (() => [255, 255, 255]),
    getSize: (d) =>
      (VEHICLE_DIMENSIONS[d.vehicleKind] ?? VEHICLE_DIMENSIONS.Unknown)!.length,
    getAngle: (d) => d.angle,
    sizeUnits: "meters",
    sizeBasis: "height",
    billboard: false,
    // No minimum pixel size: entities and streets grow together as the user zooms in.
    sizeMinPixels: 0,
    updateTriggers: { getIcon: !!color, getColor: color },
    pickable: true,
  })
}
