import type { LinksTable, NodesTable, RailLinksTable } from "../types/replay";

export interface LinkGeometry {
  lat0: number;
  lon0: number;
  lat1: number;
  lon1: number;
  lengthM: number;
  freeSpeedKmh: number;
}

export interface NodePoint {
  lat: number;
  lon: number;
}

/** `link_id -> geometry` lookup — live events only carry `link_id`, never coordinates, so
 * incoming vehicle events need the same static `links.arrow` join the batch ETL does upfront
 * (see docs/ETL_SCHEMA.md: segment rows always denormalize link geometry, never a runtime
 * join). Built once per scenario load, same lifetime as `freeSpeedLookup` in loadFrames.ts.
 */
export function buildLinkGeometryLookup(links: LinksTable | RailLinksTable): Map<string, LinkGeometry> {
  const lookup = new Map<string, LinkGeometry>();
  for (let i = 0; i < links.length; i++) {
    lookup.set(links.linkId[i]!, {
      lat0: links.lat0[i]!,
      lon0: links.lon0[i]!,
      lat1: links.lat1[i]!,
      lon1: links.lon1[i]!,
      lengthM: links.lengthM[i]!,
      freeSpeedKmh: links.freeSpeedKmh[i]!
    });
  }
  return lookup;
}

/** `node_id -> {lat,lon}` lookup — needed for live `person_walking_start` events, which are
 * node-to-node chords rather than link traversals (mirrors the ETL's `directGeometry` path;
 * see docs/ETL_SCHEMA.md "Person walking legs are node-to-node, not link-to-link"). */
export function buildNodePointLookup(nodes: NodesTable): Map<string, NodePoint> {
  const lookup = new Map<string, NodePoint>();
  for (let i = 0; i < nodes.length; i++) {
    lookup.set(nodes.nodeId[i]!, { lat: nodes.lat[i]!, lon: nodes.lon[i]! });
  }
  return lookup;
}
