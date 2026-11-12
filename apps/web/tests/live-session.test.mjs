import test from 'node:test'
import assert from 'node:assert/strict'
import { latestRecordedBase,liveStreamUrl } from '../lib/live-session.ts'

test('live stream filters by report UUID independently from the scenario geometry',()=>{
 assert.equal(liveStreamUrl('ws://localhost:8090/ws/live','report-uuid'),'ws://localhost:8090/ws/live?simulationId=report-uuid')
 assert.equal(liveStreamUrl('ws://localhost/ws/live?x=1','report-uuid'),'ws://localhost/ws/live?x=1&simulationId=report-uuid')
})
test('experiment live view resolves the latest base, not a newer partial or a different scenario',()=>{
 const entries=[
  {id:'old',scenario_key:'toulouse',scenario_id:'toulouse-completa-zzz-20261104000000',run_kind:'base'},
  {id:'new',scenario_key:'toulouse',scenario_id:'toulouse-completa-aaa-20261104120000',run_kind:'base'},
  {id:'partial',scenario_key:'toulouse',scenario_id:'toulouse-parcial-20261104130000',run_kind:'partial'},
  {id:'other',scenario_key:'other',run_kind:'base'}]
 assert.equal(latestRecordedBase(entries,'toulouse'),'new')
 assert.equal(latestRecordedBase(entries,'missing'),null)
})
