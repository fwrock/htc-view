import test from 'node:test'
import assert from 'node:assert/strict'
import {coverageWarnings,observeProcessIdentities} from '../lib/metrics-coverage.ts'
const sample=(name,value,labels={})=>({name,value,labels})
test('partial scrapes name the missing exporter and warn that totals are incomplete',()=>{
 const warnings=coverageWarnings([sample('htc_cluster_metrics_expected_nodes',4),sample('htc_cluster_metrics_available_nodes',3),sample('htc_cluster_metrics_scrape_success',0,{target:'http://localhost:9103/metrics'})])
 assert.equal(warnings.length,1);assert.match(warnings[0],/3\/4/);assert.match(warnings[0],/9103/)
 assert.deepEqual(coverageWarnings([sample('htc_cluster_metrics_expected_nodes',4),sample('htc_cluster_metrics_available_nodes',4)]),[])
 assert.deepEqual(coverageWarnings([]),[])
})
test('temporary exporter absence retains history identity and a real process restart clears it',()=>{
 const previous=new Map([['node-0',1],['node-1',2]])
 const partial=observeProcessIdentities(previous,[sample('process_start_time_seconds',1,{node:'node-0'})])
 assert.equal(partial.restarted,false);assert.equal(partial.identities.get('node-1'),2)
 assert.equal(observeProcessIdentities(partial.identities,[sample('process_start_time_seconds',2,{node:'node-1'})]).restarted,false)
 assert.equal(observeProcessIdentities(previous,[sample('process_start_time_seconds',3,{node:'node-1'})]).restarted,true)
})
