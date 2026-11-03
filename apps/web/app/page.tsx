"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Activity, ArrowRight, Map, Play } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import {
  getSimedapeHealth,
  listRuns,
  type RunStatus,
  type RunSummary,
} from "@/lib/simedape-api"

const actions = [
  {
    label: "Executar simulação",
    text: "Controle o HTC: inicie, acompanhe ao vivo e veja execuções e resultados.",
    href: "/simulator",
    icon: Play,
  },
  {
    label: "SimEDaPE",
    text: "Estimação sobre os resultados: seleção parcial e métricas.",
    href: "/simedape",
    icon: Activity,
  },
]

type Lane = "user" | "htc" | "simedape"

const lanes: { id: Lane; label: string }[] = [
  { id: "user", label: "Você" },
  { id: "htc", label: "HTC (simulador)" },
  { id: "simedape", label: "SimEDaPE" },
]

const flow: { lane: Lane; title: string; lines: [string, string] }[] = [
  { lane: "user", title: "1 · Cenário", lines: ["Standalone ou", "baseado em OSM"] },
  { lane: "htc", title: "2 · Simulação base", lines: ["Execução completa", "do cenário"] },
  { lane: "user", title: "3 · Revisa", lines: ["Confere resultados", "e replay da base"] },
  { lane: "simedape", title: "4 · Treina o modelo", lines: ["Clusteriza e aprende", "com a base"] },
  { lane: "simedape", title: "5 · Seleciona", lines: ["Define o que deve", "ser executado"] },
  { lane: "htc", title: "6 · Simulação parcial", lines: ["Executa só a", "seleção"] },
  { lane: "simedape", title: "7 · Estima", lines: ["Resultado completo", "via modelo treinado"] },
]

const BOX_W = 146
const BOX_H = 62
const GAP = 24
const LANE_H = 96
const LABEL_W = 0
const PAD = 12
const FLOW_W = PAD * 2 + flow.length * BOX_W + (flow.length - 1) * GAP + LABEL_W
const FLOW_H = lanes.length * LANE_H + 8

