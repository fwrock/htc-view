import test from 'node:test'
import assert from 'node:assert/strict'
import { getRunMetrics, runMetricsDownloadUrl, getRun, getSimedapeHealth, getSimedapeBackend, getSimedapeBackendDefault, listRuns, modelDownloadUrl } from '../lib/simedape-api.ts'

test('Scala is the default; URL and deployment choices can explicitly select Python', async () => {
  const oldWindow = globalThis.window
  const oldBackend = process.env.NEXT_PUBLIC_SIMEDAPE_BACKEND
  try {
    delete process.env.NEXT_PUBLIC_SIMEDAPE_BACKEND
    globalThis.window = { location: { pathname: '/simedape', search: '' } }
    assert.equal(getSimedapeBackend(), 'scala')
    assert.ok(modelDownloadUrl('default').includes('/api/backends/scala/'))
    process.env.NEXT_PUBLIC_SIMEDAPE_BACKEND = 'python'
    assert.equal(getSimedapeBackend(), 'python')
    globalThis.window.location.search = '?backend=scala'
    assert.equal(getSimedapeBackend(), 'scala')
    process.env.NEXT_PUBLIC_SIMEDAPE_BACKEND = 'scala'
    globalThis.window.location.search = '?backend=python'
    assert.equal(getSimedapeBackend(), 'python')
  } finally {
    globalThis.window = oldWindow
    if (oldBackend === undefined) delete process.env.NEXT_PUBLIC_SIMEDAPE_BACKEND
    else process.env.NEXT_PUBLIC_SIMEDAPE_BACKEND = oldBackend
  }
})

test('Scala selection routes pipeline requests and downloads through its namespace', async () => {
  const oldWindow = globalThis.window
  const oldFetch = globalThis.fetch
  try {
    globalThis.window = { location: { pathname: '/simedape', search: '?backend=scala' } }
    const urls = []
    globalThis.fetch = async (url) => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => [] }
    }
    assert.equal(getSimedapeBackend(), 'scala')
    await getSimedapeHealth()
    await listRuns()
    assert.ok(urls.every(url => url.includes('/api/backends/scala/api/')))
    assert.ok(modelDownloadUrl('model-id').includes('/api/backends/scala/api/runs/model-id/model/download'))
    globalThis.window.location.pathname = '/simulator/runs'
    await listRuns()
    assert.ok(!urls.at(-1).includes('/api/backends/'))
    globalThis.window.location = { pathname: '/simedape', search: '?backend=python' }
    await listRuns()
    assert.ok(!urls.at(-1).includes('/api/backends/'))
  } finally {
    globalThis.window = oldWindow
    globalThis.fetch = oldFetch
  }
})

test('Runtime backend default is always read from Python management', async () => {
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/backends'))
      assert.ok(!url.includes('/api/backends/scala/'))
      return { ok: true, json: async () => ({ default: 'scala' }) }
    }
    assert.equal(await getSimedapeBackendDefault(), 'scala')
  } finally { globalThis.fetch = oldFetch }
})


test('Run logs keep line boundaries for Scala arrays and Python text', async () => {
  const oldFetch = globalThis.fetch
  try {
    for (const logs of [['Loaded 1000 links', 'Stage completed'], 'Loaded 1000 links\nStage completed']) {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ run_id: 'fixture', logs }) })
      assert.equal((await getRun('fixture')).logs, 'Loaded 1000 links\nStage completed')
    }
  } finally { globalThis.fetch = oldFetch }
})


test('Scala resource metrics and downloads use the selected backend namespace', async () => {
  const oldWindow = globalThis.window
  const oldFetch = globalThis.fetch
  try {
    globalThis.window = { location: { pathname: '/simedape', search: '?backend=scala' } }
    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/backends/scala/api/runs/fixture/metrics'))
      return { ok: true, status: 200, json: async () => ({ schema_version: 1, stages: [] }) }
    }
    assert.equal((await getRunMetrics('fixture')).schema_version, 1)
    assert.ok(runMetricsDownloadUrl('fixture').endsWith('/api/backends/scala/api/runs/fixture/metrics?download=1'))
  } finally { globalThis.window = oldWindow; globalThis.fetch = oldFetch }
})
