import { performance } from "node:perf_hooks"

const modelCounts = [1_000, 10_000, 100_000]

/**
 * Models the previous preloader ID accumulation.
 * @param {Array<number | string>} ids - IDs read from models.
 * @returns {Array<number | string>} - First-seen unique IDs.
 */
function accumulateWithArray(ids) {
  /** @type {Array<number | string>} */
  const uniqueIds = []

  for (const id of ids) {
    if (!uniqueIds.includes(id)) uniqueIds.push(id)
  }

  return uniqueIds
}

/**
 * Models the current preloader ID accumulation.
 * @param {Array<number | string>} ids - IDs read from models.
 * @returns {Array<number | string>} - First-seen unique IDs.
 */
function accumulateWithSet(ids) {
  /** @type {Set<number | string>} */
  const uniqueIds = new Set()

  for (const id of ids) uniqueIds.add(id)

  return [...uniqueIds]
}

/**
 * Times an accumulator over enough iterations for stable small-input measurements.
 * @param {(ids: Array<number | string>) => Array<number | string>} accumulator - Accumulation implementation.
 * @param {Array<number | string>} ids - Benchmark input.
 * @param {number} iterations - Iteration count.
 * @returns {number} - Elapsed milliseconds per iteration.
 */
function time(accumulator, ids, iterations) {
  const startedAt = performance.now()

  for (let iteration = 0; iteration < iterations; iteration += 1) accumulator(ids)

  return (performance.now() - startedAt) / iterations
}

console.log("models\tArray.includes\tSet\tspeedup")

for (const modelCount of modelCounts) {
  const ids = Array.from({length: modelCount}, (_value, index) => index % 2 == 0 ? index / 2 : String((index - 1) / 2))
  const iterations = Math.max(1, Math.floor(100_000 / modelCount))
  const arrayResult = accumulateWithArray(ids)
  const setResult = accumulateWithSet(ids)

  if (JSON.stringify(setResult) != JSON.stringify(arrayResult)) {
    throw new Error(`Set accumulation changed ID order or identity for ${modelCount} models`)
  }

  // Warm both implementations before measuring them.
  accumulateWithArray(ids)
  accumulateWithSet(ids)

  const arrayMilliseconds = time(accumulateWithArray, ids, iterations)
  const setMilliseconds = time(accumulateWithSet, ids, iterations)
  const speedup = arrayMilliseconds / setMilliseconds

  console.log(`${modelCount}\t${arrayMilliseconds.toFixed(3)} ms\t${setMilliseconds.toFixed(3)} ms\t${speedup.toFixed(1)}x`)

  if (speedup <= 1) throw new Error(`Set accumulation was not faster for ${modelCount} models`)
}
