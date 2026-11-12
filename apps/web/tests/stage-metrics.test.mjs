import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/components/i18n-provider') return { url: 'data:text/javascript,export const useI18n = () => ({t: x => x, intlLocale: "en-US"})', shortCircuit: true }
    if (specifier === '@/lib/simedape-api') return { url: 'data:text/javascript,export const getRunMetrics = async () => ({stages: []}); export const runMetricsDownloadUrl = id => "/metrics/" + id;', shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('/components/simedape/stage-metrics.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    }
    return next(url, context)
  },
})
const { StageMetricsView } = await import('../components/simedape/stage-metrics.tsx')
const usage = { latest: { cpu_cores: 2.5, cpu_percent_capacity: 25, heap_used_bytes: 8589934592, heap_max_bytes: 137438953472, rss_bytes: null }, peaks: { heap_used_bytes: 11811160064 }, cpu_seconds: 15, cpu_cores_mean: 2, gc_seconds: 0.2, gc_collections: 2, disk_read_bytes: 0, disk_write_bytes: null }
const fixture = (work) => ({ index: 1, name: 'clustering', status: 'running', sampled_at: 100, resources: usage, current_phase: 'assignment', details: {}, collection_errors: 0, phases: [{ name: 'assignment', status: 'running', invocations: 1, elapsed_seconds: 10, resources: usage, details: { iteration: 2 }, work }] })

test('Scala resource summary renders units and leaves unknown phase progress indeterminate', () => {
  const html = renderToStaticMarkup(React.createElement(StageMetricsView, { runId: 'fixture', metrics: fixture({ completed: 1000, total: null, unit: 'series', percent: null, rate_per_second: 100, eta_seconds: null }) }))
  assert.ok(html.includes('8.00 GiB / 128.00 GiB'))
  assert.ok(html.includes('2.5'))
  assert.ok(html.includes('assignment'))
  assert.ok(html.includes('JVM process metrics include concurrent jobs'))
  assert.ok(!html.includes('<progress'))
  assert.ok(!html.includes('NaN'))
})

test('Known work has a phase progress bar and qualified ETA', () => {
  const html = renderToStaticMarkup(React.createElement(StageMetricsView, { runId: 'fixture', metrics: fixture({ completed: 50, total: 100, unit: 'series', percent: 50, rate_per_second: 5, eta_seconds: 10 }) }))
  assert.ok(html.includes('<progress'))
  assert.ok(html.includes('value="50"'))
  assert.ok(html.includes('Estimated phase remaining'))
  assert.ok(html.includes('/metrics/fixture'))
})


test('Output storage shows available bytes and a low-space message', () => {
  const metrics = fixture({ completed: null, total: null, unit: '', percent: null, rate_per_second: null, eta_seconds: null })
  metrics.storage = { usable_bytes: 524288000, total_bytes: 107374182400, filesystem: '/dev/data', path: '/data/scala/run', below_minimum: true }
  const html = renderToStaticMarkup(React.createElement(StageMetricsView, { runId: 'fixture', metrics }))
  assert.ok(html.includes('500.00 MiB'))
  assert.ok(html.includes('/data/scala/run'))
  assert.ok(html.includes('Low free disk space'))
})
