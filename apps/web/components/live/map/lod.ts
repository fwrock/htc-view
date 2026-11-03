/** Below this zoom, individual vehicles are aggregated into a heatmap instead of drawn as
 * discrete points — the lever that keeps rendering cost bounded by viewport pixels rather
 * than vehicle count. Per-vehicle viewport culling above this threshold is not yet
 * implemented (see docs/KNOWN_GAPS.md) — v1 renders every active vehicle in the dataset
 * once zoomed in, which is fine at thousands of vehicles but not yet at millions.
 */
export const AGGREGATE_ZOOM_THRESHOLD = 14;

export function shouldAggregate(zoom: number): boolean {
  return zoom < AGGREGATE_ZOOM_THRESHOLD;
}
