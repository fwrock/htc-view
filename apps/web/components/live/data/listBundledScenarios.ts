/** Mounted scenarios from the server bridge plus the static fixtures available offline. */
export async function listBundledScenarios(): Promise<string[]> {
  const [bundled, mounted] = await Promise.all([
    fetch("/data/scenarios.json").then((r) => r.ok ? r.json() : []).catch(() => []),
    fetch("/api/replay").then((r) => r.ok ? r.json() : {}).catch(() => ({})),
  ])
  const names = Array.isArray(bundled) ? bundled.filter((name: unknown): name is string => typeof name === "string") : []
  const catalog = mounted && typeof mounted === "object" ? mounted as { scenarios?: unknown } : {}
  for (const scenario of Array.isArray(catalog.scenarios) ? catalog.scenarios : [])
    if (scenario && scenario.hasGeometry === true && typeof scenario.name === "string") names.push(scenario.name)
  return [...new Set(names)].sort()
}
