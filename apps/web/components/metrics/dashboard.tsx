"use client"

import { ExecutionTimings } from "./execution-timings"
import { timeWarpSummary } from "@/lib/time-warp-metrics"
import { useI18n } from "@/components/i18n-provider"

import { useMemo, useRef, useState } from "react"
import { Download, FileText, Loader2, Pause, Play, RotateCcw } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  breakdown,
  buckets,
  distribution,
  fmtBytes,
  fmtNum,
  fmtSeconds,
  has,
  histogramAvg,
  latestValue,
  lines,
  quantile,
  rates,
  total,
  useMetricsStore,
  type Line,
  type MetricsStore,
} from "@/lib/metrics-store"
import { capturePanels, exportAll, exportReportPdf, type ExportMeta, type ReportSection } from "@/lib/metrics-export"
import { BarList, Distribution, Empty, ExportContext, LineChart, Matrix, Meter, Panel, Stat } from "./charts"

type SectionId = "timings" | "overview" | "actors" | "timewarp" | "trips" | "people" | "routing" | "load" | "managers" | "jvm" | "nodes" | "explorer"
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview", label: "Visão geral" },
  { id: "timings", label: "Cronômetros" },
  { id: "actors", label: "Atores e mensagens" },
  { id: "timewarp", label: "Time Warp" },
  { id: "trips", label: "Viagens e vias" },
  { id: "people", label: "Pessoas e transporte" },
  { id: "routing", label: "Roteamento" },
  { id: "load", label: "Carga e relatórios" },
  { id: "managers", label: "Managers" },
  { id: "jvm", label: "JVM e processo" },
  { id: "nodes", label: "Nós" },
  { id: "explorer", label: "Explorador" },
]
const WINDOWS = [
  { id: "120000", label: "2 min" },
  { id: "300000", label: "5 min" },
  { id: "900000", label: "15 min" },
  { id: "0", label: "Tudo" },
]
const select = "h-7 rounded-sm border border-input bg-background px-2 text-xs"

interface Ctx {
  store: MetricsStore
  since?: number
}
const mk = ({ store, since }: Ctx) => ({
  L: (name: string, o: { by?: string; where?: Record<string, string | string[]> } = {}) => lines(store, name, { ...o, since }),
  R: (name: string, o: { by?: string; where?: Record<string, string | string[]> } = {}) => rates(lines(store, name, { ...o, since })),
})

function Series({ title, hint, series, format, unit, height }: { title: string; hint?: string; series: Line[]; format?: (v: number) => string; unit?: string; height?: number }) {
  const { t: translateText } = useI18n()

  return (
    <Panel title={translateText(title)} hint={translateText(hint)} data={{ kind: "series", series, unit }}>
      <LineChart series={series} format={format} height={height} />
    </Panel>
  )
}

function Hist({ ctx, title, hint, base, where, format, unit }: { ctx: Ctx; title: string; hint?: string; base: string; where?: Record<string, string | string[]>; format?: (v: number) => string; unit?: string }) {
  const { t: translateText } = useI18n()

  if (!has(ctx.store, base + "_bucket") && !has(ctx.store, base)) return null
  const h = buckets(ctx.store, base, where, ctx.since ? { since: ctx.since } : "latest")
  const bins = distribution(h.buckets)
  const quantiles = [{ q: "p50", v: quantile(h.buckets, 0.5) }, { q: "p95", v: quantile(h.buckets, 0.95) }, { q: "p99", v: quantile(h.buckets, 0.99) }]
  return (
    <Panel title={translateText(title)} hint={translateText(hint ?? (ctx.since ? "Observações dentro da janela escolhida." : "Desde o início da simulação."))} data={{ kind: "bins", bins, quantiles, unit }}>
      <Distribution bins={bins} quantiles={quantiles} format={format} />
    </Panel>
  )
}

function Bars({ title, hint, items, format, unit }: { title: string; hint?: string; items: { label: string; value: number }[]; format?: (v: number) => string; unit?: string }) {
  const { t: translateText } = useI18n()

  return (
    <Panel title={translateText(title)} hint={translateText(hint)} data={{ kind: "bars", items, unit }}>
      <BarList items={items} format={format} />
    </Panel>
  )
}

/** Short role of a manager from its class name: GTM (global time), LTM (local time), LBM (load balancing), ... */
function roleOf(manager: string): { short: string; label: string; order: number } {
  if (/GlobalTimeManager$/.test(manager)) return { short: "GTM", label: "gerenciador de tempo global", order: 0 }
  if (/LocalTime.*Manager$|TimeManager$/.test(manager) && !/Global/.test(manager)) return { short: "LTM", label: "gerenciador de tempo local", order: 1 }
  if (manager === "LoadBalanceManager") return { short: "LBM", label: "balanceamento de carga", order: 2 }
  if (manager === "SimulationManager") return { short: "SIM", label: "controle da simulação", order: 3 }
  if (manager === "ReportManager") return { short: "REP", label: "relatórios", order: 4 }
  if (/LoadDataManager$/.test(manager)) return { short: "LOAD", label: "carga de dados", order: 5 }
  return { short: "—", label: "", order: 9 }
}

const lastRate = (ls: Line[]) => ls.reduce((a, l) => a + (latestValue(l) ?? 0), 0)

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

function Overview(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { L, R } = mk(ctx)
  const tick = total(store, "htc_simulation_current_tick")
  const ratio = total(store, "htc_simulation_progress_ratio")
  const duration = total(store, "htc_simulation_configured_duration_ticks")
  const tickRate = R("htc_simulation_current_tick")
  const msgRate = R("htc_messages_sent_total")
  const evRate = R("htc_events_processed_total")
  const hist = buckets(store, "htc_tick_duration_seconds")
  const avgTick = hist.count ? hist.sum / hist.count : null
  const avgLine: Line[] = [{ label: "duração média", points: histogramAvg(store, "htc_tick_duration_seconds").filter((p) => !ctx.since || p[0] >= ctx.since) }]
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={translateText("Tick atual")} value={fmtNum(tick, 0)} sub={duration ? translateText("de {0}", { 0: fmtNum(duration, 0) }) : undefined} />
        <Stat label={translateText("Progresso")} value={ratio === null ? "—" : (ratio * 100).toFixed(1) + "%"} />
        <Stat label={translateText("Ticks por segundo")} value={fmtNum(lastRate(tickRate), 1)} sub={translateText("tempo real")} />
        <Stat label={translateText("Duração média do tick")} value={fmtSeconds(avgTick)} sub={translateText("desde o início")} />
        <Stat label={translateText("Atores ativos")} value={fmtNum(total(store, "htc_actors_active"), 0)} />
        <Stat label={translateText("Mensagens por segundo")} value={fmtNum(lastRate(msgRate), 0)} />
        <Stat label={translateText("Eventos por segundo")} value={fmtNum(lastRate(evRate), 0)} />
        <Stat label={translateText("Dead letters")} value={fmtNum(total(store, "htc_dead_letters_total"), 0)} sub={translateText("acumulado")} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Series title={translateText("Tick da simulação")} series={L("htc_simulation_current_tick")} format={(v) => fmtNum(v, 0)} unit="tick" />
        <Series title={translateText("Ticks por segundo")} hint={translateText("Velocidade da simulação em tempo real.")} series={tickRate} format={(v) => fmtNum(v, 1)} unit="ticks/s" />
        <Series title={translateText("Duração média do tick")} hint={translateText("Média entre duas coletas.")} series={avgLine} format={fmtSeconds} unit="s" />
        <Series title={translateText("Mensagens e eventos por segundo")} series={[...msgRate.map((l) => ({ ...l, label: "mensagens" })), ...evRate.map((l) => ({ ...l, label: "eventos" }))]} format={(v) => fmtNum(v, 0)} unit="/s" />
      </div>
      <Hist ctx={ctx} title={translateText("Duração do tick")} base="htc_tick_duration_seconds" format={fmtSeconds} unit="s" />
    </>
  )
}

