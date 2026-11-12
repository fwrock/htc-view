/** Parallel submissions must not share an output directory when their clocks match. */
export function selectionRunStamp(timestamp: string): string {
  const nonce = globalThis.crypto.getRandomValues(new Uint32Array(2))
  return `${timestamp}-${[...nonce].map(value => value.toString(16).padStart(8, "0")).join("")}`
}
