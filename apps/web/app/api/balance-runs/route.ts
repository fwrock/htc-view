import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const base = process.env.HTC_BALANCE_RUNS_URL
  if (!base) return NextResponse.json({ enabled: false, runs: [] })
  const id = new URL(request.url).searchParams.get("id")
  if (id && !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid run ID" }, { status: 400 })
  try {
    const response = await fetch(base.replace(/\/$/, "") + (id ? `/${id}` : ""), { cache: "no-store", signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Run metrics service returned HTTP ${response.status}`)
    return NextResponse.json(await response.json())
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 })
  }
}
