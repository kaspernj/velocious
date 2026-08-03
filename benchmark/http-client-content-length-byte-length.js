import { performance } from "node:perf_hooks"

/**
 * Models the previous allocating Content-Length calculation.
 * @param {string} body - Request body.
 * @returns {number} - UTF-8 byte length.
 */
function allocatingByteLength(body) {
  return Buffer.from(body).byteLength
}

/**
 * Models the current allocation-free Content-Length calculation.
 * @param {string} body - Request body.
 * @returns {number} - UTF-8 byte length.
 */
function nativeByteLength(body) {
  return Buffer.byteLength(body, "utf8")
}

/**
 * Times a length calculation over enough iterations for stable measurements.
 * @param {(body: string) => number} calculate - Length implementation.
 * @param {string} body - Benchmark input.
 * @param {number} iterations - Iteration count.
 * @returns {number} - Elapsed milliseconds per iteration.
 */
function time(calculate, body, iterations) {
  const startedAt = performance.now()

  for (let iteration = 0; iteration < iterations; iteration += 1) calculate(body)

  return (performance.now() - startedAt) / iterations
}

const bodies = [
  {label: "64 B ASCII", body: "a".repeat(64)},
  {label: "8 KiB JSON-ish ASCII", body: `{"data":"${"value".repeat(1_365)}"}`},
  {label: "256 KiB multibyte/astral", body: "ö€😀".repeat(65_536)}
]

console.log("body\tBuffer.from().byteLength\tBuffer.byteLength()\tspeedup")

for (const {label, body} of bodies) {
  const iterations = Math.max(100, Math.floor(20_000_000 / body.length))

  if (nativeByteLength(body) != allocatingByteLength(body)) {
    throw new Error(`Byte length mismatch for ${label}`)
  }

  // Warm both implementations before measuring them.
  allocatingByteLength(body)
  nativeByteLength(body)

  const allocatingMilliseconds = time(allocatingByteLength, body, iterations)
  const nativeMilliseconds = time(nativeByteLength, body, iterations)
  const speedup = allocatingMilliseconds / nativeMilliseconds

  console.log(`${label}\t${allocatingMilliseconds.toFixed(6)} ms\t${nativeMilliseconds.toFixed(6)} ms\t${speedup.toFixed(1)}x`)

  if (label == "256 KiB multibyte/astral" && speedup <= 1) {
    throw new Error(`Allocation-free byte length was not faster for ${label}`)
  }
}
