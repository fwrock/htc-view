import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBalanceRun, counterDelta, imbalance, comparisonSeries, comparisonCsv, runSummary } from '../lib/balance-comparison.ts'
const sample=(name,value,labels={})=>({name,value,labels})
const row=(elapsedSeconds,samples=[],status={status:'Running',currentTick:elapsedSeconds})=>({ts:100000+elapsedSeconds*1000,elapsedSeconds,status,error:null,samples})
const run=samples=>({schemaVersion:1,metadata:{schemaVersion:1,id:'test',scenario:'same',startedAt:100000,endedAt:null,outcome:'completed',configSha256:'a',config:{},runtimeSettings:{},startupOverrides:'',nodeCount:2,imageTag:'test',balancingEnabled:true,sampleCount:samples.length,failedSamples:0,intervalSeconds:3},samples})
test('counter summaries use initial baselines and include series first appearing after start',()=>{
 const r=run([row(0,[sample('counter',5,{node:'a'})]),row(1,[sample('counter',9,{node:'a'}),sample('counter',3,{node:'b'})]),row(2,[sample('counter',1,{node:'a'}),sample('counter',4,{node:'b'})])])
 assert.equal(counterDelta(r,'counter'),9)
 assert.equal(counterDelta(r,'missing'),null)
})
test('imbalance includes idle nodes and distinguishes absent or zero load',()=>{
 assert.deepEqual(imbalance(row(0,[sample('htc_loadbalance_node_entities',10),sample('htc_loadbalance_node_entities',0)])),{cv:1,maxMean:2})
 assert.equal(imbalance(row(0,[])).cv,null)
 assert.equal(imbalance(row(0,[sample('htc_loadbalance_node_entities',0)])).cv,null)
})
test('comparison charts align independent wall clocks on elapsed time',()=>{
 const r=run([row(0),row(3)]);r.samples[1].status.currentTick=100
 assert.deepEqual(comparisonSeries(r,'tick'),[[0,0],[3000,100]])
 const other=structuredClone(r);other.samples.forEach(s=>s.ts+=86400000)
 assert.deepEqual(comparisonSeries(other,'tick'),comparisonSeries(r,'tick'))
})
test('collection failures do not become zero observations or CPU rates across gaps',()=>{
 const r=run([row(0,[sample('process_cpu_seconds_total',0)]),{...row(3),error:'missing'},row(6,[sample('process_cpu_seconds_total',6)]),row(9,[sample('process_cpu_seconds_total',12)])])
 assert.deepEqual(comparisonSeries(r,'cpu'),[[9000,2]])
 assert.equal(runSummary(r).completedMigrations,null)
})
test('CSV retains run provenance and unavailable metrics',()=>{
 const text=comparisonCsv([run([row(0)])])
 assert.match(text,/configSha256/);assert.match(text,/same/);assert.match(text,/completedMigrations/)
 assert.ok(!text.includes('NaN'))
})
test('imports reject invalid points and out of order observations',()=>{
 const r=run([row(3),row(0)]);assert.throws(()=>validateBalanceRun(r),/order/)
 assert.throws(()=>validateBalanceRun({schemaVersion:2}),/Unsupported/)
 const bad=run([row(0,[sample('bad',Infinity)])]);assert.throws(()=>validateBalanceRun(bad),/sample/)
})
test('disabled baselines can compare actor imbalance including known idle nodes',()=>{
 const observation=row(0,[sample('htc_node_info',1,{node:'a'}),sample('htc_node_info',1,{node:'b'}),sample('htc_actors_active',8,{node:'a',actor_type:'Car'}),sample('htc_actors_active',2,{node:'a',actor_type:'Person'})])
 assert.deepEqual(imbalance(observation,'actors'),{cv:1,maxMean:2})
 assert.equal(imbalance(observation).cv,null)
})
