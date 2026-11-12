import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {resolveRecordedReplay} from '../lib/recorded-replay.ts'

test('scenario replay resolves a base UUID on a read-only-style scenario mount, never the partial run',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'recorded-replay-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const cfg={scenariosDir:path.join(root,'scenarios'),parquetDir:path.join(root,'absent-engine-output')}
 const reports=path.join(cfg.scenariosDir,'toulouse','reports','parquet')
 for(const id of ['base-uuid','partial-uuid']){await mkdir(path.join(reports,id),{recursive:true});await writeFile(path.join(reports,id,'events.parquet'),'fixture')}
 const result=await resolveRecordedReplay(cfg,'toulouse',[
  {id:'partial-uuid',scenario_key:'toulouse',run_kind:'partial'},
  {id:'base-uuid',scenario_key:'toulouse',run_kind:'base',label:'Toulouse · base'}])
 assert.equal(result.reportId,'base-uuid');assert.equal(result.parquetDir,path.join(reports,'base-uuid'))
 await assert.rejects(resolveRecordedReplay(cfg,'missing',[]),/No completed base/)
})
