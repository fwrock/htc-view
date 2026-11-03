/** Uniform grid spatial index over segment midpoints, used to cull the per-frame
 * interpolation loop down to "segments whose link plausibly intersects the current
 * viewport" before doing any per-segment tick/interpolation work. A segment is bucketed by
 * the midpoint of its two endpoints — links are short relative to city scale (tens to a few
 * hundred meters in every fixture seen so far), so this is an acceptable approximation; a
 * segment that spans a much longer link could be missed near the viewport edge (see
 * docs/KNOWN_GAPS.md).
 */
export interface SpatialGrid {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  buckets: Map<number, Int32Array>;
}

export function buildSpatialGrid(
  lat0: Float32Array,
  lon0: Float32Array,
  lat1: Float32Array,
  lon1: Float32Array,
  targetCellsPerAxis = 200
): SpatialGrid {
  const n = lat0.length;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (let i = 0; i < n; i++) {
    minLat = Math.min(minLat, lat0[i]!, lat1[i]!);
    maxLat = Math.max(maxLat, lat0[i]!, lat1[i]!);
    minLon = Math.min(minLon, lon0[i]!, lon1[i]!);
    maxLon = Math.max(maxLon, lon0[i]!, lon1[i]!);
  }
  if (!Number.isFinite(minLat)) {
    minLat = 0;
    maxLat = 0;
    minLon = 0;
    maxLon = 0;
  }

  const cols = targetCellsPerAxis;
  const rows = targetCellsPerAxis;
  const cellWidth = (maxLon - minLon || 1) / cols;
  const cellHeight = (maxLat - minLat || 1) / rows;

  const cellOf = (i: number): number => {
    const midLat = (lat0[i]! + lat1[i]!) / 2;
    const midLon = (lon0[i]! + lon1[i]!) / 2;
    const col = clamp(Math.floor((midLon - minLon) / cellWidth), 0, cols - 1);
    const row = clamp(Math.floor((midLat - minLat) / cellHeight), 0, rows - 1);
    return row * cols + col;
  };

  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const key = cellOf(i);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const buckets = new Map<number, Int32Array>();
  const cursors = new Map<number, number>();
  for (const [key, count] of counts) {
    buckets.set(key, new Int32Array(count));
    cursors.set(key, 0);
  }
  for (let i = 0; i < n; i++) {
    const key = cellOf(i);
    const cursor = cursors.get(key)!;
    buckets.get(key)![cursor] = i;
    cursors.set(key, cursor + 1);
  }

  return { minLat, maxLat, minLon, maxLon, cols, rows, cellWidth, cellHeight, buckets };
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Yields segment indices from every grid cell overlapping `bounds`. Cheap when the viewport
 * covers a small fraction of the scenario's extent (the common case once zoomed in); degrades
 * to "every segment" when the viewport covers the whole grid (zoomed out) — which is exactly
 * when the caller should be using the aggregated heatmap path instead, not this one.
 */
export function* queryGrid(grid: SpatialGrid, bounds: Bounds): Generator<number> {
  const colStart = clamp(Math.floor((bounds.west - grid.minLon) / grid.cellWidth), 0, grid.cols - 1);
  const colEnd = clamp(Math.floor((bounds.east - grid.minLon) / grid.cellWidth), 0, grid.cols - 1);
  const rowStart = clamp(Math.floor((bounds.south - grid.minLat) / grid.cellHeight), 0, grid.rows - 1);
  const rowEnd = clamp(Math.floor((bounds.north - grid.minLat) / grid.cellHeight), 0, grid.rows - 1);

  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const bucket = grid.buckets.get(row * grid.cols + col);
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) yield bucket[i]!;
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
