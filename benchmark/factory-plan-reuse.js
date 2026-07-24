import {performance} from "node:perf_hooks"
import {createFactoryRegistry} from "../src/testing/factory/index.js"

class BenchmarkModel {
  /** @param {Record<string, ?>} attributes - Assigned attributes. */
  constructor(attributes = {}) {
    Object.assign(this, attributes)
  }
}

const registry = createFactoryRegistry()
const requestedTraits = Array.from({length: 8}, (_value, index) => `trait${index}`)

registry.define(({factory, trait}) => {
  for (let index = 0; index < 8; index += 1) {
    trait(`trait${index}`, ({attribute}) => {
      attribute(`traitValue${index}`, index)
    })
  }

  factory("benchmarkBase", BenchmarkModel, ({attribute}) => {
    for (let index = 0; index < 12; index += 1) attribute(`baseValue${index}`, index)
  })

  for (let level = 1; level <= 4; level += 1) {
    factory(`benchmarkLevel${level}`, {parent: level === 1 ? "benchmarkBase" : `benchmarkLevel${level - 1}`}, ({attribute}) => {
      for (let index = 0; index < 6; index += 1) attribute(`level${level}Value${index}`, level * 10 + index)
    })
  }
})
const originalCompileTemplate = registry._runner.compileTemplate.bind(registry._runner)
let compileCount = 0

registry._runner.compileTemplate = (...args) => {
  compileCount += 1

  return originalCompileTemplate(...args)
}

/**
 * Measures a list invocation after one warm-up run.
 * @param {number} count - Number of records to resolve.
 * @returns {Promise<{milliseconds: number, compileCount: number}>} - Measurement.
 */
async function measure(count) {
  await registry.attributesForList("benchmarkLevel4", 10, ...requestedTraits)
  compileCount = 0
  const startedAt = performance.now()
  const result = await registry.attributesForList("benchmarkLevel4", count, ...requestedTraits)
  const milliseconds = performance.now() - startedAt

  if (result.length !== count || result[0].traitValue7 !== 7 || result[0].level4Value5 !== 45) {
    throw new Error("Factory plan benchmark produced unexpected attributes")
  }

  return {milliseconds, compileCount}
}

console.log("records\tcompiles\ttotal\tper record")

for (const count of [1_000, 10_000]) {
  const measurement = await measure(count)
  console.log(`${count}\t${measurement.compileCount}\t${measurement.milliseconds.toFixed(2)} ms\t${(measurement.milliseconds / count).toFixed(4)} ms`)
}
