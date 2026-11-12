import { type NextRequest, NextResponse } from "next/server"
import { coverageWarnings } from "@/lib/metrics-coverage"
import { parsePrometheusText } from "@/lib/prometheus-parser"

// Same source as /api/metrics, but HTC_METRICS_URL may list several engine nodes:
//   HTC_METRICS_URL="pereiro=http://10.0.0.5:9002/metrics,sao-paulo=http://10.0.0.6:9002/metrics"
// Each target gets its own `node` label (the name before "=", else host:port). A single plain URL
// keeps the previous behaviour (no extra label). All samples are returned so any metric can be charted.
const RAW = process.env.HTC_METRICS_URL ?? "http://localhost:9002/metrics"

export const runtime = "nodejs"
export const revalidate = 0

interface Target {
  node: string | null
  url: string
}

function targets(): Target[] {
  const parts = RAW.split(",").map((p) => p.trim()).filter(Boolean)
  return parts.map((p) => {
    const eq = p.indexOf("=")
    if (eq > 0 && !p.slice(0, eq).includes("/") && !p.slice(0, eq).includes(":")) return { node: p.slice(0, eq), url: p.slice(eq + 1) }
    let node: string | null = null
    if (parts.length > 1) {
      try {
        node = new URL(p).host
      } catch {
        node = p
      }
    }
    return { node, url: p }
  })
}

export async function GET(_req: NextRequest) {
  const meta = new Map<string, { name: string; type: string; help: string }>()
  const samples: { n: string; l: Record<string, string>; v: number }[] = []
  const errors: string[] = []
  const list = targets()
  await Promise.all(
    list.map(async (t) => {
      try {
        const res = await fetch(t.url, { headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 600)}`)
        const families = parsePrometheusText(await res.text())
        for (const f of families.values()) {
          if (!meta.has(f.name)) meta.set(f.name, { name: f.name, type: f.type, help: f.help })
          for (const s of f.samples) {
            if (!Number.isFinite(s.value)) continue
            samples.push({ n: s.name, l: t.node ? { ...s.labels, node: s.labels.node ?? t.node } : s.labels, v: s.value })
          }
        }
      } catch (e) {
        errors.push(`${t.node ?? t.url}: ${(e as Error).message}`)
      }
    })
  )
  errors.push(...coverageWarnings(samples.map(s=>({name:s.n,labels:s.l,value:s.v}))))
  if (samples.length === 0) {
    return NextResponse.json(
      { error: `Cannot reach metrics endpoint: ${errors.join("; ")}`, url: list.map((t) => t.url).join(", ") },
      { status: 503 }
    )
  }
  return NextResponse.json({
    ts: Date.now(),
    url: list.map((t) => t.url).join(", "),
    nodes: list.filter((t) => t.node).map((t) => t.node),
    errors,
    meta: [...meta.values()],
    samples,
  })
}
