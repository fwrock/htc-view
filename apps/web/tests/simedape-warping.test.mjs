import test from 'node:test'
import assert from 'node:assert/strict'
import { warpingSettings } from '../lib/simedape-warping.ts'

const defaults = { dtwAlgorithm: 'exact', dtwRadius: '1', dtwWorkers: '0', dtwBatchSize: '16' }

test('DTW form preserves automatic scheduling and explicit FastDTW settings', () => {
  assert.deepEqual(warpingSettings(defaults), { algorithm: 'exact', radius: 1, n_jobs: 0, batch_size: 16 })
  assert.deepEqual(warpingSettings({ ...defaults, dtwAlgorithm: 'fastdtw', dtwRadius: '3', dtwWorkers: '8' }),
    { algorithm: 'fastdtw', radius: 3, n_jobs: 8, batch_size: 16 })
})

test('Invalid scheduling and algorithm settings fail before submission', () => {
  for (const [key, value] of [['dtwRadius', '-1'], ['dtwRadius', '129'], ['dtwWorkers', '257'], ['dtwWorkers', '1.5'], ['dtwBatchSize', '0'], ['dtwBatchSize', ''], ['dtwAlgorithm', 'unknown']]) {
    assert.throws(() => warpingSettings({ ...defaults, [key]: value }))
  }
})