function Actors(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { L, R } = mk(ctx)
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Series title={translateText("Atores ativos por tipo")} series={L("htc_actors_active", { by: "actor_type" })} format={(v) => fmtNum(v, 0)} unit="atores" />
      <Bars title={translateText("Atores ativos agora")} items={breakdown(store, "htc_actors_active", "actor_type")} format={(v) => fmtNum(v, 0)} unit="atores" />
      <Series title={translateText("Atores registrados por segundo")} hint={translateText("Chegadas nos gerenciadores de tempo.")} series={R("htc_actors_registered_total", { by: "actor_type" })} format={(v) => fmtNum(v, 1)} unit="/s" />
      <Series title={translateText("Atores destruídos por segundo")} series={R("htc_actors_destroyed_total", { by: "actor_type" })} format={(v) => fmtNum(v, 1)} unit="/s" />
      <Series title={translateText("Eventos processados por segundo")} hint={translateText("Por tipo de evento.")} series={R("htc_events_processed_total", { by: "event_type" })} format={(v) => fmtNum(v, 0)} unit="/s" />
      <Series title={translateText("Mensagens enviadas por segundo (por remetente)")} series={R("htc_messages_sent_total", { by: "from_type" })} format={(v) => fmtNum(v, 0)} unit="/s" />
      <Series title={translateText("Mensagens enviadas por segundo (por evento)")} series={R("htc_messages_sent_total", { by: "event_type" })} format={(v) => fmtNum(v, 0)} unit="/s" />
      <Bars title={translateText("Mensagens enviadas (total) por evento")} items={breakdown(store, "htc_messages_sent_total", "event_type")} format={(v) => fmtNum(v, 0)} unit="mensagens" />
      <Series title={translateText("Eventos com estado nulo por segundo")} hint={translateText("Deveria ser zero; indica evento chegando a ator sem estado.")} series={R("htc_events_when_state_is_null_total", { by: "actor_type" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <Bars title={translateText("Dead letters por destinatário")} items={breakdown(store, "htc_dead_letters_total", "recipient_type")} format={(v) => fmtNum(v, 0)} unit="mensagens" />
    </div>
  )
}

function TimeWarp(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { L, R } = mk(ctx)
  const summary = timeWarpSummary(store.latest)
  if (!summary.enabled) return <Empty>{translateText("Time Warp não está ativo neste engine.")}</Empty>
  return (
    <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="GVT" value={fmtNum(summary.gvt, 0)} sub={translateText("fronteira confirmada")}/>
      <Stat label={translateText("Commits confirmados")} value={fmtNum(summary.commits, 0)} sub={translateText("{0} workers", { 0: summary.workers ?? "—" })}/>
      <Stat label={translateText("Rollbacks")} value={fmtNum(summary.rollbacks, 0)} />
      <Stat label={translateText("Antimensagens")} value={fmtNum(summary.antiMessages, 0)} />
    </div>
    <p className="text-[11px] text-muted-foreground">{translateText("O progresso usa GVT confirmado. Zero rollbacks também é um resultado válido no modo otimista.")}</p>
    <div className="grid gap-3 lg:grid-cols-2">
      <Series title="GVT" series={L("htc_time_warp_gvt")} format={(v) => fmtNum(v, 0)} unit="ticks" />
      <Series title={translateText("Eventos especulativos retidos")} series={L("htc_time_warp_speculative_events")} format={(v) => fmtNum(v, 0)} />
      <Series title={translateText("Checkpoints e eventos retidos")} series={[...L("htc_time_warp_retained_checkpoints"), ...L("htc_time_warp_retained_events"), ...L("htc_time_warp_retained_reports")]} format={(v) => fmtNum(v, 0)} />
      <Series title={translateText("Rollbacks por segundo")} hint={translateText("Por tipo do ator que sofreu o rollback.")} series={R("htc_straggler_rollback_triggered_total", { by: "receiver_actor_type" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <Series title={translateText("Antimensagens enviadas por segundo")} series={R("htc_antimessages_sent_total", { by: "sender_actor_type" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <Series title={translateText("Rollbacks causados por antimensagem")} series={R("htc_antimessage_rollback_triggered_total", { by: "receiver_actor_type" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <Series title={translateText("Respostas obsoletas descartadas")} hint={translateText("Sem rollback.")} series={R("htc_stale_reply_dropped_without_rollback_total", { by: "event_type" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <Series title={translateText("Relatórios descartados por rollback")} series={R("htc_report_discarded_by_rollback_total", { by: "event_type" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <Hist ctx={ctx} title={translateText("Distância do rollback")} base="htc_straggler_rollback_distance_ticks" format={(v) => fmtNum(v, 0)} unit="ticks" />
    </div>
    </>
  )
}

function Trips(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { L, R } = mk(ctx)
  const started = total(store, "htc_journeys_started_total")
  const done = total(store, "htc_journeys_completed_total")
  const ok = total(store, "htc_journey_successes_total")
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={translateText("Jornadas iniciadas")} value={fmtNum(started, 0)} />
        <Stat label={translateText("Jornadas concluídas")} value={fmtNum(done, 0)} sub={started ? translateText("{0}% das iniciadas", { 0: ((100 * (done ?? 0)) / started).toFixed(1) }) : undefined} />
        <Stat label={translateText("Sucesso")} value={done ? `${((100 * (ok ?? 0)) / done).toFixed(1)}%` : "—"} sub={translateText("das concluídas")} />
        <Stat label={translateText("Veículos nas vias")} value={fmtNum(total(store, "htc_link_vehicles_active"), 0)} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Series title={translateText("Jornadas iniciadas por segundo")} series={R("htc_journeys_started_total", { by: "vehicle_type" })} format={(v) => fmtNum(v, 1)} unit="/s" />
        <Series title={translateText("Jornadas concluídas por segundo")} series={R("htc_journeys_completed_total", { by: "vehicle_type" })} format={(v) => fmtNum(v, 1)} unit="/s" />
        <Bars title={translateText("Falhas de jornada por motivo")} items={breakdown(store, "htc_journey_failures_total", "reason")} format={(v) => fmtNum(v, 0)} unit="jornadas" />
        <Bars title={translateText("Jornadas concluídas por motivo e modo")} items={breakdown(store, "htc_movable_complete_journey_reason_total", "reason")} format={(v) => fmtNum(v, 0)} unit="jornadas" />
        <Hist ctx={ctx} title={translateText("Duração das jornadas")} base="htc_journey_duration_ticks" format={(v) => fmtNum(v, 0)} unit="ticks" />
        <Hist ctx={ctx} title={translateText("Distância das jornadas")} base="htc_journey_distance_meters" format={(v) => fmtNum(v, 0)} unit="m" />
        <Series title={translateText("Veículos ativos nas vias")} series={L("htc_link_vehicles_active")} format={(v) => fmtNum(v, 0)} unit="veículos" />
        <Series title={translateText("Entradas em vias por segundo")} series={R("htc_link_vehicles_entered_total", { by: "mode" })} format={(v) => fmtNum(v, 1)} unit="/s" />
        <Series title={translateText("Saídas de vias por segundo")} series={R("htc_link_vehicles_exited_total", { by: "mode" })} format={(v) => fmtNum(v, 1)} unit="/s" />
        <Hist ctx={ctx} title={translateText("Tempo de travessia de uma via")} base="htc_link_travel_time_ticks" format={(v) => fmtNum(v, 0)} unit="ticks" />
        <Series title={translateText("Teletransportes por segundo")} hint={translateText("Veículos presos que foram movidos.")} series={R("htc_teleport_total", { by: "mode" })} format={(v) => fmtNum(v, 2)} unit="/s" />
        <Series title={translateText("Mudanças de fase dos semáforos por segundo")} series={R("htc_traffic_signal_phase_changes_total", { by: "to_phase" })} format={(v) => fmtNum(v, 1)} unit="/s" />
      </div>
    </>
  )
}

function People(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { L, R } = mk(ctx)
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Series title={translateText("Atividades iniciadas por segundo")} series={R("htc_person_activity_start_total", { by: "activity_type" })} format={(v) => fmtNum(v, 1)} unit="/s" />
      <Bars title={translateText("Modo de transporte escolhido")} hint={translateText("Resolvido, acumulado.")} items={breakdown(store, "htc_person_mode_choice_resolved_total", "resolved_mode")} format={(v) => fmtNum(v, 0)} unit="escolhas" />
      <Bars title={translateText("Mudanças de modo por origem da decisão")} items={breakdown(store, "htc_person_mode_choice_changed_total", "source")} format={(v) => fmtNum(v, 0)} unit="mudanças" />
      <Series title={translateText("Chegadas atrasadas por segundo")} series={R("htc_person_delayed_arrival_total", { by: "activity_type" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <Hist ctx={ctx} title={translateText("Atraso de chegada")} base="htc_person_arrival_delay_ticks" format={(v) => fmtNum(v, 0)} unit="ticks" />
      <Hist ctx={ctx} title={translateText("Excesso das atividades truncadas")} base="htc_person_truncated_activity_excess_ticks" format={(v) => fmtNum(v, 0)} unit="ticks" />
      <Series title={translateText("Ônibus: passageiros a bordo")} series={L("htc_bus_active_passengers")} format={(v) => fmtNum(v, 0)} unit="passageiros" />
      <Series title={translateText("Ônibus: embarques e desembarques por segundo")} series={[...R("htc_bus_passengers_boarded_total").map((l) => ({ ...l, label: "embarques" })), ...R("htc_bus_passengers_alighted_total").map((l) => ({ ...l, label: "desembarques" }))]} format={(v) => fmtNum(v, 1)} unit="/s" />
      <Series title={translateText("Passageiros esperando nas paradas")} series={L("htc_bus_stop_passengers_waiting")} format={(v) => fmtNum(v, 0)} unit="passageiros" />
      <Series title={translateText("Metrô: passageiros a bordo")} series={L("htc_subway_active_passengers")} format={(v) => fmtNum(v, 0)} unit="passageiros" />
      <Series title={translateText("Metrô: passageiros esperando por linha")} series={L("htc_subway_station_passengers_waiting", { by: "line" })} format={(v) => fmtNum(v, 0)} unit="passageiros" />
      <Series title={translateText("Metrô: embarques por segundo (por linha)")} series={R("htc_subway_passengers_boarded_total", { by: "line" })} format={(v) => fmtNum(v, 1)} unit="/s" />
    </div>
  )
}

function Routing(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { R } = mk(ctx)
  const avg = (algo?: string): Line => ({ label: algo ?? "todos", points: histogramAvg(store, "htc_gps_route_calc_duration_seconds", algo ? { algorithm: algo } : undefined).filter((p) => !ctx.since || p[0] >= ctx.since) })
  const algos = [...new Set(store.latest.filter((s) => s.name === "htc_gps_route_calc_duration_seconds_count").map((s) => s.labels.algorithm ?? ""))].filter(Boolean)
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Series title={translateText("Tempo médio de cálculo de rota")} hint={translateText("Média entre duas coletas, por algoritmo.")} series={algos.length ? algos.map(avg) : [avg()]} format={fmtSeconds} unit="s" />
      <Hist ctx={ctx} title={translateText("Tempo de cálculo de rota")} base="htc_gps_route_calc_duration_seconds" format={fmtSeconds} unit="s" />
      <Hist ctx={ctx} title={translateText("Saltos por rota")} base="htc_gps_route_hops" format={(v) => fmtNum(v, 0)} unit="saltos" />
      <Bars title={translateText("Origem das rotas")} items={breakdown(store, "htc_gps_route_source_total", "source")} format={(v) => fmtNum(v, 0)} unit="rotas" />
      <Bars title={translateText("Rotas não encontradas por modo")} items={breakdown(store, "htc_gps_cannot_find_route_total", "mode")} format={(v) => fmtNum(v, 0)} unit="falhas" />
      <Bars title={translateText("Nós não encontrados")} items={breakdown(store, "htc_gps_node_not_found_total", "type")} format={(v) => fmtNum(v, 0)} unit="falhas" />
      <Series title={translateText("Destinos inalcançáveis por segundo")} hint={translateText("Componente fortemente conexa.")} series={R("htc_scc_unreachable_total", { by: "mode" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <div className="grid grid-cols-2 gap-3 self-start">
        <Stat label={translateText("Landmarks do ALT")} value={fmtNum(total(store, "htc_gps_alt_landmark_count"), 0)} />
        <Stat label={translateText("Pré-cálculo do ALT")} value={fmtSeconds(total(store, "htc_gps_alt_precomputation_duration_seconds"))} />
      </div>
    </div>
  )
}

function Load(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { L, R } = mk(ctx)
  const loaded = L("htc_progressive_loaded_up_to_tick").map((l) => ({ ...l, label: "carregado até" }))
  const cur = L("htc_simulation_current_tick").map((l) => ({ ...l, label: "tick atual" }))
  const blocked = [{ label: "bloqueio médio", points: histogramAvg(store, "htc_tm_blocked_for_progressive_seconds").filter((p) => !ctx.since || p[0] >= ctx.since) }]
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Series title={translateText("Atores agendados por gerenciador de tempo")} series={L("htc_tm_scheduled_actors", { by: "manager" })} format={(v) => fmtNum(v, 0)} unit="atores" />
      <Series title={translateText("Eventos em execução por gerenciador")} series={L("htc_tm_running_events", { by: "manager" })} format={(v) => fmtNum(v, 0)} unit="eventos" />
      <Series title={translateText("Aguardando carga progressiva")} series={L("htc_tm_waiting_for_progressive")} format={(v) => fmtNum(v, 0)} />
      <Series title={translateText("Tempo médio bloqueado esperando a carga")} series={blocked} format={fmtSeconds} unit="s" />
      <Series title={translateText("Carga progressiva x tick atual")} hint={translateText("A carga precisa ficar à frente do tick.")} series={[...loaded, ...cur]} format={(v) => fmtNum(v, 0)} unit="tick" />
      <Series title={translateText("Atores criados por segundo (carga progressiva)")} series={R("htc_progressive_actors_created_total")} format={(v) => fmtNum(v, 1)} unit="/s" />
      <Hist ctx={ctx} title={translateText("Tempo de carga de uma janela")} base="htc_progressive_window_load_duration_seconds" format={fmtSeconds} unit="s" />
      <Bars title={translateText("Duração das fases da simulação")} items={breakdown(store, "htc_phase_duration_seconds", "phase")} format={fmtSeconds} unit="s" />
      <Series title={translateText("Relatórios gravados por segundo")} series={R("htc_report_flushed_total", { by: "event_type" })} format={(v) => fmtNum(v, 1)} unit="/s" />
      <Series title={translateText("Mensagens Kafka por segundo")} series={R("htc_kafka_messages_sent_total", { by: "topic" })} format={(v) => fmtNum(v, 1)} unit="/s" />
    </div>
  )
}

function Managers(ctx: Ctx & { manager: string; setManager: (m: string) => void }) {
  const { t: translateText } = useI18n()

  const { store, manager, setManager } = ctx
  const { L, R } = mk(ctx)
  const names = [...new Set(store.latest.filter((s) => s.name === "htc_manager_messages_total" || s.name === "htc_manager_instances").map((s) => s.labels.manager).filter((m): m is string => !!m))].sort()
  if (names.length === 0) {
    return (
      <div className="rounded-sm border border-border bg-card p-4 text-xs">
        <p className="font-semibold">{translateText("Este engine não publica métricas de manager (htc_manager_*).")}</p>
        <p className="mt-1 text-muted-foreground">{translateText("Elas existem em builds do engine com as métricas de nó e de manager. Confira que o JAR é recente e que o servidor Prometheus do engine está no endereço de ")}<code className="font-mono">HTC_METRICS_URL</code>{translateText(" (use ")}<code className="font-mono">HTC_METRICS_PORT=9002</code>{translateText(" no engine).")}</p>
      </div>
    )
  }
  // Roles the user expects to see; when one is missing, say why instead of leaving a silent gap.
  const present = new Set(names.map((n) => roleOf(n).short))
  const missing: { short: string; why: string }[] = []
  if (!present.has("GTM")) missing.push({ short: "GTM", why: "nenhum gerenciador de tempo global publicou métricas (engine sem as métricas de manager, ou simulação ainda não iniciou)." })
  if (!present.has("LTM")) missing.push({ short: "LTM", why: "nenhum gerenciador de tempo local publicou métricas." })
  if (!present.has("LBM")) missing.push({ short: "LBM", why: "o LoadBalanceManager só é criado com htc.load-balance-manager.enabled=true (HTC_LOAD_BALANCE_ENABLED, padrão false)." })
  const rows = names.map((m) => {
    const inst = store.latest.filter((s) => s.name === "htc_manager_instances" && s.labels.manager === m)
    const kind = [...new Set(inst.map((s) => s.labels.kind))].join("/") || "—"
    const instances = inst.reduce((a, s) => a + s.value, 0)
    const msgs = total(store, "htc_manager_messages_total", { manager: m }) ?? 0
    const rate = lastRate(R("htc_manager_messages_total", { where: { manager: m } }))
    const h = buckets(store, "htc_manager_message_seconds", { manager: m })
    const avg = h.count ? h.sum / h.count : null
    return { m, kind, instances, msgs, rate, avg, p95: quantile(h.buckets, 0.95), busy: h.sum }
  }).sort((a, b) => roleOf(a.m).order - roleOf(b.m).order || b.rate - a.rate || b.msgs - a.msgs)
  const picked = manager && names.includes(manager) ? manager : rows[0]!.m
  const perType = breakdown(store, "htc_manager_messages_total", "message", { manager: picked })
  const slowest = perType.map((t) => {
    const h = buckets(store, "htc_manager_message_seconds", { manager: picked, message: t.label })
    return { label: t.label, value: h.count ? h.sum / h.count : 0 }
  }).sort((a, b) => b.value - a.value)
  const hasLb = has(store, "htc_loadbalance_migrations_total") || has(store, "htc_loadbalance_rebalances_total")
  const mig = store.latest.filter((s) => s.name === "htc_loadbalance_migrations_total")
  const migNodes = [...new Set(mig.flatMap((s) => [s.labels.from_node ?? "?", s.labels.to_node ?? "?"]))].sort()
  const migCells = migNodes.map((r) => migNodes.map((c) => mig.filter((s) => s.labels.from_node === r && s.labels.to_node === c).reduce((a, s) => a + s.value, 0)))
  return (
    <>
      <Panel title={translateText("Managers")} hint={translateText("Mensagens tratadas e tempo de tratamento por manager. singleton: roda em um nó do cluster; node: um por nó.")}
        data={{ kind: "table", columns: ["manager", "papel", "tipo", "instâncias", "mensagens", "mensagens/s", "tempo médio (s)", "p95 (s)", "tempo ocupado total (s)"], rows: rows.map((r) => [r.m, roleOf(r.m).short, r.kind, r.instances, r.msgs, Number(r.rate.toFixed(2)), r.avg, r.p95, Number(r.busy.toFixed(3))]) }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Papel")}</th><th className="pr-3">{translateText("Manager")}</th><th className="pr-3">{translateText("Tipo")}</th><th className="pr-3 text-right">{translateText("Inst.")}</th><th className="pr-3 text-right">{translateText("Mensagens")}</th><th className="pr-3 text-right">{translateText("Msg/s")}</th><th className="pr-3 text-right">{translateText("Médio")}</th><th className="pr-3 text-right">{translateText("p95")}</th><th className="text-right">{translateText("Ocupado")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.m} className={cn("cursor-pointer border-t border-border hover:bg-muted/40", r.m === picked && "bg-primary/5")} onClick={() => setManager(r.m)}>
                  <td className="py-1 pr-3 font-semibold" title={translateText(roleOf(r.m).label)}>{translateText(roleOf(r.m).short)}</td>
                  <td className="pr-3 font-medium">{translateText(r.m)}</td>
                  <td className="pr-3">{translateText(r.kind)}</td>
                  <td className="pr-3 text-right font-mono">{translateText(fmtNum(r.instances, 0))}</td>
                  <td className="pr-3 text-right font-mono">{translateText(fmtNum(r.msgs, 0))}</td>
                  <td className="pr-3 text-right font-mono">{translateText(fmtNum(r.rate, 1))}</td>
                  <td className="pr-3 text-right font-mono">{translateText(fmtSeconds(r.avg))}</td>
                  <td className="pr-3 text-right font-mono">{translateText(fmtSeconds(r.p95))}</td>
                  <td className="text-right font-mono">{translateText(fmtSeconds(r.busy))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground">{translateText("Clique em uma linha para detalhar. \"Ocupado\" é o tempo total tratando mensagens. Instâncias 0 em um singleton: ele já terminou (por exemplo, a carga de dados).")}</p>
        {missing.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 rounded-sm border border-dashed border-border p-2 text-[11px] text-muted-foreground">
            {missing.map((m) => <li key={m.short}><span className="font-semibold text-foreground">{translateText(m.short)}</span>{translateText(" não está ativo: ")}{translateText(m.why)}</li>)}
          </ul>
        )}
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Series title={translateText("Mensagens por segundo, por manager")} series={R("htc_manager_messages_total", { by: "manager" })} format={(v) => fmtNum(v, 0)} unit="/s" />
        <Series title={translateText("Tempo médio de tratamento, por manager")} hint={translateText("Média entre duas coletas.")} series={names.map((m) => ({ label: m, points: histogramAvg(store, "htc_manager_message_seconds", { manager: m }).filter((p) => !ctx.since || p[0] >= ctx.since) }))} format={fmtSeconds} unit="s" />
        <Series title={translateText("Instâncias por manager")} hint={translateText("Singleton: 1 no nó que o hospeda.")} series={L("htc_manager_instances", { by: "manager" })} format={(v) => fmtNum(v, 0)} unit="instâncias" />
      </div>
      <div className="flex items-center gap-2 text-xs"><span className="font-semibold">{translateText("Detalhe:")}</span>
        <select className={select} value={picked} onChange={(e) => setManager(e.target.value)}>{names.map((n) => <option key={n} value={n}>{translateText(n)}</option>)}</select>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Series title={translateText("{0}: mensagens por segundo, por tipo", { 0: picked })} series={R("htc_manager_messages_total", { by: "message", where: { manager: picked } })} format={(v) => fmtNum(v, 1)} unit="/s" />
        <Hist ctx={ctx} title={translateText("{0}: tempo de tratamento", { 0: picked })} base="htc_manager_message_seconds" where={{ manager: picked }} format={fmtSeconds} unit="s" />
        <Bars title={translateText("{0}: mensagens por tipo (acumulado)", { 0: picked })} items={perType} format={(v) => fmtNum(v, 0)} unit="mensagens" />
        <Bars title={translateText("{0}: tipos mais lentos (tempo médio)", { 0: picked })} items={slowest} format={fmtSeconds} unit="s" />
      </div>
      {hasLb && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={translateText("Migrações concluídas")} value={fmtNum(total(store, "htc_loadbalance_migrations_total", { outcome: "completed" }), 0)} />
            <Stat label={translateText("Migrações planejadas")} value={fmtNum(total(store, "htc_loadbalance_migrations_planned_total"), 0)} />
            <Stat label={translateText("Avaliações de rebalanceamento")} value={fmtNum(total(store, "htc_loadbalance_rebalances_total"), 0)} sub={translateText("{0} geraram migrações", { 0: fmtNum(total(store, "htc_loadbalance_rebalances_total", { result: "migrations" }), 0) })} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {migNodes.length > 0 && (
              <Panel title={translateText("Migrações de shard: nó de origem × nó de destino")} data={{ kind: "matrix", rows: migNodes, cols: migNodes, cells: migCells, rowLabel: "origem", colLabel: "destino", unit: "migrações" }}>
                <Matrix rows={migNodes} cols={migNodes} cells={migCells} rowLabel={translateText("origem")} colLabel={translateText("destino")} format={(v) => fmtNum(v, 0)} />
              </Panel>
            )}
            <Series title={translateText("Migrações por segundo")} series={R("htc_loadbalance_migrations_total", { by: "outcome" })} format={(v) => fmtNum(v, 2)} unit="/s" />
            <Hist ctx={ctx} title={translateText("Duração de uma migração")} base="htc_loadbalance_migration_seconds" format={fmtSeconds} unit="s" />
            <Bars title={translateText("Migrações planejadas por motivo")} items={breakdown(store, "htc_loadbalance_migrations_planned_total", "reason")} format={(v) => fmtNum(v, 0)} unit="migrações" />
          </div>
        </>
      )}
    </>
  )
}


function Jvm(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { L, R } = mk(ctx)
  const heap = (n: string, label: string) => L(n, { where: { area: "heap" } }).map((l) => ({ ...l, label }))
  const used = total(store, "jvm_memory_bytes_used", { area: "heap" })
  const max = total(store, "jvm_memory_bytes_max", { area: "heap" })
  const cpu = R("process_cpu_seconds_total").map((l) => ({ ...l, label: "CPU", points: l.points.map(([t, v]) => [t, v * 100] as [number, number]) }))
  const fdsOpen = total(store, "process_open_fds")
  const fdsMax = total(store, "process_max_fds")
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title={translateText("Memória heap")}>
        <Meter value={used !== null && max ? used / max : null} label={translateText("{0} de {1}", { 0: fmtBytes(used), 1: fmtBytes(max) })} />
      </Panel>
      <Panel title={translateText("Descritores de arquivo")}>
        <Meter value={fdsOpen !== null && fdsMax ? fdsOpen / fdsMax : null} label={translateText("{0} de {1}", { 0: fmtNum(fdsOpen, 0), 1: fmtNum(fdsMax, 0) })} />
      </Panel>
      <Series title={translateText("Heap")} series={[...heap("jvm_memory_bytes_used", "usado"), ...heap("jvm_memory_bytes_committed", "reservado"), ...heap("jvm_memory_bytes_max", "máximo")]} format={fmtBytes} unit="bytes" />
      <Series title={translateText("Memória fora do heap")} series={L("jvm_memory_bytes_used", { where: { area: "nonheap" } }).map((l) => ({ ...l, label: "usada" }))} format={fmtBytes} unit="bytes" />
      <Bars title={translateText("Pools de memória (usado)")} items={breakdown(store, "jvm_memory_pool_bytes_used", "pool")} format={fmtBytes} unit="bytes" />
      <Series title={translateText("CPU do processo")} hint={translateText("100% = um núcleo.")} series={cpu} format={(v) => v.toFixed(0) + "%"} unit="%" />
      <Series title={translateText("Tempo de pausa de GC por segundo")} series={R("jvm_gc_collection_seconds_sum", { by: "gc" })} format={(v) => fmtSeconds(v)} unit="s/s" />
      <Series title={translateText("Coletas de GC por segundo")} series={R("jvm_gc_collection_seconds_count", { by: "gc" })} format={(v) => fmtNum(v, 2)} unit="/s" />
      <Series title={translateText("Threads por estado")} series={L("jvm_threads_state", { by: "state" })} format={(v) => fmtNum(v, 0)} unit="threads" />
      <Series title={translateText("Memória residente do processo")} series={L("process_resident_memory_bytes")} format={fmtBytes} unit="bytes" />
    </div>
  )
}

function Nodes(ctx: Ctx) {
  const { t: translateText } = useI18n()

  const { store } = ctx
  const { L, R } = mk(ctx)
  const info = store.latest.filter((s) => s.name === "htc_node_info")
  const traffic = store.latest.filter((s) => s.name === "htc_messages_by_node_total")
  const nodeLabel = store.latest.some((s) => s.labels.node && s.name !== "htc_node_info")
  if (info.length === 0 && traffic.length === 0 && !nodeLabel) {
    return (
      <div className="flex flex-col gap-2 rounded-sm border border-border bg-card p-4 text-xs">
        <p className="font-semibold">{translateText("Este engine ainda não publica informações de nó.")}</p>
        <p className="text-muted-foreground">{translateText("Engines com identidade de nó publicam ")}<code className="font-mono">htc_node_info</code>{translateText(" (nome e posição do nó) e")}{" "}
          <code className="font-mono">htc_messages_by_node_total</code>{translateText(" (mensagens por nó de origem e destino, local ou remoto). Para ver vários nós de um cluster, aponte ")}<code className="font-mono">HTC_METRICS_URL</code>{translateText(" para todos, com um nome cada:")}</p>
        <pre className="overflow-x-auto rounded-sm border border-border bg-muted/30 p-2 font-mono text-[11px]">
          HTC_METRICS_URL=&quot;pereiro=http://10.0.0.5:9001/metrics,sao-paulo=http://10.0.0.6:9001/metrics&quot;
        </pre>
      </div>
    )
  }

  // --- who talks to whom -------------------------------------------------------------------
  const pairs = new Map<string, number>()
  const names = new Set<string>()
  const byLocality = new Map<string, number>()
  for (const s of traffic) {
    const from = s.labels.from_node ?? "?"
    const to = s.labels.to_node ?? "?"
    names.add(from)
    names.add(to)
    pairs.set(`${from}\u0000${to}`, (pairs.get(`${from}\u0000${to}`) ?? 0) + s.value)
    byLocality.set(s.labels.locality ?? "?", (byLocality.get(s.labels.locality ?? "?") ?? 0) + s.value)
  }
  const nodeNames = [...names].filter((n) => n !== "unknown").sort()
  const cols = nodeNames
  const rows = [...nodeNames, ...(names.has("unknown") ? ["unknown"] : [])]
  const cells = rows.map((r) => cols.map((c) => pairs.get(`${r}\u0000${c}`) ?? 0))
  const totalMsgs = [...byLocality.values()].reduce((a, v) => a + v, 0)
  const remote = byLocality.get("remote") ?? 0
  const local = byLocality.get("local") ?? 0
  const pairBars = [...pairs.entries()].map(([k, value]) => ({ label: k.replace("\u0000", " → "), value })).sort((a, b) => b.value - a.value)
  const localityLines = R("htc_messages_by_node_total", { by: "locality" })
  const fromTo = R("htc_messages_by_node_total", { by: "to_node", where: { locality: "remote" } })

  // message types: local / remote / unknown per event_type
  const byType = new Map<string, { local: number; remote: number; unknown: number }>()
  for (const s of traffic) {
    const t = s.labels.event_type ?? "?"
    const cur = byType.get(t) ?? { local: 0, remote: 0, unknown: 0 }
    const loc = (s.labels.locality ?? "unknown") as "local" | "remote" | "unknown"
    cur[loc] += s.value
    byType.set(t, cur)
  }
  const typeRows = [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.local + b.remote + b.unknown - (a.local + a.remote + a.unknown))
  // actor class pairs
  const classPairs = new Map<string, number>()
  const classNames = new Set<string>()
  for (const s of store.latest) {
    if (s.name !== "htc_messages_by_class_total") continue
    const f = s.labels.from_type ?? "?"
    const t = s.labels.to_type ?? "?"
    classNames.add(f)
    classNames.add(t)
    classPairs.set(`${f}\u0000${t}`, (classPairs.get(`${f}\u0000${t}`) ?? 0) + s.value)
  }
  const classList = [...classNames].sort()
  const classCells = { rows: classList, cols: classList, cells: classList.map((r) => classList.map((c) => classPairs.get(`${r}\u0000${c}`) ?? 0)) }
  const singletons = store.latest
    .filter((x) => x.name === "htc_manager_instances" && x.labels.kind === "singleton" && x.value > 0)
    .map((x) => ({ manager: x.labels.manager ?? "", node: x.labels.node ?? info[0]?.labels.node ?? "", value: x.value }))
  const nodeList = info.length ? info.map((s) => ({ name: s.labels.node ?? "", rank: s.labels.rank ?? "", address: s.labels.address ?? "", strategy: s.labels.strategy ?? "" })) : []
  const labelled = nodeLabel ? [...new Set(store.latest.map((s) => s.labels.node).filter((n): n is string => !!n && !nodeList.some((x) => x.name === n)))].sort() : []
  return (
    <>
      {traffic.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={translateText("Mensagens entre atores")} value={fmtNum(totalMsgs, 0)} sub={translateText("desde o início")} />
          <Stat label={translateText("Mesmo nó (local)")} value={totalMsgs ? `${((100 * local) / totalMsgs).toFixed(1)}%` : "—"} sub={translateText(fmtNum(local, 0))} />
          <Stat label={translateText("Outro nó (remoto)")} value={totalMsgs ? `${((100 * remote) / totalMsgs).toFixed(1)}%` : "—"} sub={translateText(fmtNum(remote, 0))} />
          <Stat label={translateText("Origem desconhecida")} value={fmtNum(byLocality.get("unknown") ?? 0, 0)} sub={translateText("remetente sem carimbo")} />
        </div>
      )}
      {nodeList.length > 0 && (
        <Panel title={translateText("Nós do cluster")} hint={translateText("Nome e posição atribuídos automaticamente a partir dos membros do cluster.")} data={{ kind: "bars", items: nodeList.map((n) => ({ label: `${n.name} (posição ${n.rank})`, value: total(store, "htc_actors_active", { node: n.name }) ?? Number(n.rank) })), unit: "" }}>
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Nó")}</th><th className="pr-3">{translateText("Posição")}</th><th className="pr-3">{translateText("Estratégia")}</th><th>{translateText("Endereço")}</th></tr></thead>
            <tbody>{nodeList.map((n) => <tr key={n.name} className="border-t border-border"><td className="py-1 pr-3 font-medium">{translateText(n.name)}</td><td className="pr-3">{translateText(n.rank)}</td><td className="pr-3">{translateText(n.strategy)}</td><td className="font-mono text-muted-foreground">{translateText(n.address)}</td></tr>)}</tbody>
          </table>
        </Panel>
      )}
      {traffic.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title={translateText("Mensagens: nó de origem × nó de destino")} hint={translateText("Total acumulado. A diagonal é tráfego dentro do mesmo nó; fora dela, entre nós.")} className="lg:col-span-2"
            data={{ kind: "matrix", rows, cols, cells, rowLabel: "origem", colLabel: "destino", unit: "mensagens" }}>
            <Matrix rows={rows} cols={cols} cells={cells} rowLabel={translateText("origem")} colLabel={translateText("destino")} format={(v) => fmtNum(v, 0)} />
          </Panel>
          <Series title={translateText("Mensagens por segundo (local x remoto)")} series={localityLines} format={(v) => fmtNum(v, 0)} unit="/s" />
          <Series title={translateText("Mensagens remotas por segundo, por nó de destino")} series={fromTo} format={(v) => fmtNum(v, 0)} unit="/s" />
          <Bars title={translateText("Pares origem → destino mais frequentes")} items={pairBars} format={(v) => fmtNum(v, 0)} unit="mensagens" />
        </div>
      )}
      {typeRows.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title={translateText("Tipo de mensagem: mesmo nó x outro nó")} hint={translateText("Mensagens acumuladas por tipo (event_type) e localidade.")}
            data={{ kind: "table", columns: ["tipo de mensagem", "local", "remoto", "desconhecido", "% remoto"], rows: typeRows.map((r) => [r.type, r.local, r.remote, r.unknown, r.local + r.remote ? Number(((100 * r.remote) / (r.local + r.remote)).toFixed(2)) : 0]) }}>
            <table className="w-full text-[11px]">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Tipo")}</th><th className="pr-3 text-right">{translateText("Local")}</th><th className="pr-3 text-right">{translateText("Remoto")}</th><th className="text-right">{translateText("% remoto")}</th></tr></thead>
              <tbody>
                {typeRows.slice(0, 14).map((r) => (
                  <tr key={r.type} className="border-t border-border">
                    <td className="py-1 pr-3 font-medium">{translateText(r.type)}</td>
                    <td className="pr-3 text-right font-mono">{translateText(fmtNum(r.local, 0))}</td>
                    <td className="pr-3 text-right font-mono">{translateText(fmtNum(r.remote, 0))}</td>
                    <td className="text-right font-mono">{r.local + r.remote ? translateText(((100 * r.remote) / (r.local + r.remote)).toFixed(1) + "%") : translateText("—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {typeRows.length > 14 && <p className="text-[10px] text-muted-foreground">+ {translateText(typeRows.length - 14)}{translateText(" tipos (veja o CSV).")}</p>}
          </Panel>
          <Series title={translateText("Mensagens por segundo, por tipo")} series={R("htc_messages_by_node_total", { by: "event_type" })} format={(v) => fmtNum(v, 0)} unit="/s" />
        </div>
      )}
      {classCells.rows.length > 0 && (
        <Panel title={translateText("Mensagens: classe do ator de origem × classe do destino")} hint={translateText("Quem conversa com quem (Car, Link, Node…), todas as localidades somadas.")} className="lg:col-span-2"
          data={{ kind: "matrix", rows: classCells.rows, cols: classCells.cols, cells: classCells.cells, rowLabel: "origem", colLabel: "destino", unit: "mensagens" }}>
          <Matrix rows={classCells.rows} cols={classCells.cols} cells={classCells.cells} rowLabel={translateText("origem")} colLabel={translateText("destino")} format={(v) => fmtNum(v, 0)} />
        </Panel>
      )}
      {singletons.length > 0 && (
        <Panel title={translateText("Singletons e onde rodam")} hint={translateText("Cada singleton de cluster roda em um único nó (instâncias = 1).")}
          data={{ kind: "table", columns: ["singleton", "nó", "instâncias"], rows: singletons.map((x) => [x.manager, x.node, x.value]) }}>
          <ul className="flex flex-col gap-1 text-[11px]">
            {singletons.map((x) => <li key={x.manager + x.node} className="flex justify-between gap-3 border-t border-border pt-1"><span className="font-medium">{translateText(x.manager)}</span><span className="text-muted-foreground">{translateText(x.node || "este nó")}</span></li>)}
          </ul>
        </Panel>
      )}
      {labelled.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Series title={translateText("Atores ativos por nó")} series={L("htc_actors_active", { by: "node" })} format={(v) => fmtNum(v, 0)} unit="atores" />
          <Series title={translateText("Mensagens enviadas por segundo, por nó")} series={R("htc_messages_sent_total", { by: "node" })} format={(v) => fmtNum(v, 0)} unit="/s" />
          <Series title={translateText("Heap usado por nó")} series={L("jvm_memory_bytes_used", { by: "node", where: { area: "heap" } })} format={fmtBytes} unit="bytes" />
          <Series title={translateText("CPU por nó")} series={R("process_cpu_seconds_total", { by: "node" }).map((l) => ({ ...l, points: l.points.map(([t, v]) => [t, v * 100] as [number, number]) }))} format={(v) => v.toFixed(0) + "%"} unit="%" />
        </div>
      )}
    </>
  )
}

function Explorer(ctx: Ctx & { metric: string; setMetric: (m: string) => void; by: string; setBy: (b: string) => void; mode: "auto" | "value" | "rate"; setMode: (m: "auto" | "value" | "rate") => void; query: string; setQuery: (q: string) => void }) {
  const { t: translateText } = useI18n()

  const { store, metric, by, mode } = ctx
  const names = useMemo(() => {
    const base = new Set<string>()
    for (const s of store.latest) base.add(s.name.replace(/_(bucket|sum|count)$/, (m) => (store.meta.get(s.name.replace(/_(bucket|sum|count)$/, ""))?.type === "histogram" ? "" : m)))
    return [...base].sort()
  }, [store])
  const shown = names.filter((n) => n.toLowerCase().includes(ctx.query.toLowerCase()))
  const type = store.meta.get(metric)?.type ?? "untyped"
  const labelNames = useMemo(() => {
    const set = new Set<string>()
    for (const s of store.latest) if (s.name === metric || s.name.startsWith(metric + "_")) Object.keys(s.labels).forEach((k) => k !== "le" && set.add(k))
    return [...set].sort()
  }, [store, metric])
  const effective = mode === "auto" ? (type === "counter" ? "rate" : "value") : mode
  let series: Line[] = []
  let unit = ""
  if (metric) {
    if (type === "histogram") {
      series = [{ label: `${metric} (média por coleta)`, points: histogramAvg(store, metric).filter((p) => !ctx.since || p[0] >= ctx.since) }]
    } else {
      const raw = lines(store, metric, { by: by || undefined, since: ctx.since })
      series = effective === "rate" ? rates(raw) : raw
      unit = effective === "rate" ? "/s" : ""
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1">{translateText("Buscar")}<input className={cn(select, "w-56")} value={ctx.query} onChange={(e) => ctx.setQuery(e.target.value)} placeholder={translateText("ex.: htc_messages")} /></label>
        <label className="flex flex-col gap-1">{translateText("Métrica")}<select className={cn(select, "w-72")} value={metric} onChange={(e) => { ctx.setMetric(e.target.value); ctx.setBy("") }}>
            <option value="">{translateText("Selecione…")}</option>
            {shown.slice(0, 400).map((n) => <option key={n} value={n}>{translateText(n)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">{translateText("Agrupar por")}<select className={select} value={by} onChange={(e) => ctx.setBy(e.target.value)} disabled={type === "histogram"}>
            <option value="">{translateText("(somar tudo)")}</option>
            {labelNames.map((l) => <option key={l} value={l}>{translateText(l)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">{translateText("Valor")}<select className={select} value={mode} onChange={(e) => ctx.setMode(e.target.value as "auto" | "value" | "rate")} disabled={type === "histogram"}>
            <option value="auto">{translateText("Automático (")}{type === "counter" ? translateText("taxa/s") : translateText("valor")})</option>
            <option value="value">{translateText("Valor bruto")}</option>
            <option value="rate">{translateText("Taxa por segundo")}</option>
          </select>
        </label>
      </div>
      {metric ? (
        <>
          <p className="text-[11px] text-muted-foreground">{translateText(type)}{store.meta.get(metric)?.help ? translateText(" · {0}", { 0: store.meta.get(metric)!.help }) : translateText("")}</p>
          <Panel title={translateText(metric)} data={{ kind: "series", series, unit }}>
            <LineChart series={series} format={(v) => fmtNum(v, 2)} height={220} />
          </Panel>
          {type === "histogram" && <Hist ctx={ctx} title={translateText("{0}: distribuição", { 0: metric })} base={metric} format={(v) => fmtNum(v, 3)} />}
        </>
      ) : (
        <Empty>{translateText("Escolha uma métrica para ver o gráfico. ")}{translateText(names.length)}{translateText(" disponíveis.")}</Empty>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------

export function MetricsDashboard() {
  const { t: translateText, intlLocale, locale } = useI18n()

  const [windowMs, setWindowMs] = useState("300000")
  const [interval, setIntervalMs] = useState(3000)
  const [paused, setPaused] = useState(false)
  const [section, setSection] = useState<SectionId>("overview")
  const [metric, setMetric] = useState("")
  const [by, setBy] = useState("")
  const [mode, setMode] = useState<"auto" | "value" | "rate">("auto")
  const [query, setQuery] = useState("")
  const [manager, setManager] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const { store, error, reset } = useMetricsStore(interval, paused)
  const body = useRef<HTMLDivElement>(null)

  const since = store && Number(windowMs) ? store.ts - Number(windowMs) : undefined
  const windowLabel = WINDOWS.find((w) => w.id === windowMs)?.label ?? ""
  const meta: ExportMeta = { locale, source: store?.url ?? "", windowLabel: windowMs === "0" ? translateText("todo o histórico coletado") : translateText("últimos {0}", { 0: translateText(windowLabel) }), generatedAt: store?.ts ?? 0, section: SECTIONS.find((s) => s.id === section)?.label }

  async function report(all: boolean) {
    setBusy(all ? "pdf-all" : "pdf")
    setExportError(null)
    const original = section
    try {
      const ids = all ? SECTIONS.filter((x) => x.id !== "explorer").map((x) => x.id) : [section]
      const collected: ReportSection[] = []
      for (const id of ids) {
        if (id !== section) setSection(id)
        await new Promise((r) => setTimeout(r, 500))        // let the section render before capturing it
        const panels = body.current ? await capturePanels(body.current) : []
        if (panels.length) collected.push({ title: translateText(SECTIONS.find((x) => x.id === id)!.label), panels })
      }
      if (collected.length === 0) throw new Error("Não há painéis para exportar nesta seção.")
      await exportReportPdf(collected, meta)
    } catch (e) {
      setExportError((e as Error).message)
    } finally {
      setSection(original)
      setBusy(null)
    }
  }

  const ctx: Ctx | null = store ? { store, since } : null
  // Only the open section is rendered, as a component (its hooks stay stable across renders).
  const content = ctx ? (
    section === "timings" ? <ExecutionTimings store={ctx.store} />
    : section === "overview" ? <Overview {...ctx} />
    : section === "actors" ? <Actors {...ctx} />
    : section === "timewarp" ? <TimeWarp {...ctx} />
    : section === "trips" ? <Trips {...ctx} />
    : section === "people" ? <People {...ctx} />
    : section === "routing" ? <Routing {...ctx} />
    : section === "load" ? <Load {...ctx} />
    : section === "managers" ? <Managers {...ctx} manager={manager} setManager={setManager} />
    : section === "jvm" ? <Jvm {...ctx} />
    : section === "nodes" ? <Nodes {...ctx} />
    : <Explorer {...ctx} metric={metric} setMetric={setMetric} by={by} setBy={setBy} mode={mode} setMode={setMode} query={query} setQuery={setQuery} />
  ) : null

  return (
    <ExportContext.Provider value={meta}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5">{translateText("Janela")}<select className={select} value={windowMs} onChange={(e) => setWindowMs(e.target.value)}>{WINDOWS.map((w) => <option key={w.id} value={w.id}>{translateText(w.label)}</option>)}</select>
          </label>
          <label className="flex items-center gap-1.5">{translateText("Atualizar a cada")}<select className={select} value={interval} onChange={(e) => setIntervalMs(Number(e.target.value))}>
              {[1000, 2000, 3000, 5000, 10000].map((ms) => <option key={ms} value={ms}>{translateText(ms / 1000)}{translateText(" s")}</option>)}
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{paused ? translateText("Retomar") : translateText("Pausar")}</Button>
          <Button size="sm" variant="ghost" onClick={reset} title={translateText("Descarta o histórico coletado")}><RotateCcw className="size-3.5" />{translateText(" Limpar histórico")}</Button>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {store && (
              <>
                <Button size="sm" variant="outline" onClick={() => exportAll(store, "csv")}><Download className="size-3.5" />{translateText(" Tudo (CSV)")}</Button>
                <Button size="sm" variant="outline" onClick={() => exportAll(store, "json")}><Download className="size-3.5" />{translateText(" Tudo (JSON)")}</Button>
              </>
            )}
            <Button size="sm" disabled={!store || busy !== null} onClick={() => void report(false)}>{busy === "pdf" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}{translateText(" PDF da seção")}</Button>
            <Button size="sm" variant="outline" disabled={!store || busy !== null} onClick={() => void report(true)}>{busy === "pdf-all" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}{translateText(" PDF completo")}</Button>
          </span>
        </div>
        {exportError && <p role="alert" className="text-xs text-destructive">{translateText(exportError)}</p>}
        {store && (
          <p className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className={cn("rounded-sm border px-1.5 py-0.5 font-semibold uppercase tracking-widest", error ? "border-yellow-500/40 text-yellow-700 dark:text-yellow-400" : paused ? "border-border" : "border-green-500/30 text-green-600 dark:text-green-400")}>
              {error ? translateText("desatualizado") : paused ? translateText("pausado") : translateText("ao vivo")}
            </span>
            {translateText(store.url)} · {translateText(store.history.size)}{translateText(" séries · última leitura ")}{translateText(new Date(store.ts).toLocaleTimeString(intlLocale))}
          </p>
        )}

        {error && store && (
          <div role="status" className="rounded-sm border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs">
            <p className="font-semibold text-yellow-700 dark:text-yellow-400">{translateText("Dados desatualizados: sem conexão com o engine desde ")}{translateText(new Date(store.ts).toLocaleTimeString(intlLocale))}.</p>
            <p className="text-muted-foreground">{translateText("O que aparece abaixo é a última leitura, parada, e não reflete o engine agora.")}</p>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-xs">
            <p className="font-semibold text-red-600 dark:text-red-400">{translateText("Não foi possível ler as métricas.")}</p>
            <p className="text-muted-foreground">{translateText(error.message)}</p>
            <p className="mt-1 text-muted-foreground">{translateText("O servidor do HTC View lê ")}<code className="font-mono">HTC_METRICS_URL</code>{translateText(" (padrão ")}<code className="font-mono">http://localhost:9002/metrics</code>{translateText("). O engine precisa estar rodando com o servidor Prometheus ligado.")}</p>
          </div>
        )}

        <div role="tablist" aria-label={translateText("Seções de métricas")} className="flex flex-wrap gap-1">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}
              className={cn("rounded-sm border px-2.5 py-1 text-xs", section === s.id ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:text-foreground")}>
              {translateText(s.label)}
            </button>
          ))}
        </div>

        <div ref={body} className={cn("flex flex-col gap-3", error && store && "opacity-50")}>
          {!store && !error && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{translateText(" Lendo métricas…")}</p>}
          {translateText(content)}
        </div>
      </div>
    </ExportContext.Provider>
  )
}
