import {performance} from "node:perf_hooks"
import DatabaseDriverBase from "../src/database/drivers/base.js"

/**
 * @typedef {object} Measurement
 * @property {number} heapDeltaBytes - Heap growth during the run.
 * @property {number} iterations - Number of invocations.
 * @property {string} name - Benchmark name.
 * @property {number} perMs - Average time per invocation in milliseconds.
 * @property {number} totalMs - Total elapsed time in milliseconds.
 */

class BenchmarkDriver extends DatabaseDriverBase {
  async connect() {}

  /** @returns {string} - Driver type. */
  getType() { return "test" }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /**
   * @param {string} _sql - SQL string.
   * @returns {Promise<import("../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async _queryActual(_sql) {
    return []
  }
}

const driver = new BenchmarkDriver({}, {})

/**
 * Builds an INSERT statement that is at least `targetBytes` long.
 * @param {number} targetBytes - Desired statement length in bytes.
 * @returns {string} - Large INSERT SQL.
 */
function buildInsertSql(targetBytes) {
  const prefix = "INSERT INTO tasks (name) VALUES "
  const row = "('x')"
  let sql = prefix

  while (sql.length < targetBytes) {
    if (sql.length > prefix.length) {
      sql += ", "
    }

    sql += row
  }

  return sql
}

/**
 * Unbounded reference implementation of _debugSqlPreview.
 * @param {string} sql - SQL string.
 * @returns {string} - Preview.
 */
function unboundedDebugSqlPreview(sql) {
  return sql
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
}

/**
 * Unbounded reference implementation of _schemaCacheInvalidatingSql.
 * @param {string} sql - SQL string.
 * @returns {boolean} - Whether the SQL invalidates schema metadata.
 */
function unboundedSchemaCacheInvalidatingSql(sql) {
  const normalized = sql
    .replace(/^\ufeff/, "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*(\n|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

  if (!normalized) return false
  if (/^(create|alter|drop|rename)\b/.test(normalized)) return true
  if (/^comment\s+on\b/.test(normalized)) return true
  if (/^exec(?:ute)?\s+sp_rename\b/.test(normalized)) return true
  if (/^if\b[\s\S]*\bbegin\s+(create|alter|drop|rename)\b/.test(normalized)) return true

  return false
}

/**
 * Measures a function's time and heap allocation.
 * @param {string} name - Benchmark name.
 * @param {(sql: string) => void} fn - Function to benchmark.
 * @param {string} sql - SQL input.
 * @param {number} iterations - Iterations to run.
 * @returns {Measurement} - Measurement result.
 */
function measure(name, fn, sql, iterations) {
  // Warm-up to prime any lazy state.
  for (let i = 0; i < 3; i += 1) {
    fn(sql)
  }

  if (global.gc) {
    global.gc()
  }

  const startedAtMs = performance.now()
  const startedHeapBytes = process.memoryUsage().heapUsed

  for (let i = 0; i < iterations; i += 1) {
    fn(sql)
  }

  const endedHeapBytes = process.memoryUsage().heapUsed
  const endedAtMs = performance.now()
  const totalMs = endedAtMs - startedAtMs

  return {
    heapDeltaBytes: Math.max(0, endedHeapBytes - startedHeapBytes),
    iterations,
    name,
    perMs: totalMs / iterations,
    totalMs
  }
}

/** @param {Measurement} measurement - Measurement to print. */
function printMeasurement(measurement) {
  const heapMb = (measurement.heapDeltaBytes / 1024 / 1024).toFixed(2)
  const perUs = (measurement.perMs * 1000).toFixed(1)

  console.log(`${measurement.name}\t${measurement.iterations}\t${perUs} us/op\t${heapMb} MB heap delta`)
}

console.log("size\tvariant\titerations\tper-op\t\theap delta")

for (const sizeBytes of [64 * 1024, 1024 * 1024, 8 * 1024 * 1024]) {
  const sql = buildInsertSql(sizeBytes)
  const sizeLabel = `${(sizeBytes / 1024 / 1024).toFixed(sizeBytes >= 1024 * 1024 ? 0 : 2)} MiB`
  const iterations = sizeBytes >= 8 * 1024 * 1024 ? 5 : sizeBytes >= 1024 * 1024 ? 20 : 100

  const boundedPreview = measure("preview (bounded)", (s) => driver._debugSqlPreview(s), sql, iterations)
  const unboundedPreview = measure("preview (unbounded)", unboundedDebugSqlPreview, sql, iterations)
  const boundedInvalidation = measure("invalidation (bounded)", (s) => driver._schemaCacheInvalidatingSql(s), sql, iterations)
  const unboundedInvalidation = measure("invalidation (unbounded)", unboundedSchemaCacheInvalidatingSql, sql, iterations)

  console.log(`${sizeLabel}`)
  printMeasurement(boundedPreview)
  printMeasurement(unboundedPreview)
  printMeasurement(boundedInvalidation)
  printMeasurement(unboundedInvalidation)
}
