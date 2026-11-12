import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
registerHooks({resolve(specifier,context,next){
 if(specifier==='@/lib/i18n')return{url:new URL('../lib/i18n/index.ts',import.meta.url).href,shortCircuit:true}
 return next(specifier,context)
},load(url,context,next){
 if(url.includes('/lib/i18n/messages/')&&url.endsWith('.json'))return{format:'module',source:`export default ${readFileSync(new URL(url),'utf8')}`,shortCircuit:true}
 return next(url,context)
}})
const {panelCsv,panelJson,panelLatex}=await import('../lib/metrics-export.ts')
test('elapsed chart exports use seconds rather than 1970 UTC dates',()=>{
 const data={kind:'series',timeAxis:'elapsed',unit:'tick',series:[{label:'run A',points:[[0,1],[3500,42]]}]}
 assert.match(panelCsv(data),/elapsed_seconds/)
 assert.match(panelCsv(data),/3.5,42/)
 assert.ok(!panelCsv(data).includes('1970'))
 assert.match(panelCsv(data,false),/3.5,run A,42,tick/)
 const json=JSON.parse(panelJson('Comparison',data,{source:'run A',windowLabel:'all',generatedAt:1000}))
 assert.equal(json.series[0].points[1].elapsed_seconds,3.5)
 assert.ok(!panelLatex('Comparison',data).includes('1970'))
})