function FlowDiagram() {
  const { t: translateText } = useI18n()

  const laneY = (l: Lane) => lanes.findIndex((x) => x.id === l) * LANE_H + 4
  const boxes = flow.map((f, i) => ({
    ...f,
    x: PAD + i * (BOX_W + GAP),
    y: laneY(f.lane) + (LANE_H - BOX_H) / 2,
  }))
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${FLOW_W} ${FLOW_H}`}
        style={{ minWidth: 860 }}
        className="h-auto w-full"
        role="img"
        aria-label={translateText("Fluxo: cenário, simulação base no HTC, revisão, treino do modelo no SimEDaPE, seleção, simulação parcial no HTC e estimativa no SimEDaPE")}
      >
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="var(--muted-foreground)" />
          </marker>
        </defs>
        {lanes.map((l, i) => (
          <g key={l.id}>
            <rect
              x={0}
              y={i * LANE_H + 4}
              width={FLOW_W}
              height={LANE_H}
              fill={i % 2 ? "transparent" : "var(--muted)"}
              opacity={0.35}
            />
            <text
              x={6}
              y={i * LANE_H + 17}
              fontSize={9}
              letterSpacing={1.2}
              fill="var(--muted-foreground)"
              style={{ textTransform: "uppercase" }}
            >
              {translateText(l.label)}
            </text>
          </g>
        ))}
        {boxes.slice(0, -1).map((b, i) => {
          const n = boxes[i + 1]!
          const x1 = b.x + BOX_W
          const y1 = b.y + BOX_H / 2
          const x2 = n.x
          const y2 = n.y + BOX_H / 2
          const mx = x1 + GAP / 2
          return (
            <path
              key={i}
              d={`M${x1} ${y1}H${mx}V${y2}H${x2 - 1}`}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeWidth={1.3}
              markerEnd="url(#flow-arrow)"
            />
          )
        })}
        {boxes.map((b) => (
          <g key={b.title}>
            <rect
              x={b.x}
              y={b.y}
              width={BOX_W}
              height={BOX_H}
              rx={3}
              fill="var(--card)"
              stroke={b.lane === "htc" ? "var(--primary)" : "var(--border)"}
              strokeWidth={b.lane === "htc" ? 1.6 : 1}
            />
            <text x={b.x + 9} y={b.y + 22} fontSize={12} fontWeight={600} fill="var(--foreground)">
              {translateText(b.title)}
            </text>
            <text x={b.x + 9} y={b.y + 38} fontSize={10} fill="var(--muted-foreground)">
              {translateText(b.lines[0])}
            </text>
            <text x={b.x + 9} y={b.y + 51} fontSize={10} fill="var(--muted-foreground)">
              {translateText(b.lines[1])}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

const statusClass: Record<RunStatus, string> = {
  queued: "border-border bg-muted text-muted-foreground",
  running: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  completed:
    "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  cancelled: "border-border bg-muted text-muted-foreground",
}

const statusLabel: Record<RunStatus, string> = {
  queued: "Na fila",
  running: "Em execução",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
}

function when(ts: number, intlLocale: string) {
  return new Date(ts * 1000).toLocaleString(intlLocale, {
    dateStyle: "short",
    timeStyle: "short",
  })
}

export default function Page() {
  const { t: translateText, intlLocale } = useI18n()

  const [online, setOnline] = useState<boolean | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        await getSimedapeHealth()
        const list = await listRuns()
        if (!active) return
        setOnline(true)
        setRuns([...list].sort((a, b) => b.created_at - a.created_at))
      } catch {
        if (active) setOnline(false)
      }
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const active = runs.filter(
    (r) => r.status === "running" || r.status === "queued"
  ).length
  const recent = runs.slice(0, 6)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{translateText("Dashboard")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{translateText("HTC Platform: execute cenários, visualize resultados e analise com SimEDaPE.")}</p>
        </div>
        <div
          className="flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-1.5 text-[11px]"
          role="status"
        >
          <span
            className={cn(
              "size-2 rounded-full",
              online === null && "bg-muted-foreground",
              online === true && "bg-green-500",
              online === false && "bg-red-500"
            )}
          />
          {online === null ? translateText("Verificando API…") : online ? translateText("API de jobs online · {0} ativo(s)", { 0: active }) : translateText("API de jobs offline")}
        </div>
      </div>

      {online === false && (
        <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">{translateText("Não foi possível contatar a API de jobs. Inicie-a com")}{" "}
          <code className="font-mono">scripts/run-native-integration-demo.sh</code>{" "}{translateText("(veja docs/RUNNING.md).")}</div>
      )}

      <section aria-label={translateText("Fluxo de trabalho")}>
        <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText("Fluxo de trabalho")}</p>
        <div className="rounded-sm border border-border bg-background p-4">
          <FlowDiagram />
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{translateText("Só as etapas 1 a 3 são uma execução completa do HTC (sem SimEDaPE). As etapas 4 a 7 formam a simulação parcial: o SimEDaPE treina com a base, indica o que executar, o HTC simula só essa parte e o modelo estima o restante.")}</p>
        </div>
      </section>

      <section aria-label={translateText("Ações")}>
        <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText("Ações")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {actions.map((a) => {
            const Icon = a.icon
            return (
              <Link
                key={a.label}
                href={a.href}
                className="group flex items-start gap-3 rounded-sm border border-border bg-card p-4 transition-colors hover:border-ring"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{translateText(a.label)}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {translateText(a.text)}
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            )
          })}
        </div>
      </section>

      <section aria-label={translateText("Execuções recentes")}>
        <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText("Execuções recentes")}</p>
        <div className="rounded-sm border border-border bg-card">
          {recent.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {online === false ? translateText("Indisponível: API offline.") : translateText("Nenhuma execução ainda. Use “Executar HTC” para começar.")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li
                  key={r.run_id}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs"
                >
                  <span
                    className={cn(
                      "rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest",
                      statusClass[r.status]
                    )}
                  >
                    {translateText(statusLabel[r.status])}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {translateText(r.name)}
                  </span>
                  <span className="text-muted-foreground">
                    {translateText(when(r.created_at, intlLocale))}
                  </span>
                  {r.status === "completed" &&
                    r.meta?.workflow === "htc_native" && (
                      <Link
                        href={`/simulator/replay?scenario=simedape-${r.run_id}`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Map className="size-3" />{translateText(" Replay")}</Link>
                    )}
                  <Link
                    href={r.meta?.workflow === "htc_native" ? "/simulator/runs" : r.meta?.workflow?.startsWith("htc_osm_") ? `/simulator/import?job=${encodeURIComponent(r.run_id)}` : "/simedape"}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >{translateText("Detalhes")}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
