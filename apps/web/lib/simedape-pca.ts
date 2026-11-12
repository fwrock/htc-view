import type { PcaTrainingSettings } from './simedape-api'

/** The percentage is a UI value; native training receives a fraction in (0,1]. */
export function pcaTrainingSettings(mode: 'components' | 'variance', count: string, percentage: string): PcaTrainingSettings {
  if (mode === 'variance') {
    const value = Number(percentage)
    if (!Number.isFinite(value) || value <= 0 || value > 100) throw new Error('A meta de variância do PCA deve estar entre 0 e 100%.')
    return { selection_mode: 'variance', variance_threshold: value / 100 }
  }
  const value = Number(count)
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('O número de componentes do PCA deve ser um inteiro positivo.')
  return { n_components: value }
}
