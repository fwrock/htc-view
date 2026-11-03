import type { StyleSpecification } from "maplibre-gl"

/** Shared basemap for live and replay. Public tiles are for interactive viewing;
 * use a suitable provider/self-hosted service for larger deployments or offline maps. */
export function getMapStyle(scenarioMode?: "osm", backgroundOverride?: "none" | "osm"): string | StyleSpecification {
  // Background selection does not establish OSM compatibility of the simulation graph.
  // The verified synthetic demo is standalone; keep its background independent by default.
  const background =
    backgroundOverride ?? process.env.NEXT_PUBLIC_HTC_MAP_BACKGROUND ?? scenarioMode ?? "none"
  if (background !== "none" && background !== "osm") {
    throw new Error("NEXT_PUBLIC_HTC_MAP_BACKGROUND must be none or osm")
  }
  if (background === "none") {
    return {
      version: 8,
      sources: {},
      layers: [
        {
          id: "standalone-background",
          type: "background",
          paint: { "background-color": "#18212b" },
        },
      ],
    }
  }
  if (process.env.NEXT_PUBLIC_HTC_MAP_STYLE_URL) {
    return process.env.NEXT_PUBLIC_HTC_MAP_STYLE_URL
  }
  return {
    version: 8,
    sources: {
      openstreetmap: {
        type: "raster",
        tiles: [
          process.env.NEXT_PUBLIC_HTC_OSM_TILE_URL ??
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution:
          process.env.NEXT_PUBLIC_HTC_MAP_ATTRIBUTION ??
          '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
      },
    },
    layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap" }],
  }
}
