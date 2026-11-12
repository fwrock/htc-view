"use client"

import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { download } from "@/lib/metrics-export"
import { comparisonCsv, comparisonSeries, runSummary, samplesCsv, validateBalanceRun,
  type BalanceRun, type BalanceRunMetadata, type ComparisonMetric } from "@/lib/balance-comparison"
import { fmtBytes, fmtNum } from "@/lib/metrics-store"
import { ExportContext, LineChart, Panel } from "./charts"

const number = (v: unknown) => typeof v === "number" ? fmtNum(v, 3) : String(v ?? "—")
const label = (run: BalanceRun) => `${runSummary(run).strategy} · ${run.metadata.id.slice(0,8)}`
const charts: { key: ComparisonMetric; title: string; unit: string; format?: (v: number)=>string }[] = [
  {key:"tick",title:"Simulation progress by elapsed time",unit:"tick"},
  {key:"actorImbalance",title:"Active actor imbalance across nodes",unit:"CV"},
  {key:"imbalance",title:"Balancer observed shard load imbalance",unit:"CV"},
  {key:"heap",title:"Cluster heap used",unit:"bytes",format:fmtBytes},
  {key:"cpu",title:"Cluster CPU use",unit:"cores"},
  {key:"migrations",title:"Completed migrations",unit:"migrations"},
  {key:"remote",title:"Remote messages",unit:"messages"},
]
export function BalanceComparison() {
  const [available, setAvailable] = useState<BalanceRunMetadata[]>([])
  const [runs, setRuns] = useState<BalanceRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  async function refresh() {
    try {
      const response = await fetch("/api/balance-runs",{cache:"no-store"}); const body=await response.json()
      if (!response.ok) throw new Error(body.error ?? "Cannot read run metrics")
      setAvailable(body.runs); setEnabled(body.enabled); setError(null)
    } catch(e) { setError((e as Error).message) }
  }
  useEffect(()=>{ void refresh() },[])
  async function select(id: string) {
    if (runs.some(r=>r.metadata.id===id)) { setRuns(runs.filter(r=>r.metadata.id!==id)); return }
    setBusy(true)
    try {
      const response=await fetch(`/api/balance-runs?id=${encodeURIComponent(id)}`,{cache:"no-store"})
      const data=await response.json()
      if (!response.ok) throw new Error(data.error ?? "Cannot read run")
      const run=validateBalanceRun(data); setRuns(old=>[...old.filter(r=>r.metadata.id!==id),run]); setError(null)
    } catch(e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const columns=["Run","Scenario","Strategy","Outcome","Nodes","Observed wall time (s)","Final tick","Observed ticks/s","Mean actor CV","Mean shard load CV",
    "CPU (s)","Peak heap (bytes)","Rebalance evaluations","Planned migrations","Completed migrations",
    "Skipped migrations","Mean migration (s)","Remote message ratio","Failed load observations","Failed scrapes","Storage errors"]
  const rows=runs.map(run=>{
    const m=run.metadata,s=runSummary(run)
    return [m.id,m.scenario,s.strategy,m.outcome,m.nodeCount,s.observedSeconds,s.finalTick,s.observedTicksPerSecond,s.meanActorImbalanceCV,s.meanImbalanceCV,
      s.cpuSeconds,s.peakHeapBytes,s.rebalanceEvaluations,s.plannedMigrations,s.completedMigrations,s.skippedMigrations,
      s.meanMigrationSeconds,s.remoteMessageRatio,s.failedObservations,s.failedSamples,s.storageErrors]
  })
  const distinct=(pick:(run:BalanceRun)=>unknown)=>new Set(runs.map(pick)).size>1
  const mismatch=distinct(r=>r.metadata.configSha256)||distinct(r=>r.metadata.nodeCount)||distinct(r=>r.metadata.imageTag)
  return <ExportContext.Provider value={{source:`ClickHouse runs: ${runs.map(r=>r.metadata.id).join(", ")}`,windowLabel:"full captured runs; elapsed seconds",generatedAt:Date.now(),section:"Strategy comparison"}}><div className="flex flex-col gap-3">
    <p className="text-xs text-muted-foreground">Each cluster start records metrics in ClickHouse, even with this panel closed. Select independent executions or import their JSON exports. Charts align on elapsed seconds from capture start; capture includes loading, pauses and reporting.</p>
    {!enabled&&<p className="text-xs">Run recording is not enabled for this deployment. JSON imports remain available.</p>}
    <div className="flex flex-wrap gap-2 items-center">
      <Button size="sm" variant="outline" onClick={()=>void refresh()} disabled={busy}>Refresh runs</Button>
      <label className="text-xs">Import run JSON <input type="file" accept="application/json,.json" multiple className="text-xs" disabled={busy} onChange={async e=>{
        const files=Array.from(e.target.files??[]); setBusy(true)
        try { for (const file of files) {
          if (file.size>64*1024*1024) throw new Error("Run import exceeds 64 MiB")
          const run=validateBalanceRun(JSON.parse(await file.text()))
          setRuns(old=>[...old.filter(r=>r.metadata.id!==run.metadata.id),run])
        };setError(null) } catch(err){setError((err as Error).message)} finally{setBusy(false);e.target.value=""}
      }}/></label>
      <Button size="sm" variant="outline" disabled={!runs.length} onClick={()=>download(new Blob([comparisonCsv(runs)],{type:"text/csv;charset=utf-8"}),"balance-comparison.csv")}>Export comparison CSV</Button>
    </div>
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="max-h-60 overflow-auto rounded-sm border border-border">
      <table className="w-full text-xs"><thead><tr><th>Select</th><th>Scenario / run</th><th>Started</th><th>Outcome</th><th>Samples / failed</th></tr></thead>
      <tbody>{available.map(m=><tr key={m.id} className="border-t border-border">
        <td className="p-2"><input type="checkbox" aria-label={`Compare ${m.id}`} checked={runs.some(r=>r.metadata.id===m.id)} disabled={busy} onChange={()=>void select(m.id)}/></td>
        <td>{m.scenario} · {m.id.slice(0,8)}</td><td>{new Date(m.startedAt).toLocaleString()}</td><td>{m.outcome}</td><td>{m.sampleCount} / {m.failedSamples}</td>
      </tr>)}</tbody></table>
      {!available.length&&<p className="p-3 text-xs text-muted-foreground">No recorded runs yet.</p>}
    </div>
    {mismatch&&<p role="status" className="text-xs text-amber-700">Selected runs differ in scenario configuration, node count or image tag. Account for those differences when comparing strategies.</p>}
    {runs.some(r=>r.metadata.outcome!=="completed"||r.metadata.failedSamples||r.metadata.storageErrors)&&<p className="text-xs text-amber-700">Some selected runs are incomplete or have collection gaps. Missing measurements are shown as unavailable, not zero.</p>}
    {!!runs.length&&<>
      <Panel title="Strategy comparison summary" data={{kind:"table",columns,rows}}>
        <div className="overflow-auto"><table className="text-[11px]"><thead><tr>{columns.map(c=><th key={c} className="p-2 text-left whitespace-nowrap">{c}</th>)}</tr></thead>
        <tbody>{rows.map((row,i)=><tr key={runs[i]!.metadata.id}>{row.map((v,j)=><td key={j} className="p-2 border-t border-border whitespace-nowrap">{number(v)}</td>)}</tr>)}</tbody></table></div>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">{charts.map(chart=>{
        const series=runs.map(run=>({label:label(run),points:comparisonSeries(run,chart.key)}))
        return <Panel key={chart.key} title={chart.title} hint="Elapsed time (seconds). Export the chart or its underlying values." data={{kind:"series",series,unit:chart.unit,timeAxis:"elapsed"}}>
          <LineChart series={series} maxSeries={runs.length} format={chart.format??(v=>fmtNum(v,2))} formatTime={ms=>`${(ms/1000).toFixed(0)} s`}/>
        </Panel>
      })}</div>
      <p className="text-[11px] text-muted-foreground">Actor CV sums active actors by node, including known idle nodes. Shard CV uses the last complete balancer observation; zero total load has no defined imbalance. CPU is measured in core-seconds, not CPU percentage. Summary CV is the mean of recorded observations. Configuration hashes identify the configuration file, not the contents of every input dataset.</p>
      {runs.map(run=><details key={run.metadata.id} className="rounded-sm border border-border p-3 text-xs"><summary>{label(run)} · configuration and data exports</summary>
        <div className="my-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={()=>download(new Blob([JSON.stringify(run)],{type:"application/json"}),`balance-run-${run.metadata.id}.json`)}>Export run JSON</Button>
          <Button size="sm" variant="outline" onClick={()=>download(new Blob([samplesCsv(run)],{type:"text/csv;charset=utf-8"}),`balance-samples-${run.metadata.id}.csv`)}>Export samples CSV</Button>
        </div><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(run.metadata,null,2)}</pre>
      </details>)}
    </>}
  </div></ExportContext.Provider>
}
