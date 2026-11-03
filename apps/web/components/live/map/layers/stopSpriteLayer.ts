import { IconLayer } from "@deck.gl/layers"
import type { StopConfig } from "../../types/replay"
import { stopSprite } from "../entitySprites"

const icons = Object.fromEntries(
  ["BusStop", "BusStation", "SubwayStation"].map((kind) => [
    kind,
    stopSprite(kind),
  ])
)

/** Physical footprint in metres: a bus-stop sign/shelter, a terminal, a metro station entrance. */
export const STOP_SIZE_M: Record<string, number> = {
  BusStop: 5,
  BusStation: 16,
  SubwayStation: 22,
}

export function createStopSpriteLayer(
  stops: StopConfig[]
): IconLayer<StopConfig> {
  return new IconLayer<StopConfig>({
    id: "stops-svg",
    data: stops,
    getPosition: (d) => [d.lon, d.lat],
    getIcon: (d) => icons[d.kind]!,
    getSize: (d) => STOP_SIZE_M[d.kind] ?? 5,
    sizeUnits: "meters",
    // Stops stay findable from far away (8 px floor) but grow with the street once zoomed in.
    sizeMinPixels: 8,
    billboard: false,
    pickable: true,
  })
}
