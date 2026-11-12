import { spawn } from "node:child_process"
import path from "node:path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: Request) {
  let payload
  try {
    const body = await request.text()
    if (Buffer.byteLength(body) > 32 * 1024 * 1024) return NextResponse.json({ error: "Report exceeds 32 MB. Export smaller sections." }, { status: 413 })
    payload = JSON.parse(body)
    if (!["pdf", "zip"].includes(payload.format) || !Array.isArray(payload.panels) || !payload.panels.length || payload.panels.length > 250) throw new Error("Invalid report request")
    for (const panel of payload.panels) {
      if (typeof panel.title !== "string" || !["series", "bars", "bins", "table", "matrix"].includes(panel.data?.kind) || typeof panel.csv !== "string" || typeof panel.latex !== "string") throw new Error("Invalid panel data")
    }
  } catch {
    return NextResponse.json({ error: "Invalid report request" }, { status: 400 })
  }
  try {
    const output = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(process.env.HTC_REPORT_PYTHON ?? "python3", [path.join(process.cwd(), "scripts/render-report.py")], { stdio: ["pipe", "pipe", "pipe"] })
      const chunks: Buffer[] = []
      let size = 0
      let stderr = ""
      const abort = () => { child.kill(); reject(new Error("Report export cancelled")) }
      const timer = setTimeout(() => { child.kill(); reject(new Error("Report generation timed out. Export smaller sections.")) }, 290_000)
      const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener("abort", abort) }
      request.signal.addEventListener("abort", abort, { once: true })
      if (request.signal.aborted) abort()
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > 128 * 1024 * 1024) { child.kill(); reject(new Error("Generated report is too large. Export smaller sections.")) }
        else chunks.push(chunk)
      })
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000) })
      child.stdin.on("error", () => {})
      child.on("error", (error) => { cleanup(); reject(error) })
      child.on("close", (code) => {
        cleanup()
        if (code === 0) resolve(Buffer.concat(chunks))
        else { console.error("Report renderer:", stderr); reject(new Error("Report generation failed. Check that Python and matplotlib are installed on the UI server.")) }
      })
      if (!request.signal.aborted) child.stdin.end(JSON.stringify(payload))
    })
    return new Response(new Uint8Array(output), { headers: {
      "Content-Type": payload.format === "pdf" ? "application/pdf" : "application/zip",
      "Content-Disposition": `attachment; filename="htc-report.${payload.format}"`,
      "Cache-Control": "no-store",
    } })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
