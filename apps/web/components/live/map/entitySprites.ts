import { SPEED_BUCKET_COLORS, type SpeedBucket } from "./speedColor"

export const VEHICLE_DIMENSIONS: Record<
  string,
  { width: number; length: number }
> = {
  Car: { width: 1.9, length: 4.5 },
  Bus: { width: 2.5, length: 12 },
  Subway: { width: 2.8, length: 20 },
  Motorcycle: { width: 0.8, length: 2.2 },
  Bicycle: { width: 0.65, length: 1.8 },
  Person: { width: 0.65, length: 0.8 },
  Unknown: { width: 1.5, length: 3 },
}

export function svgDataUrl(
  body: string,
  width: number,
  height: number,
  viewBox = "0 0 64 128"
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" preserveAspectRatio="none">${body}</svg>`
  )}`
}

// Cache a bounded set of sprites (kind × speed bucket), never one texture per entity/tick.
const vehicles = new Map<
  string,
  { url: string; width: number; height: number; mask: false }
>()

export function vehicleSprite(kind: string, bucket: SpeedBucket) {
  const resolved = VEHICLE_DIMENSIONS[kind] ? kind : "Unknown"
  const key = `${resolved}:${bucket}`
  const cached = vehicles.get(key)
  if (cached) return cached
  const dimensions = VEHICLE_DIMENSIONS[resolved]!
  const width = Math.round((256 * dimensions.width) / dimensions.length)
  const color = `rgb(${SPEED_BUCKET_COLORS[bucket].join(",")})`
  const outline = 'stroke="#cbd5e1" stroke-width="2"'
  const glass = 'fill="#bce6f5" stroke="#172b40" stroke-width="2"'
  let drawing: string
  switch (resolved) {
    case "Car":
      drawing = `<rect x="1" y="23" width="6" height="23" rx="2" fill="#101827"/><rect x="57" y="23" width="6" height="23" rx="2" fill="#101827"/><rect x="1" y="84" width="6" height="23" rx="2" fill="#101827"/><rect x="57" y="84" width="6" height="23" rx="2" fill="#101827"/><rect x="6" y="2" width="52" height="124" rx="16" fill="${color}" ${outline}/><path d="M12 37L17 27H47L52 37L49 51H15Z" ${glass}/><path d="M15 89H49L52 103H12Z" ${glass}/><path d="M10 8H21M43 8H54" stroke="#fff4bf" stroke-width="5"/><path d="M10 119H22M42 119H54" stroke="${bucket === "stopped" ? "#ff3b40" : "#991b35"}" stroke-width="5"/>`
      break
    case "Bus":
    case "Subway": {
      const train = resolved === "Subway"
      drawing = `<rect x="3" y="1" width="58" height="126" rx="${train ? 14 : 6}" fill="${color}" ${outline}/><path d="M9 13Q32 5 55 13V23H9Z" ${glass}/><path d="M9 105H55V115H9Z" ${glass}/><rect x="15" y="34" width="34" height="57" rx="5" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/><path d="M22 40H42M22 85H42" stroke="#64748b" stroke-width="3"/>`
      for (let y = 30; y < 105; y += 13)
        drawing += `<path d="M6 ${y}V${y + 8}M58 ${y}V${y + 8}" stroke="#bce6f5" stroke-width="3"/>`
      if (train)
        drawing +=
          '<path d="M20 59L32 47L44 59L32 71Z" fill="none" stroke="#334155" stroke-width="3"/>'
      break
    }
    case "Motorcycle":
    case "Bicycle":
      drawing = `<path d="M32 3V31M32 98V125" stroke="#cbd5e1" stroke-width="10" stroke-linecap="round"/><path d="M32 4V30M32 100V124" stroke="#172b40" stroke-width="6"/><path d="M32 26V102M6 37H58" stroke="${color}" stroke-width="7" stroke-linecap="round"/><ellipse cx="32" cy="72" rx="${resolved === "Bicycle" ? 14 : 21}" ry="29" fill="${color}" ${outline}/><path d="M12 53L7 38M52 53L57 38" stroke="#e2e8f0" stroke-width="6" stroke-linecap="round"/><ellipse cx="32" cy="49" rx="12" ry="14" fill="#f1f5f9" stroke="#334155" stroke-width="2"/><path d="M24 44H40" stroke="#1e293b" stroke-width="5"/>`
      break
    case "Person":
      drawing = `<path d="M22 86L18 116M42 86L46 116" stroke="#cbd5e1" stroke-width="12" stroke-linecap="round"/><ellipse cx="32" cy="72" rx="27" ry="26" fill="${color}" ${outline}/><ellipse cx="32" cy="38" rx="17" ry="25" fill="#f0c9a5" stroke="#334155" stroke-width="2"/><path d="M18 29Q32 6 46 29" fill="#334155"/>`
      break
    default:
      drawing = `<path d="M32 3L61 62L32 125L3 62Z" fill="${color}" ${outline}/>`
  }
  // Roof marks make speed states distinguishable without relying only on color.
  const marks = { stopped: 0, slow: 1, reduced: 2, flowing: 3 }[bucket]
  if (!marks)
    drawing += '<path d="M24 63H40" stroke="#f8fafc" stroke-width="5"/>'
  for (let i = 0; i < marks; i++)
    drawing += `<path d="M25 ${64 + i * 8}L32 ${59 + i * 8}L39 ${64 + i * 8}" fill="none" stroke="#f8fafc" stroke-width="3"/>`
  const icon = {
    url: svgDataUrl(drawing, width, 256),
    width,
    height: 256,
    mask: false as const,
  }
  vehicles.set(key, icon)
  return icon
}

export type SignalAppearance = "Green" | "Red" | "Unknown"
const signalSprites = new Map<
  SignalAppearance,
  { url: string; width: number; height: number; mask: false }
>()
export function signalSprite(state: SignalAppearance) {
  const cached = signalSprites.get(state)
  if (cached) return cached
  const body = `<rect x="3" y="1" width="58" height="126" rx="14" fill="#172333" stroke="#cbd5e1" stroke-width="3"/><circle cx="32" cy="32" r="18" fill="${state === "Red" ? "#ff4545" : "#45313a"}"/><circle cx="32" cy="96" r="18" fill="${state === "Green" ? "#4ade80" : "#25473c"}"/>${state === "Unknown" ? '<path d="M22 64H42" stroke="#94a3b8" stroke-width="5"/>' : ""}`
  const icon = {
    url: svgDataUrl(body, 64, 128),
    width: 64,
    height: 128,
    mask: false as const,
  }
  signalSprites.set(state, icon)
  return icon
}

export function stopSprite(kind: string) {
  const rail = kind === "SubwayStation"
  const body = rail
    ? '<rect x="2" y="2" width="60" height="60" rx="12" fill="#303b79" stroke="#e0e7ff" stroke-width="3"/><path d="M15 47V18L32 37L49 18V47" fill="none" stroke="#fff" stroke-width="6"/>'
    : `<rect x="2" y="2" width="60" height="60" rx="${kind === "BusStation" ? 5 : 18}" fill="#195f80" stroke="#bae6fd" stroke-width="3"/><rect x="17" y="10" width="30" height="40" rx="6" fill="#f0f9ff"/><rect x="21" y="15" width="22" height="16" rx="2" fill="#195f80"/><path d="M22 38H26M38 38H42M22 49V54M42 49V54" stroke="#195f80" stroke-width="4"/>`
  return {
    url: svgDataUrl(body, 128, 128, "0 0 64 64"),
    width: 128,
    height: 128,
    mask: false as const,
  }
}
