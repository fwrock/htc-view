/** Visit every requested section, including the one open when collection began. */
export async function collectReportSections<T, S extends string>(
  sections: readonly S[],
  activate: (section: S) => void | Promise<void>,
  collect: () => T[],
  options: { signal?: AbortSignal; progress?: (section: S, index: number, total: number) => void } = {},
): Promise<T[]> {
  const result: T[] = []
  for (const [index, section] of sections.entries()) {
    options.signal?.throwIfAborted()
    options.progress?.(section, index + 1, sections.length)
    await activate(section)
    options.signal?.throwIfAborted()
    result.push(...collect())
  }
  return result
}
