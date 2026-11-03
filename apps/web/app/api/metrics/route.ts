import { type NextRequest, NextResponse } from "next/server"
import {
  getGauge,
  getHistogramAvg,
  getLabelledValues,
  getLabelledValuesBySample,
  getSampleByLabel,
  parsePrometheusText,
} from "@/lib/prometheus-parser"

const METRICS_URL =
  process.env.HTC_METRICS_URL ?? "http://localhost:9002/metrics"

export const runtime = "nodejs"
// Disable Next.js cache — always fresh
export const revalidate = 0

export async function GET(_req: NextRequest) {
  let raw: string
  try {
    const res = await fetch(METRICS_URL, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: `Metrics endpoint returned ${res.status}` },
        { status: 502 }
      )
    }
    raw = await res.text()
  } catch (e) {
    return NextResponse.json(
      { error: `Cannot reach metrics endpoint: ${(e as Error).message}` },
      { status: 503 }
    )
  }

  const families = parsePrometheusText(raw)

  const metrics = {
    // ── Simulation progress ─────────────────────────────────────────────
    currentTick: getGauge(families, "htc_simulation_current_tick"),
    progressRatio: getGauge(families, "htc_simulation_progress_ratio"),
    ticksTotal: getGauge(families, "htc_simulation_ticks_total"),

    // ── Tick latency ────────────────────────────────────────────────────
    tickDurationAvgMs: (() => {
      const avg = getHistogramAvg(families, "htc_tick_duration_seconds")
      return avg !== null ? avg * 1000 : null
    })(),

    // ── Actors ──────────────────────────────────────────────────────────
    activeActors: getLabelledValues(families, "htc_actors_active", "actor_type"),
    actorsRegistered: getLabelledValues(
      families,
      "htc_actors_registered_total",
      "actor_type"
    ),

    // ── Events ──────────────────────────────────────────────────────────
    eventsProcessed: getLabelledValues(
      families,
      "htc_events_processed_total",
      "event_type"
    ),

    // ── Time manager ────────────────────────────────────────────────────
    tmScheduledActors: getGauge(families, "htc_tm_scheduled_actors"),
    tmRunningEvents: getGauge(families, "htc_tm_running_events"),
    tmWaitingForProgressive: getGauge(
      families,
      "htc_tm_waiting_for_progressive"
    ),

    // ── Progressive loading ─────────────────────────────────────────────
    progressiveActorsCreated: getGauge(
      families,
      "htc_progressive_actors_created_total"
    ),
    progressiveLoadedUpToTick: getGauge(
      families,
      "htc_progressive_loaded_up_to_tick"
    ),
    progressiveWindowsLoaded: getGauge(
      families,
      "htc_progressive_windows_loaded_total"
    ),

    // ── Journeys ────────────────────────────────────────────────────────
    journeysStarted: getLabelledValues(
      families,
      "htc_journeys_started_total",
      "vehicle_type"
    ),
    journeysCompleted: getLabelledValues(
      families,
      "htc_journeys_completed_total",
      "vehicle_type"
    ),

    // ── Infrastructure ──────────────────────────────────────────────────
    deadLetters: getGauge(families, "htc_dead_letters_total"),
    kafkaMessages: getLabelledValues(
      families,
      "htc_kafka_messages_sent_total",
      "topic"
    ),

    // ── JVM Memory (heap vs non-heap) ────────────────────────────────────
    jvmHeapUsed: getSampleByLabel(
      families,
      "jvm_memory_bytes_used",
      "area",
      "heap"
    ),
    jvmHeapMax: getSampleByLabel(
      families,
      "jvm_memory_bytes_max",
      "area",
      "heap"
    ),
    jvmHeapCommitted: getSampleByLabel(
      families,
      "jvm_memory_bytes_committed",
      "area",
      "heap"
    ),
    jvmNonHeapUsed: getSampleByLabel(
      families,
      "jvm_memory_bytes_used",
      "area",
      "nonheap"
    ),
    jvmNonHeapMax: getSampleByLabel(
      families,
      "jvm_memory_bytes_max",
      "area",
      "nonheap"
    ),

    // ── JVM Memory pools (per-pool breakdown) ───────────────────────────
    jvmMemoryPoolsUsed: getLabelledValues(
      families,
      "jvm_memory_pool_bytes_used",
      "pool"
    ),
    jvmMemoryPoolsMax: getLabelledValues(
      families,
      "jvm_memory_pool_bytes_max",
      "pool"
    ),

    // ── JVM GC (summary: total pause time + count per collector) ────────
    gcPauseSecs: getLabelledValuesBySample(
      families,
      "jvm_gc_collection_seconds",
      "jvm_gc_collection_seconds_sum",
      "gc"
    ),
    gcCount: getLabelledValuesBySample(
      families,
      "jvm_gc_collection_seconds",
      "jvm_gc_collection_seconds_count",
      "gc"
    ),

    // ── JVM Threads ──────────────────────────────────────────────────────
    jvmThreadsCurrent: getGauge(families, "jvm_threads_current"),
    jvmThreadsDaemon: getGauge(families, "jvm_threads_daemon"),
    jvmThreadsPeak: getGauge(families, "jvm_threads_peak"),
    jvmThreadsDeadlocked: getGauge(families, "jvm_threads_deadlocked"),
    jvmThreadsState: getLabelledValues(
      families,
      "jvm_threads_state",
      "state"
    ),

    // ── Process ──────────────────────────────────────────────────────────
    processCpuSecondsTotal: getGauge(families, "process_cpu_seconds_total"),
    processOpenFds: getGauge(families, "process_open_fds"),
    processMaxFds: getGauge(families, "process_max_fds"),
    processResidentBytes: getGauge(families, "process_resident_memory_bytes"),
  }

  return NextResponse.json(metrics)
}
