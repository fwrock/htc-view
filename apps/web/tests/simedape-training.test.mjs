import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrainingRun, recoveryCandidates, hasTrainingModel } from '../lib/simedape-training.ts'
import { planTrainingResume, resumeTraining } from '../lib/simedape-api.ts'

const run = (id, stages, status = 'failed', extra = {}) => ({ run_id: id, status, meta: { stages, output_dir: `/data/${id}`, ...extra } })

test('Recovery training remains visible even when clustering was reused', () => {
  assert.equal(isTrainingRun(run('original', ['clustering', 'warping_paths'])), true)
  assert.equal(isTrainingRun(run('resumed', ['model_export'], 'completed', { training: true, resume_of: 'original' })), true)
  assert.equal(isTrainingRun(run('estimate', ['estimation_variants'])), false)
  assert.equal(hasTrainingModel(run('prepared', ['data_load', 'process_dataset'], 'completed', { training: true })), false)
  assert.deepEqual(recoveryCandidates([
    run('failed', ['clustering']), run('completed', ['model_export'], 'completed', { training: true }),
    run('active', ['clustering'], 'running'), run('waiting', ['clustering'], 'queued'), run('estimate', ['compare']),
  ]).map(row => row.run_id), ['failed', 'completed'])
})

test('Planning does not start a job; resumption posts the reviewed options through Scala routing', async () => {
  const oldFetch = globalThis.fetch
  const oldWindow = globalThis.window
  try {
    globalThis.window = { location: { pathname: '/simedape', search: '?backend=scala' } }
    const calls = []
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200, json: async () => ({ source_run_id: 'failed', run_id: 'new' }) }
    }
    const options = { from_stage: 'auto', checkpoint_data: true, warping_paths: { algorithm: 'fastdtw', radius: 2, n_jobs: 0, batch_size: 16 } }
    await planTrainingResume('failed', options)
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/api/backends/scala/api/runs/failed/resume-plan'))
    await resumeTraining('failed', options)
    assert.ok(calls[1].url.endsWith('/api/backends/scala/api/runs/failed/resume'))
    assert.equal(calls[1].init.method, 'POST')
    assert.deepEqual(JSON.parse(calls[1].init.body), options)
  } finally { globalThis.fetch = oldFetch; globalThis.window = oldWindow }
})
