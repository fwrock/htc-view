/** Nominal lane width: scenario data provides lane counts, not measured road widths. */
export const LANE_WIDTH_M = 3.2

/** deck.gl rotates icons counterclockwise; SVGs point north at zero degrees. */
export function entityAngle(
  from: readonly number[],
  to: readonly number[]
): number {
  const east =
    (to[0]! - from[0]!) * Math.cos((((from[1]! + to[1]!) / 2) * Math.PI) / 180)
  const north = to[1]! - from[1]!
  return (-Math.atan2(east, north) * 180) / Math.PI
}

export function offsetMetres(
  point: readonly number[],
  east: number,
  north: number
): [number, number] {
  return [
    point[0]! + east / (111195 * Math.cos((point[1]! * Math.PI) / 180)),
    point[1]! + north / 111195,
  ]
}

/** MICRO lane 0 is the rightmost lane. Unknown observations stay on the centreline. */
export function lanePosition(
  start: number | undefined,
  end: number | undefined,
  t: number,
  lanes: number
): number | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(lanes > 0))
    return undefined
  const last = Math.max(0, Math.round(lanes) - 1)
  return Math.max(0, Math.min(last, start! + (end! - start!) * t))
}

export function positionInLane(
  point: [number, number],
  angle: number,
  lane: number | undefined,
  lanes: number
): [number, number] {
  if (lane === undefined) return point
  const left = (lane - (Math.max(1, lanes) - 1) / 2) * LANE_WIDTH_M
  const bearing = (-angle * Math.PI) / 180
  return offsetMetres(
    point,
    -Math.cos(bearing) * left,
    Math.sin(bearing) * left
  )
}
