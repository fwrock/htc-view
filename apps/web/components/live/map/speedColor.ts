export type SpeedBucket = "stopped" | "slow" | "reduced" | "flowing";

// Thresholds are fractions of the link's own freeSpeed, not absolute km/h — so "flowing"
// means "near this road's configured free-flow speed", not an arbitrary global constant.
const STOPPED_KMH = 2;
const SLOW_RATIO = 0.4;
const REDUCED_RATIO = 0.8;

export const SPEED_BUCKET_COLORS: Record<SpeedBucket, [number, number, number]> = {
  stopped: [20, 20, 20],
  slow: [220, 40, 40],
  reduced: [255, 202, 40],
  flowing: [56, 176, 84]
};

export const SPEED_BUCKET_LABELS: Record<SpeedBucket, string> = {
  stopped: "Parada",
  slow: "Lenta",
  reduced: "Reduzida",
  flowing: "Fluindo"
};

export function speedBucket(speedKmh: number, freeSpeedKmh: number): SpeedBucket {
  if (speedKmh <= STOPPED_KMH) return "stopped";
  const ratio = freeSpeedKmh > 0 ? speedKmh / freeSpeedKmh : 1;
  if (ratio < SLOW_RATIO) return "slow";
  if (ratio < REDUCED_RATIO) return "reduced";
  return "flowing";
}

export function speedColor(speedKmh: number, freeSpeedKmh: number): [number, number, number] {
  return SPEED_BUCKET_COLORS[speedBucket(speedKmh, freeSpeedKmh)];
}
