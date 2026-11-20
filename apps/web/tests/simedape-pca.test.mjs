import test from 'node:test'
import assert from 'node:assert/strict'
import { pcaTrainingSettings } from '../lib/simedape-pca.ts'

test('Fixed component count retains the legacy native configuration', () => {
  assert.deepEqual(pcaTrainingSettings('components', '5', '95'), { n_components: 5 })
  assert.deepEqual(pcaTrainingSettings('components', '20', 'bad'), { n_components: 20 })
  for (const count of ['0', '-1', '2.5', 'NaN', 'Infinity', '2147483648']) assert.throws(() => pcaTrainingSettings('components', count, '95'))
})
test('Variance percentages are encoded as native fractions rather than component caps', () => {
  assert.deepEqual(pcaTrainingSettings('variance', '5', '95'), { selection_mode: 'variance', variance_threshold: 0.95 })
  assert.deepEqual(pcaTrainingSettings('variance', 'bad', '99.5'), { selection_mode: 'variance', variance_threshold: 0.995 })
  assert.deepEqual(pcaTrainingSettings('variance', '5', '100'), { selection_mode: 'variance', variance_threshold: 1 })
  for (const percent of ['', '0', '-1', '100.1', 'NaN', 'Infinity']) assert.throws(() => pcaTrainingSettings('variance', '5', percent))
})

test('simulation-point centering survives fixed-rank and energy-target API settings', () => {
  assert.deepEqual(pcaTrainingSettings('components', '5', '95', 'simulation_point'), {centering:'simulation_point',n_components:5})
  assert.deepEqual(pcaTrainingSettings('variance', '5', '95', 'simulation_point'), {centering:'simulation_point',selection_mode:'variance',variance_threshold:.95})
  assert.throws(() => pcaTrainingSettings('components', '5', '95', 'wrong'))
})
