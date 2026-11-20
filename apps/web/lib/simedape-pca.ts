import type { PcaTrainingSettings } from './simedape-api'

/** The percentage is a UI value; native training receives a fraction in (0,1]. */
export function pcaTrainingSettings(mode: 'components' | 'variance', count: string, percentage: string, centering: 'cluster_mean' | 'simulation_point' = 'cluster_mean'): PcaTrainingSettings {
  if (!['cluster_mean', 'simulation_point'].includes(centering)) throw new Error('Invalid PCA centering')
  const origin = centering === 'simulation_point' ? { centering } : {}
  if (mode === 'variance') {
    const value = Number(percentage)
    if (!Number.isFinite(value) || value <= 0 || value > 100) throw new Error('A meta de variância do PCA deve estar entre 0 e 100%.')
    return { ...origin, selection_mode: 'variance', variance_threshold: value / 100 }
  }
  const value = Number(count)
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('O número de componentes do PCA deve ser um inteiro positivo.')
  return { ...origin, n_components: value }
}
